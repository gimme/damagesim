// Target archetypes ("squishy", "bruiser", "tank") whose stats follow the target's level.
//
// A preset = the average base stats of its champion class (game data, Riot's primary class tag)
// at the target level + the items of a typical build for that level (real items from the game
// data, bought in order, or the items the scenario gives instead) + health rune shards. Only the
// items' stats count: the target never fights back, so their passives and actives don't apply.

import type { ChampionBaseStats, ItemData } from './data-types.ts';
import { findItem, type GameData } from './gamedata.ts';
import { GAME } from './stats.ts';

export type TargetPreset = 'squishy' | 'bruiser' | 'tank';

export interface PresetDef {
  label: string;
  /** Primary class tags whose base stats are averaged. */
  classes: string[];
  /** Six items in purchase order; null = an item without health or resists (damage items, boots without resists). */
  build: (string | null)[];
  /** Health shards: flat (+65) and/or scaling (+10–180 by level). */
  shards: { flat: boolean; scaling: boolean };
  description: string;
}

export const TARGET_PRESETS: Record<TargetPreset, PresetDef> = {
  squishy: {
    label: 'Squishy',
    classes: ['Marksman', 'Mage', 'Assassin'],
    build: [null, null, null, null, 'Guardian Angel', "Banshee's Veil"],
    shards: { flat: false, scaling: true },
    description: 'Average marksman, mage and assassin with a damage build.',
  },
  bruiser: {
    label: 'Bruiser',
    classes: ['Fighter'],
    build: ["Mercury's Treads", 'Stridebreaker', "Sterak's Gage", "Death's Dance", 'Spirit Visage', "Dead Man's Plate"],
    shards: { flat: true, scaling: true },
    description: 'Average fighter with a health-and-resists bruiser build.',
  },
  tank: {
    label: 'Tank',
    classes: ['Tank'],
    build: ['Plated Steelcaps', 'Sunfire Aegis', 'Kaenic Rookern', 'Thornmail', "Jak'Sho, The Protean", "Warmog's Armor"],
    shards: { flat: true, scaling: true },
    description: 'Average tank with a full tank build.',
  },
};

/**
 * Finished items (boots included) at a champion level, for a laner with typical gold income:
 * boots around level 7, first legendary around 9, then one item every ~2 levels (6 at 18).
 */
const ITEMS_BY_LEVEL = [0, 0, 0, 0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 3, 4, 4, 5, 5, 6, 6, 6];

/** How {@link itemsAtLevel} picks the item count, for people reading it. */
export const ITEMS_BY_LEVEL_RULE = 'boots around level 7, the first item around 9, then one every ~2 levels (6 items at 18)';

export function itemsAtLevel(level: number): number {
  return ITEMS_BY_LEVEL[Math.max(1, Math.min(GAME.maxLevel, Math.round(level)))];
}

/** The level at which the typical build reaches `count` items (undefined beyond 6). */
export function levelForItems(count: number): number | undefined {
  const level = ITEMS_BY_LEVEL.findIndex((n, l) => l >= 1 && n >= count);
  return level > 0 ? level : undefined;
}

export function isTargetPreset(s: unknown): s is TargetPreset {
  return typeof s === 'string' && s in TARGET_PRESETS;
}

/** The preset's typical items at a level, in purchase order; null = an item without health or resists. */
export function typicalBuild(data: GameData, preset: TargetPreset, level: number): (ItemData | null)[] {
  return TARGET_PRESETS[preset].build.slice(0, itemsAtLevel(level)).map((x) => (x === null ? null : findItem(data, x)));
}

const classCache = new WeakMap<GameData, Map<string, ChampionBaseStats>>();

/** Average base stats (and growth) of champions whose primary class is one of `classes`. */
export function classAverageStats(data: GameData, classes: string[]): ChampionBaseStats {
  const key = classes.join(',');
  let cache = classCache.get(data);
  if (!cache) classCache.set(data, (cache = new Map()));
  const hit = cache.get(key);
  if (hit) return hit;
  const champs = Object.values(data.champions).filter((c) => classes.includes(c.tags?.[0] ?? ''));
  if (!champs.length) throw new Error(`no champions of class ${key}`);
  const avg = { ...champs[0].stats } as ChampionBaseStats & Record<string, unknown>;
  for (const k of Object.keys(avg)) {
    const vals = champs.map((c) => (c.stats as unknown as Record<string, unknown>)[k]).filter((v): v is number => typeof v === 'number');
    if (vals.length === champs.length) (avg as Record<string, unknown>)[k] = vals.reduce((s, v) => s + v, 0) / vals.length;
  }
  cache.set(key, avg);
  return avg;
}

/** Health from the preset's rune shards at a level. */
export function presetShardHp(data: GameData, preset: TargetPreset, level: number): number {
  const def = TARGET_PRESETS[preset];
  const scaling = data.runes.find((r) => r.id === 5001);
  const flat = data.runes.find((r) => r.id === 5011);
  let hp = 0;
  if (def.shards.scaling && scaling) hp += scaling.values.StatGainMin + ((scaling.values.StatGainMax - scaling.values.StatGainMin) * (level - 1)) / 17;
  if (def.shards.flat && flat) hp += flat.values.StatGain;
  return hp;
}

export interface ResolvedPreset {
  preset: TargetPreset;
  level: number;
  base: ChampionBaseStats;
  /** Items whose stats count: the given ones, else the typical build's items with health or resists. */
  items: ItemData[];
  /** Bonus health from rune shards. */
  shardHp: number;
  label: string;
}

/** A preset at a level, with `items` in place of its typical build when given. */
export function resolvePreset(data: GameData, preset: TargetPreset, level: number, items?: ItemData[]): ResolvedPreset {
  const def = TARGET_PRESETS[preset];
  const typical = items ? undefined : typicalBuild(data, preset, level);
  const owned = items ?? typical!.filter((x): x is ItemData => x !== null);
  const count = typical ? `, ${typical.length} item${typical.length === 1 ? '' : 's'}` : '';
  return {
    preset,
    level,
    base: classAverageStats(data, def.classes),
    items: owned,
    shardHp: presetShardHp(data, preset, level),
    label: `${def.label} lvl ${level}${count}${owned.length ? ` (${owned.map((i) => i.name).join(', ')})` : ''}`,
  };
}
