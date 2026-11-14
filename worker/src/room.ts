import { DurableObject } from "cloudflare:workers";
import {
  BATTLE_DEFAULTS,
  CATEGORIES,
  CONFIRM_GRACE_MS,
  DEADLINE_GRACE_MS,
  DIVE_DEFAULTS,
  battleSuggestedAccepts,
  battleSuggestedLives,
  coopSuggestedGoal,
  matchGuess,
  nicknameProblem,
  partyDepth,
  pointsToDepth,
  tierInfo,
} from "@fathom/shared";
import type {
  Look,
  AnswerIndex,
  BattleSettings,
  BattleVariant,
  BestAnswer,
  Category,
  ClientMessage,
  DiveSettings,
  DiveVariant,
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
import { looksOf } from "./rewards";
import { assertNotBanned } from "./bans";
import { profile } from "./social";
import { recordRejected } from "./rejected";
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
  /** Shop cosmetics (sub, trail, sidekick, title, name colour), read when they join. */
  look?: Look;
  /** Public friend code, so others in the room can send a friend request. */
  code?: string | null;
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
  /** Relay: team 0 or 1. */
  team?: number;
  /** Battle: accepted answers this game. Shark/Battle: the round they went out in. */
  turns?: number;
  outRound?: number;
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
  /** Co-op: the shared sub's goal depth, in metres. */
  coopGoal?: number;
  /** Shark Tank: who's in this round (null = everyone still in); a tie-break round has only the tied. */
  sharkPool?: string[] | null;
  /** Shark Tank: rounds played so far. */
  sharkRound?: number;
  /** "Did you mean…?" asked in time: a yes for that answer counts until `until`, even past the clock. */
  confirms?: Record<string, { answerId: string; until: number }>;
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
  /** Relay: the letter the next answer must start with (for the team whose turn it is). */
  letter?: string | null;
  /** Relay: each team chains off its own last answer. */
  teamLetters?: [string | null, string | null];
  /** Relay: shared lives per team. */
  teamLives?: [number, number] | null;
  /** "Did you mean…?" asked in time on this turn: a yes counts until `until`. */
  confirm?: { pid: string; answerId: string; until: number } | null;
}

interface RoomState {
  code: string;
  /** Players the host removed; they can't rejoin this room. */
  kicked?: string[];
  kind: RoomKind;
  hostId: string | null;
  createdAt: number;
  lastActivity: number;
  seats: Record<string, Seat>;
  settings: DiveSettings | BattleSettings;
  phase: RoomPhase;
  dive?: DiveRound;
  battle?: BattleRound;
  results?: NonNullable<RoomSnapshot["results"]>;
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
      penaltySeconds: DIVE_DEFAULTS.wrongGuessPenaltySeconds,
      variant: "classic",
      sharkLives: DIVE_DEFAULTS.sharkLives,
    };
  }
  return {
    source: "unlimited",
    lives: BATTLE_DEFAULTS.lives,
    baseSeconds: BATTLE_DEFAULTS.baseSeconds,
    failedTurnsToRotate: BATTLE_DEFAULTS.failedTurnsToRotate,
    acceptsToRotate: null,
    speedUp: BATTLE_DEFAULTS.speedUp,
    penaltySeconds: BATTLE_DEFAULTS.wrongGuessPenaltySeconds,
    variant: "classic",
  };
}

const clamp = (n: unknown, lo: number, hi: number, fallback: number) => {
  const v = Math.round(Number(n));
  return Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : fallback;
};

const DIVE_VARIANTS: readonly DiveVariant[] = ["classic", "coop", "shark", "school"];
const BATTLE_VARIANTS: readonly BattleVariant[] = ["classic", "hotpotato", "relay"];
function validVariant(kind: RoomKind, v: unknown): DiveVariant | BattleVariant {
  const list: readonly string[] = kind === "battle" ? BATTLE_VARIANTS : DIVE_VARIANTS;
  return (list.includes(String(v)) ? v : "classic") as DiveVariant | BattleVariant;
}
const diveVariant = (s: RoomState) => (s.kind === "dive" ? (s.settings as DiveSettings).variant ?? "classic" : null);
const battleVariant = (s: RoomState) => (s.kind === "battle" ? (s.settings as BattleSettings).variant ?? "classic" : null);

const penalty = (n: unknown, max: number, cur: number) => (n === undefined ? cur : clamp(n, 0, max, cur));

/** Life circle fill rate by players left: full with 4+, two-thirds with 3, a third head-to-head. */
function lifeFillFactor(alive: number) {
  return alive >= 4 ? 1 : alive === 3 ? 2 / 3 : 1 / 3;
}

/** First and last a–z letters of an answer (accents removed), for Relay's letter chain. */
function plainLetters(text: string) {
  return text.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z]/g, "");
}
const firstLetter = (text: string) => plainLetters(text)[0] ?? null;
const lastLetter = (text: string) => plainLetters(text).slice(-1) || null;

/** Relay: split players into two teams by join order and interleave them so turns alternate teams. */
/**
 * Relay turn order: keep the teams the host set up (anyone without a team
 * joins the smaller one), then interleave the two teams so turns alternate.
 */
function relayOrder(players: Seat[]): string[] {
  const sorted = [...players].sort((a, b) => a.joinedAt - b.joinedAt);
  assignTeams(sorted);
  const t0 = sorted.filter((p) => p.team === 0);
  const t1 = sorted.filter((p) => p.team === 1);
  const order: string[] = [];
  for (let i = 0; i < Math.max(t0.length, t1.length); i++) {
    if (t0[i]) order.push(t0[i].id);
    if (t1[i]) order.push(t1[i].id);
  }
  return order;
}

