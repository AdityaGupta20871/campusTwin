import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

const appRoot = fileURLToPath(new URL(".", import.meta.url));
const webRoot = resolve(appRoot, "../../web");

export default defineConfig({
  root: webRoot,
  server: {
    host: "127.0.0.1",
    port: 5173,
    strictPort: false,
    proxy: {
      "/api": {
        target: "http://127.0.0.1:3000",
        changeOrigin: true,
      },
    },
  },
  preview: {
    host: "127.0.0.1",
    port: 4173,
    strictPort: false,
  },
  build: {
    outDir: resolve(appRoot, "../../../dist/web"),
    emptyOutDir: true,
    rollupOptions: {
      input: {
        index: resolve(webRoot, "index.html"),
        studio: resolve(webRoot, "studio.html"),
        qr: resolve(webRoot, "qr.html"),
        builder: resolve(webRoot, "builder.html"),
      },
      output: {
        manualChunks(id) {
          if (id.includes("node_modules/three/")) return "three";
        },
      },
    },
  },
});