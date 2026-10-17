// Champion kit definitions: how an ability's game formulas turn into damage instances.
//
// Numbers never live here — amounts are expressions over the game's own calculations (calc.X),
// data values (dv.X), stats and the target. A kit only says *which* formula is dealt as *what*.
//
// Expression names (see sim.ts `resolvePath` for the full list):
//   calc.Name / dv.Name / rank            this ability's spell (calc evaluated at current rank, level, stats)
//   Q.calc.Name, P.dv.Name, R.rank        another slot's spell
//   spell['ScriptName'].calc.Name         any spell of the champion by script name
//   ad bonusAd baseAd ap maxHp bonusHp baseHp hp armor bonusArmor mr bonusMr as bonusAs critChance
//   critDamage lethality level ms bonusMs mana bonusMana range ah
//   target.maxHp target.hp target.missingHp target.hpPct target.missingHpPct target.bonusHp
//   target.armor target.mr target.bonusArmor target.bonusMr target.baseHp
//   opt.name        champion option (stacks etc., see KitOption)
//   stacks.name     a counter the kit maintains (hooks)
//   buff.name       1 if the caster has that buff, else 0;  debuff.name likewise on the target
//   hit             0-based index of the hit within a multi-hit component; hits = total
//   recast          1-based index of the cast within a recast chain (Riven Q1/Q2/Q3)
//   charge          seconds the slot's cast was held to charge (AbilitySpec.charge; its default before a cast)

import type { DamageType } from './damage.ts';
import type { StatMods } from './stats.ts';

export type Expr = string | number;

/** Seconds from a cast's start: for every ability, or per slot (see AbilitySpec.castLockout). */
export type CastLockout = Expr | Partial<Record<'Q' | 'W' | 'E' | 'R', Expr>>;

export interface ComponentSpec {
  id: string;
  label: string;
  type: DamageType | 'adaptive';
  /** Raw (pre-mitigation) damage of one hit. */
  amount: Expr;
  /** Number of hits in a default cast (user can override per combo step). */
  hits?: Expr;
  /** The most hits a longer duration or a step's count fires (variableDuration, variableCount; default: `hits`). */
  maxHits?: Expr;
  /** Seconds between hits. */
  interval?: Expr;
  /** Seconds after the cast completes before the first hit is fired (or lands, without travel). */
  delay?: Expr;
  /**
   * Seconds a fired hit is in flight before it lands, after `delay`: `true` for the ability's max
   * range at its missile's speed (castRange / missileSpeed, from the data). A cast ended early still
   * lands the hits fired before it ends (Xerath R's shots).
   */
  travel?: Expr | true;
  /** Area damage (some items/runes treat AoE differently). */
  aoe?: boolean;
  /** Damage over time (periodic). */
  dot?: boolean;
  /** This hit is a basic attack (applies on-hit, counts for attack-based runes, may crit). */
  attack?: boolean;
  /** Applies on-hit effects although not an attack (e.g. Ezreal Q). */
  onHit?: boolean;
  /**
   * Also triggers on-attack effects: stacking effects such as Guinsoo's, Rapid Firecannon charges,
   * Navori and Lethal Tempo (wiki "Attack effects", "Triggering on-attack effects"). Basic attacks
   * always do. Use with `onHit` or `attack`.
   */
  onAttack?: boolean;
  /**
   * On-hit applied by an area effect, which Press the Attack ignores (Katarina's daggers and R,
   * Evelynn's empowered E, Master Yi's Q). Single-target hits of area abilities (Yasuo Q) still count.
   */
  areaOnHit?: boolean;
  /** Can critically strike; amount is multiplied by crit damage (or critMultiplier). */
  canCrit?: boolean;
  /** Custom crit multiplier expression, e.g. Yasuo Q. */
  critMultiplier?: Expr;
  /** Damage dealt by a pet/summon. */
  pet?: boolean;
  /** Not counted as ability damage for item/rune triggers (e.g. passive procs). */
  noProc?: boolean;
  /** Proc damage (the wiki's "deals proc damage", Smolder's Q burn): no spell effects (Liandry's,
   *  Luden's) and no rune triggers (Dark Harvest). */
  proc?: boolean;
  /** Proc damage special-cased to trigger Dark Harvest anyway (Teemo's Toxic Shot). */
  harvest?: boolean;
  /**
   * Spell damage where the hit otherwise isn't: a passive's part of an attack (Diana's Moonsilver
   * Blade), which is the attack's default damage unless marked.
   */
  spell?: boolean;
  /** Excluded unless the combo step enables it. */
  optional?: boolean;
  /** Short condition shown in the UI, e.g. "if the target is isolated". */
  condition?: string;
  note?: string;
  /** Display name of the damage source (default: the ability or passive name). */
  source?: string;
  /**
   * The basic ability whose passive deals this hit of the kit's `attack` (Ekko W's Parallel
   * Convergence): shown under that ability, and `calc.`/`dv.` are its spell's.
   */
  slot?: 'Q' | 'W' | 'E' | 'R';
  /** Extra percent armor/MR penetration for this hit only (fraction), e.g. Gangplank barrels 0.4. */
  penPercent?: Expr;
  /** For attack/onHit components: fraction of item on-hit damage applied (Azir soldiers 0.5, Akshan E 0.25). */
  onHitEffectiveness?: Expr;
  /**
   * Whether all hits share the cast (count once for "N separate hits" effects like Electrocute).
   * Default: true, except multi-hit `attack: true` components, whose hits are separate attacks.
   */
  sameCast?: boolean;
  /** Bonus damage on top of the basic attack (attack: true components only replace when replaceAttack). */
  /** Clamp min/max of the computed amount (after evaluation). */
  min?: Expr;
  max?: Expr;
}

