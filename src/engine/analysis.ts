// Higher-level analyses built on simulate(): compare builds, rank items, optimize item sets,
// order combos, and sweep target resistances. Used by the CLI, the MCP server and the web UI.

import type { GameData } from './gamedata.ts';
import { findItem } from './gamedata.ts';
import { simulate, isLegendary, type Scenario, type SimResult } from './sim.ts';
import { parseCombo, formatCombo, type ComboStep } from './combo.ts';
import { ITEM_GROUPS } from './items.ts';
import type { ItemData } from './data-types.ts';

export type Metric = 'damage' | 'burst' | 'percentHp' | 'damagePerGold' | 'killTime' | 'dps';

export interface Summary {
  label: string;
  totalDamage: number;
  comboDamage: number;
  dotDamage: number;
  percentOfHp: number;
  killed: boolean;
  killTime?: number;
  duration: number;
  dps: number;
  gold: number;
  items: string[];
  byType: SimResult['byType'];
  warnings: string[];
}

export function summarize(r: SimResult, label: string): Summary {
  return {
    label,
    totalDamage: round(r.totalDamage),
    comboDamage: round(r.comboDamage),
    dotDamage: round(r.dotDamage),
    percentOfHp: round(r.percentOfHp, 4),
    killed: r.killed,
    ...(r.killTime !== undefined ? { killTime: round(r.killTime, 3) } : {}),
    duration: round(r.duration, 3),
    dps: round(r.dps),
    gold: r.gold,
    items: r.items.map((i) => i.name),
    byType: { physical: round(r.byType.physical), magic: round(r.byType.magic), true: round(r.byType.true) },
    warnings: r.warnings,
  };
}

export function metricValue(r: SimResult, metric: Metric): number {
  switch (metric) {
    case 'damage':
      return r.totalDamage;
    case 'burst':
      return r.comboDamage;
    case 'percentHp':
      return r.percentOfHp;
    case 'damagePerGold':
      return r.gold > 0 ? r.totalDamage / r.gold : r.totalDamage;
    case 'killTime':
      // Lower is better: return negative time (kills first), unkilled ranked by damage.
      return r.killTime !== undefined ? 1e6 - r.killTime : r.totalDamage;
    case 'dps':
      return r.dps;
  }
}

export function round(v: number, digits = 1): number {
  const f = 10 ** digits;
  return Math.round(v * f) / f;
}

// -----------------------------------------------------------------------------
// Compare builds / scenarios

export interface Variant {
  label?: string;
  /** Fields that replace the base scenario's (items, runes, level, ranks, combo, options…). */
  changes: Partial<Scenario>;
}

export function compare(data: GameData, base: Scenario, variants: Variant[], metric: Metric = 'damage') {
  const results = variants.map((v, i) => {
    const sc: Scenario = { ...base, ...v.changes, options: { ...base.options, ...v.changes.options } };
    const r = simulate(data, sc);
    return { ...summarize(r, v.label ?? describeVariant(v, i)), score: metricValue(r, metric) };
  });
  results.sort((a, b) => b.score - a.score);
  return { metric, results };
}

function describeVariant(v: Variant, i: number): string {
  const parts: string[] = [];
  if (v.changes.items) parts.push(v.changes.items.join(' + '));
  if (v.changes.runes) parts.push(`runes: ${v.changes.runes.join(', ')}`);
  if (v.changes.combo) parts.push(`combo: ${typeof v.changes.combo === 'string' ? v.changes.combo : formatCombo(v.changes.combo)}`);
  if (v.changes.level) parts.push(`level ${v.changes.level}`);
  return parts.join(' | ') || `variant ${i + 1}`;
}

// -----------------------------------------------------------------------------
// Item ranking: marginal value of adding one item to the current build.

export function rankItems(data: GameData, base: Scenario, opts: { candidates?: (number | string)[]; metric?: Metric; limit?: number } = {}) {
  const metric = opts.metric ?? 'damage';
  const baseRes = simulate(data, base);
  const baseScore = metricValue(baseRes, metric);
  const baseItems = (base.items ?? []).map((q) => findItem(data, q));
  const candidates = opts.candidates?.length ? opts.candidates.map((q) => findItem(data, q)) : defaultCandidates(data, base);
  const rows = [];
  for (const it of candidates) {
    if (baseItems.some((b) => b.id === it.id) || conflicts(baseItems, it)) continue;
    const r = simulate(data, { ...base, items: [...(base.items ?? []), it.id] });
    const score = metricValue(r, metric);
    rows.push({
      item: it.name,
      id: it.id,
      gold: it.gold.total,
      totalDamage: round(r.totalDamage),
      gain: round(r.totalDamage - baseRes.totalDamage),
      gainPerGold: round(((r.totalDamage - baseRes.totalDamage) / it.gold.total) * 1000, 2),
      killed: r.killed,
      ...(r.killTime !== undefined ? { killTime: round(r.killTime, 2) } : {}),
      score: score - baseScore,
    });
  }
  rows.sort((a, b) => b.score - a.score);
  return { metric, base: summarize(baseRes, 'current build'), items: rows.slice(0, opts.limit ?? 25), note: 'gainPerGold is damage gained per 1000 gold.' };
}

/** Legendary items + boots on Summoner's Rift (excluding champion-specific ones). */
export function defaultCandidates(data: GameData, base?: Scenario): ItemData[] {
  return Object.values(data.items).filter((i) => i.inStore && !i.requiredChampion && (isLegendary(i) || (i.tags.includes('Boots') && i.depth >= 2)));
}

