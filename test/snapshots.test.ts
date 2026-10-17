// Regression guard: every champion's standard combos must match test/snapshots/champions.json.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { loadGameData } from "../src/node/load.ts";
import { loadAllKits } from "../src/node/kits.ts";
import { simulate } from "../src/engine/sim.ts";
import { SNAPSHOT_CASES } from "./snapshot-cases.ts";

const snap = JSON.parse(readFileSync(new URL("./snapshots/champions.json", import.meta.url), "utf8"));
const data = loadGameData(snap.patch);
await loadAllKits();

test("champion combo snapshots (run scripts/update-snapshots.ts after intended changes)", () => {
  const diffs: string[] = [];
  for (const [id, cases] of Object.entries(snap.results) as [string, Record<string, number>][]) {
    for (const [name, expected] of Object.entries(cases)) {
      const r = simulate(data, { ...SNAPSHOT_CASES[name], champion: id });
      const got = Math.round(r.totalDamage * 100) / 100;
      if (Math.abs(got - expected) > 0.05) diffs.push(`${id} [${name}]: ${expected} → ${got}`);
    }
  }
  assert.deepEqual(diffs, [], `${diffs.length} snapshot changes:\n${diffs.slice(0, 40).join("\n")}`);
});
