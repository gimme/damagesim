// Hook interface shared by item passives, runes, summoner spells and champion kit mechanics.

import type { DamageType } from "./damage.ts";
import type { StatMods } from "./stats.ts";
import type { Sim } from "./sim.ts";
import type { ComponentSpec, KitOption } from "./kit-types.ts";

export type Slot = "P" | "Q" | "W" | "E" | "R";

export interface DamageFlags {
  /** What produced the damage. */
  kind: "ability" | "attack" | "item" | "rune" | "summoner";
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
  /**
   * A literal execute (Smolder Q, Pyke R, The Collector): kills the target, so it sets off nothing
   * (no effects, runes, items, marks or detonations). See Sim.deal.
   */
  execute?: boolean;
  /** Persistent aura damage (Sunfire, Unending Despair): doesn't by itself keep you in combat. */
  aura?: boolean;
  /** Basic damage other than the attack itself (Kraken Slayer, attack-like ability hits). */
  basic?: boolean;
  /** On-hit damage that reduced on-hit effectiveness doesn't scale (Grasp, Heartsteel, Electrospark). */
  fullOnHit?: boolean;
  /** What an ability or passive adds to the attack it empowers (Garen Q, Vayne Q): the results show
   *  that attack as its. */
  empowered?: boolean;
}

export interface DamageInstance {
  id: number;
  time: number;
  /** Groups the instances of one cast / one attack ("separate hits" for runes). */
  castId: number;
  /**
   * The hit it's part of: a cast's parts landing together (the n-th of each at one moment: Katarina's
   * knife, its magic and AD parts), a mark's, an attack's damage with its on-hit effects (each
   * application: Dusk and Dawn's second is a hit of its own). Anything else is a hit of its own: what
   * a hit sets off (procs, marks, DoTs' ticks), parts landing later, an execute, a multiplier's part
   * recorded as a hit (amps' `hit`). Item value counts hits by it.
   */
  hitId: number;
  /**
   * The castId of the combo action (an ability cast, an attack, an active) that set this off, also
   * for hits counted as casts of their own (Zed's shadow Q, Katarina's R daggers) and for what the
   * action triggered (procs, DoTs). Unset for damage no action set off (an aura from the start).
   */
  action?: number;
  source: string;
  sourceLabel: string;
  /** The HUD icon of the cast it shows under, where the kit picks one (another form's spell, Arc of
   *  Ruin): a path under CommunityDragon's game folder. */
  icon?: string;
  label: string;
  type: DamageType;
  /** Pre-mitigation damage after crit. */
  raw: number;
  flags: DamageFlags;
  /**
   * Damage modifiers (fractions). Since 26.9 "dealt" amplifiers (PTA, Coup de Grace, Liandry's…)
   * add together; "taken" modifiers (Abyssal Mask, damage reduction) and "crit"-like effects
   * (Shadowflame) multiply. `id` is the source as a damage instance's `source` names it
   * ('item:3165', 'rune:8005', 'R'); `source` is its name. A multiplier with a `hit` (and an `id`)
   * is recorded as a hit of its own, so named, under its source: what it adds to the damage, on top
   * of the multipliers before it. For a champion's damage the game deals as an amp, which the results
   * credit to where it comes from (Yunara's passive amping a crit, as her attacks' crits deal it as a
   * hit), and Shadowflame's Cinderbloom, what its crits add most of what the item is worth; other
   * amps stay in the hit (Abyssal Mask, Rabadon's).
   */
  amps: { id?: string; source: string; value: number; kind?: "dealt" | "taken" | "multiplier"; hit?: string }[];
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
  type: DamageType | "adaptive";
  amount: number;
  flags?: Partial<DamageFlags>;
  castId?: number;
  /** The hit it's part of (DamageInstance.hitId); a new one if omitted. */
  hitId?: number;
  note?: string;
  /** Internal: produced by a mark/detonation. */
  markSource?: string;
  /** Extra percent armor/MR penetration for this hit only (Gangplank barrels ignore 40% armor). */
  penPercent?: number;
  /**
   * A hit that replaces an attack's own damage (Garen Q): of `amount`, what the normal attack would
   * have dealt, recorded as that attack's hit (`amount` of it, named `label`, a crit if `crit`) and
   * the rest as this.
   */
  normalAttack?: { amount: number; source: string; sourceLabel: string; label: string; crit: boolean };
  /**
   * Part of an attack that crits with it (canCrit components, Yone's magic half): `amount` is before
   * the crit, which multiplies it by this much on a full crit once the attack's crit is known,
   * guaranteed crits too (Sim.critAttack).
   */
  critMultiplier?: number;
  /** An on-hit dealt before the attack's own damage (Voltaic Cyclosword's Firmament, wiki). */
  beforeAttack?: boolean;
  /** An on-hit dealt first of the attack's on-hits, right after its own damage: the other Energized
   *  effects, which fire with Firmament. */
  firstOnHit?: boolean;
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
   * damage when the attack would have crit anyway. Several sources keep the highest of each. The
   * modifier scales all of the attack's own damage and of its empowered ability's, the parts that
   * don't crit too, but not its on-hit effects (Sim.critAttack).
   */
  forcedCrit?: { modifier: number; naturalModifier: number };
  /** Extra damage requests added by on-hit effects. */
  extra: DamageRequest[];
  /** Multiplier applied to the attack's base damage (e.g. Kraken, Guinsoo?). */
  baseMult: number;
  /** Whether this hit came from an ability that applies on-hit (not a real attack). */
  fromAbility?: Slot;
  /**
   * Triggers on-attack effects (stacking: Guinsoo's, Navori, Lethal Tempo…): basic
   * attacks, and abilities on the wiki's on-attack list. On-hit effects apply to every hit.
   */
  onAttack: boolean;
  /** On-hit applied by an area effect (Press the Attack ignores those). */
  areaOnHit?: boolean;
  /** Set to true to remove the attack's own damage (empowered attacks that replace it). */
  replaceBase?: boolean;
  /**
   * The hits in `extra` that replace it: they are recorded as the normal attack for as much as it
   * would have dealt, the rest as their own (Garen Q; hooks add theirs, before the crit: Galio's
   * passive). That much of them is the attack's, which crits (Sim.critAttack).
   */
  replacedBy?: DamageRequest[];
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
  /** "P" for a passive step, or an attack that is an ability (kit.attack.ability). */
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
  /** Seconds the cast takes (0 for item actives). */
  castTime?: number;
  /** Its place in a recast chain (1: the first cast; expressions' `recast`). */
  recast?: number;
  /** Not an ability cast for Spellblade (AbilitySpec.noSpellblade). */
  noSpellblade?: boolean;
  /** How far it goes, where its step sets it (AbilitySpec.variableDistance; expressions' `distance`). */
  distance?: number;
}

