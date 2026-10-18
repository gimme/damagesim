// Higher-level analyses built on simulate(): compare builds, rank items, optimize item sets,
// order combos, and sweep target resistances. Used by the CLI, the MCP server and the web UI.

import type { GameData } from "./gamedata.ts";
import { findItem } from "./gamedata.ts";
import { simulate, isLegendary, Sim, type Scenario, type SimResult } from "./sim.ts";
import type { DamageInstance } from "./effects.ts";
import { parseCombo, formatCombo, type ComboStep } from "./combo.ts";
import { ITEM_GROUPS } from "./items.ts";
import type { ItemData } from "./data-types.ts";

export type Metric = "damage" | "burst" | "percentHp" | "damagePerGold" | "killTime" | "dps";

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
  byType: SimResult["byType"];
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
    case "damage":
      return r.totalDamage;
    case "burst":
      return r.comboDamage;
    case "percentHp":
      return r.percentOfHp;
    case "damagePerGold":
      return r.gold > 0 ? r.totalDamage / r.gold : r.totalDamage;
    case "killTime":
      // Lower is better: return negative time (kills first), unkilled ranked by damage.
      return r.killTime !== undefined ? 1e6 - r.killTime : r.totalDamage;
    case "dps":
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

export function compare(data: GameData, base: Scenario, variants: Variant[], metric: Metric = "damage") {
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
  if (v.changes.items) parts.push(v.changes.items.join(" + "));
  if (v.changes.runes) parts.push(`runes: ${v.changes.runes.join(", ")}`);
  if (v.changes.combo) parts.push(`combo: ${typeof v.changes.combo === "string" ? v.changes.combo : formatCombo(v.changes.combo)}`);
  if (v.changes.level) parts.push(`level ${v.changes.level}`);
  return parts.join(" | ") || `variant ${i + 1}`;
}

// -----------------------------------------------------------------------------
// Item ranking: marginal value of adding one item to the current build.

