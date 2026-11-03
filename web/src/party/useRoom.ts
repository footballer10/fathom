import { useCallback, useEffect, useRef, useState } from "react";
import type { ClientMessage, RevealAnswer, RoomSnapshot, ServerMessage } from "@fathom/shared";
import { syncClock } from "../api";
import { getPlayerId } from "../player";
import { whenActive } from "../activity";

export type RoomEvent = ServerMessage & { id: number };

/** Reconnect waits: 1s, 2s, 4s… capped at a minute, giving up after 10 tries. */
const RETRY_BASE_MS = 1000;
const RETRY_MAX_MS = 60_000;
const MAX_RETRIES = 10;

/**
 * Connection to a party room. Reconnects after a dropped connection (the
 * server puts you back in your seat by player ID), keeps the clock in sync
 * with ping/pong, and exposes the latest snapshot plus a stream of events.
 *
 * Each reconnect attempt is a billed Worker request, so: never after the room
 * has gone (close 4000 "expired" or 4004 "no such room"), exponential backoff
 * otherwise, nothing while the tab is hidden or the player is idle (it resumes
 * the moment they're back), and a "Try again" button after 10 failed tries.
 * Pings and messages on an open socket are free.
 */
export function useRoom(code: string, nickname: string | null) {
  const [state, setState] = useState<RoomSnapshot | null>(null);
  const [status, setStatus] = useState<"connecting" | "open" | "closed" | "gone" | "kicked" | "failed">("connecting");
  const [attempt, setAttempt] = useState(0); // bumping it (via retry) starts a fresh round of reconnects
  const [events, setEvents] = useState<RoomEvent[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [revealAnswers, setRevealAnswers] = useState<RevealAnswer[]>([]);
  const [typing, setTyping] = useState<{ playerId: string; text: string } | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const eventId = useRef(0);

  useEffect(() => {
    if (!nickname) return;
    let stopped = false;
    let retry = 0;
    let pingTimer: ReturnType<typeof setInterval> | undefined;
    let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
    let cancelWait = () => {};

    const connect = () => {
      setStatus("connecting");
      const proto = location.protocol === "https:" ? "wss" : "ws";
      const ws = new WebSocket(`${proto}://${location.host}/ws/rooms/${code}`);
      wsRef.current = ws;
      ws.onopen = () => {
        retry = 0;
        setStatus("open");
        setError(null);
        ws.send(JSON.stringify({ type: "join", playerId: getPlayerId(), nickname } satisfies ClientMessage));
        const ping = () => ws.readyState === WebSocket.OPEN && ws.send(JSON.stringify({ type: "ping", t: Date.now() } satisfies ClientMessage));
        ping();
        pingTimer = setInterval(ping, 15_000);
      };
      ws.onmessage = (e) => {
        const m = JSON.parse(e.data) as ServerMessage;
        switch (m.type) {
          case "state":
            setState(m.state);
            break;
          case "pong":
            syncClock(m.serverNow, Date.now() - m.t);
            return;
          case "error":
            setError(m.message);
            break;
          case "reveal":
            setRevealAnswers(m.answers);
            break;
          case "question":
            setRevealAnswers([]);
            break;
          case "typing":
            setTyping({ playerId: m.playerId, text: m.text });
            return;
          case "turn":
          case "rotate":
            setTyping(null);
            break;
        }
        const id = ++eventId.current;
        setEvents((prev) => [...prev.slice(-40), { ...m, id }]);
      };
      ws.onclose = (e) => {
        clearInterval(pingTimer);
        if (stopped) return;
        if (e.code === 4000 || e.code === 4004) {
          setStatus("gone");
          return;
        }
        if (e.code === 4003) {
          setStatus("kicked");
          return;
        }
        if (retry >= MAX_RETRIES) {
          setStatus("failed");
          return;
        }
        setStatus("closed");
        const delay = Math.min(RETRY_MAX_MS, RETRY_BASE_MS * 2 ** retry++);
        // Wait out the backoff, then only reconnect once someone is actually looking.
        reconnectTimer = setTimeout(() => {
          cancelWait = whenActive(() => {
            if (!stopped) connect();
          });
        }, delay);
      };
    };
    connect();
    return () => {
      stopped = true;
      clearInterval(pingTimer);
      clearTimeout(reconnectTimer);
      cancelWait();
      wsRef.current?.close();
    };
  }, [code, nickname, attempt]);

  /** After giving up: start reconnecting again (from the "Try again" button). */
  const retry = useCallback(() => setAttempt((n) => n + 1), []);

  const send = useCallback((m: ClientMessage) => {
    const ws = wsRef.current;
    if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(m));
  }, []);

  return { state, status, events, error, setError, send, revealAnswers, typing, retry };
}
