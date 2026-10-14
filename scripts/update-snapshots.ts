// Record every champion's standard combo damage (test/snapshots/champions.json). The snapshot test
// fails when engine/kit changes move these numbers; re-run this script after an intended change.
// Usage: node scripts/update-snapshots.ts

import { writeFileSync } from 'node:fs';
import { loadGameData } from '../src/node/load.ts';
import { loadAllKits } from '../src/node/kits.ts';
import { simulate } from '../src/engine/sim.ts';
import { SNAPSHOT_CASES } from '../test/snapshot-cases.ts';

const data = loadGameData();
await loadAllKits();
const out: Record<string, Record<string, number>> = {};
for (const c of data.championIndex) {
  out[c.id] = {};
  for (const [name, sc] of Object.entries(SNAPSHOT_CASES)) {
    const r = simulate(data, { ...sc, champion: c.id });
    out[c.id][name] = Math.round(r.totalDamage * 100) / 100;
  }
}
writeFileSync(new URL('../test/snapshots/champions.json', import.meta.url), JSON.stringify({ patch: data.meta.patch, results: out }, null, 1));
console.log(`snapshots written for ${data.championIndex.length} champions × ${Object.keys(SNAPSHOT_CASES).length} cases`);
