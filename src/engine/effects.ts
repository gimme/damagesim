// Hook interface shared by item passives, runes, summoner spells and champion kit mechanics.

import type { DamageType } from './damage.ts';
import type { StatMods } from './stats.ts';
import type { Sim } from './sim.ts';
import type { ComponentSpec, KitOption } from './kit-types.ts';

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
  /** Proc damage (items, runes, champion procs): applies no spell effects and triggers no runes. */
  proc: boolean;
  /** Proc damage that triggers Dark Harvest anyway (Teemo's Toxic Shot). */
  harvest?: boolean;
  crit: boolean;
  /** Not affected by damage-dealt amplifiers (Ignite, First Strike bonus). */
  unamplified?: boolean;
  /** Persistent aura damage (Sunfire, Unending Despair): doesn't by itself keep you in combat. */
  aura?: boolean;
  /** Basic damage other than the attack itself (Kraken Slayer, attack-like ability hits). */
  basic?: boolean;
  /** On-hit damage that reduced on-hit effectiveness doesn't scale (Grasp, Heartsteel, Electrospark). */
  fullOnHit?: boolean;
}

export interface DamageInstance {
  id: number;
  time: number;
  /** Groups the instances of one cast / one attack ("separate hits" for runes). */
  castId: number;
  /**
   * The castId of the combo action (an ability cast, an attack, an active) that set this off, also
   * for hits counted as casts of their own (Zed's shadow Q, Katarina's R daggers) and for what the
   * action triggered (procs, DoTs). Unset for damage no action set off (an aura from the start).
   */
  action?: number;
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
   * (Shadowflame) multiply. `id` is the source as a damage instance's `source` names it
   * ('item:3165', 'rune:8005', 'R'); `source` is its name.
   */
  amps: { id?: string; source: string; value: number; kind?: 'dealt' | 'taken' | 'multiplier' }[];
  /** Filled in when applied. */
  effectiveResist?: number;
  resistMult?: number;
  /** The amps together, as they multiply the damage. */
  ampMult?: number;
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
  canCrit: boolean;
  /** Chance (0-1) that the attack crits on its own, before guaranteed crits (Sundered Sky…). */
  naturalCrit: number;
  /** Damage multiplier of a full crit for this attack (champion crit modifiers included). */
  critMultiplier: number;
  /**
   * Guaranteed crit from an item: `modifier` × full crit damage, or `naturalModifier` × full crit
   * damage when the attack would have crit anyway. Several sources keep the highest of each.
   */
  forcedCrit?: { modifier: number; naturalModifier: number };
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
  /** Extra times on-hit effects apply (Guinsoo's Phantom Hit, Dusk and Dawn, Renekton W); sources add up. */
  repeatOnHit?: number;
  /** This pass is the repeated on-hit application (no base damage). */
  phantom?: boolean;
  /** When a basic attack was launched (its windup ended), when its missile flew before it hit. */
  launched?: number;
}

/**
 * A basic attack launched (its windup ended; a ranged one hits when its missile arrives), or an
 * ability hit that triggers on-attack effects (Ezreal Q), which launches as it hits.
 */
export interface AttackLaunch {
  castId: number;
  /** The ability whose hit it is; unset for a basic attack. */
  fromAbility?: Slot;
}

/** The hit triggers on-attack effects (and isn't a repeated on-hit application). */
export function triggersOnAttack(atk: AttackInfo): boolean {
  return atk.onAttack && !atk.phantom;
}

/** Apply the attack's on-hit effects `n` more times. */
export function addOnHitRepeat(atk: AttackInfo, n = 1) {
  atk.repeatOnHit = (atk.repeatOnHit ?? 0) + n;
}

/** Guarantee a crit (see AttackInfo.forcedCrit). */
export function forceCrit(atk: AttackInfo, modifier: number, naturalModifier = modifier) {
  const f = atk.forcedCrit;
  atk.forcedCrit = { modifier: Math.max(f?.modifier ?? 0, modifier), naturalModifier: Math.max(f?.naturalModifier ?? 0, naturalModifier) };
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
  /** Cast by an item active (Rocketbelt), not a champion ability. */
  item?: boolean;
  isUltimate: boolean;
  label: string;
}

/** Distance to the target, shared by Arcane Comet, Hexoptics C44 and Horizon Focus (positions are not simulated). */
export const DISTANCE = { key: 'distance', label: 'Distance to target (units)', default: 600, min: 0, max: 2000, step: 100, description: 'Where your attacks and abilities hit the target from.' };

/**
 * Your own health, shared by Last Stand, Absolute Focus, Immortal Path, Overlord's Bloodmail, Olaf,
 * Tryndamere and Dr. Mundo. It stays where it's set, as the target never fights back. Each switches
 * or stops ramping at a multiple of 10% (Absolute Focus 70, Immortal Path 50, Last Stand 60 to 30,
 * the rest 30, Tryndamere 10), so it steps by 10.
 */
export const SELF_HP: KitOption = { key: 'self.hpPercent', label: 'Your current HP (%)', default: 100, min: 10, max: 100, step: 10, description: 'Your health as a percentage of your maximum health.' };

/**
 * Seconds you've already been fighting when the combo starts, shared by what builds up over a fight:
 * the damage bonus of Liandry's Torment, Riftmaker and Haunting Guise, and Grasp of the Undying's
 * charge. None takes more than 4 seconds.
 */
export const IN_COMBAT: KitOption = {
  key: 'combat.seconds',
  label: 'Seconds already in combat',
  default: 0,
  min: 0,
  max: 4,
  step: 1,
  description: 'Starts the combo as if you had been fighting the target this long, so what builds up over a fight starts partway.',
};

/** Your current health as a fraction of your maximum (the option is a percentage). */
export const selfHp = (opt: Record<string, number>) => (opt[SELF_HP.key] ?? SELF_HP.default) / 100;

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
  /**
   * An attack is launched: on-attack effects (the wiki's "on-attacking": attack speed stacks, Guinsoo's,
   * Navori, Energize charges, Hail of Blades) trigger now, before abilities cast while a ranged
   * attack's missile flies; what it deals waits for its hit (preAttack, onAttack). Same castId as the hit.
   */
  onLaunch?(sim: Sim, launch: AttackLaunch): void;
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
  options?: KitOption[];
}

export type { ComponentSpec };