/** Item-group conflicts (only one Spellblade, Hydra, Fatality, Blight… item; one pair of boots). */
export function conflicts(build: ItemData[], it: ItemData): string | null {
  if (build.some((b) => b.id === it.id)) return 'duplicate';
  if (it.tags.includes('Boots') && build.some((b) => b.tags.includes('Boots'))) return 'boots';
  for (const [group, ids] of Object.entries(ITEM_GROUPS)) {
    if (ids.includes(it.id) && build.some((b) => ids.includes(b.id))) return group;
  }
  return null;
}

// -----------------------------------------------------------------------------
// Optimize: best k items out of a pool (exhaustive over combinations, capped).

export function optimizeItems(
  data: GameData,
  base: Scenario,
  opts: { pool?: (number | string)[]; slots: number; fixed?: (number | string)[]; metric?: Metric; maxEvaluations?: number; top?: number },
) {
  const metric = opts.metric ?? 'damage';
  const fixed = (opts.fixed ?? base.items ?? []).map((q) => findItem(data, q));
  let pool = (opts.pool?.length ? opts.pool.map((q) => findItem(data, q)) : defaultCandidates(data, base)).filter((p) => !fixed.some((f) => f.id === p.id));
  const maxEval = opts.maxEvaluations ?? 20000;

  // Prune a large pool by single-item marginal value first.
  const combos = (n: number, k: number) => {
    let c = 1;
    for (let i = 0; i < k; i++) c = (c * (n - i)) / (i + 1);
    return c;
  };
  if (combos(pool.length, opts.slots) > maxEval) {
    const ranked = rankItems(data, { ...base, items: fixed.map((f) => f.id) }, { candidates: pool.map((p) => p.id), metric, limit: pool.length });
    let keep = pool.length;
    while (keep > opts.slots && combos(keep, opts.slots) > maxEval) keep--;
    const keepIds = new Set(ranked.items.slice(0, keep).map((r) => r.id));
    pool = pool.filter((p) => keepIds.has(p.id));
  }

  const results: { items: string[]; ids: number[]; score: number; summary: Summary }[] = [];
  const choose = (start: number, picked: ItemData[]) => {
    if (picked.length === opts.slots) {
      const ids = [...fixed, ...picked].map((i) => i.id);
      const r = simulate(data, { ...base, items: ids });
      results.push({ items: [...fixed, ...picked].map((i) => i.name), ids, score: metricValue(r, metric), summary: summarize(r, picked.map((p) => p.name).join(' + ')) });
      return;
    }
    for (let i = start; i < pool.length; i++) {
      const it = pool[i];
      if (conflicts([...fixed, ...picked], it)) continue;
      picked.push(it);
      choose(i + 1, picked);
      picked.pop();
    }
  };
  choose(0, []);
  results.sort((a, b) => b.score - a.score);
  return { metric, evaluated: results.length, poolSize: pool.length, best: results.slice(0, opts.top ?? 10) };
}

// -----------------------------------------------------------------------------
// Combo ordering: try permutations of the given steps.

export function optimizeCombo(data: GameData, base: Scenario, opts: { metric?: Metric; keepFirst?: number; maxPermutations?: number; top?: number } = {}) {
  const metric = opts.metric ?? 'damage';
  const steps = typeof base.combo === 'string' ? parseCombo(base.combo) : base.combo;
  const keep = opts.keepFirst ?? 0;
  const head = steps.slice(0, keep);
  const tail = steps.slice(keep);
  const max = opts.maxPermutations ?? 5040;
  const seen = new Set<string>();
  const out: { combo: string; score: number; summary: Summary }[] = [];
  const permute = (rest: ComboStep[], acc: ComboStep[]) => {
    if (out.length >= max) return;
    if (!rest.length) {
      const combo = [...head, ...acc];
      const key = formatCombo(combo);
      if (seen.has(key)) return;
      seen.add(key);
      const r = simulate(data, { ...base, combo });
      out.push({ combo: key, score: metricValue(r, metric), summary: summarize(r, key) });
      return;
    }
    for (let i = 0; i < rest.length; i++) permute([...rest.slice(0, i), ...rest.slice(i + 1)], [...acc, rest[i]]);
  };
  permute(tail, []);
  out.sort((a, b) => b.score - a.score);
  return { metric, evaluated: out.length, best: out.slice(0, opts.top ?? 10) };
}

// -----------------------------------------------------------------------------
// Resistance sweep: damage vs. target armor/MR (for charts and breakpoints).

export function resistSweep(data: GameData, base: Scenario, opts: { stat: 'armor' | 'mr'; from?: number; to?: number; step?: number }) {
  const from = opts.from ?? 0;
  const to = opts.to ?? 300;
  const step = opts.step ?? 10;
  const points = [];
  for (let v = from; v <= to + 1e-9; v += step) {
    const target = { ...(base.target ?? {}), [opts.stat]: v, ...(opts.stat === 'armor' ? { bonusArmor: Math.max(0, v - 50) } : { bonusMr: Math.max(0, v - 35) }) };
    const r = simulate(data, { ...base, target });
    points.push({ [opts.stat]: v, totalDamage: round(r.totalDamage), physical: round(r.byType.physical), magic: round(r.byType.magic), true: round(r.byType.true) });
  }
  return points;
}
