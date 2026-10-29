import { Hono } from "hono";
import { ROOM_CODE_LETTERS, isRoomCode } from "@fathom/shared";
import { HttpError } from "./env";
import type { Env } from "./env";

/** Room creation and the WebSocket hand-off to each room's Durable Object. */

type AppEnv = { Bindings: Env };
export const roomRoutes = new Hono<AppEnv>();

function randomCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(4));
  return Array.from(bytes, (b) => ROOM_CODE_LETTERS[b % ROOM_CODE_LETTERS.length]).join("");
}

roomRoutes.post("/api/rooms", async (c) => {
  const { kind } = await c.req.json<{ kind?: string }>().catch(() => ({ kind: "dive" }));
  for (let attempt = 0; attempt < 8; attempt++) {
    const code = randomCode();
    const stub = c.env.ROOMS.get(c.env.ROOMS.idFromName(code));
    const res = await stub.fetch("https://room/init", { method: "POST", body: JSON.stringify({ code, kind: kind === "battle" ? "battle" : "dive" }) });
    if (res.ok) return c.json({ code });
  }
  throw new HttpError(503, "Couldn't find a free room code, try again");
});

roomRoutes.get("/api/rooms/:code", async (c) => {
  const code = c.req.param("code").toUpperCase();
  if (!isRoomCode(code)) return c.json({ exists: false });
  const stub = c.env.ROOMS.get(c.env.ROOMS.idFromName(code));
  return c.json(await (await stub.fetch("https://room/exists")).json());
});

roomRoutes.get("/ws/rooms/:code", async (c) => {
  const code = c.req.param("code").toUpperCase();
  if (!isRoomCode(code)) return c.text("Bad room code", 400);
  if (c.req.header("Upgrade") !== "websocket") return c.text("Expected a WebSocket", 426);
  const stub = c.env.ROOMS.get(c.env.ROOMS.idFromName(code));
  return stub.fetch(c.req.raw);
});
