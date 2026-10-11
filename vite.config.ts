import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

// @ts-expect-error process is a nodejs global
const host = process.env.TAURI_DEV_HOST;

function appManualChunks(id: string): string | undefined {
  const moduleId = id.replace(/\\/g, "/");
  if (!moduleId.includes("/node_modules/")) return undefined;

  if (
    moduleId.includes("/node_modules/@tiptap/")
    || moduleId.includes("/node_modules/prosemirror-")
  ) return "editor-vendor";

  if (moduleId.includes("/node_modules/tippy.js/")) return "tooltip-vendor";

  if (
    moduleId.includes("/node_modules/@reactflow/")
    || moduleId.includes("/node_modules/reactflow/")
  ) return "flow-vendor";

  if (
    moduleId.includes("/node_modules/react/")
    || moduleId.includes("/node_modules/react-dom/")
    || moduleId.includes("/node_modules/scheduler/")
  ) return "react-vendor";

  if (
    moduleId.includes("/node_modules/framer-motion/")
    || moduleId.includes("/node_modules/motion-dom/")
    || moduleId.includes("/node_modules/motion-utils/")
  ) return "animation-vendor";

  if (moduleId.includes("/node_modules/@tauri-apps/")) return "tauri-vendor";

  if (
    moduleId.includes("/node_modules/d3-")
    || moduleId.includes("/node_modules/graphlib/")
    || moduleId.includes("/node_modules/lodash/")
  ) return "graph-vendor";

  if (moduleId.includes("/node_modules/zod/")) return "validation-vendor";

  if (moduleId.includes("/node_modules/dompurify/")) return "content-safety-vendor";

  return undefined;
}

// https://vite.dev/config/
export default defineConfig(async () => ({
  plugins: [react()],
  optimizeDeps: {
    entries: ["index.html"],
  },

  test: {
    environment: "jsdom",
    setupFiles: ["./src/test/setup.ts"],
    include: ["src/**/*.test.{ts,tsx}"],
    css: {
      include: /src\/(?:styles\/(?:index|ui-primitives|react-flow|theme-recipes|features\/(?:journal|omnibox|plugin-composed-view|portfolio-chat|resource-categories|settings|theme-studio))|export\/viewer\/viewer)\.css(?:\?inline)?$/,
    },
    clearMocks: true,
    restoreMocks: true,
  },

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent Vite from obscuring rust errors
  clearScreen: false,
  build: {
    target: "es2020",
    // Initial JavaScript and the separately emitted offline-viewer template have
    // explicit gzip budgets. Warn only when an individual JS chunk grows beyond
    // the current main-entry envelope.
    chunkSizeWarningLimit: 1150,
    rollupOptions: {
      output: {
        manualChunks: appManualChunks,
      },
    },
  },
  // 2. tauri expects a fixed port, fail if that port is not available
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      // 3. tell Vite to ignore watching `src-tauri`
      ignored: ["**/src-tauri/**"],
    },
  },
}));