export interface BuffSpec {
  id: string;
  label: string;
  /** Seconds. */
  duration: Expr;
  /** Stat bonuses while active, as expressions (keys of StatMods with numeric values). */
  stats?: Partial<Record<NumericStatKey, Expr>>;
  /** Percent penetration while active (fractions); the bonus* forms apply to bonus resists only. */
  armorPenPercent?: Expr;
  magicPenPercent?: Expr;
  bonusArmorPenPercent?: Expr;
  bonusMagicPenPercent?: Expr;
  /** Empowers the next N basic attacks with extra components. */
  empowerAttacks?: {
    count: Expr;
    components: ComponentSpec[];
    /**
     * The empowered attack's own physical damage is replaced by the components. The results credit
     * the basic attack with what it would have dealt and the ability with the rest (Garen Q).
     */
    replaceBase?: boolean;
    /** With replaceBase: someone else attacks instead (Azir's soldiers), so all of it is the ability's. */
    otherAttacker?: boolean;
    /**
     * The attack itself is also the ability's spell damage, the wiki's "basic damage and spell
     * damage" (Wukong Q, Kayle E): like an attack the components replace (Garen Q).
     */
    spell?: boolean;
    /** Attack resets the auto-attack timer. */
    resetsAttack?: boolean;
    /** Extra times on-hit effects apply with each empowered attack (Renekton W: 1 or 2). */
    onHitRepeats?: Expr;
    /** Crowd control applied when the empowered attack lands (TF gold card, Trundle Q slow). */
    cc?: CCSpec[];
  };
  /** Extra components on every basic attack while active. */
  onHit?: ComponentSpec[];
  /** Multiplies outgoing damage while active (e.g. 0.1 for +10%). */
  damageAmp?: Expr;
}

export type NumericStatKey = {
  [K in keyof StatMods]: StatMods[K] extends number ? K : never;
}[keyof StatMods];

export interface DebuffSpec {
  id: string;
  label: string;
  duration: Expr;
  /** Apply before the first hit's damage (default: after, so the applying hit isn't amplified). */
  applyBeforeHit?: boolean;
  /** Percent armor/MR reduction (fraction) and flat reduction. */
  armorReduction?: Expr;
  armorReductionFlat?: Expr;
  mrReduction?: Expr;
  mrReductionFlat?: Expr;
  /** Target takes this much more damage from the caster (fraction). */
  damageTakenAmp?: Expr;
  /** Stacks up to this many times (each application adds a stack). */
  maxStacks?: Expr;
  /** Apply only once the cast has landed this many hits (e.g. Garen E shred after 6 strikes). */
  afterHits?: number;
  /**
   * The debuff is a mark detonated by a later attack/ability from a *different* cast (Lux passive):
   * the components are dealt and the mark is removed.
   */
  /** `slot`: which slot the detonation counts as (default: the slot that applied the debuff; Lux passive uses 'P'). */
  consume?: { by: ConsumeBy | ConsumeBy[]; components: ComponentSpec[]; slot?: 'P' | 'Q' | 'W' | 'E' | 'R' };
  /**
   * Delayed detonation when the debuff expires (Zed R, Tahm…): deals the components plus
   * `storeFraction` × the post-mitigation damage you dealt to the target while it was active.
   */
  detonate?: { components: ComponentSpec[]; storeFraction?: Expr; storeType?: 'physical' | 'magic' | 'true'; label?: string };
}

/**
 * A stacking mark on the target driven by your hits (Darius bleed, Vayne silver bolts, Brand
 * blaze, Kai'Sa plasma, Ekko resonance…). Use `stacks.<id>` in expressions to read the count.
 */
