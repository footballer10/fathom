import { DurableObject } from "cloudflare:workers";
import {
  BATTLE_DEFAULTS,
  CATEGORIES,
  DEADLINE_GRACE_MS,
  DIVE_DEFAULTS,
  matchGuess,
  nicknameProblem,
  pointsToDepth,
  tierInfo,
} from "@fathom/shared";
import type {
  BattleSettings,
  BestAnswer,
  Category,
  ClientMessage,
  DiveSettings,
  GameResult,
  LeaderboardRow,
  QuestionRecap,
  RevealRow,
  RoomKind,
  RoomPhase,
  RoomPlayer,
  RoomSnapshot,
  ServerMessage,
  TierPoints,
  UsedAnswer,
} from "@fathom/shared";
import type { Env } from "./env";
import { recordPartyResults } from "./leaderboards";
import { getIndex, getQuestions, markRoomSeen, pickRoomQuestions } from "./questions";

/**
 * One party room (Dive or Battle) per 4-letter code.
 *
 * STATE MACHINE
 *   Dive:   lobby → question → reveal → question → … → over → (host) lobby
 *   Battle: lobby → turn → turn → … (rotate → turn …) → over → (host) lobby
 *
 * The Durable Object owns every clock. The next deadline (question end,
 * reveal end, turn end, the pause before the next turn, or idle expiry) is a
 * single storage alarm; `alarm()` advances the state machine when it fires.
 * Clients only render countdowns from the `endsAt` times we send them.
 *
 * Sockets use the WebSocket Hibernation API, so the object can sleep between
 * messages. Anything that must survive a sleep lives in `this.s`, which is
 * persisted to storage after every meaningful change and reloaded on wake.
 */

type Best = (NonNullable<BestAnswer> & { at?: number }) | null;

interface Seat {
  id: string;
  nickname: string;
  joinedAt: number;
  spectator: boolean;
  score: number;
  timeUsedMs: number;
  lives: number;
  eliminated: boolean;
  eliminatedAt?: number;
  depthTrail: number[];
  /** Battle: progress toward the next life, in 32nds. */
  lifeMeter: number;
}

interface DiveAnswer {
  answerId: string;
  canonical: string;
  tier: TierPoints;
  points: number;
  corrected: boolean;
  msUsed: number;
  at: number;
}

interface DiveRound {
  questionIds: string[];
  index: number;
  prompt: string;
  category: Category;
  startedAt: number;
  endsAt: number;
  answers: Record<string, DiveAnswer>;
  penalties: Record<string, number>;
  reveal: { perPlayer: RevealRow[]; leaderboard: LeaderboardRow[]; nextAt: number } | null;
  ranks: Record<string, number>;
  best: Best;
  /** Every question's answers so far, shown at the end. */
  recap?: QuestionRecap[];
}

interface BattleRound {
  questionIds: string[];
  qPos: number;
  prompt: string;
  category: Category;
  round: number;
  baseSeconds: number;
  order: string[];
  turnPlayerId: string | null;
  turnStartedAt: number;
  turnEndsAt: number;
  /** When the next turn begins (after a short pause or the NEW PROMPT transition). */
  nextTurnAt: number;
  nextTurnPlayerId: string | null;
  used: UsedAnswer[];
  usedIds: string[];
  accepted: number;
  failed: number;
  spectatorGuesses: { playerId: string; nickname: string; text: string; canonical: string | null; tier: TierPoints | null }[];
  best: Best;
}

interface RoomState {
  code: string;
  kind: RoomKind;
  hostId: string | null;
  createdAt: number;
  lastActivity: number;
  seats: Record<string, Seat>;
  settings: DiveSettings | BattleSettings;
  phase: RoomPhase;
  dive?: DiveRound;
  battle?: BattleRound;
  results?: { results: GameResult[]; bestAnswer: BestAnswer; recap?: QuestionRecap[] };
}

interface Attachment {
  playerId: string | null;
}

const IDLE_MS = DIVE_DEFAULTS.roomIdleExpiryMinutes * 60_000;

function defaultSettings(kind: RoomKind): DiveSettings | BattleSettings {
  if (kind === "dive") {
    return {
      source: "unlimited",
      questionCount: DIVE_DEFAULTS.questionCount,
      timerSeconds: DIVE_DEFAULTS.timerSeconds,
      uniqueAnswers: DIVE_DEFAULTS.uniqueAnswers,
    };
  }
  return {
    source: "unlimited",
    lives: BATTLE_DEFAULTS.lives,
    baseSeconds: BATTLE_DEFAULTS.baseSeconds,
    failedTurnsToRotate: BATTLE_DEFAULTS.failedTurnsToRotate,
    acceptsToRotate: null,
    speedUp: BATTLE_DEFAULTS.speedUp,
  };
}

