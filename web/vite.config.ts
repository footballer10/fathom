import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";

// Put the built script and stylesheet straight into index.html instead of separate files.
// Some ad and content blockers block script/style files on *.workers.dev addresses; with
// everything inside the page itself there is nothing separate for them to block.
const inlineAssets: Plugin = {
  name: "inline-assets",
  apply: "build",
  enforce: "post",
  generateBundle(_options, bundle) {
    const html = Object.values(bundle).find((f) => f.type === "asset" && f.fileName === "index.html");
    if (!html || html.type !== "asset") return;
    let page = String(html.source);
    for (const [name, file] of Object.entries(bundle)) {
      const ref = new RegExp(`<script[^>]*src="/${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"[^>]*></script>`);
      if (file.type === "chunk" && file.isEntry && ref.test(page)) {
        const code = file.code.replace(/<\/script/gi, "<\\/script");
        page = page.replace(ref, () => `<script type="module">${code}</script>`);
        delete bundle[name];
      } else if (file.type === "asset" && name.endsWith(".css")) {
        const link = new RegExp(`<link[^>]*href="/${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"[^>]*>`);
        if (link.test(page)) {
          page = page.replace(link, () => `<style>${String(file.source)}</style>`);
          delete bundle[name];
        }
      }
    }
    html.source = page;
  },
};

// In development the API and party rooms run in `wrangler dev` on port 8787;
// Vite forwards /api and /ws there so the browser sees one site.
export default defineConfig({
  plugins: [react(), inlineAssets],
  server: {
    port: 5173,
    proxy: {
      "/api": "http://127.0.0.1:8787",
      "/ws": { target: "ws://127.0.0.1:8787", ws: true },
    },
  },
});
