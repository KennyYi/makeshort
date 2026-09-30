import { defineConfig } from "vite";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const projectRoot = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  root: resolve(projectRoot, "web"),
  server: { host: "127.0.0.1", port: 5173 },
  build: {
    outDir: resolve(projectRoot, "web", "dist"),
    emptyOutDir: true,
  },
});
