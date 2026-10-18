// Record the golden test's results (test/snapshots/golden.json): a hash of each corpus scenario's whole
// result and of each item ranking (test/golden.ts). The golden test fails when anything in them
// changes, down to an event's order or a number's last bit; re-run this after an intended change.
// --dump <dir> writes each case's JSON there instead, to diff two versions of the engine:
// node scripts/update-golden.ts --dump /tmp/a; (change); node scripts/update-golden.ts --dump /tmp/b; diff -r /tmp/a /tmp/b
// Usage: node scripts/update-golden.ts [--dump <dir>]

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { loadGameData } from "../src/node/load.ts";
import { loadAllKits } from "../src/node/kits.ts";
import { goldenHashes, goldenJson } from "../test/golden.ts";

const { values: args } = parseArgs({ options: { dump: { type: "string" } } });
const data = loadGameData();
await loadAllKits();

if (args.dump) {
  mkdirSync(args.dump, { recursive: true });
  const all = goldenJson(data);
  for (const [k, json] of all) writeFileSync(join(args.dump, `${k.replace(/[^A-Za-z0-9]+/g, "_")}.json`), JSON.stringify(JSON.parse(json), null, 1));
  console.log(`${all.size} cases written to ${args.dump}`);
} else {
  const cases = goldenHashes(data);
  writeFileSync(new URL("../test/snapshots/golden.json", import.meta.url), JSON.stringify({ patch: data.meta.patch, cases }, null, 1) + "\n");
  console.log(`golden results written for ${Object.keys(cases).length} cases`);
}
