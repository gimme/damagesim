// The ranking worker's runner (src/web/ranking-runner.ts): jobs run a slice at a time, a lane's new
// job in place of the one before, which never answers.

import { test } from "node:test";
import assert from "node:assert/strict";
import { loadGameData } from "../src/node/load.ts";
import { loadAllKits } from "../src/node/kits.ts";
import { rankItems, rankItemSets } from "../src/engine/analysis.ts";
import { ranker, type FromWorker, type RankJob } from "../src/web/ranking-runner.ts";

const data = loadGameData("16.20");
await loadAllKits();

const base = { champion: "Ahri", level: 11, items: [6655, 3020], combo: "E Q W R AA R", target: { preset: "squishy" as const } };
const candidates = [3089, 4645, 4646, 3135, 3100, 3157, 4629, 4628];
const sets: RankJob = { kind: "sets", base, size: 2, slots: 6, candidates };

/** A runner whose waits are the event loop's, the messages it posts, and a promise of the next one that settles a lane's job. */
function harness(slice = 5) {
  const posted: FromWorker[] = [];
  const waiting: { lane: number; resolve: (m: FromWorker) => void }[] = [];
  const send = ranker(
    data,
    (m) => {
      posted.push(m);
      if ("progress" in m) return;
      const k = waiting.findIndex((w) => w.lane === m.lane);
      if (k >= 0) waiting.splice(k, 1)[0].resolve(m);
    },
    (next) => setImmediate(next),
    slice,
  );
  const settled = (lane: number) => new Promise<FromWorker>((resolve) => waiting.push({ lane, resolve }));
  return { send, posted, settled };
}

test("a job's progress, a slice at a time, then its result", async () => {
  const { send, posted, settled } = harness();
  const done = settled(1);
  send({ lane: 1, id: 1, job: sets });
  const m = await done;
  assert.ok("result" in m);
  assert.deepEqual(m.result, rankItemSets(data, base, { size: 2, candidates, fits: (b) => b.length <= 6 }));
  const progress = posted.filter((p) => "progress" in p);
  assert.ok(progress.length > 1);
  assert.ok(posted.every((p) => p.lane === 1 && p.id === 1));
  // The next item's ranking, as rankItems has it.
  const items = settled(1);
  send({ lane: 1, id: 2, job: { kind: "items", base, candidates } });
  const r = await items;
  assert.ok("result" in r);
  assert.deepEqual(r.result, rankItems(data, base, { candidates, limit: Infinity }));
});

test("a lane's new job stops the one before, which never answers; a null job stops it", async () => {
  const { send, posted, settled } = harness();
  const done = settled(1);
  send({ lane: 1, id: 1, job: sets });
  await new Promise((resolve) => setImmediate(resolve));
  assert.ok(posted.some((p) => p.id === 1 && "progress" in p));
  send({ lane: 1, id: 2, job: { ...sets, size: 3 } });
  const m = await done;
  assert.equal(m.id, 2);
  assert.ok(!posted.some((p) => p.id === 1 && !("progress" in p)));
  // Stopped: nothing more.
  send({ lane: 1, id: 3, job: sets });
  send({ lane: 1, id: 4, job: null });
  const was = posted.length;
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.equal(posted.length, was);
});

test("two lanes run side by side; a job that fails answers with its error", async () => {
  const { send, settled } = harness();
  const one = settled(1);
  const two = settled(2);
  send({ lane: 1, id: 1, job: sets });
  send({ lane: 2, id: 1, job: { kind: "items", base: { ...base, champion: "Nobody" } } });
  const [a, b] = await Promise.all([one, two]);
  assert.ok("result" in a);
  assert.ok("error" in b && b.error.length > 0);
});
