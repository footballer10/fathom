import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { spawn } from "node:child_process";
import WebSocket from "ws";
import type { ClientMessage, ServerMessage } from "../../shared/src/index";
import { ROOT } from "../lib/content";

export const BASE = process.env.SIM_BASE ?? "http://127.0.0.1:8787";

/** Make sure `wrangler dev` is running (starts it if not). Returns a stop function. */
export async function ensureServer(): Promise<() => void> {
  const up = async () => fetch(`${BASE}/api/health`).then((r) => r.ok).catch(() => false);
  if (await up()) return () => {};
  console.log("Starting local server (wrangler dev)...");
  const proc = spawn("npx", ["wrangler", "dev", "--port", "8787", "--log-level", "warn"], { cwd: join(ROOT, "worker"), stdio: "ignore" });
  for (let i = 0; i < 60; i++) {
    if (await up()) return () => proc.kill("SIGINT");
    await sleep(1000);
  }
  proc.kill();
  throw new Error("Local server didn't start");
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Answers for every seed question, by prompt (so a bot can play like a person). */
export function answerBook(): Map<string, { text: string; tier: number }[]> {
  const dir = join(ROOT, "content", "questions");
  const map = new Map<string, { text: string; tier: number }[]>();
  for (const f of readdirSync(dir).filter((x) => x.endsWith(".json"))) {
    for (const q of JSON.parse(readFileSync(join(dir, f), "utf8")) as { prompt: string; answers: { text: string; tier: number }[] }[]) {
      map.set(q.prompt, q.answers.map((a) => ({ text: a.text, tier: a.tier })));
    }
  }
  return map;
}

export class Bot {
  ws!: WebSocket;
  inbox: ServerMessage[] = [];
  state: Extract<ServerMessage, { type: "state" }>["state"] | null = null;
  handlers: ((m: ServerMessage) => void)[] = [];

  constructor(
    public code: string,
    public playerId: string,
    public nickname: string,
  ) {}

  async connect(): Promise<void> {
    this.ws = new WebSocket(`${BASE.replace(/^http/, "ws")}/ws/rooms/${this.code}`);
    await new Promise<void>((resolve, reject) => {
      this.ws.once("open", () => resolve());
      this.ws.once("error", reject);
    });
    this.ws.on("message", (data) => {
      const m = JSON.parse(String(data)) as ServerMessage;
      this.inbox.push(m);
      if (m.type === "state") this.state = m.state;
      for (const h of this.handlers) h(m);
    });
    this.send({ type: "join", playerId: this.playerId, nickname: this.nickname });
    await this.waitFor((m) => m.type === "state" && m.state.players.some((p) => p.id === this.playerId));
  }

  send(m: ClientMessage) {
    this.ws.send(JSON.stringify(m));
  }

  on(h: (m: ServerMessage) => void) {
    this.handlers.push(h);
  }

  close() {
    this.ws.close();
  }

  waitFor(pred: (m: ServerMessage) => boolean, timeoutMs = 60_000): Promise<ServerMessage> {
    return new Promise((resolve, reject) => {
      const hit = this.inbox.find(pred);
      if (hit) return resolve(hit);
      const t = setTimeout(() => reject(new Error(`${this.nickname}: timed out waiting`)), timeoutMs);
      const h = (m: ServerMessage) => {
        if (pred(m)) {
          clearTimeout(t);
          this.handlers = this.handlers.filter((x) => x !== h);
          resolve(m);
        }
      };
      this.handlers.push(h);
    });
  }
}

export async function createRoom(kind: "dive" | "battle"): Promise<string> {
  const res = await fetch(`${BASE}/api/rooms`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ kind }) });
  const { code } = (await res.json()) as { code: string };
  if (!code) throw new Error("No room code");
  return code;
}

export class Checks {
  results: { name: string; ok: boolean; detail?: string }[] = [];
  check(name: string, ok: boolean, detail?: string) {
    this.results.push({ name, ok, detail });
    console.log(`${ok ? "  PASS" : "  FAIL"}  ${name}${detail ? ` (${detail})` : ""}`);
  }
  get ok() {
    return this.results.every((r) => r.ok);
  }
}