export function rankItems(data: GameData, base: Scenario, opts: { candidates?: (number | string)[]; metric?: Metric; limit?: number } = {}) {
  const metric = opts.metric ?? "damage";
  const baseRes = simulate(data, base);
  const baseScore = metricValue(baseRes, metric);
  const baseTally = tally(baseRes);
  const baseItems = (base.items ?? []).map((q) => findItem(data, q));
  const baseIds = baseItems.map((b) => b.id);
  const candidates = opts.candidates?.length ? opts.candidates.map((q) => findItem(data, q)) : defaultCandidates(data, base);
  const rows = [];
  for (const it of candidates) {
    // An item built from items of the build takes their place, for the difference in gold.
    const used = builtFrom(data, baseIds, it.id);
    const kept = baseItems.filter((_, k) => !used.includes(k));
    if (kept.some((b) => b.id === it.id) || conflicts(kept, it)) continue;
    const gold = it.gold.total - used.reduce((sum, k) => sum + baseItems[k].gold.total, 0);
    // A free upgrade isn't bought: the mid lane role quest's tier 3 boots.
    if (used.length && gold <= 0) continue;
    const r = simulate(data, { ...base, items: [...kept.map((b) => b.id), it.id] });
    const gain = r.totalDamage - baseRes.totalDamage;
    const perGold = gold > 0 ? (gain / gold) * 1000 : 0;
    const source = `item:${it.id}`;
    const own = r.bySource.filter((s) => s.source === source);
    const parts = attribute(baseTally, tally(r), source);
    rows.push({
      item: it.name,
      id: it.id,
      gold,
      /** The build's items it's built from, which it replaces (Boots, for a pair of boots). */
      ...(used.length ? { replaces: used.map((k) => ({ item: baseItems[k].name, id: baseItems[k].id })) } : {}),
      totalDamage: round(r.totalDamage),
      gain: round(gain),
      gainPerGold: round(perGold, 2),
      /** Part of the gain from the item's stats and amplifiers making your other hits deal more. */
      baseDamage: round(parts.base),
      /** Part of the gain dealt by the item itself (its procs, burns, actives). */
      itemDamage: round(own.reduce((sum, s) => sum + s.damage, 0)),
      /** The itemDamage by hit (Squall, Spellblade, Echo), largest first. */
      itemHits: ownHits(r, source),
      /** Part of the gain dealt by hits of your other damage that land only with the item (Electrocute it procs, an execute it brings the target into range of). */
      procDamage: round(sum(parts.procs)),
      /** The procDamage by what it is (Electrocute, Liandry's Torment, Super Scorcher Breath (execute)), largest first. */
      procs: byName(parts.procs),
      /** Damage of your other hits the item takes away, negative: hits that land only without it, and hits
       *  that deal less with it (adaptive force turning AD, a proc landing later). gain = baseDamage +
       *  itemDamage + procDamage + lostDamage. */
      lostDamage: round(-sum(parts.lost)) || 0,
      /** The lostDamage by what it is, most lost first. */
      lost: byName(parts.lost).map((l) => ({ ...l, damage: -l.damage })),
      /** Your adaptive force's type with the item, where it turns it (from AP to AD with an AD item). */
      ...(r.stats.adaptiveType !== baseRes.stats.adaptiveType ? { adaptive: r.stats.adaptiveType } : {}),
      killed: r.killed,
      ...(r.killTime !== undefined ? { killTime: round(r.killTime, 2) } : {}),
      // Per gold ranks the item's own efficiency (gain ÷ its cost), not the whole build's damage per gold.
      score: metric === "damagePerGold" ? perGold : metricValue(r, metric) - baseScore,
    });
  }
  rows.sort((a, b) => b.score - a.score);
  return {
    metric,
    base: summarize(baseRes, "current build"),
    items: rows.slice(0, opts.limit ?? 25),
    note: "gold is what the item costs: its price, less that of the build's items it's built from, which it replaces (replaces lists them). gainPerGold is damage gained per 1000 of that gold. The gain is baseDamage + itemDamage + procDamage + lostDamage: baseDamage its stats making your other hits deal more; itemDamage what the item deals itself; procDamage hits of your other damage that land only with it (procs lists them, e.g. Electrocute); lostDamage (negative) what it takes away from your other damage (lost lists it, e.g. a proc it makes land later). adaptive is your adaptive force's type with the item, where it turns it.",
  };
}

/** A hit's name without its variant (Luden's Echo and its repeats, Varus's detonation at any stacks). */
const hitName = (label: string) => label.replace(/ \(.*\)$/, "");

/** What a hit of your damage is called in an item's parts: by its rune or item (Electrocute), by the
 *  champion's hit without its variant (Achooo! with its explosion, an attack critting or not), an
 *  execute by its own (Super Scorcher Breath (execute)). */
const nameOf = (e: DamageInstance) => (e.source.includes(":") ? e.sourceLabel : e.flags.execute ? e.label : hitName(e.label));

type Named = Map<string, { source: string; damage: number }>;

const sum = (named: Named) => [...named.values()].reduce((total, n) => total + n.damage, 0);

const addTo = (named: Named, key: string, source: string, damage: number) => {
  if (!named.has(key)) named.set(key, { source, damage: 0 });
  named.get(key)!.damage += damage;
};

/** Damage by name, largest first, leaving out what rounds to nothing. */
const byName = (named: Named) =>
  [...named]
    .filter(([, n]) => n.damage >= 0.5)
    .sort((a, b) => b[1].damage - a[1].damage)
    .map(([key, n]) => ({ source: n.source, name: key.slice(key.indexOf("|") + 1), damage: round(n.damage) }));

/** The damage of an item's own hits by their name (Squall, Spellblade, Echo), largest first. */
function ownHits(r: SimResult, item: string) {
  const hits: Named = new Map();
  for (const e of r.events) if (e.source === item) addTo(hits, `${item}|${hitName(e.label)}`, item, e.final ?? 0);
  return byName(hits).map(({ name, damage }) => ({ name, damage }));
}

/**
 * The hit each event is part of, as a key: a hit's parts share it (a Death Lotus knife's magic and AD
 * parts, Achooo! and its explosion), each hit has its own (Nashor's Tooth applied twice by one attack).
 * Told from the events: a source's events at one moment are its hits there, the k-th of each kind there
 * the k-th hit; an execute is one of its own.
 */
