// Shapes of the generated game data (data/generated/<patch>/…), produced by scripts/build-data.ts.

/** One node of a Riot "GameCalculation" formula tree (see calc.ts for semantics). */
export type CalcPart =
  | { t: 'dv'; name: string }
  | { t: 'stat'; stat: number; formula: number; coef: number; target?: boolean }
  | { t: 'statdv'; stat: number; formula: number; dv: string; target?: boolean }
  | { t: 'statsub'; stat: number; formula: number; sub: CalcPart; target?: boolean }
  | { t: 'num'; v: number }
  | { t: 'sum'; parts: CalcPart[] }
  | { t: 'prod'; a: CalcPart; b: CalcPart }
  | { t: 'lerp'; start: number; end: number; statProgression?: boolean }
  | { t: 'bp'; l1: number; init: number; bps: { level: number; perLevel: number; add: number }[] }
  | { t: 'lvltable'; values: number[] }
  | { t: 'effect'; idx: number }
  | { t: 'cdmult' }
  | { t: 'resource'; coef: number; formula: number; resource: number }
  | { t: 'buff'; buff: string; coef: number }
  | { t: 'buffdv'; buff: string; dv: string }
  | { t: 'clamp'; floor: number | null; ceil: number | null; parts: CalcPart[] }
  | { t: 'pow'; parts: CalcPart[]; exp: any }
  | { t: 'ref'; name: string }
  | { t: 'extdv'; spell: string; name: string }
  | { t: 'lerpdv'; start: string; end: string }
  | { t: 'bpdv'; l1: string; init: string; bps: { level: number; perLevel: string; add: string }[] }
  | { t: 'lvldv'; base: string; perLevel: string }
  | { t: 'buffelapsed'; buff: string; coef: number }
  | { t: 'itemcount'; epicness: number; coef: number }
  | { t: 'unknown'; type: string };

interface CalcCommon {
  /** Tooltip shows this value ×100 with a % sign. */
  pct?: boolean;
  tooltipOnly?: boolean;
  damageType?: number;
  precision?: number;
}

export type CalcNode =
  | ({ t: 'calc'; parts: CalcPart[]; mult?: CalcPart; rangedMult?: CalcPart } & CalcCommon)
  | ({ t: 'mod'; of: string; mult: CalcPart; rank?: number } & CalcCommon)
  | ({ t: 'cond'; default: string | null; conditional: string; requirement: { type: string; buff?: string } } & CalcCommon);

export interface SpellData {
  path: string;
  scriptName: string;
  name: string;
  /** Raw tooltip with @Placeholders@ (see tooltip.ts to render). */
  tooltip: string;
  levelCount?: number;
  /** Per-rank values; index = rank (index 0 is a placeholder for "unlearned"). */
  dataValues: Record<string, number[]>;
  calcs: Record<string, CalcNode>;
  /** Legacy effect amounts; effects[i][rank]. */
  effects?: number[][];
  /** Cooldown per rank; index = rank. */
  cooldown?: number[];
  /** Cost per rank; index = rank - 1. */
  cost?: number[];
  castTime: number;
  channel?: number;
  maxAmmo?: number[] | number;
  ammoRecharge?: number[] | number;
  tags?: string[];
  cooldownFixed?: boolean;
}

export interface AbilityData {
  name: string;
  /** P = passive, X = not bound to a slot (alternate forms, sub-spells). */
  slot: 'P' | 'Q' | 'W' | 'E' | 'R' | 'X';
  spells: SpellData[];
}

export interface ChampionBaseStats {
  hp: number;
  hpPerLevel: number;
  hpRegen: number;
  hpRegenPerLevel: number;
  resource: string;
  mp: number;
  mpPerLevel: number;
  mpRegen: number;
  mpRegenPerLevel: number;
  ad: number;
  adPerLevel: number;
  armor: number;
  armorPerLevel: number;
  mr: number;
  mrPerLevel: number;
  ms: number;
  range: number;
  attackSpeed: number;
  attackSpeedRatio: number;
  /** Fraction per level (0.022 = 2.2%). */
  attackSpeedPerLevel: number;
  critDamageMultiplier: number;
  attackWindupOffset: number;
  attackCastTime?: number;
  attackTotalTime?: number;
}

export interface ChampionData {
  id: string;
  key: number;
  name: string;
  title: string;
  tags: string[];
  partype: string;
  icon: string;
  attackType: 'melee' | 'ranged';
  adaptive: 'physical' | 'magic';
  stats: ChampionBaseStats;
  passive: { name: string; description: string };
  /** HUD icon of the passive and each ability slot, as a path under CommunityDragon's game folder. */
  abilityIcons: Partial<Record<'P' | 'Q' | 'W' | 'E' | 'R', string>>;
  abilities: AbilityData[];
}

export interface ChampionIndexEntry {
  id: string;
  key: number;
  name: string;
  title: string;
  tags: string[];
  icon: string;
  attackType: 'melee' | 'ranged';
  adaptive: 'physical' | 'magic';
  resource: string;
}

export interface ItemData {
  id: number;
  name: string;
  icon: string;
  gold: { total: number; base: number; sell: number; purchasable: boolean };
  tags: string[];
  from: number[];
  into: number[];
  depth: number;
  inStore: boolean;
  requiredChampion?: string;
  /** Normalized stat keys (see ITEM_STAT_FIELDS in build-data.ts). Percentages are fractions. */
  stats: Record<string, number>;
  dataValues: Record<string, number>;
  calcs: Record<string, CalcNode>;
  /** Tooltip values that differ for melee and ranged champions: the data value or calculation each
   *  side uses (Serpent's Fang's @ShieldShredMeleeRangedSplit@). */
  rangeSplits?: Record<string, { melee: string; ranged: string }>;
  /** Values the tooltip names @Effect1Amount@… */
  effects?: number[];
  /** The passive and active text with @Placeholders@ the shop text is generated from. */
  tooltip: string;
  /** Tooltip with numbers resolved by the game's own text generator. */
  description: string;
  plaintext: string;
}

export interface RuneData {
  id: number;
  key: string;
  name: string;
  tree: string;
  treeId: number;
  /** 0 = keystone row; -1 = stat shard. */
  row: number;
  icon: string;
  values: Record<string, number>;
  calcs: Record<string, CalcNode>;
  /** Long description (the rune page's text), with @Placeholders@. */
  description: string;
  /** In-game tooltip with @Placeholders@: calculations, and @f1@… values the rune's script sets in play. */
  tooltip: string;
  /** The texts the tooltip's {{ Key_@f1@ }} includes choose between, by lowercase key. */
  includes?: Record<string, string>;
  statModifiers?: unknown;
}

export interface DataMeta {
  patch: string;
  ddragonVersion: string;
  cdragonVersion: string;
  champions: number;
  items: number;
  runes: number;
}
