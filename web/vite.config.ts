import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { mockApiPlugin } from "./mock/vitePlugin";

export default defineConfig({
  plugins: [react(), mockApiPlugin()],
  server: { port: 5173, open: false },
  preview: { port: 4173 },
});
