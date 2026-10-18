// Time the simulator: every champion's corpus scenarios (test/corpus.ts), split into setting up a Sim
// and running its combo, then the app's heavy paths, the item ranking (rankItems) and the item search
// (optimizeItems over pairs; searchItemSets too where analysis.ts has it). Each part runs once to warm
// up, then --runs times; a scenario's time is its fastest run, which the machine's other load
// disturbs least.
// Usage: node scripts/bench.ts [--runs 5] [--only corpus,ranking,search] [--champions] [--json file]

import { writeFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { loadGameData } from "../src/node/load.ts";
import { loadAllKits } from "../src/node/kits.ts";
import { Sim } from "../src/engine/sim.ts";
import { parseCombo } from "../src/engine/combo.ts";
import * as analysis from "../src/engine/analysis.ts";
import { corpus, RANKING_CHAMPIONS, rankingScenario } from "../test/corpus.ts";

const { values: args } = parseArgs({
  options: {
    runs: { type: "string", default: "5" },
    only: { type: "string", default: "corpus,ranking,search" },
    champions: { type: "boolean", default: false },
    json: { type: "string" },
  },
});
const runs = Math.max(1, Number(args.runs));
const only = new Set(args.only.split(","));

const data = loadGameData();
await loadAllKits();

const now = () => performance.now();
const ms = (v: number, digits = 3) => v.toFixed(digits);
const min = (xs: number[]) => Math.min(...xs);
const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[xs.length >> 1];
const report: Record<string, unknown> = { node: process.version, runs };

/** Simulations run while `fn` runs (counted on a pass of its own, so the timed ones aren't). */
function countSims(fn: () => void): number {
  const run = Sim.prototype.run;
  let n = 0;
  Sim.prototype.run = function (this: Sim, ...a: Parameters<Sim["run"]>) {
    n++;
    return run.apply(this, a);
  };
  try {
    fn();
  } finally {
    Sim.prototype.run = run;
  }
  return n;
}

/** Fastest of `runs` timed runs of `fn`, after one to warm up; and the median. */
function time(fn: () => void): { min: number; median: number } {
  fn();
  const t: number[] = [];
  for (let i = 0; i < runs; i++) {
    const t0 = now();
    fn();
    t.push(now() - t0);
  }
  return { min: min(t), median: median(t) };
}

if (only.has("corpus")) {
  const cs = corpus(data);
  const setup = cs.map(() => [] as number[]);
  const play = cs.map(() => [] as number[]);
  const passes: number[] = [];
  for (let pass = 0; pass <= runs; pass++) {
    const p0 = now();
    cs.forEach((c, i) => {
      const t0 = now();
      const sim = new Sim(data, c.scenario);
      const t1 = now();
      sim.run(typeof c.scenario.combo === "string" ? parseCombo(c.scenario.combo) : c.scenario.combo);
      const t2 = now();
      // The first pass warms up.
      if (pass === 0) return;
      setup[i].push(t1 - t0);
      play[i].push(t2 - t1);
    });
    if (pass > 0) passes.push(now() - p0);
  }
  const rows = cs.map((c, i) => ({ ...c, setup: min(setup[i]), run: min(play[i]) }));
  const sum = (xs: typeof rows, f: (r: (typeof rows)[number]) => number) => xs.reduce((s, r) => s + f(r), 0);
  const total = sum(rows, (r) => r.setup + r.run);
  console.log(`corpus: ${cs.length} simulations (${data.championIndex.length} champions × ${cs.length / data.championIndex.length} cases)`);
  console.log(`  whole corpus: ${ms(min(passes), 1)} ms fastest pass, ${ms(median(passes), 1)} ms median`);
  console.log(
    `  per simulation (fastest of each): ${ms(total / cs.length)} ms: setup ${ms(sum(rows, (r) => r.setup) / cs.length)} ms + run ${ms(sum(rows, (r) => r.run) / cs.length)} ms`,
  );
  const byCase = new Map<string, typeof rows>();
  const byChamp = new Map<string, typeof rows>();
  for (const r of rows) {
    byCase.set(r.name, [...(byCase.get(r.name) ?? []), r]);
    byChamp.set(r.champion, [...(byChamp.get(r.champion) ?? []), r]);
  }
  console.log("  by case (ms per simulation: setup + run):");
  for (const [name, rs] of byCase)
    console.log(
      `    ${name.padEnd(28)} ${ms(sum(rs, (r) => r.setup + r.run) / rs.length)}  (${ms(sum(rs, (r) => r.setup) / rs.length)} + ${ms(sum(rs, (r) => r.run) / rs.length)})`,
    );
  const champs = [...byChamp].map(([id, rs]) => ({
    id,
    perSim: sum(rs, (r) => r.setup + r.run) / rs.length,
    setup: sum(rs, (r) => r.setup) / rs.length,
    run: sum(rs, (r) => r.run) / rs.length,
  }));
  champs.sort((a, b) => b.perSim - a.perSim);
  const shown = args.champions ? champs : [...champs.slice(0, 15), ...champs.slice(-5)];
  console.log(`  by champion, slowest first (ms per simulation: setup + run)${args.champions ? "" : ", the 15 slowest and 5 fastest"}:`);
  for (const [k, c] of shown.entries()) {
    if (!args.champions && k === 15) console.log("    …");
    console.log(`    ${c.id.padEnd(14)} ${ms(c.perSim)}  (${ms(c.setup)} + ${ms(c.run)})`);
  }
  const sorted = champs.map((c) => c.perSim).sort((a, b) => a - b);
  console.log(`  champion spread: median ${ms(median(sorted))}, p90 ${ms(sorted[Math.floor(sorted.length * 0.9)])}, max ${ms(sorted[sorted.length - 1])} ms`);
  report.corpus = {
    simulations: cs.length,
    passMin: min(passes),
    passMedian: median(passes),
    perSim: total / cs.length,
    setup: sum(rows, (r) => r.setup) / cs.length,
    run: sum(rows, (r) => r.run) / cs.length,
    byCase: Object.fromEntries([...byCase].map(([name, rs]) => [name, sum(rs, (r) => r.setup + r.run) / rs.length])),
    byChampion: Object.fromEntries(champs.map((c) => [c.id, { perSim: c.perSim, setup: c.setup, run: c.run }])),
  };
}

if (only.has("ranking")) {
  console.log("item ranking (rankItems, the app's Item value card):");
  const out: Record<string, unknown> = {};
  let totalMs = 0;
  let totalSims = 0;
  for (const champion of RANKING_CHAMPIONS) {
    const base = rankingScenario(data, champion);
    const job = () => analysis.rankItems(data, base, { limit: Infinity });
    const sims = countSims(job);
    const t = time(job);
    totalMs += t.min;
    totalSims += sims;
    console.log(`  ${champion.padEnd(8)} ${ms(t.min, 1)} ms (median ${ms(t.median, 1)}), ${sims} simulations, ${ms(t.min / sims)} ms each`);
    out[champion] = { ms: t.min, median: t.median, sims };
  }
  console.log(`  mean: ${ms(totalMs / RANKING_CHAMPIONS.length, 1)} ms a ranking, ${ms(totalMs / totalSims)} ms a simulation`);
  report.ranking = { perRanking: totalMs / RANKING_CHAMPIONS.length, perSim: totalMs / totalSims, champions: out };
}

if (only.has("search")) {
  console.log("item search:");
  const base = rankingScenario(data, "Ahri");
  const pool = analysis.defaultCandidates(data, base).slice(0, 42);
  const job = () => analysis.optimizeItems(data, base, { pool: pool.map((p) => p.id), slots: 2 });
  const sims = countSims(job);
  const t = time(job);
  console.log(
    `  optimizeItems, Ahri, pairs of ${pool.length}: ${ms(t.min, 1)} ms (median ${ms(t.median, 1)}), ${sims} simulations, ${ms(t.min / sims)} ms each`,
  );
  report.optimizeItems = { ms: t.min, median: t.median, sims };
  // The item-combos branch's search, where this branch has it.
  const search = (analysis as Record<string, unknown>).searchItemSets as
    ((d: typeof data, b: typeof base, o: { size: number }) => Generator<unknown, { evaluated: number }>) | undefined;
  if (search) {
    for (const size of [2, 3]) {
      const job = () => {
        const it = search(data, base, { size });
        while (!it.next().done);
      };
      const sims = countSims(job);
      const t = time(job);
      console.log(`  searchItemSets, Ahri, size ${size}: ${ms(t.min, 1)} ms (median ${ms(t.median, 1)}), ${sims} simulations, ${ms(t.min / sims)} ms each`);
      report[`searchItemSets${size}`] = { ms: t.min, median: t.median, sims };
    }
  } else console.log("  searchItemSets: not in analysis.ts on this branch");
}

if (args.json) writeFileSync(args.json, JSON.stringify(report, null, 1));
