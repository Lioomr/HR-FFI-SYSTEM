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
    // chunk that legitimately can't be split further.
    chunkSizeWarningLimit: 600,
    // flag-icons' stylesheet references ~270 small SVGs; Vite's default 4 KB
    // limit inlined hundreds of them as base64 into the global CSS that every
    // visitor downloads. Keep them as files so a browser only fetches the
    // flags a page actually shows. Everything else keeps Vite's default.
    assetsInlineLimit: (filePath: string) =>
      filePath.includes("flag-icons") ? false : undefined,
    rollupOptions: {
      output: {
        // Group large, stable third-party dependencies into their own
        // vendor chunks, separate from application code. This is not an
        // exhaustive per-package split — only the libraries big enough to
        // matter for the initial load get their own bucket; everything else
        // (small deps) falls into rollup's default vendor handling alongside
        // whichever app chunk first imports them.
        //
        // antd (and its rc-* / @ant-design deps) is deliberately NOT bucketed:
        // a catch-all antd chunk pulled every component any lazy page uses
        // (DatePicker, Tree, QRCode, ...) into the initial download. Left to
        // rollup, the shell's components stay in the entry and page-only ones
        // move into the lazy page chunks that need them.
        manualChunks(id) {
          if (!id.includes("node_modules")) return undefined;

          if (
            id.includes("react-dom") ||
            id.includes("/react/") ||
            id.includes("scheduler")
          ) {
            return "vendor-react";
          }
          if (id.includes("react-router")) {
            return "vendor-router";
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
