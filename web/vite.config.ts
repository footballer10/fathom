import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// In development the API and party rooms run in `wrangler dev` on port 8787;
// Vite forwards /api and /ws there so the browser sees one site.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/api": "http://127.0.0.1:8787",
      "/ws": { target: "ws://127.0.0.1:8787", ws: true },
    },
  },
});