function hitKeys(r: SimResult): string[] {
  const seen = new Map<string, number>();
  return r.events.map((e) => {
    const src = `${e.source}|${e.sourceLabel}`;
    if (e.flags.execute) return `${src}|${e.id}`;
    const kind = `${src}|${e.time}|${e.label}`;
    const k = seen.get(kind) ?? 0;
    seen.set(kind, k + 1);
    return `${src}|${e.time}|#${k}`;
  });
}

/** A result's damage by kind of hit (source, its label and the hit's: Smolder's Q hit, its burn, its
 *  execute), and how many hits each source ("source|Q|Super Scorcher Breath") and each name
 *  ("name|Q|Super Scorcher Breath") lands. */
function tally(r: SimResult) {
  const kinds = new Map<string, { src: string; source: string; name: string; events: number; damage: number }>();
  const hits = new Map<string, Set<string>>();
  const count = (key: string, hit: string) => (hits.get(key) ?? hits.set(key, new Set()).get(key)!).add(hit);
  const keys = hitKeys(r);
  r.events.forEach((e, i) => {
    const src = `${e.source}|${e.sourceLabel}`;
    const kind = `${src}|${e.label}`;
    const name = `${e.source}|${nameOf(e)}`;
    if (!kinds.has(kind)) kinds.set(kind, { src, source: e.source, name, events: 0, damage: 0 });
    const k = kinds.get(kind)!;
    k.events++;
    k.damage += e.final ?? 0;
    count(`source|${src}`, keys[i]);
    count(`name|${name}`, keys[i]);
  });
  return { kinds, hits: new Map([...hits].map(([key, set]) => [key, set.size])) };
}

/**
 * An item's gain from your other damage (its own hits aside), by comparing each kind of hit with and
 * without it:
 * - procs: the hits that land only with it. Of a kind that lands more often, as many as its source
 *   and its name land more hits (a stat from zero adds a part to hits that land anyway, Katarina's AD
 *   knives, not a hit), at the kind's average damage, at most what the kind and its name gained (First
 *   Strike's hit on an aura tick is smaller than its average). Electrocute striking only with it, an
 *   execute it brings the target into range of; not Electrocute striking on its hit instead of a later
 *   one, which lands either way, nor an attack now critting on average, the same hit.
 * - lost: the same the other way, hits that land only without it (at their average without it), and
 *   by name, what the same hits deal less with it (adaptive force turning AD, a proc landing later at
 *   less health, an amp no longer before them).
 * - base: by name, what the same hits deal more with it.
 * base + procs − lost is the gain less the item's own damage. Named by the rune or item, or by the
 * champion's hit (nameOf).
 */
