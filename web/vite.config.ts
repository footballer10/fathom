import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Vite marks the built script and stylesheet tags `crossorigin`. They're served from the same
// site, so it isn't needed, and Safari can refuse to load cached files requested that way.
const noCrossorigin = {
  name: "no-crossorigin",
  enforce: "post" as const,
  transformIndexHtml: (html: string) => html.replace(/ crossorigin(?=[\s>])/g, ""),
};

// In development the API and party rooms run in `wrangler dev` on port 8787;
// Vite forwards /api and /ws there so the browser sees one site.
export default defineConfig({
  plugins: [react(), noCrossorigin],
  server: {
    port: 5173,
    proxy: {
      "/api": "http://127.0.0.1:8787",
      "/ws": { target: "ws://127.0.0.1:8787", ws: true },
    },
  },
});