export interface MarkSpec {
  id: string;
  label: string;
  maxStacks: Expr;
  /** Seconds; refreshed whenever a stack is added. */
  duration: Expr;
  /** Which hits add a stack: 'attack' (basic attacks), 'ability' (any ability), or slots. */
  appliedBy: ('attack' | 'ability' | 'onhit' | 'P' | 'Q' | 'W' | 'E' | 'R')[];
  /** Stacks added per qualifying hit (default 1). Expression may use `hit` context. */
  stacksPerHit?: Expr;
  /** Count at most one stack per cast (default true). */
  oncePerCast?: boolean;
  /** Damage dealt each time a stack is applied (after the hit). */
  onStack?: ComponentSpec[];
  /** Damage over time while the mark is active, scaling with `stacks.<id>`. */
  dot?: { interval: Expr; components: ComponentSpec[] };
  /** When stacks reach maxStacks: deal components, optionally consume all stacks, optional cooldown. */
  atMax?: { components: ComponentSpec[]; consume?: boolean; cooldown?: Expr; buff?: BuffSpec; debuff?: DebuffSpec; cc?: CCSpec[] };
  /** Slot whose spell provides calc./dv. context for this mark's expressions (default 'P'). */
  slot?: 'P' | 'Q' | 'W' | 'E' | 'R';
  /** Percent armor / magic resist reduction per stack while the mark is active (fractions). */
  armorReductionPerStack?: Expr;
  mrReductionPerStack?: Expr;
}

export type ConsumeBy = 'attack' | 'ability' | 'any' | 'Q' | 'W' | 'E' | 'R';

/** Crowd control applied to the target when the ability first hits. */
export interface CCSpec {
  /** immobilize = stun/root/knock-up/charm/fear/taunt/suppress/sleep; impair = silence/blind/ground/polymorph/disarm. */
  kind: 'immobilize' | 'slow' | 'impair';
  /** Seconds; ≤ 0 means no CC (lets an expression make it conditional). */
  duration: Expr;
  /** Seconds after the first hit before the CC lands (delayed stuns/roots). */
  delay?: Expr;
}

/**
 * An alternate cast. Fields it doesn't set fall back to the ability's (buff, debuff, cc, castTime…);
 * set `cc: []` / `buff: []` to clear them.
 */
export interface VariantSpec {
  label: string;
  /** Script name of the spell providing calc./dv. for this variant (e.g. another form's spell). */
  spell?: string;
  components: ComponentSpec[];
  resetsAttack?: boolean;
  dash?: boolean;
  cc?: CCSpec[];
  lockout?: Expr;
  attackLockout?: Expr;
  castLockout?: CastLockout;
  cooldown?: Expr;
  buff?: BuffSpec | BuffSpec[];
  /** `null` clears the ability's debuff for this variant. */
  debuff?: DebuffSpec | null;
  castTime?: Expr;
  note?: string;
}