const clamp = (n: unknown, lo: number, hi: number, fallback: number) => {
  const v = Math.round(Number(n));
  return Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : fallback;
};

export class Room extends DurableObject<Env> {
  private s: RoomState | null = null;
  private lastTypingAt = new Map<string, number>();

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.blockConcurrencyWhile(async () => {
      this.s = (await ctx.storage.get<RoomState>("state")) ?? null;
    });
  }

  // -------------------------------------------------------------------------
  // HTTP entry points (called by the Worker)
  // -------------------------------------------------------------------------

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/init" && request.method === "POST") {
      const { code, kind } = await request.json<{ code: string; kind: RoomKind }>();
      const now = Date.now();
      if (this.s && now - this.s.lastActivity < IDLE_MS) return new Response("in use", { status: 409 });
      this.s = {
        code,
        kind: kind === "battle" ? "battle" : "dive",
        hostId: null,
        createdAt: now,
        lastActivity: now,
        seats: {},
        settings: defaultSettings(kind),
        phase: "lobby",
      };
      await this.save();
      return Response.json({ code });
    }
    if (url.pathname === "/exists") {
      return Response.json({ exists: !!this.s, kind: this.s?.kind ?? null });
    }
    if (request.headers.get("Upgrade") === "websocket") {
      if (!this.s) return new Response("No such room", { status: 404 });
      const pair = new WebSocketPair();
      this.ctx.acceptWebSocket(pair[1]);
      pair[1].serializeAttachment({ playerId: null } satisfies Attachment);
      return new Response(null, { status: 101, webSocket: pair[0] });
    }
    return new Response("Not found", { status: 404 });
  }

  // -------------------------------------------------------------------------
  // WebSocket events (hibernation API)
  // -------------------------------------------------------------------------

  async webSocketMessage(ws: WebSocket, raw: string | ArrayBuffer) {
    if (!this.s) return ws.close(4004, "Room closed");
    let msg: ClientMessage;
    try {
      msg = JSON.parse(typeof raw === "string" ? raw : new TextDecoder().decode(raw));
    } catch {
      return;
    }
    const now = Date.now();
    const pid = (ws.deserializeAttachment() as Attachment | null)?.playerId ?? null;

    if (msg.type === "ping") return this.send(ws, { type: "pong", t: msg.t, serverNow: now });
    if (msg.type === "join") return this.onJoin(ws, msg.playerId, msg.nickname, now);
    if (!pid || !this.s.seats[pid]) return this.send(ws, { type: "error", message: "Join the room first" });

    if (msg.type === "typing") return this.onTyping(pid, String(msg.text ?? "").slice(0, 60), now);

    this.s.lastActivity = now;
    switch (msg.type) {
      case "settings":
        if (pid !== this.s.hostId || (this.s.phase !== "lobby" && this.s.phase !== "over")) return;
        this.applySettings(msg.settings ?? {});
        break;
      case "start":
        if (pid !== this.s.hostId) return this.send(ws, { type: "error", message: "Only the host can start" });
        await this.startGame(ws, now);
        break;
      case "next":
        if (pid === this.s.hostId && this.s.phase === "reveal") await this.advanceDive(now);
        break;
      case "lobby":
        if (pid === this.s.hostId && this.s.phase === "over") this.toLobby();
        break;
      case "guess":
        await this.onGuess(ws, pid, String(msg.text ?? "").slice(0, 100), now);
        return;
    }
    await this.commit();
  }

  async webSocketClose(ws: WebSocket) {
    await this.onDisconnect(ws);
  }

  async webSocketError(ws: WebSocket) {
    await this.onDisconnect(ws);
  }

  private async onDisconnect(ws: WebSocket) {
    if (!this.s) return;
    const pid = (ws.deserializeAttachment() as Attachment | null)?.playerId;
    if (!pid) return;
    // Wait until the socket list no longer includes this one before checking who's left.
    const stillHere = this.connectedIds(ws).has(pid);
    if (!stillHere && pid === this.s.hostId) this.migrateHost(ws);
    await this.commit(ws);
  }

  // -------------------------------------------------------------------------
  // Alarm: the room's single clock
  // -------------------------------------------------------------------------

  async alarm() {
    if (!this.s) return;
    const now = Date.now();
    if (now - this.s.lastActivity >= IDLE_MS) {
      // Expire the room after 2 hours idle.
      for (const ws of this.ctx.getWebSockets()) ws.close(4000, "Room expired");
      await this.ctx.storage.deleteAll();
      this.s = null;
      return;
    }
    const s = this.s;
    if (s.phase === "question" && s.dive && now >= s.dive.endsAt + DEADLINE_GRACE_MS) {
      await this.revealDive(now);
    } else if (s.phase === "reveal" && s.dive?.reveal && now >= s.dive.reveal.nextAt) {
      await this.advanceDive(now);
    } else if ((s.phase === "turn" || s.phase === "rotate") && s.battle) {
      const b = s.battle;
      if (b.turnPlayerId && now >= b.turnEndsAt + DEADLINE_GRACE_MS) await this.battleTimeout(now);
      else if (!b.turnPlayerId && b.nextTurnAt && now >= b.nextTurnAt) this.startTurn(b.nextTurnPlayerId, now);
    }
    await this.commit();
  }

  /** Persist, broadcast a fresh snapshot to everyone, and re-arm the alarm. */
  private async commit(skip?: WebSocket) {
    await this.save();
    this.broadcastState(skip);
    await this.scheduleAlarm();
  }

  private async save() {
    if (this.s) await this.ctx.storage.put("state", this.s);
  }

  private async scheduleAlarm() {
    if (!this.s) return;
    const s = this.s;
    const times = [s.lastActivity + IDLE_MS];
    if (s.phase === "question" && s.dive) times.push(s.dive.endsAt + DEADLINE_GRACE_MS + 20);
    if (s.phase === "reveal" && s.dive?.reveal) times.push(s.dive.reveal.nextAt);
    if ((s.phase === "turn" || s.phase === "rotate") && s.battle) {
      times.push(s.battle.turnPlayerId ? s.battle.turnEndsAt + DEADLINE_GRACE_MS + 20 : s.battle.nextTurnAt);
    }
    await this.ctx.storage.setAlarm(Math.min(...times.filter((t) => t > 0)));
  }

  // -------------------------------------------------------------------------
  // Lobby: joining, reconnecting, host, settings
  // -------------------------------------------------------------------------

  private async onJoin(ws: WebSocket, playerId: string, nicknameRaw: string, now: number) {
    const s = this.s!;
    if (!/^[\w-]{8,64}$/.test(String(playerId))) return this.send(ws, { type: "error", message: "Bad player id" });
    const nickname = String(nicknameRaw ?? "").trim().slice(0, 16);
    const existing = s.seats[playerId];
    if (!existing) {
      const problem = nicknameProblem(nickname);
      if (problem) return this.send(ws, { type: "error", message: problem });
      const max = s.kind === "dive" ? DIVE_DEFAULTS.maxPlayers : BATTLE_DEFAULTS.maxPlayers;
      const seated = Object.values(s.seats).filter((x) => !x.spectator).length;
      const midGame = s.phase !== "lobby" && s.phase !== "over";
      if (!midGame && seated >= max) return this.send(ws, { type: "error", message: `This room is full (${max} players)` });
      s.seats[playerId] = {
        id: playerId,
        nickname,
        joinedAt: now,
        // Late joiners watch until the next game.
        spectator: midGame,
        score: 0,
        timeUsedMs: 0,
        lives: 0,
        eliminated: false,
        depthTrail: [],
        lifeMeter: 0,
      };
    } else if (nickname && !nicknameProblem(nickname)) {
      existing.nickname = nickname; // reconnecting to the same seat (maybe with a new name)
    }
    ws.serializeAttachment({ playerId } satisfies Attachment);
    if (!s.hostId || !this.connectedIds().has(s.hostId)) s.hostId = playerId;
    s.lastActivity = now;
    await this.commit();
  }

  /** The host left: the oldest still-connected player takes over. */
  private migrateHost(leaving?: WebSocket) {
    const s = this.s!;
    const connected = this.connectedIds(leaving);
    const next = Object.values(s.seats)
      .filter((x) => connected.has(x.id))
      .sort((a, b) => a.joinedAt - b.joinedAt)[0];
    s.hostId = next?.id ?? null;
  }

  private applySettings(patch: Partial<DiveSettings & BattleSettings>) {
    const s = this.s!;
    const src = patch.source && ["daily", "unlimited", "category"].includes(patch.source) ? patch.source : undefined;
    const cat = patch.category && (CATEGORIES as readonly string[]).includes(patch.category) ? patch.category : undefined;
    if (s.kind === "dive") {
      const cur = s.settings as DiveSettings;
      s.settings = {
        source: src ?? cur.source,
        category: cat ?? cur.category,
        questionCount: patch.questionCount !== undefined ? clamp(patch.questionCount, DIVE_DEFAULTS.questionCountMin, DIVE_DEFAULTS.questionCountMax, cur.questionCount) : cur.questionCount,
        timerSeconds: (DIVE_DEFAULTS.timerOptions as readonly number[]).includes(Number(patch.timerSeconds)) ? Number(patch.timerSeconds) : cur.timerSeconds,
        uniqueAnswers: typeof patch.uniqueAnswers === "boolean" ? patch.uniqueAnswers : cur.uniqueAnswers,
      };
    } else {
      const cur = s.settings as BattleSettings;
      s.settings = {
        source: src ?? cur.source,
        category: cat ?? cur.category,
        lives: patch.lives !== undefined ? clamp(patch.lives, BATTLE_DEFAULTS.livesMin, BATTLE_DEFAULTS.livesMax, cur.lives) : cur.lives,
        baseSeconds: patch.baseSeconds !== undefined ? clamp(patch.baseSeconds, BATTLE_DEFAULTS.baseSecondsMin, BATTLE_DEFAULTS.baseSecondsMax, cur.baseSeconds) : cur.baseSeconds,
        failedTurnsToRotate: patch.failedTurnsToRotate !== undefined ? clamp(patch.failedTurnsToRotate, 1, 5, cur.failedTurnsToRotate) : cur.failedTurnsToRotate,
        acceptsToRotate:
          patch.acceptsToRotate === null ? null : patch.acceptsToRotate !== undefined ? clamp(patch.acceptsToRotate, 1, 50, 6) : cur.acceptsToRotate,
        speedUp: typeof patch.speedUp === "boolean" ? patch.speedUp : cur.speedUp,
      };
    }
  }

  private toLobby() {
    const s = this.s!;
    s.phase = "lobby";
    s.dive = undefined;
    s.battle = undefined;
    for (const seat of Object.values(s.seats)) seat.spectator = false;
  }

  // -------------------------------------------------------------------------
  // Starting a game
  // -------------------------------------------------------------------------

  private async startGame(ws: WebSocket, now: number) {
    const s = this.s!;
    if (s.phase !== "lobby" && s.phase !== "over") return;
    const connected = this.connectedIds();
    // Everyone connected plays; disconnected seats sit this one out.
    for (const seat of Object.values(s.seats)) {
      Object.assign(seat, {
        spectator: !connected.has(seat.id),
        score: 0,
        timeUsedMs: 0,
        eliminated: false,
        eliminatedAt: undefined,
        depthTrail: [],
        lifeMeter: 0,
      });
    }
    const players = Object.values(s.seats).filter((x) => !x.spectator);
    s.results = undefined;

    if (s.kind === "dive") {
      const set = s.settings as DiveSettings;
      const ids = await pickRoomQuestions(this.env, set.source, set.category, set.questionCount, now, this.roomPlayerIds());
      if (!ids.length) return this.send(ws, { type: "error", message: "No questions available for those settings" });
      s.dive = {
        questionIds: ids,
        index: -1,
        prompt: "",
        category: "food",
        startedAt: 0,
        endsAt: 0,
        answers: {},
        penalties: {},
        reveal: null,
        ranks: {},
        best: null,
        recap: [],
      };
      await Promise.all(ids.map((id) => getIndex(this.env, id))); // warm the answer indexes
      await this.startDiveQuestion(0, now);
      return;
    }

    if (players.length < BATTLE_DEFAULTS.minPlayers) {
      return this.send(ws, { type: "error", message: `Battle needs at least ${BATTLE_DEFAULTS.minPlayers} players` });
    }
    const set = s.settings as BattleSettings;
    const ids = await pickRoomQuestions(this.env, set.source, set.category, 30, now, this.roomPlayerIds());
    if (!ids.length) return this.send(ws, { type: "error", message: "No questions available for those settings" });
    for (const p of players) p.lives = set.lives;
    const q = (await getQuestions(this.env, [ids[0]])).get(ids[0])!;
    await markRoomSeen(this.env, this.roomPlayerIds(), ids[0], now);
    s.battle = {
      questionIds: ids,
      qPos: 0,
      prompt: q.prompt,
      category: q.category,
      round: 1,
      baseSeconds: set.baseSeconds,
      order: players.sort((a, b) => a.joinedAt - b.joinedAt).map((p) => p.id),
      turnPlayerId: null,
      turnStartedAt: 0,
      turnEndsAt: 0,
      nextTurnAt: 0,
      nextTurnPlayerId: null,
      used: [],
      usedIds: [],
      accepted: 0,
      failed: 0,
      spectatorGuesses: [],
      best: null,
    };
    await getIndex(this.env, ids[0]);
    this.startTurn(s.battle!.order[0], now);
  }

  // -------------------------------------------------------------------------
  // Dive
  // -------------------------------------------------------------------------

  private async startDiveQuestion(i: number, now: number) {
    const s = this.s!;
    const d = s.dive!;
    const qid = d.questionIds[i];
    const q = (await getQuestions(this.env, [qid])).get(qid)!;
    await markRoomSeen(this.env, this.roomPlayerIds(), qid, now);
    const timer = (s.settings as DiveSettings).timerSeconds;
    Object.assign(d, {
      index: i,
      prompt: q.prompt,
      category: q.category,
      startedAt: now,
      endsAt: now + timer * 1000,
      answers: {},
      penalties: {},
      reveal: null,
    });
    s.phase = "question";
    this.broadcast({ type: "question", index: i, total: d.questionIds.length, prompt: q.prompt, category: q.category, endsAt: d.endsAt });
  }

  private personalEndsAt(pid: string) {
    const d = this.s!.dive!;
    return d.endsAt - (d.penalties[pid] ?? 0) * DIVE_DEFAULTS.wrongGuessPenaltySeconds * 1000;
  }

  private activeDivers(): Seat[] {
    return Object.values(this.s!.seats).filter((x) => !x.spectator);
  }

  private async diveGuess(ws: WebSocket, pid: string, text: string, now: number) {
    const s = this.s!;
    const d = s.dive!;
    const seat = s.seats[pid];
    if (s.phase !== "question" || seat.spectator || d.answers[pid]) return;
    const myEnd = this.personalEndsAt(pid);
    if (now > myEnd + DEADLINE_GRACE_MS) {
      return this.send(ws, { type: "guessResult", accepted: false, canonical: null, tier: null, points: 0, corrected: false, reason: "late", endsAt: myEnd });
    }
    const index = await getIndex(this.env, d.questionIds[d.index]);
    const r = matchGuess(index, text);
    if (r.accepted && r.answerId && r.canonical && r.tier) {
      d.answers[pid] = {
        answerId: r.answerId,
        canonical: r.canonical,
        tier: r.tier,
        points: r.points,
        corrected: r.corrected,
        msUsed: now - d.startedAt,
        at: now,
      };
      this.send(ws, { type: "guessResult", accepted: true, canonical: r.canonical, tier: r.tier, points: r.points, corrected: r.corrected, reason: null, endsAt: myEnd });
      this.broadcast({ type: "locked", playerId: pid });
      // Everyone who's here has locked in: reveal right away.
      const connected = this.connectedIds();
      if (this.activeDivers().filter((x) => connected.has(x.id)).every((x) => d.answers[x.id])) await this.revealDive(now);
    } else {
      d.penalties[pid] = (d.penalties[pid] ?? 0) + 1;
      this.send(ws, { type: "guessResult", accepted: false, canonical: null, tier: null, points: 0, corrected: false, reason: r.reason, endsAt: this.personalEndsAt(pid) });
    }
  }

  private leaderboard(previous: Record<string, number>): LeaderboardRow[] {
    const rows = this.activeDivers().sort((a, b) => b.score - a.score || a.timeUsedMs - b.timeUsedMs);
    return rows.map((x, i) => ({
      playerId: x.id,
      nickname: x.nickname,
      score: x.score,
      timeUsedMs: x.timeUsedMs,
      rank: i + 1,
      previousRank: previous[x.id] ?? i + 1,
    }));
  }

  private async revealDive(now: number) {
    const s = this.s!;
    const d = s.dive!;
    if (s.phase !== "question") return;
    const set = s.settings as DiveSettings;
    // "Unique answers": anyone who gave the same answer as someone else gets half points.
    const counts = new Map<string, number>();
    for (const a of Object.values(d.answers)) counts.set(a.answerId, (counts.get(a.answerId) ?? 0) + 1);

    const perPlayer: RevealRow[] = [];
    for (const seat of this.activeDivers()) {
      const a = d.answers[seat.id];
      const shared = !!a && set.uniqueAnswers && (counts.get(a.answerId) ?? 0) > 1;
      const points = a ? (shared ? Math.floor(a.points / 2) : a.points) : 0;
      seat.score += points;
      seat.timeUsedMs += a ? a.msUsed : set.timerSeconds * 1000;
      seat.depthTrail.push(pointsToDepth(seat.score));
      perPlayer.push({ playerId: seat.id, nickname: seat.nickname, canonical: a?.canonical ?? null, tier: a?.tier ?? null, points, corrected: a?.corrected ?? false, shared });
      if (a && (!d.best || a.tier > d.best.tier || (a.tier === d.best.tier && a.at < (d.best.at ?? Infinity)))) {
        d.best = { nickname: seat.nickname, canonical: a.canonical, tier: a.tier, prompt: d.prompt, at: a.at };
      }
    }
    perPlayer.sort((a, b) => b.points - a.points);
    const leaderboard = this.leaderboard(d.ranks);
    d.ranks = Object.fromEntries(leaderboard.map((r) => [r.playerId, r.rank]));
    const nextAt = now + DIVE_DEFAULTS.revealSeconds * 1000;
    d.reveal = { perPlayer, leaderboard, nextAt };
    (d.recap ??= []).push({ prompt: d.prompt, perPlayer });
    s.phase = "reveal";
    const index = await getIndex(this.env, d.questionIds[d.index]);
    this.broadcast({
      type: "reveal",
      index: d.index,
      perPlayer,
      leaderboard,
      answers: index.answers.map((a) => ({ answerId: a.id, canonical: a.canonical, tier: a.tier })),
      nextAt,
    });
  }

  private async advanceDive(now: number) {
    const d = this.s!.dive!;
    if (d.index + 1 < d.questionIds.length) await this.startDiveQuestion(d.index + 1, now);
    else this.gameOver(d.best);
  }

  // -------------------------------------------------------------------------
  // Battle
  // -------------------------------------------------------------------------

  private aliveIds(): string[] {
    const s = this.s!;
    return s.battle!.order.filter((id) => !s.seats[id].eliminated);
  }


  private startTurn(pid: string | null, now: number) {
    const s = this.s!;
    const b = s.battle!;
    const alive = this.aliveIds();
    const next = pid && alive.includes(pid) ? pid : alive[0];
    if (!next) return this.gameOver(b.best);
    const seconds = b.baseSeconds;
    Object.assign(b, { turnPlayerId: next, turnStartedAt: now, turnEndsAt: now + seconds * 1000, nextTurnAt: 0, nextTurnPlayerId: null });
    s.phase = "turn";
    this.lastTypingAt.clear();
    this.broadcast({ type: "turn", playerId: next, endsAt: b.turnEndsAt, prompt: b.prompt, seconds });
  }

  /** Who goes after `pid` in seat order, skipping eliminated players. */
  private nextAfter(pid: string): string | null {
    const b = this.s!.battle!;
    const alive = this.aliveIds();
    if (!alive.length) return null;
    const start = b.order.indexOf(pid);
    for (let k = 1; k <= b.order.length; k++) {
      const cand = b.order[(start + k) % b.order.length];
      if (alive.includes(cand)) return cand;
    }
    return alive[0];
  }

  private queueNextTurn(after: string, now: number, delay: number) {
    const b = this.s!.battle!;
    b.turnPlayerId = null;
    b.turnStartedAt = now;
    b.nextTurnAt = now + delay;
    b.nextTurnPlayerId = this.nextAfter(after);
  }

  private async battleGuess(ws: WebSocket, pid: string, text: string, now: number) {
    const s = this.s!;
    const b = s.battle!;
    const seat = s.seats[pid];
    const index = await getIndex(this.env, b.questionIds[b.qPos]);

    // Eliminated players and spectators can still guess for fun (unscored, shown in a side panel).
    if (seat.eliminated || seat.spectator) {
      const r = matchGuess(index, text);
      const g = { playerId: pid, nickname: seat.nickname, text, canonical: r.canonical, tier: r.tier };
      b.spectatorGuesses = [...b.spectatorGuesses.slice(-19), g];
      this.broadcast({ type: "spectatorGuess", ...g });
      return;
    }
    if (s.phase !== "turn" || b.turnPlayerId !== pid) return this.send(ws, { type: "error", message: "Not your turn" });
    if (now > b.turnEndsAt + DEADLINE_GRACE_MS) return;

    const r = matchGuess(index, text, { takenAnswerIds: new Set(b.usedIds) });
    if (r.accepted && r.answerId && r.canonical && r.tier) {
      b.used.push({ canonical: r.canonical, tier: r.tier, byPlayerId: pid });
      b.usedIds.push(r.answerId);
      b.accepted += 1;
      seat.score += r.points;
      // Every accepted answer fills the life circle; each full circle is an extra life (no cap).
      const fill = (seat.lifeMeter ?? 0) + tierInfo(r.tier).battleLifeFill;
      const livesGained = Math.floor(fill / BATTLE_DEFAULTS.lifeMeterFull);
      seat.lifeMeter = fill % BATTLE_DEFAULTS.lifeMeterFull;
      seat.lives += livesGained;
      if (!b.best || r.tier > b.best.tier) b.best = { nickname: seat.nickname, canonical: r.canonical, tier: r.tier, prompt: b.prompt, at: now };
      this.send(ws, { type: "guessResult", accepted: true, canonical: r.canonical, tier: r.tier, points: r.points, corrected: r.corrected, reason: null, endsAt: b.turnEndsAt });
      this.broadcast({ type: "turnResult", playerId: pid, canonical: r.canonical, tier: r.tier, corrected: r.corrected, livesGained, livesLeft: seat.lives, lifeMeter: seat.lifeMeter });
      if (!(await this.maybeRotate(now, pid))) this.queueNextTurn(pid, now, BATTLE_DEFAULTS.betweenTurnsMs);
      return;
    }
    // Wrong (or already taken): costs time, keep guessing.
    if (r.reason === "taken" && r.canonical) {
      const by = b.used.find((u) => u.canonical === r.canonical)?.byPlayerId ?? "";
      this.broadcast({ type: "taken", answerCanonical: r.canonical, byPlayerId: by });
    }
    b.turnEndsAt -= BATTLE_DEFAULTS.wrongGuessPenaltySeconds * 1000;
    this.send(ws, { type: "guessResult", accepted: false, canonical: r.canonical, tier: null, points: 0, corrected: false, reason: r.reason, endsAt: b.turnEndsAt });
  }

  private async battleTimeout(now: number) {
    const s = this.s!;
    const b = s.battle!;
    const pid = b.turnPlayerId!;
    const seat = s.seats[pid];
    seat.lives -= 1;
    b.failed += 1;
    this.broadcast({ type: "lifeLost", playerId: pid, livesLeft: seat.lives });
    if (seat.lives <= 0) {
      seat.eliminated = true;
      seat.eliminatedAt = now;
      this.broadcast({ type: "eliminated", playerId: pid });
    }
    if (this.aliveIds().length <= 1) return this.gameOver(b.best);
    if (!(await this.maybeRotate(now, pid))) this.queueNextTurn(pid, now, BATTLE_DEFAULTS.betweenTurnsMs);
  }

  /**
   * Switch to a new prompt when: N failed turns on this prompt, or enough
   * accepted answers (default 2 × alive players), or fewer than 5 unused
   * valid answers remain. Speed-up shaves a second off the base time each time.
   */
  private async maybeRotate(now: number, lastPid: string): Promise<boolean> {
    const s = this.s!;
    const b = s.battle!;
    const set = s.settings as BattleSettings;
    const index = await getIndex(this.env, b.questionIds[b.qPos]);
    const acceptsNeeded = set.acceptsToRotate ?? 2 * this.aliveIds().length;
    const unused = index.answers.length - b.usedIds.length;
    if (b.failed < set.failedTurnsToRotate && b.accepted < acceptsNeeded && unused >= 5) return false;

    b.qPos += 1;
    if (b.qPos >= b.questionIds.length) {
      const more = await pickRoomQuestions(this.env, set.source, set.category, 30, now, this.roomPlayerIds());
      b.questionIds.push(...more.filter((id) => !b.questionIds.includes(id)));
      if (b.qPos >= b.questionIds.length) b.qPos = 0;
    }
    const qid = b.questionIds[b.qPos];
    const q = (await getQuestions(this.env, [qid])).get(qid)!;
    await getIndex(this.env, qid);
    await markRoomSeen(this.env, this.roomPlayerIds(), qid, now);
    if (set.speedUp) b.baseSeconds = Math.max(BATTLE_DEFAULTS.minBaseSeconds, b.baseSeconds - 1);
    Object.assign(b, { prompt: q.prompt, category: q.category, round: b.round + 1, used: [], usedIds: [], accepted: 0, failed: 0, spectatorGuesses: [] });
    s.phase = "rotate";
    this.queueNextTurn(lastPid, now, BATTLE_DEFAULTS.rotatePauseMs);
    this.broadcast({ type: "rotate", prompt: q.prompt, category: q.category, baseSeconds: b.baseSeconds, startsAt: b.nextTurnAt });
    return true;
  }

  // -------------------------------------------------------------------------
  // Typing, guesses, game over
  // -------------------------------------------------------------------------

  private onTyping(pid: string, text: string, now: number) {
    const b = this.s?.battle;
    if (!b || this.s!.phase !== "turn" || b.turnPlayerId !== pid) return;
    // Clients throttle to ~10/s; drop anything faster.
    if (now - (this.lastTypingAt.get(pid) ?? 0) < 1000 / BATTLE_DEFAULTS.typingUpdatesPerSecond - 20) return;
    this.lastTypingAt.set(pid, now);
    this.broadcast({ type: "typing", playerId: pid, text });
  }

  private async onGuess(ws: WebSocket, pid: string, text: string, now: number) {
    const s = this.s!;
    if (!text.trim()) return;
    if (s.kind === "dive" && s.dive) await this.diveGuess(ws, pid, text, now);
    else if (s.kind === "battle" && s.battle) await this.battleGuess(ws, pid, text, now);
    await this.commit();
  }

  /** Everyone playing in the room (not spectators), for picking unseen questions. */
  private roomPlayerIds(): string[] {
    return Object.values(this.s!.seats)
      .filter((x) => !x.spectator)
      .map((x) => x.id);
  }

  private gameOver(best: Best) {
    const s = this.s!;
    const seats = Object.values(s.seats).filter((x) => !x.spectator);
    const ranked =
      s.kind === "dive"
        ? // Ties broken by less total time used.
          seats.sort((a, b) => b.score - a.score || a.timeUsedMs - b.timeUsedMs)
        : // Battle: last player standing first, then by how long they survived.
          seats.sort((a, b) => Number(a.eliminated) - Number(b.eliminated) || (b.eliminatedAt ?? 0) - (a.eliminatedAt ?? 0) || b.score - a.score);
    const results: GameResult[] = ranked.map((x, i) => ({
      playerId: x.id,
      nickname: x.nickname,
      score: x.score,
      depth: pointsToDepth(x.score),
      timeUsedMs: x.timeUsedMs,
      rank: i + 1,
      depthTrail: x.depthTrail,
      eliminatedAt: x.eliminatedAt,
    }));
    const bestAnswer = best ? { nickname: best.nickname, canonical: best.canonical, tier: best.tier, prompt: best.prompt } : null;
    s.results = { results, bestAnswer, ...(s.kind === "dive" && s.dive?.recap?.length ? { recap: s.dive.recap } : {}) };
    s.phase = "over";
    if (s.battle) s.battle.turnPlayerId = null;
    this.broadcast({ type: "gameOver", results, bestAnswer });
    // For the global leaderboards (party wins). Never let a database hiccup break the game.
    this.ctx.waitUntil(
      recordPartyResults(this.env, s.kind, s.code, results.map((r) => ({ playerId: r.playerId, rank: r.rank, score: r.score })), Date.now()).catch(
        (err) => console.error("recordPartyResults", err),
      ),
    );
  }

  // -------------------------------------------------------------------------
  // Sending
  // -------------------------------------------------------------------------

  private connectedIds(exclude?: WebSocket): Set<string> {
    const ids = new Set<string>();
    for (const ws of this.ctx.getWebSockets()) {
      if (ws === exclude || ws.readyState !== WebSocket.OPEN) continue;
      const pid = (ws.deserializeAttachment() as Attachment | null)?.playerId;
      if (pid) ids.add(pid);
    }
    return ids;
  }

  private send(ws: WebSocket, msg: ServerMessage) {
    try {
      ws.send(JSON.stringify(msg));
    } catch {
      /* socket already gone */
    }
  }

  private broadcast(msg: ServerMessage) {
    const text = JSON.stringify(msg);
    for (const ws of this.ctx.getWebSockets()) {
      try {
        ws.send(text);
      } catch {
        /* ignore */
      }
    }
  }

  private broadcastState(skip?: WebSocket) {
    if (!this.s) return;
    const connected = this.connectedIds(skip);
    for (const ws of this.ctx.getWebSockets()) {
      if (ws === skip) continue;
      const pid = (ws.deserializeAttachment() as Attachment | null)?.playerId ?? "";
      this.send(ws, { type: "state", state: this.snapshot(pid, connected) });
    }
  }

  private snapshot(pid: string, connected: Set<string>): RoomSnapshot {
    const s = this.s!;
    const now = Date.now();
    const players: RoomPlayer[] = Object.values(s.seats)
      .sort((a, b) => a.joinedAt - b.joinedAt)
      .map((x) => ({
        id: x.id,
        nickname: x.nickname,
        connected: connected.has(x.id),
        spectator: x.spectator,
        score: x.score,
        timeUsedMs: x.timeUsedMs,
        lives: x.lives,
        lifeMeter: x.lifeMeter ?? 0,
        eliminated: x.eliminated,
        locked: !!s.dive?.answers[x.id] && s.phase === "question",
      }));
    const snap: RoomSnapshot = { code: s.code, kind: s.kind, hostId: s.hostId, phase: s.phase, players, settings: s.settings, you: pid, serverNow: now };
    if (s.dive && s.dive.index >= 0) {
      const d = s.dive;
      const mine = d.answers[pid];
      snap.dive = {
        index: d.index,
        total: d.questionIds.length,
        prompt: d.prompt,
        category: d.category,
        endsAt: d.endsAt,
        yourEndsAt: this.personalEndsAt(pid),
        yourAnswer: mine ? { canonical: mine.canonical, tier: mine.tier, points: mine.points, corrected: mine.corrected } : null,
        // The answer list is sent with the live "reveal" message; snapshots carry the rest.
        reveal: d.reveal ? { ...d.reveal, answers: [] } : null,
      };
    }
    if (s.battle) {
      const b = s.battle;
      snap.battle = {
        prompt: b.prompt,
        category: b.category,
        round: b.round,
        baseSeconds: b.baseSeconds,
        turnPlayerId: b.turnPlayerId,
        nextTurnPlayerId: b.turnPlayerId ? null : b.nextTurnPlayerId,
        turnStartedAt: b.turnStartedAt,
        turnEndsAt: b.turnPlayerId ? b.turnEndsAt : b.nextTurnAt,
        used: b.used,
        typing: "",
        spectatorGuesses: b.spectatorGuesses,
      };
    }
    if (s.results) snap.results = s.results;
    return snap;
  }
}

