import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  build: {
    minify: "esbuild",
    // The route-level code splitting (React.lazy in src/routes) plus the
    // manualChunks below already keep the initial-load chunks well under
    // this; the warning limit stays only as a backstop for the rare vendor
    // chunk (e.g. antd core) that legitimately can't be split further.
    chunkSizeWarningLimit: 600,
    rollupOptions: {
      output: {
        // Group large, stable third-party dependencies into their own
        // vendor chunks, separate from application code. This is not an
        // exhaustive per-package split — only the libraries big enough to
        // matter for the initial load get their own bucket; everything else
        // (small deps) falls into rollup's default vendor handling alongside
        // whichever app chunk first imports them.
        manualChunks(id) {
          if (!id.includes("node_modules")) return undefined;

          if (id.includes("react-dom") || id.includes("/react/") || id.includes("scheduler")) {
            return "vendor-react";
          }
          if (id.includes("react-router")) {
            return "vendor-router";
          }
          if (id.includes("@ant-design/icons")) {
            return "vendor-antd-icons";
          }
          if (id.includes("antd") || id.includes("rc-") || id.includes("@rc-component")) {
            return "vendor-antd";
          }
          if (id.includes("dayjs")) {
            return "vendor-dayjs";
          }
          if (id.includes("leaflet")) {
            return "vendor-leaflet";
          }
          return undefined;
        },
      },
    },
  },
  esbuild: {
    drop: ["console", "debugger"],
  },
});