/** Put anyone without a team on the smaller team (by join order). */
function assignTeams(seats: Seat[]) {
  const count = [0, 0];
  for (const p of seats) if (p.team === 0 || p.team === 1) count[p.team]++;
  for (const p of [...seats].sort((a, b) => a.joinedAt - b.joinedAt)) {
    if (p.team === 0 || p.team === 1) continue;
    p.team = count[0] <= count[1] ? 0 : 1;
    count[p.team]++;
  }
}

export class Room extends DurableObject<Env> {
  private s: RoomState | null = null;
  private lastTypingAt = new Map<string, number>();
  /** Answer indexes already loaded, for code that can't wait (Relay's letter check at turn start). */
  private indexCache = new Map<string, AnswerIndex>();
  private async loadIndex(qid: string) {
    const idx = await getIndex(this.env, qid);
    this.indexCache.set(qid, idx);
    return idx;
  }

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
      const { code, kind, variant } = await request.json<{ code: string; kind: RoomKind; variant?: string }>();
      const now = Date.now();
      if (this.s && now - this.s.lastActivity < IDLE_MS) return new Response("in use", { status: 409 });
      this.s = {
        code,
        kind: kind === "battle" ? "battle" : "dive",
        hostId: null,
        createdAt: now,
        lastActivity: now,
        seats: {},
        settings: { ...defaultSettings(kind), variant: validVariant(kind, variant) } as DiveSettings | BattleSettings,
        phase: "lobby",
      };
      await this.save();
      return Response.json({ code });
    }
    if (url.pathname === "/exists") {
      return Response.json({ exists: !!this.s, kind: this.s?.kind ?? null });
    }
    if (request.headers.get("Upgrade") === "websocket") {
      if (!this.s) {
        // Answer with a socket that closes straight away with 4004, rather than an HTTP 404:
        // browsers hide a failed upgrade's status (it just looks like a dropped connection,
        // code 1006), so clients would keep retrying. A 4004 close tells them to stop.
        const gone = new WebSocketPair();
        gone[1].accept();
        gone[1].close(4004, "No such room");
        return new Response(null, { status: 101, webSocket: gone[0] });
      }
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
        this.syncRelayTeams();
        break;
      case "mode":
        if (pid !== this.s.hostId || (this.s.phase !== "lobby" && this.s.phase !== "over")) return;
        this.switchMode(ws, msg.kind === "battle" ? "battle" : "dive", String(msg.variant ?? "classic"));
        break;
      case "team":
        if (pid !== this.s.hostId || this.s.phase !== "lobby" || !this.s.seats[msg.playerId]) return;
        this.s.seats[msg.playerId].team = msg.team === 1 ? 1 : 0;
        break;
      case "shuffleTeams":
        if (pid !== this.s.hostId || this.s.phase !== "lobby") return;
        this.shuffleTeams();
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
        await this.onGuess(ws, pid, String(msg.text ?? "").slice(0, 100), now, msg.confirm === true);
        return;
      case "end":
        // The host ends the game now; everyone goes to the results.
        if (pid !== this.s.hostId) return;
        if (this.s.dive && (this.s.phase === "question" || this.s.phase === "reveal")) this.gameOver(this.s.dive.best);
        else if (this.s.battle && (this.s.phase === "turn" || this.s.phase === "rotate")) this.gameOver(this.s.battle.best);
        break;
      case "kick":
        if (pid === this.s.hostId) await this.kick(String(msg.playerId ?? ""), now);
        break;
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
    if (s.phase === "question" && s.dive && now >= s.dive.endsAt + DEADLINE_GRACE_MS && !this.confirmPending(now)) {
      await this.revealDive(now);
    } else if (s.phase === "reveal" && s.dive?.reveal && now >= s.dive.reveal.nextAt) {
      await this.advanceDive(now);
    } else if ((s.phase === "turn" || s.phase === "rotate") && s.battle) {
      const b = s.battle;
      const waiting = b.confirm && b.confirm.pid === b.turnPlayerId && now <= b.confirm.until;
      if (b.turnPlayerId && now >= b.turnEndsAt + DEADLINE_GRACE_MS && !waiting) await this.battleTimeout(now);
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
    if (s.phase === "question" && s.dive) times.push(Math.max(s.dive.endsAt + DEADLINE_GRACE_MS, ...Object.values(s.dive.confirms ?? {}).map((c) => c.until)) + 20);
    if (s.phase === "reveal" && s.dive?.reveal) times.push(s.dive.reveal.nextAt);
    if ((s.phase === "turn" || s.phase === "rotate") && s.battle) {
      const b = s.battle;
      times.push(b.turnPlayerId ? Math.max(b.turnEndsAt + DEADLINE_GRACE_MS, b.confirm?.pid === b.turnPlayerId ? b.confirm.until : 0) + 20 : b.nextTurnAt);
    }
    await this.ctx.storage.setAlarm(Math.min(...times.filter((t) => t > 0)));
  }

  // -------------------------------------------------------------------------
  // Lobby: joining, reconnecting, host, settings
  // -------------------------------------------------------------------------

  private async onJoin(ws: WebSocket, playerId: string, nicknameRaw: string, now: number) {
    const s = this.s!;
    if (!/^[\w-]{8,64}$/.test(String(playerId))) return this.send(ws, { type: "error", message: "Bad player id" });
    try {
      await assertNotBanned(this.env, playerId);
    } catch (e) {
      this.send(ws, { type: "error", message: (e as Error).message });
      ws.close(4003, "Banned");
      return;
    }
    const nickname = String(nicknameRaw ?? "").trim().slice(0, 16);
    if (s.kicked?.includes(playerId)) {
      this.send(ws, { type: "error", message: "The host removed you from this room." });
      ws.close(4003, "Removed by the host");
      return;
    }
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
    // Their shop look, fresh on every (re)join so a new sub shows up next time they connect.
    const look = (await looksOf(this.env, [playerId]).catch(() => new Map<string, Look>())).get(playerId);
    if (s.seats[playerId]) {
      s.seats[playerId].look = look;
      if (!s.seats[playerId].code) s.seats[playerId].code = (await profile(this.env, playerId).catch(() => null))?.friendCode ?? null;
    }
    if (s.phase === "lobby") this.syncRelayTeams();
    if (!s.hostId || !this.connectedIds().has(s.hostId)) s.hostId = playerId;
    s.lastActivity = now;
    await this.commit();
  }

  /** Lobby: switch between Dive and Battle (settings reset to that kind's defaults, keeping the question source). */
  private switchMode(ws: WebSocket, kind: RoomKind, variant: string) {
    const s = this.s!;
    if (s.phase === "over") this.toLobby();
    const seated = Object.values(s.seats).filter((x) => !x.spectator).length;
    const max = kind === "dive" ? DIVE_DEFAULTS.maxPlayers : BATTLE_DEFAULTS.maxPlayers;
    if (seated > max) return this.send(ws, { type: "error", message: `Too many players for ${kind === "dive" ? "Dive" : "Battle"} (max ${max})` });
    if (kind !== s.kind) {
      const prev = s.settings;
      s.kind = kind;
      s.settings = { ...defaultSettings(kind), source: prev.source, category: prev.category } as DiveSettings | BattleSettings;
      s.results = undefined;
    }
    (s.settings as { variant?: string }).variant = validVariant(kind, variant);
    this.syncRelayTeams();
  }

  /** Relay rooms keep everyone on a team; other modes don't use teams. */
  private syncRelayTeams() {
    const s = this.s!;
    const seats = Object.values(s.seats);
    if (s.kind === "battle" && battleVariant(s) === "relay") assignTeams(seats);
    else if (s.phase === "lobby") for (const x of seats) x.team = undefined;
  }

  /** Random, even split into the two Relay teams. */
  private shuffleTeams() {
    const seats = Object.values(this.s!.seats).sort(() => Math.random() - 0.5);
    seats.forEach((x, i) => (x.team = i % 2));
  }

  /** The host removes a player: their seat goes, their connection closes, and they can't come back. */
  private async kick(target: string, now: number) {
    const s = this.s!;
    if (!s.seats[target] || target === s.hostId) return;
    delete s.seats[target];
    s.kicked = [...(s.kicked ?? []), target].slice(-50);
    for (const ws of this.ctx.getWebSockets()) {
      if ((ws.deserializeAttachment() as Attachment | null)?.playerId !== target) continue;
      this.send(ws, { type: "error", message: "The host removed you from this room." });
      ws.close(4003, "Removed by the host");
    }
    // Mid-Battle: take them out of the turn order (passing the fish on if it was theirs).
    const b = s.battle;
    if (b && (s.phase === "turn" || s.phase === "rotate")) {
      const wasTurn = b.turnPlayerId === target;
      const next = this.nextAfter(target);
      b.order = b.order.filter((id) => id !== target);
      if (this.aliveIds().length <= 1) return this.gameOver(b.best);
      if (wasTurn || b.nextTurnPlayerId === target) {
        Object.assign(b, { turnPlayerId: null, turnStartedAt: now, nextTurnAt: now + BATTLE_DEFAULTS.betweenTurnsMs, nextTurnPlayerId: next ?? this.aliveIds()[0] });
      }
    }
    // Mid-Dive: if everyone left has answered, move on.
    if (s.dive && s.phase === "question") {
      const connected = this.connectedIds();
      if (this.activeDivers().filter((x) => connected.has(x.id)).every((x) => s.dive!.answers[x.id])) await this.revealDive(now);
    }
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
        penaltySeconds: penalty(patch.penaltySeconds, DIVE_DEFAULTS.penaltyMax, cur.penaltySeconds ?? DIVE_DEFAULTS.wrongGuessPenaltySeconds),
        variant: patch.variant !== undefined ? (validVariant("dive", patch.variant) as DiveVariant) : cur.variant ?? "classic",
        sharkLives: patch.sharkLives !== undefined ? clamp(patch.sharkLives, 1, DIVE_DEFAULTS.sharkLivesMax, cur.sharkLives ?? DIVE_DEFAULTS.sharkLives) : cur.sharkLives ?? DIVE_DEFAULTS.sharkLives,
        coopGoal:
          patch.coopGoal === null
            ? null
            : patch.coopGoal !== undefined
              ? Math.round(clamp(patch.coopGoal, DIVE_DEFAULTS.coopGoalMin, DIVE_DEFAULTS.coopGoalMax, 2500) / 250) * 250
              : cur.coopGoal ?? null,
      };
    } else {
      const cur = s.settings as BattleSettings;
      s.settings = {
        source: src ?? cur.source,
        category: cat ?? cur.category,
        lives: patch.lives !== undefined ? clamp(patch.lives, BATTLE_DEFAULTS.livesMin, BATTLE_DEFAULTS.livesMax, cur.lives) : cur.lives,
        livesAuto: patch.lives !== undefined ? false : cur.livesAuto ?? true,
        baseSeconds: patch.baseSeconds !== undefined ? clamp(patch.baseSeconds, BATTLE_DEFAULTS.baseSecondsMin, BATTLE_DEFAULTS.baseSecondsMax, cur.baseSeconds) : cur.baseSeconds,
        failedTurnsToRotate: patch.failedTurnsToRotate !== undefined ? clamp(patch.failedTurnsToRotate, 1, 5, cur.failedTurnsToRotate) : cur.failedTurnsToRotate,
        acceptsToRotate:
          patch.acceptsToRotate === null ? null : patch.acceptsToRotate !== undefined ? clamp(patch.acceptsToRotate, 1, 50, 6) : cur.acceptsToRotate,
        speedUp: typeof patch.speedUp === "boolean" ? patch.speedUp : cur.speedUp,
        penaltySeconds: penalty(patch.penaltySeconds, BATTLE_DEFAULTS.penaltyMax, cur.penaltySeconds ?? BATTLE_DEFAULTS.wrongGuessPenaltySeconds),
        variant: patch.variant !== undefined ? (validVariant("battle", patch.variant) as BattleVariant) : cur.variant ?? "classic",
      };
    }
    this.syncAutoSettings();
  }

  /**
   * Sliders the host hasn't touched follow the group size: Battle lives.
   * (Co-op's goal and Battle's answers-per-prompt are worked out at the start when left on auto.)
   */
  private syncAutoSettings() {
    const s = this.s!;
    if (s.kind !== "battle") return;
    const set = s.settings as BattleSettings;
    if (set.livesAuto ?? true) set.lives = battleSuggestedLives(Object.values(s.seats).filter((x) => !x.spectator).length);
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
        turns: 0,
        outRound: undefined,
      });
      if (!(s.kind === "battle" && battleVariant(s) === "relay")) seat.team = undefined;
    }
    const players = Object.values(s.seats).filter((x) => !x.spectator);
    s.results = undefined;

    if (s.kind === "dive") {
      const set = s.settings as DiveSettings;
      // Shark Tank plays until one diver is left, so it starts with a bigger stack (and adds more if needed).
      const count = diveVariant(s) === "shark" ? DIVE_DEFAULTS.sharkStartQuestions : set.questionCount;
      const ids = await pickRoomQuestions(this.env, set.source, set.category, count, now, this.roomPlayerIds());
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
        coopGoal: diveVariant(s) === "coop" ? set.coopGoal ?? coopSuggestedGoal(players.length) : undefined,
        sharkPool: null,
        sharkRound: 0,
      };
      if (diveVariant(s) === "shark") for (const p of players) p.lives = set.sharkLives ?? DIVE_DEFAULTS.sharkLives;
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
    for (const p of players) Object.assign(p, { lives: set.lives, turns: 0, outRound: undefined });
    const relay = battleVariant(s) === "relay";
    if (relay && players.length < 2) return this.send(ws, { type: "error", message: "Relay needs at least 2 players" });
    if (relay) {
      assignTeams(players);
      if (!players.some((p) => p.team === 0) || !players.some((p) => p.team === 1)) {
        return this.send(ws, { type: "error", message: "Each Relay team needs at least one player" });
      }
    }
    const q = (await getQuestions(this.env, [ids[0]])).get(ids[0])!;
    await markRoomSeen(this.env, this.roomPlayerIds(), ids[0], now);
    s.battle = {
      questionIds: ids,
      qPos: 0,
      prompt: q.prompt,
      category: q.category,
      round: 1,
      baseSeconds: set.baseSeconds,
      order: relay ? relayOrder(players) : players.sort((a, b) => a.joinedAt - b.joinedAt).map((p) => p.id),
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
      letter: null,
      teamLetters: [null, null],
      teamLives: relay ? [set.lives, set.lives] : null,
    };
    await this.loadIndex(ids[0]);
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
      confirms: {},
    });
    s.phase = "question";
    this.broadcast({ type: "question", index: i, total: d.questionIds.length, prompt: q.prompt, category: q.category, endsAt: d.endsAt });
  }

  private personalEndsAt(pid: string) {
    const d = this.s!.dive!;
    return d.endsAt - (d.penalties[pid] ?? 0) * ((this.s!.settings as DiveSettings).penaltySeconds ?? DIVE_DEFAULTS.wrongGuessPenaltySeconds) * 1000;
  }

  /** Co-op: the shared sub's depth, the team's average depth so far. */
  private coopDepth() {
    const s = this.s!;
    const seats = Object.values(s.seats).filter((x) => !x.spectator);
    const qc = s.dive?.questionIds.length ?? (s.settings as DiveSettings).questionCount;
    return seats.length ? Math.round(seats.reduce((n, x) => n + partyDepth(x.score, qc), 0) / seats.length / 10) * 10 : 0;
  }

  /** Someone who hasn't answered is still inside their "Did you mean…?" window. */
  private confirmPending(now: number) {
    const d = this.s!.dive!;
    return Object.entries(d.confirms ?? {}).some(([pid, c]) => !d.answers[pid] && now <= c.until);
  }

  /** Divers still answering (Shark Tank's bitten players sit out). */
  private activeDivers(): Seat[] {
    const pool = this.s!.dive?.sharkPool;
    return Object.values(this.s!.seats).filter((x) => !x.spectator && !x.eliminated && (!pool || pool.includes(x.id)));
  }

  private async diveGuess(ws: WebSocket, pid: string, text: string, now: number, confirm: boolean) {
    const s = this.s!;
    const d = s.dive!;
    const seat = s.seats[pid];
    if (s.phase !== "question" || seat.spectator || seat.eliminated || d.answers[pid]) return;
    const myEnd = this.personalEndsAt(pid);
    const index = await getIndex(this.env, d.questionIds[d.index]);
    const r = matchGuess(index, text);
    const pending = d.confirms?.[pid];
    const lateConfirm = confirm && !!pending && pending.answerId === r.answerId && now <= pending.until;
    if (now > myEnd + DEADLINE_GRACE_MS && !lateConfirm) {
      return this.send(ws, { type: "guessResult", accepted: false, canonical: null, tier: null, points: 0, corrected: false, reason: "late", endsAt: myEnd });
    }
    // Autocorrected matches ask first ("Did you mean…?"); no penalty for asking, and a yes
    // within CONFIRM_GRACE_MS counts even if the clock runs out meanwhile.
    if (r.accepted && r.corrected && !confirm) {
      if (r.answerId) (d.confirms ??= {})[pid] = { answerId: r.answerId, until: Math.max(myEnd + DEADLINE_GRACE_MS, now) + CONFIRM_GRACE_MS + 500 };
      return this.send(ws, { type: "guessResult", accepted: false, canonical: r.canonical, tier: null, points: 0, corrected: true, reason: "confirm", endsAt: myEnd });
    }
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
      if (r.reason !== "taken") this.ctx.waitUntil(recordRejected(this.env, d.questionIds[d.index], index, text, now));
      d.penalties[pid] = (d.penalties[pid] ?? 0) + 1;
      this.send(ws, { type: "guessResult", accepted: false, canonical: null, tier: null, points: 0, corrected: false, reason: r.reason, endsAt: this.personalEndsAt(pid) });
    }
  }

  private leaderboard(previous: Record<string, number>): LeaderboardRow[] {
    const rows = Object.values(this.s!.seats).filter((x) => !x.spectator).sort((a, b) => b.score - a.score || a.timeUsedMs - b.timeUsedMs);
    return rows.map((x, i) => ({
      playerId: x.id,
      nickname: x.nickname,
      score: x.score,
      timeUsedMs: x.timeUsedMs,
      rank: i + 1,
      previousRank: previous[x.id] ?? i + 1,
    }));
  }

  /** Answering is over: score the round and show the reveal. */
  private async revealDive(now: number) {
    await this.scoreDive(now);
  }

  private async scoreDive(now: number) {
    const s = this.s!;
    const d = s.dive!;
    if (s.phase !== "question") return;
    const set = s.settings as DiveSettings;
    const variant = diveVariant(s);

    // "Unique answers": anyone who gave the same answer as someone else gets half points.
    const counts = new Map<string, number>();
    for (const a of Object.values(d.answers)) counts.set(a.answerId, (counts.get(a.answerId) ?? 0) + 1);

    const perPlayer: RevealRow[] = [];
    for (const seat of this.activeDivers()) {
      const a = d.answers[seat.id];
      const shared = !!a && set.uniqueAnswers && (counts.get(a.answerId) ?? 0) > 1;
      // School of Fish scores matching the crowd instead of rarity.
      const matches = a ? (counts.get(a.answerId) ?? 1) - 1 : 0;
      const points =
        variant === "school" ? matches * DIVE_DEFAULTS.schoolPointsPerMatch : a ? (shared ? Math.floor(a.points / 2) : a.points) : 0;
      seat.score += points;
      seat.timeUsedMs += a ? a.msUsed : set.timerSeconds * 1000;
      seat.depthTrail.push(partyDepth(seat.score, set.questionCount));
      perPlayer.push({
        playerId: seat.id,
        nickname: seat.nickname,
        canonical: a?.canonical ?? null,
        tier: a?.tier ?? null,
        points,
        corrected: a?.corrected ?? false,
        shared,
        ...(variant === "school" ? { matches } : {}),
      });
      if (a && (!d.best || a.tier > d.best.tier || (a.tier === d.best.tier && a.at < (d.best.at ?? Infinity)))) {
        d.best = { nickname: seat.nickname, canonical: a.canonical, tier: a.tier, prompt: d.prompt, at: a.at };
      }
    }
    // Shark Tank: the one diver with the lowest score is bitten. If several tie for
    // the lowest, they (and only they) play a tie-break round, again and again until
    // just one is lowest; then everyone still in plays the next round.
    if (variant === "shark") {
      d.sharkRound = (d.sharkRound ?? 0) + 1;
      const low = Math.min(...perPlayer.map((r) => r.points));
      const lowest = perPlayer.filter((r) => r.points === low);
      if (perPlayer.length > 1 && lowest.length > 1) {
        for (const row of lowest) row.tied = true;
        d.sharkPool = lowest.map((r) => r.playerId);
      } else if (lowest.length === 1 && (perPlayer.length > 1 || d.sharkPool)) {
        const row = lowest[0];
        const seat = s.seats[row.playerId];
        row.bitten = true;
        seat.lives = Math.max(0, (seat.lives || 1) - 1);
        row.livesLeft = seat.lives;
        if (seat.lives <= 0) Object.assign(seat, { eliminated: true, eliminatedAt: now, outRound: d.sharkRound });
        d.sharkPool = null;
      }
    }
    perPlayer.sort((a, b) => b.points - a.points);
    const leaderboard = this.leaderboard(d.ranks);
    d.ranks = Object.fromEntries(leaderboard.map((r) => [r.playerId, r.rank]));
    const nextAt = now + (DIVE_DEFAULTS.revealSeconds + (variant === "shark" ? DIVE_DEFAULTS.sharkRevealExtraSeconds : 0)) * 1000;
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
    const s = this.s!;
    const d = s.dive!;
    // Shark Tank ends as soon as one diver (or none) is left, and adds rounds until then.
    if (diveVariant(s) === "shark") {
      const alive = Object.values(s.seats).filter((x) => !x.spectator && !x.eliminated);
      if (alive.length <= 1) return this.gameOver(d.best);
      if (d.index + 1 >= d.questionIds.length) {
        const set = s.settings as DiveSettings;
        const more = await pickRoomQuestions(this.env, set.source, set.category, 10, now, this.roomPlayerIds());
        d.questionIds.push(...more.filter((id) => !d.questionIds.includes(id)));
        if (d.index + 1 >= d.questionIds.length) return this.gameOver(d.best);
      }
    }
    if (d.index + 1 < d.questionIds.length) await this.startDiveQuestion(d.index + 1, now);
    else this.gameOver(d.best);
  }

  // -------------------------------------------------------------------------
  // Battle
  // -------------------------------------------------------------------------

  /** Relay: every member shows their team's shared lives. */
  private syncTeamLives() {
    const s = this.s!;
    const tl = s.battle?.teamLives;
    if (!tl) return;
    for (const x of Object.values(s.seats)) if (x.team !== undefined) x.lives = tl[x.team];
  }

  private aliveIds(): string[] {
    const s = this.s!;
    return s.battle!.order.filter((id) => s.seats[id] && !s.seats[id].eliminated);
  }


  private startTurn(pid: string | null, now: number) {
    const s = this.s!;
    const b = s.battle!;
    const alive = this.aliveIds();
    const next = pid && alive.includes(pid) ? pid : alive[0];
    if (!next) return this.gameOver(b.best);
    const seconds = b.baseSeconds;
    Object.assign(b, { turnPlayerId: next, turnStartedAt: now, turnEndsAt: now + seconds * 1000, nextTurnAt: 0, nextTurnPlayerId: null, confirm: null });
    // Relay: this player's team chain letter, if any unused answer still starts with it.
    const team = s.seats[next].team;
    const want = battleVariant(s) === "relay" && team !== undefined ? b.teamLetters?.[team] ?? null : null;
    const idx = this.indexCache.get(b.questionIds[b.qPos]);
    const used = new Set(b.usedIds);
    b.letter = want && (!idx || idx.answers.some((a) => !used.has(a.id) && firstLetter(a.canonical) === want)) ? want : null;
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

  private async battleGuess(ws: WebSocket, pid: string, text: string, now: number, confirm: boolean) {
    const s = this.s!;
    const b = s.battle!;
    const seat = s.seats[pid];
    const index = await this.loadIndex(b.questionIds[b.qPos]);

    // Eliminated players and spectators can still guess for fun (unscored, shown in a side panel).
    if (seat.eliminated || seat.spectator) {
      const r = matchGuess(index, text);
      const g = { playerId: pid, nickname: seat.nickname, text, canonical: r.canonical, tier: r.tier };
      b.spectatorGuesses = [...b.spectatorGuesses.slice(-19), g];
      this.broadcast({ type: "spectatorGuess", ...g });
      return;
    }
    if (s.phase !== "turn" || b.turnPlayerId !== pid) return this.send(ws, { type: "error", message: "Not your turn" });
    const r = matchGuess(index, text, { takenAnswerIds: new Set(b.usedIds) });
    const lateConfirm = confirm && b.confirm?.pid === pid && b.confirm.answerId === r.answerId && now <= b.confirm.until;
    if (now > b.turnEndsAt + DEADLINE_GRACE_MS && !lateConfirm) return;
    if (r.accepted && r.corrected && !confirm) {
      if (r.answerId) b.confirm = { pid, answerId: r.answerId, until: Math.max(b.turnEndsAt + DEADLINE_GRACE_MS, now) + CONFIRM_GRACE_MS + 500 };
      return this.send(ws, { type: "guessResult", accepted: false, canonical: r.canonical, tier: null, points: 0, corrected: true, reason: "confirm", endsAt: b.turnEndsAt });
    }
    const relay = battleVariant(s) === "relay";
    // Relay: a valid answer still has to start with the chain letter.
    if (relay && r.accepted && r.canonical && b.letter && firstLetter(r.canonical) !== b.letter) {
      b.turnEndsAt -= ((s.settings as BattleSettings).penaltySeconds ?? BATTLE_DEFAULTS.wrongGuessPenaltySeconds) * 1000;
      return this.send(ws, { type: "guessResult", accepted: false, canonical: r.canonical, tier: null, points: 0, corrected: false, reason: "letter", endsAt: b.turnEndsAt });
    }
    if (r.accepted && r.answerId && r.canonical && r.tier) {
      b.used.push({ canonical: r.canonical, tier: r.tier, byPlayerId: pid });
      b.usedIds.push(r.answerId);
      b.accepted += 1;
      seat.score += r.points;
      seat.turns = (seat.turns ?? 0) + 1;
      // Every accepted answer fills the life circle; each full circle is an extra life (no cap).
      // The circle fills slower as the field thins out, so small games don't drag on forever.
      const fill = (seat.lifeMeter ?? 0) + Math.round(tierInfo(r.tier).battleLifeFill * lifeFillFactor(this.aliveIds().length));
      const livesGained = Math.floor(fill / BATTLE_DEFAULTS.lifeMeterFull);
      seat.lifeMeter = fill % BATTLE_DEFAULTS.lifeMeterFull;
      seat.lives += livesGained;
      if (relay && seat.team !== undefined && b.teamLives) {
        b.teamLives[seat.team] += livesGained;
        this.syncTeamLives();
        // Your team's next answer must start with this one's last letter (each team keeps its own chain).
        (b.teamLetters ??= [null, null])[seat.team] = lastLetter(r.canonical);
      }
      if (!b.best || r.tier > b.best.tier) b.best = { nickname: seat.nickname, canonical: r.canonical, tier: r.tier, prompt: b.prompt, at: now };
      this.send(ws, { type: "guessResult", accepted: true, canonical: r.canonical, tier: r.tier, points: r.points, corrected: r.corrected, reason: null, endsAt: b.turnEndsAt });
      this.broadcast({ type: "turnResult", playerId: pid, canonical: r.canonical, tier: r.tier, corrected: r.corrected, livesGained, livesLeft: seat.lives, lifeMeter: seat.lifeMeter });
      if (!(await this.maybeRotate(now, pid))) this.queueNextTurn(pid, now, BATTLE_DEFAULTS.betweenTurnsMs);
      return;
    }
    // Wrong (or already taken): costs time, keep guessing. Wrong ones go to the weekly review.
    if (r.reason !== "taken") this.ctx.waitUntil(recordRejected(this.env, b.questionIds[b.qPos], index, text, now));
    if (r.reason === "taken" && r.canonical) {
      const by = b.used.find((u) => u.canonical === r.canonical)?.byPlayerId ?? "";
      this.broadcast({ type: "taken", answerCanonical: r.canonical, byPlayerId: by });
    }
    b.turnEndsAt -= ((s.settings as BattleSettings).penaltySeconds ?? BATTLE_DEFAULTS.wrongGuessPenaltySeconds) * 1000;
    this.send(ws, { type: "guessResult", accepted: false, canonical: r.canonical, tier: null, points: 0, corrected: false, reason: r.reason, endsAt: b.turnEndsAt });
  }

  private async battleTimeout(now: number) {
    const s = this.s!;
    const b = s.battle!;
    const pid = b.turnPlayerId!;
    const seat = s.seats[pid];
    b.failed += 1;
    if (battleVariant(s) === "relay" && seat.team !== undefined && b.teamLives) {
      // Relay: the team shares lives, a failed turn breaks the letter chain, and a team at 0 is out.
      b.teamLives[seat.team] -= 1;
      (b.teamLetters ??= [null, null])[seat.team] = null;
      this.syncTeamLives();
      this.broadcast({ type: "lifeLost", playerId: pid, livesLeft: seat.lives });
      if (b.teamLives[seat.team] <= 0) {
        for (const x of Object.values(s.seats)) {
          if (x.team !== seat.team || x.spectator) continue;
          Object.assign(x, { eliminated: true, eliminatedAt: now, outRound: b.round });
          this.broadcast({ type: "eliminated", playerId: x.id });
        }
        return this.gameOver(b.best);
      }
    } else {
      seat.lives -= 1;
      this.broadcast({ type: "lifeLost", playerId: pid, livesLeft: seat.lives });
      if (seat.lives <= 0) {
        seat.eliminated = true;
        seat.eliminatedAt = now;
        seat.outRound = b.round;
        // Each elimination tightens the clock a little.
        b.baseSeconds = Math.max(BATTLE_DEFAULTS.minBaseSeconds, b.baseSeconds - 1);
        this.broadcast({ type: "eliminated", playerId: pid });
      }
    }
    if (this.aliveIds().length <= 1) return this.gameOver(b.best);
    if (!(await this.maybeRotate(now, pid))) this.queueNextTurn(pid, now, BATTLE_DEFAULTS.betweenTurnsMs);
  }

  /**
   * Switch to a new prompt when: N failed turns on this prompt, or enough
   * accepted answers (default 12, or 2 × alive players if more), or fewer than 5 unused
   * valid answers remain. Speed-up shaves a second off the base time each time.
   */
  private async maybeRotate(now: number, lastPid: string): Promise<boolean> {
    const s = this.s!;
    const b = s.battle!;
    const set = s.settings as BattleSettings;
    const index = await getIndex(this.env, b.questionIds[b.qPos]);
    const acceptsNeeded = set.acceptsToRotate ?? battleSuggestedAccepts(this.aliveIds().length);
    const unused = index.answers.length - b.usedIds.length;
    const hotPotato = battleVariant(s) === "hotpotato";
    if (!hotPotato && b.failed < set.failedTurnsToRotate && b.accepted < acceptsNeeded && unused >= 5) return false;

    b.qPos += 1;
    if (b.qPos >= b.questionIds.length) {
      const more = await pickRoomQuestions(this.env, set.source, set.category, 30, now, this.roomPlayerIds());
      b.questionIds.push(...more.filter((id) => !b.questionIds.includes(id)));
      if (b.qPos >= b.questionIds.length) b.qPos = 0;
    }
    const qid = b.questionIds[b.qPos];
    const q = (await getQuestions(this.env, [qid])).get(qid)!;
    await this.loadIndex(qid);
    await markRoomSeen(this.env, this.roomPlayerIds(), qid, now);
    // Speed-up (or a head-to-head with two left) shaves a second off each new prompt.
    // Hot Potato has a new prompt every turn, so its clock only tightens on eliminations.
    if (!hotPotato && (set.speedUp || this.aliveIds().length <= 2)) b.baseSeconds = Math.max(BATTLE_DEFAULTS.minBaseSeconds, b.baseSeconds - 1);
    Object.assign(b, { prompt: q.prompt, category: q.category, round: b.round + 1, used: [], usedIds: [], accepted: 0, failed: 0, spectatorGuesses: [], letter: null, teamLetters: [null, null] });
    s.phase = "rotate";
    this.queueNextTurn(lastPid, now, hotPotato ? BATTLE_DEFAULTS.hotPotatoPauseMs : BATTLE_DEFAULTS.rotatePauseMs);
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

  private async onGuess(ws: WebSocket, pid: string, text: string, now: number, confirm: boolean) {
    const s = this.s!;
    if (!text.trim()) return;
    if (s.kind === "dive" && s.dive) await this.diveGuess(ws, pid, text, now, confirm);
    else if (s.kind === "battle" && s.battle) await this.battleGuess(ws, pid, text, now, confirm);
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
    const dv = diveVariant(s);
    const bv = battleVariant(s);
    const qc = s.dive?.questionIds.length ?? (s.settings as DiveSettings).questionCount;
    const rounds = s.kind === "dive" ? (dv === "shark" ? s.dive?.sharkRound ?? 0 : Math.max(0, (s.dive?.index ?? -1) + (s.phase === "reveal" ? 1 : 0))) : s.battle?.round ?? 0;

    // Co-op: one shared sub at the team's average depth. Everyone succeeds or nobody does.
    const coopDepth = seats.length ? Math.round(seats.reduce((n, x) => n + partyDepth(x.score, qc), 0) / seats.length / 10) * 10 : 0;
    const coop = dv === "coop" ? { depth: coopDepth, goal: s.dive?.coopGoal ?? coopSuggestedGoal(seats.length), success: coopDepth >= (s.dive?.coopGoal ?? 0) } : null;
    const winningTeam = bv === "relay" ? seats.find((x) => !x.eliminated)?.team ?? null : null;

    // What actually wins each mode, as a sort key (bigger is better). Equal keys share a rank.
    const key = (x: Seat): number[] => {
      if (coop) return [0];
      if (bv === "relay") return [x.team === winningTeam ? 1 : 0];
      if (s.kind === "battle" || dv === "shark") {
        // Survivors first, then whoever lasted longer (round, then time), then lives left.
        return [x.eliminated ? 0 : 1, x.eliminated ? x.outRound ?? 0 : rounds, x.eliminated ? x.eliminatedAt ?? 0 : Infinity, x.lives];
      }
      return [x.score]; // Dive and School of Fish: points (ties share the spot)
    };
    const cmp = (a: number[], b: number[]) => {
      for (let i = 0; i < Math.max(a.length, b.length); i++) if ((a[i] ?? 0) !== (b[i] ?? 0)) return (b[i] ?? 0) - (a[i] ?? 0);
      return 0;
    };
    const ranked = seats.sort((a, b) => cmp(key(a), key(b)) || a.joinedAt - b.joinedAt);
    const ranks = new Map<string, number>();
    ranked.forEach((x, i) => ranks.set(x.id, i > 0 && cmp(key(ranked[i - 1]), key(x)) === 0 ? ranks.get(ranked[i - 1].id)! : i + 1));

    const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;
    const stat = (x: Seat): string | undefined => {
      if (dv === "school") {
        const m = Math.round(x.score / DIVE_DEFAULTS.schoolPointsPerMatch);
        return `${m} ${m === 1 ? "match" : "matches"}`;
      }
      if (dv === "shark") return x.eliminated ? `Bitten out in round ${x.outRound ?? "?"}` : `Survived ${plural(rounds, "round")} · ❤️ ${x.lives} left`;
      if (bv === "relay") return plural(x.turns ?? 0, "answer");
      if (s.kind === "battle") {
        if (x.eliminated) return `Out on prompt ${x.outRound ?? "?"} · ${plural(x.turns ?? 0, "answer")}`;
        // Ended early by the host: several can still be in.
        return seats.filter((y) => !y.eliminated).length > 1 ? `Still in · ❤️ ${x.lives} · ${plural(x.turns ?? 0, "answer")}` : `Last one standing · ${plural(x.turns ?? 0, "answer")}`;
      }
      return undefined;
    };

    const results: GameResult[] = ranked.map((x) => ({
      playerId: x.id,
      nickname: x.nickname,
      score: x.score,
      depth: s.kind === "dive" ? partyDepth(x.score, qc) : pointsToDepth(x.score),
      timeUsedMs: x.timeUsedMs,
      // A missed Co-op goal means nobody won; a made one means everybody did.
      rank: coop ? (coop.success ? 1 : 2) : ranks.get(x.id)!,
      depthTrail: x.depthTrail,
      eliminatedAt: x.eliminatedAt,
      ...(x.team !== undefined ? { team: x.team } : {}),
      ...(stat(x) ? { stat: stat(x) } : {}),
    }));
    const bestAnswer = best ? { nickname: best.nickname, canonical: best.canonical, tier: best.tier, prompt: best.prompt } : null;
    s.results = {
      results,
      bestAnswer,
      ...(s.kind === "dive" && s.dive?.recap?.length ? { recap: s.dive.recap } : {}),
      ...(coop ? { coop } : {}),
      ...(winningTeam !== null ? { winningTeam } : {}),
      scoring: s.kind === "dive" && (dv === "classic" || dv === "coop") ? "depth" : "stat",
    };
    s.phase = "over";
    if (s.battle) s.battle.turnPlayerId = null;
    this.broadcast({ type: "gameOver", results, bestAnswer });
    // For the global leaderboards (party wins). Never let a database hiccup break the game.
    this.ctx.waitUntil(
      recordPartyResults(
        this.env,
        s.kind,
        s.code,
        results.map((r) => ({ playerId: r.playerId, rank: r.rank, score: r.score })),
        Date.now(),
        (s.settings as { variant?: string }).variant ?? "classic",
      ).catch(
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
        ...(x.team !== undefined ? { team: x.team } : {}),
        ...(x.look && Object.keys(x.look).length ? { look: x.look } : {}),
        ...(x.code ? { code: x.code } : {}),
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
        coop: d.coopGoal ? { depth: this.coopDepth(), goal: d.coopGoal } : null,
        sharkPool: d.sharkPool ?? null,
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
        letter: b.letter ?? null,
        teamLetters: b.teamLetters ?? null,
        teamLives: b.teamLives ?? null,
        typing: "",
        spectatorGuesses: b.spectatorGuesses,
      };
    }
    if (s.results) snap.results = s.results;
    return snap;
  }
}

