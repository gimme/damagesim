// Hook interface shared by item passives, runes, summoner spells and champion kit mechanics.

import type { DamageType } from './damage.ts';
import type { StatMods } from './stats.ts';
import type { Sim } from './sim.ts';
import type { ComponentSpec } from './kit-types.ts';

export type Slot = 'P' | 'Q' | 'W' | 'E' | 'R';

export interface DamageFlags {
  /** What produced the damage. */
  kind: 'ability' | 'attack' | 'item' | 'rune' | 'summoner';
  slot?: Slot;
  /** Counts as ability damage (Liandry's, Luden's, Electrocute ability hits, spell vamp…). */
  ability: boolean;
  /** The basic attack's own damage. */
  attack: boolean;
  /** On-hit effect damage. */
  onHit: boolean;
  aoe: boolean;
  dot: boolean;
  pet: boolean;
  /** Damage from an item/rune proc; does not trigger further procs. */
  proc: boolean;
  crit: boolean;
  /** Not affected by damage-dealt amplifiers (Ignite, First Strike bonus). */
  unamplified?: boolean;
  /** Persistent aura damage (Sunfire, Unending Despair): doesn't by itself keep you in combat. */
  aura?: boolean;
}

export interface DamageInstance {
  id: number;
  time: number;
  /** Groups the instances of one cast / one attack ("separate hits" for runes). */
  castId: number;
  source: string;
  sourceLabel: string;
  label: string;
  type: DamageType;
  /** Pre-mitigation damage after crit. */
  raw: number;
  flags: DamageFlags;
  /**
   * Damage modifiers (fractions). Since 26.9 "dealt" amplifiers (PTA, Coup de Grace, Liandry's…)
   * add together; "taken" modifiers (Abyssal Mask, damage reduction) and "crit"-like effects
   * (Shadowflame) multiply.
   */
  amps: { source: string; value: number; kind?: 'dealt' | 'taken' | 'multiplier' }[];
  /** Filled in when applied. */
  effectiveResist?: number;
  resistMult?: number;
  final?: number;
  targetHpBefore?: number;
  targetHpAfter?: number;
  note?: string;
  /** Damage dealt by a kit mark/detonation (does not re-trigger marks). */
  fromMark?: string;
}

/** A pending hit to be dealt (before amps/mitigation). */
export interface DamageRequest {
  source: string;
  sourceLabel: string;
  label: string;
  type: DamageType | 'adaptive';
  amount: number;
  flags?: Partial<DamageFlags>;
  castId?: number;
  note?: string;
  /** Internal: produced by a mark/detonation. */
  markSource?: string;
  /** Extra percent armor/MR penetration for this hit only (Gangplank barrels ignore 40% armor). */
  penPercent?: number;
}

export interface AttackInfo {
  castId: number;
  /** Index of this attack in the combo (0-based). */
  index: number;
  crit: boolean;
  /** Expected-value crit factor used when crit mode is "expected". */
  critFactor: number;
  /** Extra damage requests added by on-hit effects. */
  extra: DamageRequest[];
  /** Multiplier applied to the attack's base damage (e.g. Kraken, Guinsoo?). */
  baseMult: number;
  /** Whether this hit came from an ability that applies on-hit (not a real attack). */
  fromAbility?: Slot;
  /**
   * Triggers on-attack effects (stacking: Guinsoo's, Energize charges, Navori, Lethal Tempo…): basic
   * attacks, and abilities on the wiki's on-attack list. On-hit effects apply to every hit.
   */
  onAttack: boolean;
  /** On-hit applied by an area effect (Press the Attack ignores those). */
  areaOnHit?: boolean;
  /** Set to true to remove the attack's own damage (empowered attacks that replace it). */
  replaceBase?: boolean;
  /** Apply on-hit effects extra times: true/1 = once more (Guinsoo's phantom hit, Dusk and Dawn). */
  repeatOnHit?: boolean | number;
  /** This pass is the repeated on-hit application (no base damage). */
  phantom?: boolean;
}

/** The hit triggers on-attack effects (and isn't a repeated on-hit application). */
export function triggersOnAttack(atk: AttackInfo): boolean {
  return atk.onAttack && !atk.phantom;
}

export interface CastInfo {
  castId: number;
  slot: Slot;
  /** The ability dashes/blinks the caster (Sudden Impact etc.). */
  dash?: boolean;
  resetsAttack?: boolean;
  variant?: string;
  /** Ability actually hits the target. */
  hitsTarget: boolean;
  isUltimate: boolean;
  label: string;
}

export interface SetupCtx {
  level: number;
  ranged: boolean;
  opt: Record<string, number>;
  champion: string;
  /** Number of legendary items (for "per legendary" scalings). */
  legendaryCount: number;
}

export interface EffectHooks {
  /** Static stat bonuses (computed once). */
  stats?(ctx: SetupCtx): Partial<StatMods> | void;
  /** Stat bonuses depending on simulation state (stacks, buffs). */
  dynamicStats?(sim: Sim): Partial<StatMods> | void;
  onStart?(sim: Sim): void;
  /** An ability was cast (before its damage). */
  onCast?(sim: Sim, cast: CastInfo): void;
  /** Before on-hit effects resolve: may force a crit (atk.crit/critFactor) or request repeatOnHit. */
  preAttack?(sim: Sim, atk: AttackInfo): void;
  /** A basic attack (or on-hit-applying ability) hits the target; push on-hit damage into atk.extra. */
  onAttack?(sim: Sim, atk: AttackInfo): void;
  /** Adjust a damage instance before mitigation (push amps, change raw). */
  beforeDamage?(sim: Sim, inst: DamageInstance): void;
  /** React to damage that was dealt (procs, burns, stack counters). */
  afterDamage?(sim: Sim, inst: DamageInstance): void;
  /** The target was crowd-controlled by an ability (immobilize: stun/root/knock-up/charm…). */
  onCrowdControl?(sim: Sim, cc: { kind: 'immobilize' | 'slow' | 'impair'; castId: number; slot?: Slot; duration: number }): void;
  /** Resist reductions this effect currently applies to the target. */
  targetResist?(sim: Sim): { armorFlat?: number; armorPercent?: number; mrFlat?: number; mrPercent?: number } | void;
}

export interface Effect extends EffectHooks {
  id: string;
  label: string;
  source: 'item' | 'rune' | 'kit' | 'summoner';
  /** Short human-readable description of what the simulator models. */
  description?: string;
  /** Things the simulator does not model for this effect. */
  limitations?: string[];
  /** Item / summoner active usable as a combo step. */
  active?: {
    label: string;
    cooldown: number;
    /** Seconds the cast takes. */
    castTime?: number;
    cast(sim: Sim, castId: number): void;
  };
  /** User-tunable parameters (e.g. stacks). */
  options?: { key: string; label: string; default: number; min?: number; max?: number; step?: number }[];
}

export type { ComponentSpec };
