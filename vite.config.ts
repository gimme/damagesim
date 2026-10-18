import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { copyFileSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL(".", import.meta.url));
const patch = JSON.parse(readFileSync(`${root}data/generated/current.json`, "utf8")).patch;

// ARTIFACT=1 builds a self-contained bundle (app.js + app.css, icons fetched from icons.json)
// for hosting where external images are blocked; see scripts/build-artifact.ts.
const artifact = process.env.ARTIFACT === "1";

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
  base: artifact ? "./" : base,
  plugins: [react(), ...(artifact ? [] : [notFound])],
  define: { __ARTIFACT__: JSON.stringify(artifact) },
  resolve: {
    alias: { "@data": `${root}data/generated/${patch}` },
  },
  build: {
    outDir: artifact ? `${root}dist-artifact/build` : `${root}dist`,
    emptyOutDir: true,
    chunkSizeWarningLimit: 4000,
    ...(artifact
      ? {
          modulePreload: false,
          rollupOptions: { output: { entryFileNames: "app.js", assetFileNames: "app.[ext]", inlineDynamicImports: true } },
        }
      : {}),
  },
  server: { port: 5173 },
});