export interface AbilitySpec {
  /** Script name of the spell holding the calcs (default: the slot's root spell). */
  spell?: string;
  /** Display name override. */
  name?: string;
  /** Passive only: rank used for its data values (e.g. 'R.rank + 1' or 'level >= 11 ? 3 : 1'). Default 1. */
  rank?: Expr;
  /** Seconds the cast takes (default: the spell's cast time); may be an expression. */
  castTime?: Expr;
  components?: ComponentSpec[];
  /** Alternate casts (e.g. Lee Sin Q2, Nidalee cougar form, empowered Rengar abilities). */
  variants?: Record<string, VariantSpec>;
  /** Default variant key when the combo doesn't specify one. */
  defaultVariant?: string;
  /** Self buff(s) applied on cast. */
  buff?: BuffSpec | BuffSpec[];
  /**
   * Seconds the caster is busy from the start of the cast (channels, dashes), without delaying the
   * damage (which follows castTime + delay). Default: the cast time.
   */
  lockout?: Expr;
  /**
   * Seconds from the start of the cast the caster can't attack, while still free to cast (the wiki's
   * "unable to move or attack while Rocket Grab is in flight"): delays the next attack, not the next
   * cast. A lockout that stops casting too ("unable to act") is `lockout`. Attack resets don't end
   * it: an ability that empowers the next attack (Blitzcrank E) can be cast, but its attack waits.
   */
  attackLockout?: Expr;
  /**
   * Seconds from the start of the cast the caster can't cast abilities, while still free to attack
   * (the wiki's "unable to cast Decimate or Apprehend for 0.25 seconds after Noxian Guillotine's
   * cast time"): every ability, or the listed slots each until its own seconds.
   */
  castLockout?: CastLockout;
  /**
   * The player chooses how long it lasts: ends the channel early (Smolder E: cast something, or fly
   * out of range) or leaves the toggle on (Karthus E). A combo step sets its seconds after the cast
   * time (`E{0.5s}`): its repeating hits land within them, up to their maxHits, and its lockout
   * ends with them. By default it lasts its lockout, or as long as its hits take.
   */
  variableDuration?: boolean;
  /** The most seconds a variableDuration cast lasts after its cast time (default: its lockout, else as long as its hits' maxHits take). */
  maxDuration?: Expr;
  /** The fewest seconds, when it can't be ended sooner (a recast allowed after 0.5s); never less than until its first hit is fired. */
  minDuration?: Expr;
  /**
   * The player chooses how many of its hits to fire, called this ("shots": Xerath R, Jhin R): a combo
   * step sets the count (`R{3}`), the first that many in the order they're fired, and its lockout
   * ends when the last of them is fired.
   */
  variableCount?: string;
  /**
   * Held to charge (Sion Q, Varus Q): a combo step sets the seconds held (`Q{0.5s}`), which
   * expressions read as `charge` (castTime, amounts, cc). `default`: the hold when the step doesn't
   * say (usually the full charge); `min`: the earliest release (default 0); `max`: the longest hold
   * (default `default`).
   */
  charge?: { default: Expr; min?: Expr; max?: Expr };
  /** Base cooldown (before haste) when the data's cooldown is missing or wrong, e.g. 'calc.CD'. */
  cooldown?: Expr;
  /** This slot isn't an ultimate (Udyr R): no ultimate haste, items don't treat it as one. */
  notUltimate?: boolean;
  debuff?: DebuffSpec;
  resetsAttack?: boolean;
  /** Crowd control applied on the first hit (drives Aftershock, Cheap Shot, Glacial…). */
  cc?: CCSpec[];
  /** The cast dashes or blinks (Sudden Impact). */
  dash?: boolean;
  /** Ability can be cast this many times per cooldown (Ahri R, Akali R, Riven Q…). */
  recasts?: number;
  /** Seconds before the next recast is possible (default: the cast time). */
  recastDelay?: Expr;
  /** Seconds during which the next recast is allowed; afterwards the chain ends and the cooldown applies. */
  recastWindow?: Expr;
  /** Measure recastWindow from the first cast (default) or from the previous cast (Aatrox Q, Riven Q). */
  recastWindowFrom?: 'first' | 'previous';
  /** Doesn't hit the target (self buff) — still counts as an ability cast for Sheen etc. */
  noTarget?: boolean;
  /** Sets off a hit that can crit outside its components (Viego R's second strike), so a crit mark (R!) applies to it. */
  followUpCrits?: boolean;
  notes?: string[];
}

export interface KitOption {
  key: string;
  label: string;
  default: number;
  min?: number;
  max?: number;
  step?: number;
  /** Boolean toggle when true (0/1). */
  toggle?: boolean;
  description?: string;
}

/** Static stat modifications from a champion's passive (e.g. stacking AP, bonus AD from crit). */
export type KitStatsFn = (ctx: { level: number; opt: Record<string, number>; ranks: Record<string, number>; evalExpr: (e: Expr, slot?: string) => number }) => Partial<StatMods>;

export interface ChampionKit {
  id: string;
  /**
   * verified – checked against in-game/wiki numbers by a person or reviewer
   * curated  – hand-written mapping of game formulas to damage instances
   * auto     – generated from tooltips (damage values exact, semantics best-effort)
   */
  status: 'verified' | 'curated' | 'auto';
  notes?: string[];
  options?: KitOption[];
  abilities: Partial<Record<'P' | 'Q' | 'W' | 'E' | 'R', AbilitySpec>>;
  /** Basic attack modifications. */
  attack?: {
    /** Extra components on every attack (passive on-hits). */
    onHit?: ComponentSpec[];
    /** Multiplier on the basic attack's AD portion (e.g. Kalista 0.9?). */
    damageMult?: Expr;
    /** Every Nth attack gets these components (Jhin 4th shot, Vayne W, Diana P…). */
    everyNth?: { n: number; components: ComponentSpec[]; label: string; counts?: 'attacks' | 'hits'; resetAfter?: number };
    /** Damage type of the basic attack itself (default physical). */
    type?: DamageType;
    /** Can this champion's basic attack critically strike (default true). */
    canCrit?: boolean;
    critMultiplier?: Expr;
    /** Fixed attack speed (attacks/second) replacing the normal formula (Jhin). */
    attackSpeed?: Expr;
  };
  stats?: KitStatsFn;
  /** Stacking marks on the target (see MarkSpec). */
  marks?: MarkSpec[];
  /** Map buff-hash references in game formulas (BuffCounter parts) to expressions, e.g. option values. */
  buffStacks?: Record<string, Expr>;
  /** Free-form hooks for mechanics the declarative format can't express. */
  hooks?: import('./effects.ts').EffectHooks;
}
