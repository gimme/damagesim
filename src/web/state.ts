// UI state ⇄ engine Scenario, plus URL-hash persistence (shareable links) and the last state in
// localStorage (reloads where the page can't write its URL, e.g. the artifact frame).

import type { Scenario, SimSettings } from '../engine/sim.ts';
import { isTargetPreset, type TargetPreset } from '../engine/presets.ts';

export const SHARD_ROWS: { label: string; options: number[] }[] = [
  { label: 'Offense', options: [5008, 5005, 5007] },
  { label: 'Flex', options: [5008, 5010, 5001] },
  { label: 'Defense', options: [5011, 5013, 5001] },
];

export interface TargetState {
  mode: 'stats' | 'champion';
  /** Stats mode: an archetype whose stats follow its level, or null for the custom numbers below. */
  preset: TargetPreset | null;
  /** Target level minus your level (presets and champion targets). */
  levelDiff: number;
  maxHp: number;
  armor: number;
  mr: number;
  bonusHp: number;
  bonusArmor: number;
  bonusMr: number;
  hpPercent: number;
  damageReduction: number;
  champion: string;
  items: number[];
}

export interface UIState {
  champion: string;
  level: number;
  /** null = default leveling. */
  ranks: { Q: number; W: number; E: number; R: number } | null;
  skillOrder: string;
  items: (number | null)[];
  keystone: number | null;
  minors: number[];
  shards: number[];
  options: Record<string, number>;
  combo: string;
  target: TargetState;
  settings: Required<Pick<SimSettings, 'crit' | 'ampStacking' | 'priorCombatTime' | 'finishDots'>>;
}

export const DEFAULT_STATE: UIState = {
  champion: 'Ahri',
  level: 11,
  ranks: null,
  skillOrder: 'QWE',
  items: [6655, 3020, null, null, null, null],
  keystone: 8112,
  minors: [8126, 8143, 8233, 8237],
  shards: [5008, 5008, 5001],
  options: {},
  combo: 'E Q W R AA R',
  target: {
    mode: 'stats',
    preset: 'squishy',
    levelDiff: 0,
    maxHp: 1700,
    armor: 62,
    mr: 42,
    bonusHp: 150,
    bonusArmor: 0,
    bonusMr: 0,
    hpPercent: 1,
    damageReduction: 0,
    champion: 'Jinx',
    items: [3031],
  },
  settings: { crit: 'expected', ampStacking: 'additive', priorCombatTime: 0, finishDots: true },
};

export function toScenario(s: UIState): Scenario {
  const t = s.target;
  return {
    champion: s.champion,
    level: s.level,
    ...(s.ranks ? { ranks: s.ranks } : {}),
    skillOrder: s.skillOrder,
    items: s.items.filter((x): x is number => x != null),
    runes: [...(s.keystone ? [s.keystone] : []), ...s.minors, ...s.shards],
    options: s.options,
    combo: s.combo,
    target:
      t.mode === 'champion'
        ? { champion: t.champion, levelDiff: t.levelDiff, items: t.items, hpPercent: t.hpPercent, damageReduction: t.damageReduction }
        : t.preset
          ? { preset: t.preset, levelDiff: t.levelDiff, hpPercent: t.hpPercent, damageReduction: t.damageReduction }
          : {
              maxHp: t.maxHp,
              armor: t.armor,
              mr: t.mr,
              bonusHp: t.bonusHp,
              bonusArmor: Math.min(t.bonusArmor, t.armor),
              bonusMr: Math.min(t.bonusMr, t.mr),
              hpPercent: t.hpPercent,
              damageReduction: t.damageReduction,
            },
    settings: s.settings,
  };
}

export function encodeState(s: UIState): string {
  const json = JSON.stringify(s);
  return btoa(unescape(encodeURIComponent(json))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function decodeState(hash: string): UIState | null {
  try {
    const b64 = hash.replace(/^#/, '').replace(/-/g, '+').replace(/_/g, '/');
    if (!b64) return null;
    const parsed = JSON.parse(decodeURIComponent(escape(atob(b64))));
    const pt = parsed.target ?? {};
    const target: TargetState = { ...DEFAULT_STATE.target, ...pt };
    // Links from before presets/level offsets: explicit stats, absolute target level.
    if (parsed.target && !('preset' in pt)) target.preset = null;
    if (!isTargetPreset(target.preset)) target.preset = null;
    if (pt.levelDiff === undefined && typeof pt.level === 'number') target.levelDiff = pt.level - (parsed.level ?? DEFAULT_STATE.level);
    delete (target as Partial<TargetState> & { level?: number }).level;
    return { ...DEFAULT_STATE, ...parsed, target, settings: { ...DEFAULT_STATE.settings, ...parsed.settings } };
  } catch {
    return null;
  }
}

const STORAGE_KEY = 'lolsim:state';

export function loadSavedState(): UIState | null {
  try {
    return decodeState(localStorage.getItem(STORAGE_KEY) ?? '');
  } catch {
    return null;
  }
}

export function saveState(s: UIState): void {
  try {
    localStorage.setItem(STORAGE_KEY, encodeState(s));
  } catch {
    // storage unavailable
  }
}