/**
 * Distance to the target (positions are not simulated): what attacks, missiles and dashes at it fly,
 * and what Arcane Comet, Hexoptics C44 and Horizon Focus read. Unset, your attack range (the
 * simulation sets it; `default` is only a fallback).
 */
export const DISTANCE = {
  key: "distance",
  label: "Distance to target (units)",
  default: 550,
  min: 0,
  max: 2000,
  step: 25,
  description: "Where the target stands, edge to edge: your attack range unless set. Attacks, missiles and dashes at it fly this far.",
};

/**
 * Your own health, shared by Last Stand, Absolute Focus, Immortal Path, Overlord's Bloodmail, Olaf,
 * Tryndamere and Dr. Mundo. It stays where it's set, as the target never fights back. Each switches
 * or stops ramping at a multiple of 10% (Absolute Focus 70, Immortal Path 50, Last Stand 60 to 30,
 * the rest 30, Tryndamere 10), so it steps by 10.
 */
export const SELF_HP: KitOption = {
  key: "self.hpPercent",
  label: "Your current HP (%)",
  default: 100,
  min: 10,
  max: 100,
  step: 10,
  description: "Your health as a percentage of your maximum health.",
};

/**
 * Seconds you've already been fighting when the combo starts, shared by what builds up over a fight:
 * the damage bonus of Liandry's Torment, Riftmaker and Haunting Guise, and Grasp of the Undying's
 * charge. None takes more than 4 seconds.
 */
export const IN_COMBAT: KitOption = {
  key: "combat.seconds",
  label: "Seconds already in combat",
  default: 0,
  min: 0,
  max: 4,
  step: 1,
  description: "Starts the combo as if you had been fighting the target this long, so what builds up over a fight starts partway.",
};

/**
 * An item's or rune's stacks as the combo starts, from hits just before it (none by default), `max`
 * at most: they're fresh, lasting as long from the start as stacks gained then would. They count hits
 * already made, so the combo's first is the next: Kraken Slayer at 2 procs on the first attack.
 */
export function startStacks(name: string, key: string, max: number, description: string): KitOption {
  return { key, label: `${name} stacks at start`, default: 0, min: 0, max, step: 1, description };
}

/** The stacks a startStacks option sets, a whole number within its range. */
export const optStacks = (sim: Sim, o: KitOption) => Math.max(0, Math.min(o.max ?? Infinity, Math.round(sim.opt[o.key] ?? 0)));

/** A fraction as a percentage for a description: 0.075 → 7.5. */
export const pct = (x: number) => +(x * 100).toFixed(1);

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
   * Navori, Hail of Blades) trigger now, before abilities cast while a ranged
   * attack's missile flies; what it deals waits for its hit (preAttack, onAttack). Same castId as the hit.
   */
  onLaunch?(sim: Sim, launch: AttackLaunch): void;
  /** Before on-hit effects resolve: may force a crit (atk.crit/critFactor) or request repeatOnHit. */
  preAttack?(sim: Sim, atk: AttackInfo): void;
  /** A basic attack (or on-hit-applying ability) hits the target; push on-hit damage into atk.extra. */
  onAttack?(sim: Sim, atk: AttackInfo): void;
  /** Adjust a damage instance before mitigation (push amps, change raw). */
  beforeDamage?(sim: Sim, inst: DamageInstance): void;
  /**
   * An effect's beforeDamage made the hit a critical strike (Shadowflame's Cinderbloom, on magic and
   * true damage), its amp pushed: push what a crit gets (Yunara's passive). An attack's own crit is
   * onAttack's (atk.crit, critFactor).
   */
  onCrit?(sim: Sim, inst: DamageInstance): void;
  /** React to damage that was dealt (procs, burns, stack counters). */
  afterDamage?(sim: Sim, inst: DamageInstance): void;
  /** The target was crowd-controlled by an ability (immobilize: stun/root/knock-up/charm…). */
  onCrowdControl?(sim: Sim, cc: { kind: "immobilize" | "slow" | "impair"; castId: number; slot?: Slot; duration: number }): void;
  /** Resist reductions this effect currently applies to the target. */
  targetResist?(sim: Sim): { armorFlat?: number; armorPercent?: number; mrFlat?: number; mrPercent?: number } | void;
}

export interface Effect extends EffectHooks {
  id: string;
  label: string;
  source: "item" | "rune" | "kit" | "summoner";
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
