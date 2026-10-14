// Load every curated kit file from src/kits/champions (Node only; the web build uses all.ts).

import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { registerKit } from '../kits/index.ts';

const DIR = new URL('../kits/champions/', import.meta.url).pathname;

let loaded = false;

export async function loadAllKits(): Promise<string[]> {
  if (loaded) return [];
  loaded = true;
  const ids: string[] = [];
  for (const f of readdirSync(DIR).sort()) {
    if (!f.endsWith('.ts')) continue;
    const mod = await import(pathToFileURL(join(DIR, f)).href);
    const kit = mod.default;
    if (!kit) continue;
    const id = typeof kit === 'function' ? f.replace(/\.ts$/, '') : kit.id;
    registerKit(id, kit);
    ids.push(id);
  }
  return ids;
}
