import type { Connect, Plugin } from "vite";
import { HttpError, handleApi } from "./mockApi";

/** Serves the Phase 1 mock API at /api/* from both `vite` (dev) and `vite preview`. */
export function mockApiPlugin(): Plugin {
  const middleware: Connect.NextHandleFunction = (req, res, next) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    if (!url.pathname.startsWith("/api/")) return next();

    let raw = "";
    req.on("data", (chunk) => (raw += chunk));
    req.on("end", () => {
      res.setHeader("Content-Type", "application/json");
      res.setHeader("Cache-Control", "no-store");
      try {
        const body = raw ? JSON.parse(raw) : undefined;
        const playerId = String(req.headers["x-player-id"] ?? "");
        const result = handleApi(req.method ?? "GET", url.pathname, playerId, body);
        res.end(JSON.stringify(result));
      } catch (err) {
        const status = err instanceof HttpError ? err.status : 500;
        if (status === 500) console.error("[mock api]", err);
        res.statusCode = status;
        res.end(JSON.stringify({ error: err instanceof Error ? err.message : "Server error" }));
      }
    });
  };

  return {
    name: "krillion-mock-api",
    configureServer(server) {
      server.middlewares.use(middleware);
    },
    configurePreviewServer(server) {
      server.middlewares.use(middleware);
    },
  };
}
