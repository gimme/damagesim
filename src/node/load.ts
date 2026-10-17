// Load generated game data from disk (Node).

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type { GameData } from "../engine/gamedata.ts";

const ROOT = new URL("../..", import.meta.url).pathname;

let cached: GameData | null = null;

export function loadGameData(patch?: string): GameData {
  if (cached && (!patch || cached.meta.patch === patch)) return cached;
  const gen = join(ROOT, "data/generated");
  const p = patch ?? JSON.parse(readFileSync(join(gen, "current.json"), "utf8")).patch;
  const dir = join(gen, p);
  const read = (f: string) => JSON.parse(readFileSync(join(dir, f), "utf8"));
  const champions: GameData["champions"] = {};
  for (const f of readdirSync(join(dir, "champions"))) {
    const c = read(join("champions", f));
    champions[c.id] = c;
  }
  cached = {
    meta: read("meta.json"),
    championIndex: read("champions.json"),
    champions,
    items: read("items.json"),
    runes: read("runes.json"),
    runePage: read("rune-page.json"),
    summoners: read("summoners.json"),
  };
  return cached;
}
