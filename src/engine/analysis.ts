// Higher-level analyses built on simulate(): compare builds, rank items and sets of items, optimize
// item sets, order combos, and sweep target resistances. Used by the CLI, the MCP server and the web UI.

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

/** The candidates given, else the legendaries and boots, and every component with `components`. */
export function rankItems(
  data: GameData,
  base: Scenario,
  opts: { candidates?: (number | string)[]; components?: boolean; metric?: Metric; limit?: number } = {},
) {
  if (opts.candidates && opts.components)
    throw new Error("components adds every component to the default candidates: with candidates, list the components among them");
  const metric = opts.metric ?? "damage";
  const baseRes = simulate(data, base);
  const baseScore = metricValue(baseRes, metric);
  const baseTally = tally(baseRes);
  const baseItems = (base.items ?? []).map((q) => findItem(data, q));
  const baseIds = baseItems.map((b) => b.id);
  const candidates = opts.candidates
    ? opts.candidates.map((q) => findItem(data, q))
    : [...defaultCandidates(data, base), ...(opts.components ? componentCandidates(data) : [])];
  const rows = [];
  for (const it of candidates) {
    // An item built from items of the build takes their place, for the difference in gold.
    const used = builtFrom(data, baseIds, it.id);
    const kept = baseItems.filter((_, k) => !used.includes(k));
    if (conflicts(kept, it)) continue;
    const gold = it.gold.total - used.reduce((sum, k) => sum + baseItems[k].gold.total, 0);
    // A free upgrade isn't bought: the mid lane role quest's tier 3 boots.
    if (used.length && gold <= 0) continue;
    const r = simulate(data, { ...base, items: [...kept.map((b) => b.id), it.id] });
    const gain = r.totalDamage - baseRes.totalDamage;
    const perGold = gold > 0 ? (gain / gold) * 1000 : 0;
    const parts = gainParts(baseRes, baseTally, r, new Set([`item:${it.id}`]));
    rows.push({
      item: it.name,
      id: it.id,
      gold,
      /** The build's items it's built from, which it replaces (Boots, for a pair of boots). */
      ...(used.length ? { replaces: used.map((k) => ({ item: baseItems[k].name, id: baseItems[k].id })) } : {}),
      totalDamage: round(r.totalDamage),
      gain: round(gain),
      gainPerGold: round(perGold, 2),
      ...parts,
      // The item's hits by name alone: they're all its own.
      itemHits: parts.itemHits.map(({ name, damage }) => ({ name, damage })),
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

/** How a hit of your damage is matched across the runs with and without an item: by its rune or item
 *  (Electrocute), by the champion's hit without its variant (Achooo! with its explosion, an attack
 *  critting or not), an execute by its own (Super Scorcher Breath (execute)). A line is named otherwise
 *  (shownAs). */
const nameOf = (e: DamageInstance) => (e.source.includes(":") ? e.sourceLabel : e.flags.execute ? e.label : hitName(e.label));

/** What a hit is called in its run, as a line shows it: by its rune or item, or as the champion's hit is
 *  labelled, with its variant (Achooo! (explosion), Vow of the First Lands (crit)). */
const shownAs = (e: DamageInstance) => (e.source.includes(":") ? e.sourceLabel : e.label);

/** Damage by name, and what the hits of each are called in the run it comes from, with what each deals there. */
type Named = Map<string, { source: string; damage: number; shown: Map<string, number> }>;

const sum = (named: Named) => [...named.values()].reduce((total, n) => total + n.damage, 0);

const addTo = (named: Named, key: string, source: string, damage: number, shown?: ReadonlyMap<string, number>) => {
  if (!named.has(key)) named.set(key, { source, damage: 0, shown: new Map() });
  const n = named.get(key)!;
  n.damage += damage;
  for (const [as, d] of shown ?? []) n.shown.set(as, (n.shown.get(as) ?? 0) + d);
};

/** Damage by name, largest first, leaving out what rounds to nothing. Each named as its hits are called
 *  in the run it comes from (Vow of the First Lands (crit)), or where they're called several things
 *  there (Achooo! and its explosion), by the name they share. */
const byName = (named: Named) =>
  [...named]
    .filter(([, n]) => n.damage >= 0.5)
    .sort((a, b) => b[1].damage - a[1].damage)
    .map(([key, n]) => {
      const shown = [...n.shown].filter(([, d]) => d > 0);
      return { source: n.source, name: shown.length === 1 ? shown[0][0] : key.slice(key.indexOf("|") + 1), damage: round(n.damage) };
    });

/** The damage of the items' own hits (their sources: item:3089) by their name (Squall, Spellblade, Echo), largest first. */
function ownHits(r: SimResult, items: ReadonlySet<string>) {
  const hits: Named = new Map();
  for (const e of r.events) if (items.has(e.source)) addTo(hits, `${e.source}|${hitName(e.label)}`, e.source, e.final ?? 0);
  return byName(hits);
}

/** A result's kinds of hit (source, its label and the hit's: Smolder's Q hit, its burn, its execute):
 *  how many land and what they deal; its hits (DamageInstance.hitId: a Death Lotus knife's magic and AD
 *  parts are one, Nashor's Tooth applied twice by one attack two), source by source by their makeup, the
 *  kinds they land (Achooo! with its explosion); and its damage by name. */
function tally(r: SimResult) {
  const names: Named = new Map();
  const kinds = new Map<string, { source: string; name: string; shown: string; events: number; damage: number }>();
  const hits = new Map<string, { src: string; kinds: Map<string, number> }>();
  for (const e of r.events) {
    const src = `${e.source}|${e.sourceLabel}`;
    const kind = `${src}|${e.label}`;
    const name = `${e.source}|${nameOf(e)}`;
    addTo(names, name, e.source, e.final ?? 0, new Map([[shownAs(e), e.final ?? 0]]));
    if (!kinds.has(kind)) kinds.set(kind, { source: e.source, name, shown: shownAs(e), events: 0, damage: 0 });
    const k = kinds.get(kind)!;
    k.events++;
    k.damage += e.final ?? 0;
    const key = `${src}|${e.hitId}`;
    if (!hits.has(key)) hits.set(key, { src, kinds: new Map() });
    const hit = hits.get(key)!;
    hit.kinds.set(kind, (hit.kinds.get(kind) ?? 0) + 1);
  }
  const makeups = new Map<string, Map<string, { hits: number; events: Map<string, number> }>>();
  for (const hit of hits.values()) {
    const makeup = [...hit.kinds.keys()].sort().join("\n");
    if (!makeups.has(hit.src)) makeups.set(hit.src, new Map());
    const of = makeups.get(hit.src)!;
    if (!of.has(makeup)) of.set(makeup, { hits: 0, events: new Map() });
    const m = of.get(makeup)!;
    m.hits++;
    for (const [kind, n] of hit.kinds) m.events.set(kind, (m.events.get(kind) ?? 0) + n);
  }
  return { names, kinds, makeups };
}

/**
 * What a build gains over the base with items added (their sources: item:3089), in parts, as Item value
 * splits a row's bar. gain = baseDamage + itemDamage + procDamage + lostDamage.
 */
function gainParts(baseRes: SimResult, baseTally: ReturnType<typeof tally>, r: SimResult, items: ReadonlySet<string>) {
  const parts = attribute(baseTally, tally(r), items);
  return {
    /** Part of the gain from the items' stats and amplifiers making your other hits deal more. */
    baseDamage: round(parts.base),
    /** Part of the gain dealt by the items themselves (their procs, burns, actives). */
    itemDamage: round(r.bySource.filter((s) => items.has(s.source)).reduce((sum, s) => sum + s.damage, 0)),
    /** The itemDamage by hit (Squall, Spellblade, Echo) and item, largest first. */
    itemHits: ownHits(r, items),
    /** Part of the gain dealt by hits of your other damage that land only with the items (Electrocute they proc, an execute they bring the target into range of). */
    procDamage: round(sum(parts.procs)),
    /** The procDamage by what it is (Electrocute, Liandry's Torment, Super Scorcher Breath (execute)), largest first. */
    procs: byName(parts.procs),
    /** Damage of your other hits the items take away, negative: hits that land only without them, and
     *  hits that deal less with them (adaptive force turning AD, a proc landing later). */
    lostDamage: round(-sum(parts.lost)) || 0,
    /** The lostDamage by what it is, most lost first. */
    lost: byName(parts.lost).map((l) => ({ ...l, damage: -l.damage })),
    /** Your adaptive force's type with the items, where they turn it (from AP to AD with AD items). */
    ...(r.stats.adaptiveType !== baseRes.stats.adaptiveType ? { adaptive: r.stats.adaptiveType } : {}),
  };
}

/**
 * Items' gain from your other damage (their own hits aside), by comparing your hits with and without
 * them, source by source by their makeup:
 * - procs: the hits that land only with it, a makeup's more hits: Electrocute striking only with it,
 *   Dusk and Dawn's second Spider Queen and Spiderlings, an execute it brings the target into range of.
 *   Not a hit that changed: fewer hits of one makeup and more of another with a name in common are the
 *   same hits (an attack now critting, Katarina's knives with their AD part). Their parts at their
 *   kind's average, as many as the kind lands more often: hits regrouped are none (Tibbers' aura and
 *   attack no longer landing at one moment), nor Electrocute striking on its hit instead of a later one.
 * - lost: the same the other way, hits that land only without it (at their average without it), and
 *   by name, what the same hits deal less with it (adaptive force turning AD, a proc landing later at
 *   less health, an amp no longer before them).
 * - base: by name, what the same hits deal more with it.
 * A kind's and a name's new hits are at most what it gained (First Strike's hit on an aura tick is
 * smaller than its average), their lost ones at most what it lost. base + procs − lost is the gain less
 * the items' own damage. Matched by the rune or item, or by the champion's hit (nameOf), and named as
 * the hits are called in the run each number comes from (byName): procs and what deals less as with the
 * items, what lands only without them as without.
 */
function attribute(was: ReturnType<typeof tally>, now: ReturnType<typeof tally>, items: ReadonlySet<string>) {
  // The events of each kind the hits that land only with the item (+) or only without it (−) have.
  const landed = new Map<string, number>();
  for (const src of new Set([...was.makeups.keys(), ...now.makeups.keys()])) {
    const [a, b] = [was.makeups.get(src), now.makeups.get(src)];
    const makeups = [...new Set([...(a?.keys() ?? []), ...(b?.keys() ?? [])])].map((makeup) => {
      const [before, after] = [a?.get(makeup), b?.get(makeup)];
      const kinds = [...(before ?? after)!.events.keys()];
      const names = new Set(kinds.map((kind) => (was.kinds.get(kind) ?? now.kinds.get(kind))!.name));
      return { more: (after?.hits ?? 0) - (before?.hits ?? 0), before, after, names };
    });
    const more = makeups.filter((m) => m.more > 0);
    for (const fewer of makeups.filter((m) => m.more < 0))
      for (const m of more) {
        if (!m.more || ![...fewer.names].some((name) => m.names.has(name))) continue;
        const same = Math.min(-fewer.more, m.more);
        fewer.more += same;
        m.more -= same;
      }
    for (const m of makeups) {
      if (!m.more) continue;
      const at = m.more > 0 ? m.after! : m.before!;
      for (const [kind, events] of at.events) landed.set(kind, (landed.get(kind) ?? 0) + (events / at.hits) * m.more);
    }
  }
  const procs: Named = new Map();
  const lost: Named = new Map();
  for (const [kind, n] of landed) {
    const [a, b] = [was.kinds.get(kind), now.kinds.get(kind)];
    const k = (a ?? b)!;
    if (items.has(k.source)) continue;
    const sign = Math.sign(n);
    const events = Math.min(Math.abs(n), sign * ((b?.events ?? 0) - (a?.events ?? 0)));
    if (!(events > 0)) continue;
    const at = sign > 0 ? b! : a!;
    const damage = Math.min((at.damage / at.events) * events, sign * ((b?.damage ?? 0) - (a?.damage ?? 0)));
    if (damage > 0) addTo(sign > 0 ? procs : lost, k.name, k.source, damage, new Map([[k.shown, damage]]));
  }
  // A name's new hits are at most what it gained, its lost ones at most what it lost; the rest of its
  // gain is the same hits dealing more or less.
  let base = 0;
  for (const name of new Set([...was.names.keys(), ...now.names.keys()])) {
    const { source } = (was.names.get(name) ?? now.names.get(name))!;
    if (items.has(source)) continue;
    const d = (now.names.get(name)?.damage ?? 0) - (was.names.get(name)?.damage ?? 0);
    const [p, l] = [procs.get(name), lost.get(name)];
    if (p) p.damage = Math.min(p.damage, Math.max(0, d));
    if (l) l.damage = Math.min(l.damage, Math.max(0, -d));
    const rest = d - (p?.damage ?? 0) + (l?.damage ?? 0);
    if (rest > 0) base += rest;
    else addTo(lost, name, source, -rest, (now.names.get(name) ?? was.names.get(name))!.shown);
  }
  return { base, procs, lost };
}

/** An item the shop sells on Summoner's Rift, to any champion. */
const onRift = (i: ItemData) => i.inStore && !i.requiredChampion;

/** A legendary item or a pair of boots on Summoner's Rift (not a champion-specific one). */
const isCandidate = (i: ItemData) => onRift(i) && (isLegendary(i) || (i.tags.includes("Boots") && i.depth >= 2));

/** Legendary items + boots on Summoner's Rift (excluding champion-specific ones). */
export function defaultCandidates(data: GameData, base?: Scenario): ItemData[] {
  return Object.values(data.items).filter(isCandidate);
}

/** An item the shop sells to build into others (Serrated Dirk, B. F. Sword, Dark Seal), but boots and potions. */
export const isComponent = (it: ItemData) => it.into.length > 0 && !it.tags.includes("Boots") && !it.tags.includes("Consumable");

/** The components on Summoner's Rift (excluding champion-specific ones): rankItems ranks them with the
 *  legendaries and boots when asked to; sets of items and optimize keep to those. */
export function componentCandidates(data: GameData): ItemData[] {
  return Object.values(data.items).filter((i) => onRift(i) && isComponent(i));
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

/**
 * How many of a build's items a set of items can be bought in place of, as searchItemSets buys it:
 * each of its items built from items of the build in their place, for more gold, at most one of an item
 * group (conflicts). Each frees a slot for one more item: Zhonya's Hourglass in place of two Amplifying
 * Tomes is one, and anything in the other's slot. Of two Sheens, none: a Spellblade item in place of
 * one leaves the other; nor a Sheen beside a Trinity Force. Of the candidates given, else the
 * legendaries and boots.
 */
export function upgradeRoom(data: GameData, items: readonly (number | null)[], candidates?: (number | string)[]): number {
  type Held = { it: ItemData; held: boolean };
  const idsOf = (build: Held[]) => build.map((e) => e.it.id);
  const itemsOf = (build: Held[]) => build.map((e) => e.it);
  const start: Held[] = items.flatMap((x) => (x != null && data.items[x] ? [{ it: data.items[x], held: true }] : []));
  const pool = (candidates ? candidates.map((q) => findItem(data, q)) : defaultCandidates(data)).filter((it) => builtFrom(data, idsOf(start), it.id).length);
  /** The build with `it` bought in place of what it's built from; null where it can't be. */
  const buy = (build: Held[], it: ItemData): Held[] | null => {
    const used = builtFrom(data, idsOf(build), it.id);
    // Not an upgrade of an item of the set: each one bought takes a slot of its own.
    if (!used.length || used.some((k) => !build[k].held)) return null;
    const rest = build.filter((_, k) => !used.includes(k));
    if (conflicts(itemsOf(rest), it)) return null;
    // A free upgrade isn't bought: the mid lane role quest's tier 3 boots.
    if (it.gold.total <= used.reduce((sum, k) => sum + build[k].it.gold.total, 0)) return null;
    return [...rest, { it, held: false }];
  };
  const heldIn = (build: Held[]) => build.filter((e) => e.held).map((e) => e.it.id);
  let most = 0;
  // The build's items an item at a time, the one fewest can be bought in place of first: each of those
  // bought, or none, its copy kept; never more than the items left to try. Copies are alike, so a copy
  // kept is any of them, as the shop takes the first.
  const go = (build: Held[], kept: number[]) => {
    const held = heldIn(build);
    const used = start.length - held.length;
    most = Math.max(most, used);
    const left = [...kept];
    const open = held.filter((x) => (left.includes(x) ? (left.splice(left.indexOf(x), 1), false) : true));
    if (most === start.length || used + open.length <= most) return;
    const next = pool.map((it) => buy(build, it)).filter((b): b is Held[] => b != null);
    const ids = [...new Set(open)];
    const copies = (xs: number[], x: number) => xs.filter((y) => y === x).length;
    const ways = ids.map((x) => next.filter((b) => copies(heldIn(b), x) < copies(held, x)));
    const k = ways.reduce((m, w, i) => (w.length < ways[m].length ? i : m), 0);
    for (const b of ways[k]) go(b, kept);
    go(build, [...kept, ids[k]]);
  };
  go(start, []);
  return most;
}

/** Item-group conflicts (only one Spellblade, Hydra, Fatality, Blight… item; one pair of boots), and a
 *  legendary's second copy; a component's copies stack (two Long Swords), its unique passive once. */
export function conflicts(build: ItemData[], it: ItemData): string | null {
  if (isLegendary(it) && build.some((b) => b.id === it.id)) return "duplicate";
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
  let pool = (opts.pool ? opts.pool.map((q) => findItem(data, q)) : defaultCandidates(data, base)).filter((p) => !fixed.some((f) => f.id === p.id));
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
// Item sets: the best few items to buy together, for Item value and rank-items --size. A beam search
// rather than optimizeItems' brute force: it adds one item at a time to the sets it keeps, so an item
// counts for what it adds to the others (Rabadon's Deathcap on more AP, Void Staff on more magic
// damage). A generator, so its caller can show progress and give way between simulations.

/** A set of items bought together, as rankItems' rows: what it gains for the gold it costs, and from what. */
export interface ItemSet extends GainParts {
  /** The items bought, in the order to buy them: each the one that adds the most damage per gold to those before it. */
  items: { item: string; id: number }[];
  /** The build's items they're built from, which they replace (Boots, for a pair of boots). */
  replaces?: { item: string; id: number }[];
  gold: number;
  totalDamage: number;
  gain: number;
  /** Damage gained per 1000 of the gold. */
  gainPerGold: number;
  killed: boolean;
  killTime?: number;
}

/** The parts of a gain (gainParts); a set's own hits name their item (its source, item:3089). */
export type GainParts = ReturnType<typeof gainParts>;

export interface ItemSetOptions {
  /** How many items each set adds. */
  size: number;
  /** The items to choose from (by default the legendaries and boots, defaultCandidates). */
  candidates?: (number | string)[];
  /** How many sets of each size the search builds on, the best by damage and the best per gold each (6). */
  beam?: number;
  /** Whether a build's items fit its slots (the bot lane quest's boots slot); by default six items do. */
  fits?: (items: ItemData[]) => boolean;
  /** How many sets to return, the best by damage and the best per gold each (25). */
  limit?: number;
}

/** Progress, in simulations: those run, and a guess at how many the search takes in all (the buy order's aside), which can go up as well as down. */
export interface SearchProgress {
  done: number;
  total: number;
}

/** Rounds of swapping the best sets' items, at most. */
const REFINE_ROUNDS = 3;

/**
 * The best sets of `size` items to add to the build, as the shop buys them: one at a time, an item
 * built from items of the build in their place, at most one of an item group (conflicts), and the
 * build fitting its slots. Each build is simulated once.
 *
 * First every candidate alone, as rankItems. Then, size by size, each of the `beam` best sets by
 * damage and the `beam` best per gold with each candidate added that adds damage alone. One that
 * doesn't (idle: most add nothing to the build, as boots with nothing to scale with move speed, but
 * some nothing yet, as Stormsurge short of its burst) is tried with the best set by damage and the
 * best per gold of each size instead, and once it makes a set kept there, with the other sets kept
 * too and from then on with each; a set it adds nothing to isn't one. Last, the best set by damage
 * and the best per gold with each of their items swapped for each candidate not idle, and again from
 * a better one found, up to 3 rounds. At most candidates + (size − 1) × 2 × beam × candidates
 * simulations and 2 × size × candidates a round of swaps, fewer as idle candidates are tried with two
 * sets of a size and a build reached two ways is simulated once: for the five builds the benchmark
 * ranks items for (test/corpus.ts), 650 to 800 for 2 items of some 115 candidates, 1,300 to 1,700 for
 * 3, 2,000 to 2,500 for 4, 1,700 to 2,900 for 5 (from one item).
 *
 * A set's items come in the order to buy them: a greedy pass over its own items, the one that adds the
 * most damage per gold alone first, then the one that adds the most per gold to it, and so on. Its
 * builds are mostly ones the search simulated: 0 to some 40 simulations more in all.
 *
 * What it misses: a set none of whose smaller sets was kept and that differs from the best ones by
 * more than one item, as items that add little alone but much together; and one with an idle
 * candidate that makes no set kept with the best ones of a size, though it would with another. Of
 * the sets whose items all add damage, for 2 items it found the 8 best by damage and the 8 best per
 * gold of every one in each of those five builds, and in 159 of 160 builds of tank items with short
 * combos or none (where trying only the candidates that add damage alone missed some in 27, the best
 * itself in 16); for 3 to 5 items, as a search keeping 24 and trying every candidate found, in each
 * of the five but for 2 of one's 16 at 4 items, and for 3 in 56 of 60 of the others, as many as
 * trying every candidate with each set kept.
 */
export function* searchItemSets(
  data: GameData,
  base: Scenario,
  opts: ItemSetOptions,
): Generator<SearchProgress, { base: Summary; sets: ItemSet[]; evaluated: number }> {
  const beam = opts.beam ?? 6;
  const fits = opts.fits ?? ((items: ItemData[]) => items.length <= 6);
  const baseRes = simulate(data, base);
  type Node = { added: ItemData[]; replaced: ItemData[]; build: ItemData[]; gold: number; r?: SimResult; gain: number; perGold: number };
  const root: Node = { added: [], replaced: [], build: (base.items ?? []).map((q) => findItem(data, q)), gold: 0, r: baseRes, gain: 0, perGold: 0 };
  const candidates = opts.candidates ? opts.candidates.map((q) => findItem(data, q)) : defaultCandidates(data, base);

  /** The set with one more item, as the shop buys it; null where it can't be bought. */
  const buy = (n: Node | null, it: ItemData): Node | null => {
    if (!n) return null;
    const used = builtFrom(
      data,
      n.build.map((b) => b.id),
      it.id,
    );
    // Not an upgrade of an item of the set: each one bought takes a slot of its own.
    if (used.some((k) => n.added.includes(n.build[k]))) return null;
    const rest = n.build.filter((_, k) => !used.includes(k));
    if (conflicts(rest, it)) return null;
    const gold = it.gold.total - used.reduce((sum, k) => sum + n.build[k].gold.total, 0);
    // A free upgrade isn't bought: the mid lane role quest's tier 3 boots.
    if (used.length && gold <= 0) return null;
    const build = [...rest, it];
    if (!fits(build)) return null;
    return { added: [...n.added, it], replaced: [...n.replaced, ...used.map((k) => n.build[k])], build, gold: n.gold + gold, gain: 0, perGold: 0 };
  };

  // Simulates each set not seen before; `ahead` guesses how many more the search takes after them.
  const keyOf = (build: ItemData[]) =>
    build
      .map((b) => b.id)
      .sort((a, b) => a - b)
      .join();
  /** The total damage of each build simulated, by its items. */
  const totals = new Map<string, number>();
  let done = 0;
  let last: SearchProgress = { done: 0, total: 0 };
  function* run(sets: (Node | null)[], ahead: number): Generator<SearchProgress, Node[]> {
    const fresh: Node[] = [];
    const batch = new Set<string>();
    for (const n of sets) {
      const key = n && keyOf(n.build);
      if (!n || totals.has(key!) || batch.has(key!)) continue;
      batch.add(key!);
      fresh.push(n);
    }
    const total = done + fresh.length + ahead;
    for (const n of fresh) {
      n.r = simulate(data, { ...base, items: n.build.map((b) => b.id) });
      totals.set(keyOf(n.build), n.r.totalDamage);
      n.gain = n.r.totalDamage - baseRes.totalDamage;
      n.perGold = n.gold > 0 ? (n.gain / n.gold) * 1000 : 0;
      yield (last = { done: ++done, total });
    }
    return fresh.filter((n) => n.gain > 0.5);
  }

  const limit = opts.limit ?? 25;
  // The candidates tried with every set kept: those that add damage alone, and those that have made a
  // set kept since. The others, idle, are tried with the best set by damage and the best per gold of
  // each size until they do.
  let pool: ItemData[] = [];
  let idle = candidates;
  // A guess at what the sizes after `size` take, and the swaps: about beam + 1 sets kept of each (the
  // best by damage and the best per gold mostly the same), each with the pool, two sets with each idle
  // candidate, none waking, and a quarter of a round of swaps, most of whose sets have been simulated.
  // Until the first size sorts them, every candidate counts as in the pool.
  const after = (size: number) => {
    const [n, idling] = size === 1 ? [candidates.length, 0] : [pool.length, idle.length];
    return (opts.size - size) * ((beam + 1) * n + 2 * idling) + Math.round(0.5 * opts.size * n);
  };
  let kept = [root];
  let found: Node[] = [];
  for (let size = 1; size <= opts.size; size++) {
    const leads = best(kept, 1);
    const tries = leads.flatMap((from) => idle.map((it) => ({ from, it, set: buy(from, it) })));
    const fresh = yield* run([...tries.map((t) => t.set), ...kept.flatMap((n) => pool.map((it) => buy(n, it)))], after(size));
    // An idle candidate that adds nothing to the set it was tried with makes no set there. One that adds
    // damage wakes, alone, or after that with its set among those kept: one that adds a little to the
    // best sets, as many do, isn't tried with the others but again with the next size's best.
    const none = new Set(tries.filter((t) => t.set && totals.get(keyOf(t.set.build))! - t.from.r!.totalDamage <= 0.5).map((t) => t.set));
    found = fresh.filter((n) => !none.has(n));
    const keep = new Set(size === 1 ? found : best(found, beam));
    const wakes = new Set(tries.filter((t) => t.set && keep.has(t.set)).map((t) => t.it));
    const woke = idle.filter((it) => wakes.has(it));
    if (woke.length) {
      // Woken, it's tried with the other sets kept too, and from then on with each.
      pool = [...pool, ...woke];
      idle = idle.filter((it) => !wakes.has(it));
      const more = yield* run(
        kept.flatMap((n) => woke.map((it) => buy(n, it))),
        after(size),
      );
      found.push(...more);
    }
    kept = best(found, beam);
  }
  // Each of the best sets' items swapped for each candidate: the sets one item from them.
  const top = () => [best(found, 1, "gain")[0], best(found, 1, "perGold")[0]];
  let was: (Node | undefined)[] = [];
  for (let pass = 0; pass < REFINE_ROUNDS; pass++) {
    const now = top();
    const seeds = [...new Set(now.filter((n, i) => n && n !== was[i]))] as Node[];
    if (!seeds.length) break;
    was = now;
    const near = seeds.flatMap((s) => s.added.flatMap((_, i) => pool.map((it) => [...s.added.slice(0, i), ...s.added.slice(i + 1), it].reduce(buy, root))));
    // Guessed the last round: another comes only of a better set found.
    found.push(...(yield* run(near, 0)));
  }

  // Each set's items in the order to buy them, a greedy pass over its own items: first the one that
  // adds the most damage per gold alone, then the one that adds the most per gold to it, and so on.
  // The builds on the way are mostly ones the search simulated, which aren't simulated again; the few
  // that aren't (0 to some 40 in all) don't count as progress, which holds where the search left it.
  const chosen = best(found, limit);
  let ordering = 0;
  const ordered: ItemData[][] = [];
  for (const n of chosen) {
    let [at, atTotal] = [root, baseRes.totalDamage];
    const rest = [...n.added];
    while (rest.length > 1) {
      let pick: { k: number; next: Node; total: number; perGold: number } | null = null;
      for (let k = 0; k < rest.length; k++) {
        const next = buy(at, rest[k]);
        if (!next) continue;
        let total = totals.get(keyOf(next.build));
        if (total === undefined) {
          total = simulate(data, { ...base, items: next.build.map((b) => b.id) }).totalDamage;
          totals.set(keyOf(next.build), total);
          ordering++;
          yield last;
        }
        const perGold = (total - atTotal) / (next.gold - at.gold);
        if (!pick || perGold > pick.perGold) pick = { k, next, total, perGold };
      }
      // Bought in no other order (never, as the shop's rules go): the rest as found.
      if (!pick) break;
      [at, atTotal] = [pick.next, pick.total];
      rest.splice(pick.k, 1);
    }
    ordered.push([...at.added, ...rest]);
  }

  const baseTally = tally(baseRes);
  const sets = chosen.map((n, i): ItemSet => ({
    items: ordered[i].map((it) => ({ item: it.name, id: it.id })),
    ...(n.replaced.length ? { replaces: n.replaced.map((it) => ({ item: it.name, id: it.id })) } : {}),
    gold: n.gold,
    totalDamage: round(n.r!.totalDamage),
    gain: round(n.gain),
    gainPerGold: round(n.perGold, 2),
    ...gainParts(baseRes, baseTally, n.r!, new Set(n.added.map((it) => `item:${it.id}`))),
    killed: n.r!.killed,
    ...(n.r!.killTime !== undefined ? { killTime: round(n.r!.killTime, 2) } : {}),
  }));
  return { base: summarize(baseRes, "current build"), sets, evaluated: done + ordering };
}

/** The `n` best by damage and the `n` best per gold (or by one of them), by damage. */
function best<T extends { gain: number; perGold: number }>(xs: T[], n: number, by?: "gain" | "perGold"): T[] {
  const top = (k: "gain" | "perGold") => [...xs].sort((a, b) => b[k] - a[k]).slice(0, n);
  return [...new Set([...(by !== "perGold" ? top("gain") : []), ...(by !== "gain" ? top("perGold") : [])])].sort((a, b) => b.gain - a.gain);
}

/** searchItemSets, run to its end. */
export function rankItemSets(data: GameData, base: Scenario, opts: ItemSetOptions) {
  const search = searchItemSets(data, base, opts);
  for (;;) {
    const step = search.next();
    if (step.done) return step.value;
  }
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
