import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { copyFileSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL(".", import.meta.url));
const patch = JSON.parse(readFileSync(`${root}data/generated/current.json`, "utf8")).patch;

// The page's path names its champion (/zed/), so its scripts and styles go by absolute paths: the
// site's root, or where it's served below it, as BASE_PATH says (/damagesim/ on GitHub Pages).
const base = process.env.BASE_PATH ?? "/";

// GitHub Pages serves 404.html for a path without a file of its own (/damagesim/zed/): the app's page.
const notFound: Plugin = {
  name: "404",
  apply: "build",
  writeBundle: ({ dir }) => copyFileSync(`${dir}/index.html`, `${dir}/404.html`),
};

export default defineConfig({
  root: "src/web",
  base,
  plugins: [react(), notFound],
  resolve: {
    alias: { "@data": `${root}data/generated/${patch}` },
  },
  build: {
    outDir: `${root}dist`,
    emptyOutDir: true,
    chunkSizeWarningLimit: 4000,
  },
  server: { port: 5173 },
});