function attribute(was: ReturnType<typeof tally>, now: ReturnType<typeof tally>, item: string) {
  const more = (key: string) => (now.hits.get(key) ?? 0) - (was.hits.get(key) ?? 0);
  const kinds = [...new Set([...was.kinds.keys(), ...now.kinds.keys()])].flatMap((key) => {
    const [a, b] = [was.kinds.get(key), now.kinds.get(key)];
    const k = (a ?? b)!;
    if (k.source === item) return [];
    const events = (b?.events ?? 0) - (a?.events ?? 0);
    return [{ ...k, of: [`source|${k.src}`, `name|${k.name}`], events, before: a, after: b, damage: (b?.damage ?? 0) - (a?.damage ?? 0) }];
  });
  // What each name gained, and how many more (or fewer) events the kinds of each source and name land.
  const gained = new Map<string, number>();
  const events = new Map<string, number>();
  for (const k of kinds) {
    gained.set(k.name, (gained.get(k.name) ?? 0) + k.damage);
    for (const key of k.of) {
      const signed = `${Math.sign(k.events)}|${key}`;
      if (k.events) events.set(signed, (events.get(signed) ?? 0) + Math.abs(k.events));
    }
  }
  // A source's (or name's) more hits are shared among its kinds that land more often.
  const share = (key: string, sign: number) => Math.min(1, (sign * more(key)) / events.get(`${sign}|${key}`)!);
  const procs: Named = new Map();
  const lost: Named = new Map();
  for (const k of kinds) {
    const sign = Math.sign(k.events);
    if (!sign || k.of.some((key) => sign * more(key) <= 0)) continue;
    const at = sign > 0 ? k.after! : k.before!;
    const damage = Math.max(0, Math.min((at.damage / at.events) * Math.abs(k.events), sign * k.damage, sign * gained.get(k.name)!));
    addTo(sign > 0 ? procs : lost, k.name, k.source, damage * Math.min(...k.of.map((key) => share(key, sign))));
  }
  // A name's new hits are at most what it gained, its lost ones at most what it lost; the rest of its
  // gain is the same hits dealing more or less.
  let base = 0;
  for (const [name, d] of gained) {
    const source = kinds.find((k) => k.name === name)!.source;
    const [p, l] = [procs.get(name), lost.get(name)];
    if (p) p.damage = Math.min(p.damage, Math.max(0, d));
    if (l) l.damage = Math.min(l.damage, Math.max(0, -d));
    const rest = d - (procs.get(name)?.damage ?? 0) + (lost.get(name)?.damage ?? 0);
    if (rest > 0) base += rest;
    else addTo(lost, name, source, -rest);
  }
  return { base, procs, lost };
}

/** Legendary items + boots on Summoner's Rift (excluding champion-specific ones). */
export function defaultCandidates(data: GameData, base?: Scenario): ItemData[] {
  return Object.values(data.items).filter((i) => i.inStore && !i.requiredChampion && (isLegendary(i) || (i.tags.includes("Boots") && i.depth >= 2)));
}

/**
 * The items of a build an item is built from, as the shop combines them: each of its components the
 * build has, else that component's own components, recursively. Indices into `build`, which may have
 * empty slots.
 */
export function builtFrom(data: GameData, build: readonly (number | null)[], id: number): number[] {
  const used: number[] = [];
  const take = (c: number) => {
    const k = build.findIndex((b, j) => b === c && !used.includes(j));
    if (k >= 0) used.push(k);
    else for (const f of data.items[c]?.from ?? []) take(f);
  };
  for (const c of data.items[id]?.from ?? []) take(c);
  return used;
}

/** Item-group conflicts (only one Spellblade, Hydra, Fatality, Blight… item; one pair of boots). */
export function conflicts(build: ItemData[], it: ItemData): string | null {
  if (build.some((b) => b.id === it.id)) return "duplicate";
  if (it.tags.includes("Boots") && build.some((b) => b.tags.includes("Boots"))) return "boots";
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
  const metric = opts.metric ?? "damage";
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
      results.push({
        items: [...fixed, ...picked].map((i) => i.name),
        ids,
        score: metricValue(r, metric),
        summary: summarize(r, picked.map((p) => p.name).join(" + ")),
      });
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
  const metric = opts.metric ?? "damage";
  const steps = typeof base.combo === "string" ? parseCombo(base.combo) : base.combo;
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

export function resistSweep(data: GameData, base: Scenario, opts: { stat: "armor" | "mr"; from?: number; to?: number; step?: number }) {
  const from = opts.from ?? 0;
  const to = opts.to ?? 300;
  const step = opts.step ?? 10;
  // The target keeps its base resist (lowered where the sweep goes below it); the rest is bonus.
  const t = new Sim(data, base).target;
  const baseResist = opts.stat === "armor" ? t.baseArmor : t.baseMr;
  const points = [];
  for (let v = from; v <= to + 1e-9; v += step) {
    const target = { ...(base.target ?? {}), [opts.stat]: v, [opts.stat === "armor" ? "bonusArmor" : "bonusMr"]: Math.max(0, v - baseResist) };
    const r = simulate(data, { ...base, target });
    points.push({
      [opts.stat]: v,
      totalDamage: round(r.totalDamage),
      physical: round(r.byType.physical),
      magic: round(r.byType.magic),
      true: round(r.byType.true),
    });
  }
  return points;
}
