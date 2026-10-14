import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('.', import.meta.url));
const patch = JSON.parse(readFileSync(`${root}data/generated/current.json`, 'utf8')).patch;

// ARTIFACT=1 builds a self-contained bundle (app.js + app.css, icons fetched from icons.json)
// for hosting where external images are blocked; see scripts/build-artifact.ts.
const artifact = process.env.ARTIFACT === '1';

export default defineConfig({
  root: 'src/web',
  base: './',
  plugins: [react()],
  define: { __ARTIFACT__: JSON.stringify(artifact) },
  resolve: {
    alias: { '@data': `${root}data/generated/${patch}` },
  },
  build: {
    outDir: artifact ? `${root}dist-artifact/build` : `${root}dist`,
    emptyOutDir: true,
    chunkSizeWarningLimit: 4000,
    ...(artifact
      ? {
          modulePreload: false,
          rollupOptions: { output: { entryFileNames: 'app.js', assetFileNames: 'app.[ext]', inlineDynamicImports: true } },
        }
      : {}),
  },
  server: { port: 5173 },
});
