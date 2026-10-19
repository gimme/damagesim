// The scenarios the benchmark (scripts/bench.ts) times and the golden test (test/golden.test.ts)
// replays: every champion in the standard snapshot cases, in the web app's default setup and with a
// crit build, and the app's heavy path, the item ranking, on a few of them.

import type { GameData } from "../src/engine/gamedata.ts";
import type { Scenario } from "../src/engine/sim.ts";
import { DEMO_STATE, toScenario } from "../src/web/state.ts";
import { SNAPSHOT_CASES } from "./snapshot-cases.ts";

export function cases(data: GameData): Record<string, Omit<Scenario, "champion">> {
  const { champion: _, ...app } = toScenario(data, DEMO_STATE);
  return {
    ...SNAPSHOT_CASES,
    // The page as it opens: Luden's Echo and Sorcerer's Shoes, Electrocute, a squishy of the same level.
    "app default": app,
    "L13 crit + Lethal Tempo": {
      level: 13,
      items: ["Kraken Slayer", "Infinity Edge", "Berserker's Greaves", "Phantom Dancer"],
      runes: ["Lethal Tempo", "Presence of Mind", "Legend: Alacrity", "Cut Down", 5005, 5008, 5001],
      combo: "AA Q AA W AA E AA R AA AA AA",
      target: { preset: "bruiser", levelDiff: 1 },
    },
  };
}

export interface CorpusCase {
  champion: string;
  name: string;
  scenario: Scenario;
}

/** Every champion in every case, champions in the index's order. */
export function corpus(data: GameData): CorpusCase[] {
  const all = Object.entries(cases(data));
  return data.championIndex.flatMap((c) => all.map(([name, sc]) => ({ champion: c.id, name, scenario: { ...sc, champion: c.id } })));
}

/** The item ranking's scenarios: the app's default page, its next slot empty, for a mage, an assassin,
 *  a marksman, a fighter and a tank, each against another kind of target. */
const RANKINGS: Record<string, Scenario["target"]> = {
  Ahri: undefined,
  Zed: { champion: "Jinx", items: ["Infinity Edge", "Berserker's Greaves"] },
  Jinx: { preset: "bruiser" },
  Garen: { preset: "tank", levelDiff: 2 },
  Ornn: { maxHp: 2500, armor: 90, mr: 60 },
};
export const RANKING_CHAMPIONS = Object.keys(RANKINGS);

export function rankingScenario(data: GameData, champion: string): Scenario {
  const app = cases(data)["app default"];
  return { ...app, champion, ...(RANKINGS[champion] ? { target: RANKINGS[champion] } : {}) };
}
