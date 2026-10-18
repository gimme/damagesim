// Golden test: every corpus scenario's whole result and the item rankings (test/golden.ts) must be as
// recorded in test/snapshots/golden.json, to the last bit. It guards changes meant to leave every
// result as it was (optimizations); after an intended change, run scripts/update-golden.ts.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { loadGameData } from "../src/node/load.ts";
import { loadAllKits } from "../src/node/kits.ts";
import { goldenHashes } from "./golden.ts";

const golden = JSON.parse(readFileSync(new URL("./snapshots/golden.json", import.meta.url), "utf8"));
const data = loadGameData(golden.patch);
await loadAllKits();

test("golden results (run scripts/update-golden.ts after intended changes; its --dump shows what changed)", () => {
  const got = goldenHashes(data);
  const keys = [...new Set([...Object.keys(golden.cases), ...Object.keys(got)])];
  const diffs = keys.filter((k) => golden.cases[k] !== got[k]);
  assert.deepEqual(diffs, [], `${diffs.length} of ${keys.length} cases changed:\n${diffs.slice(0, 40).join("\n")}`);
});
