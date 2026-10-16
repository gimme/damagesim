// UI state ⇄ engine Scenario, plus URL-hash persistence (shareable links) and the last state in
// localStorage (reloads where the page can't write its URL, e.g. the artifact frame).

import type { Scenario, SimSettings, TargetSpec } from '../engine/sim.ts';
import type { TargetPreset } from '../engine/presets.ts';
import { pageRunes, type RunePage } from '../engine/rune-page.ts';
import { DATA } from './data.ts';

/** Health, armor and magic resist. */
export interface TargetStats {
  hp: number;
  armor: number;
  mr: number;
}

/** Who you hit: a preset whose stats follow its level, a champion with items, or custom numbers. */
export type TargetMode = TargetPreset | 'champion' | 'custom';

export const TARGET_MODES: TargetMode[] = ['squishy', 'bruiser', 'tank', 'champion', 'custom'];

export interface TargetState {
  mode: TargetMode;
  /** Target level minus your level (presets and champions). */
  levelDiff: number;
  /**
   * A preset's items in place of its typical build for the target's level, per preset (absent =
   * the typical build). null = an item without health or resists, kept so the slots read as a build.
   */
  builds: Partial<Record<TargetPreset, (number | null)[]>>;
  champion: string;
  /** The champion's items. */
  items: number[];
  /** Custom numbers: total = base + bonus. */
  base: TargetStats;
  bonus: TargetStats;
  hpPercent: number;
  damageReduction: number;
}

export interface UIState {
  champion: string;
  level: number;
  /** null = default leveling. */
  ranks: { Q: number; W: number; E: number; R: number } | null;
  skillOrder: string;
  items: (number | null)[];
  runes: RunePage;
  options: Record<string, number>;
  combo: string;
  target: TargetState;
  settings: Required<Pick<SimSettings, 'finishDots'>>;
}

export const DEFAULT_STATE: UIState = {
  champion: 'Ahri',
  level: 11,
  ranks: null,
  skillOrder: 'QWE',
  items: [6655, 3020, null, null, null, null],
  // Electrocute, Cheap Shot, Grisly Mementos, Ultimate Hunter; Absolute Focus, Scorch.
  runes: { primary: 'Domination', secondary: 'Sorcery', picks: [8112, 8126, 8140, 8106, 8233, 8237], shards: [5008, 5008, 5001] },
  options: {},
  combo: 'E Q W R AA R',
  target: {
    mode: 'squishy',
    levelDiff: 0,
    builds: {},
    champion: 'Jinx',
    items: [3031],
    base: { hp: 1600, armor: 60, mr: 40 },
    bonus: { hp: 400, armor: 20, mr: 10 },
    hpPercent: 100,
    damageReduction: 0,
  },
  settings: { finishDots: true },
};

export function toScenario(s: UIState): Scenario {
  return {
    champion: s.champion,
    level: s.level,
    ...(s.ranks ? { ranks: s.ranks } : {}),
    skillOrder: s.skillOrder,
    items: s.items.filter((x): x is number => x != null),
    runes: pageRunes(DATA, s.runes),
    options: s.options,
    combo: s.combo,
    target: toTargetSpec(s.target),
    settings: s.settings,
  };
}

export function toTargetSpec(t: TargetState): TargetSpec {
  const hp = { hpPercent: t.hpPercent, damageReduction: t.damageReduction };
  if (t.mode === 'champion') return { champion: t.champion, levelDiff: t.levelDiff, items: t.items, ...hp };
  if (t.mode === 'custom')
    return {
      maxHp: t.base.hp + t.bonus.hp,
      bonusHp: t.bonus.hp,
      armor: t.base.armor + t.bonus.armor,
      bonusArmor: t.bonus.armor,
      mr: t.base.mr + t.bonus.mr,
      bonusMr: t.bonus.mr,
      ...hp,
    };
  const build = t.builds[t.mode];
  return { preset: t.mode, levelDiff: t.levelDiff, ...(build ? { items: build.filter((x): x is number => x != null) } : {}), ...hp };
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
    const target: TargetState = TARGET_MODES.includes(parsed.target?.mode) ? { ...DEFAULT_STATE.target, ...parsed.target } : DEFAULT_STATE.target;
    const runes: RunePage = isRunePage(parsed.runes) ? parsed.runes : DEFAULT_STATE.runes;
    return { ...DEFAULT_STATE, ...parsed, runes, target, settings: { ...DEFAULT_STATE.settings, ...parsed.settings } };
  } catch {
    return null;
  }
}

const isRunePage = (p: any): p is RunePage =>
  typeof p?.primary === 'string' && typeof p.secondary === 'string' && [p.picks, p.shards].every((xs) => Array.isArray(xs) && xs.every((x: unknown) => typeof x === 'number'));

const STORAGE_KEY = 'damagesim:state';

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
