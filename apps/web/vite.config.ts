import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  // The Monaco editor core (~2.5MB pre-gzip, ~650KB gzip) is a deliberate,
  // opt-in cost: it is lazy-loaded only when the learner enables the enhanced
  // editor, ships a single worker and a custom Rust tokenizer (no bundled
  // language packs), and the accessible textarea remains the default editor.
  build: { manifest: true, chunkSizeWarningLimit: 2_600 },
  plugins: [
    tanstackStart({
      spa: { enabled: true, prerender: { retryCount: 5, retryDelay: 500 } },
    }),
    react(),
  ],
  server: {
    proxy: {
      "/api": "http://127.0.0.1:4317",
    },
  },
});
