// What the golden test (test/golden.test.ts) compares: every corpus scenario's whole result (its
// events in order, with their times, amounts and labels, the timeline, totals, warnings…) and the
// item rankings, each as a hash of its JSON with numbers to the last bit.

import { createHash } from "node:crypto";
import type { GameData } from "../src/engine/gamedata.ts";
import { simulate } from "../src/engine/sim.ts";
import { rankItems } from "../src/engine/analysis.ts";
import { corpus, RANKING_CHAMPIONS, rankingScenario } from "./corpus.ts";

/** JSON that tells apart what JSON can't: -0, NaN, ±Infinity (an undefined field is left out). */
export const canonical = (v: unknown) =>
  JSON.stringify(v, (_, x) => (typeof x === "number" && (!Number.isFinite(x) || Object.is(x, -0)) ? `#${Object.is(x, -0) ? "-0" : x}` : x));

const hash = (s: string) => createHash("sha256").update(s).digest("hex").slice(0, 20);

/** Each case's JSON, by "<champion> | <case>" and "ranking | <champion>". */
export function goldenJson(data: GameData): Map<string, string> {
  const out = new Map<string, string>();
  for (const c of corpus(data)) out.set(`${c.champion} | ${c.name}`, canonical(simulate(data, c.scenario)));
  for (const champion of RANKING_CHAMPIONS) out.set(`ranking | ${champion}`, canonical(rankItems(data, rankingScenario(data, champion), { limit: Infinity })));
  return out;
}

export const goldenHashes = (data: GameData) => Object.fromEntries([...goldenJson(data)].map(([k, json]) => [k, hash(json)]));
