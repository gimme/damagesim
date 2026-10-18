// The combat simulator: one attacker, one target, a sequence of combo steps on a timeline.

import type { ChampionData, ItemData, RuneData, SpellData, CalcNode } from "./data-types.ts";
import type { GameData } from "./gamedata.ts";
import { findChampion, findItem, findRune } from "./gamedata.ts";
import { evalCalcNode, STAT, type CalcEnv } from "./calc.ts";
import { compile, type Resolver } from "./expr.ts";
import { computeStats, emptyMods, hasteCooldown, itemStatsToMods, mergeMods, type Stats, type StatMods, GAME } from "./stats.ts";
import { effectiveResist, resistMultiplier, type DamageType } from "./damage.ts";
import type { AbilitySpec, BuffSpec, ChampionKit, ComponentSpec, DebuffSpec, Expr, MarkSpec, VariantSpec } from "./kit-types.ts";
import {
  addOnHitRepeat,
  DISTANCE,
  IN_COMBAT,
  selfHp,
  type AttackInfo,
  type AttackLaunch,
  type CastInfo,
  type DamageFlags,
  type DamageInstance,
  type DamageRequest,
  type Effect,
  type SetupCtx,
  type Slot,
} from "./effects.ts";
import { attackOptions, findVariant, hasPassiveStep, parseCombo, formatCombo, rollsCrits, type AbilityStep, type ComboStep, type CritMode } from "./combo.ts";
import { getKit } from "../kits/index.ts";
import { createItemEffect, energize, ENERGIZED_ITEMS, ITEM_GROUPS } from "./items.ts";
import { bonusSkillPoints, createRuneEffects } from "./runes.ts";
import { runePageProblems } from "./rune-page.ts";
import { createSummonerEffect } from "./summoners.ts";
import { resolvePreset, type TargetPreset } from "./presets.ts";

export interface TargetSpec {
  /** Derive stats from a champion (level + items). Explicit numbers below override. */
  champion?: string;
  /**
   * Archetype whose stats follow the target's level: class-average base stats + a typical build
   * for that level (or `items`) + health shards (see presets.ts). Explicit numbers below override.
   */
  preset?: TargetPreset;
  /** Absolute target level. Default: the attacker's level + levelDiff. */
  level?: number;
  /** Target level relative to the attacker's (used when `level` is not given). Default 0. */
  levelDiff?: number;
  /** The champion's items, or a preset's in place of its typical build. Only their stats count. */
  items?: (number | string)[];
  label?: string;
  /**
   * Totals and bonus parts of health, armor and MR. A total keeps the champion's or preset's base
   * (at most the total) and puts the rest in bonus; a bonus is added to that base. Raw numbers (no
   * champion or preset) are all base unless a bonus is given. Default 2000 HP, 80 armor, 50 MR.
   */
  maxHp?: number;
  bonusHp?: number;
  armor?: number;
  bonusArmor?: number;
  mr?: number;
  bonusMr?: number;
  /** Current HP (absolute). */
  hp?: number;
  /** Current HP as a percentage of max (0-100). */
  hpPercent?: number;
  /** Generic damage reduction (fraction) applied to all incoming damage. */
  damageReduction?: number;
}

export interface SimSettings {
  /** Keep simulating damage-over-time effects after the last step (default true). */
  finishDots?: boolean;
  /** Executes kill the target below their health line (default true); off, they deal nothing and
   *  the results mark no lines. */
  executes?: boolean;
  /** Wait for an ability's cooldown when it's used again (default true); otherwise cast anyway. */
  waitForCooldowns?: boolean;
}

export interface Scenario {
  champion: string;
  level?: number;
  ranks?: Partial<Record<"Q" | "W" | "E" | "R", number>>;
  /** Max order for default ranks, e.g. "QEW" (default "QWE"). */
  skillOrder?: string;
  items?: (number | string)[];
  runes?: (number | string)[];
  options?: Record<string, number | boolean>;
  combo: ComboStep[] | string;
  target?: TargetSpec;
  settings?: SimSettings;
}

/**
 * What a combo step sets about a cast, where the player chooses it: the seconds it lasts after its
 * cast time (AbilitySpec.variableDuration), the seconds it's held to charge (charge), how many of
 * its hits it fires (variableCount), or how far the target stands for it (variableDistance). By
 * default `value`, at most `max`.
 */
export interface CastSetting {
  kind: "lasts" | "held" | "count" | "distance";
  value: number;
  /** The least that does something: the first hit, the earliest release, one shot. */
  min: number;
  max: number;
  /** "s", "u" (units of distance), or what the hits are called ("shots"). */
  unit: string;
}

/** How many hits, `first` seconds in and `interval` apart, land within `seconds` (at most `maxHits`). */
const hitsWithin = (first: number, interval: number, maxHits: number, seconds: number) =>
  seconds + 1e-6 < first ? 0 : Math.min(maxHits, Math.floor((seconds - first) / interval + 1e-6) + 1);

/** castTime: the cast's own cast time, where it differs from its spell's (a kit's castTime);
 *  distance: how far the target stands for it, where its step says (variableDistance). */
type CastCtx = { slot: Slot; spell: SpellData; rank: number; recast?: number; castTime?: number; distance?: number };
/** An execute as dealt, and as the results show it (DamageRequest.normalAttack can split it). */
type Execution = { inst: DamageInstance; records: DamageInstance[] };

/** The health an execute kills below (SimResult.executeLines). */
export interface ExecuteLine {
  source: string;
  sourceLabel: string;
  label: string;
  hp: number;
}

const round2 = (x: number) => Math.round(x * 100) / 100;

/** Why a step's number became `set`: "… lasts 0.1s to 1.25s, so E{5s} lasts 1.25s", "… fires whole shots, so R{2.5} fires 3". */
function settingWarning(label: string, step: AbilityStep, s: CastSetting, asked: number, set: number) {
  if (s.kind === "distance") return `${label} reaches ${s.min} to ${s.max} units, so ${formatCombo([step])} is cast at ${set}`;
  const verb = s.kind === "lasts" ? "lasts" : s.kind === "held" ? "is held" : "fires";
  const within = asked >= s.min && asked <= s.max;
  const range = s.kind !== "count" ? `${s.min}s to ${s.max}s` : within ? `whole ${s.unit}` : `${s.min} to ${s.max} ${s.unit}`;
  return `${label} ${verb} ${range}, so ${formatCombo([step])} ${verb} ${set}${s.kind === "count" ? "" : "s"}`;
}

/** What each ability key casts at a point of the combo: its variant in the form or state it's in
 *  (Elise's Q after R: Venomous Bite), that one's icon and name. */
export type KeyCasts = Partial<Record<Slot, { variant?: string; icon?: string; name: string }>>;

export interface SourceTotal {
  source: string;
  label: string;
  /** Its hits' icon (DamageInstance.icon). */
  icon?: string;
  damage: number;
  raw: number;
  hits: number;
  type: Partial<Record<DamageType, number>>;
}

export interface SimResult {
  patch: string;
  champion: { id: string; name: string; level: number; ranks: Record<string, number>; kitStatus: ChampionKit["status"] };
  items: { id: number; name: string; gold: number }[];
  runes: { id: number; name: string }[];
  gold: number;
  combo: string;
  stats: Stats;
  target: {
    label: string;
    /** Target level (champion or preset targets). */
    level?: number;
    maxHp: number;
    bonusHp: number;
    startHp: number;
    endHp: number;
    armor: number;
    bonusArmor: number;
    mr: number;
    bonusMr: number;
    /** Effective resist and damage multiplier at combo start (after your penetration). */
    effectiveArmor: number;
    effectiveMr: number;
    physicalMultiplier: number;
    magicMultiplier: number;
  };
  totalDamage: number;
  /** Damage excluding damage-over-time ticks (burns, bleeds, Ignite, auras): the burst part. */
  comboDamage: number;
  /** Damage from damage-over-time ticks. */
  dotDamage: number;
  rawDamage: number;
  byType: Record<DamageType, number>;
  bySource: SourceTotal[];
  events: DamageInstance[];
  /** The combo's steps as done: an ability as cast (`index` its step's, its variant and icon as the
   *  state it was cast in made them: W:ruin), attacks, waits, actives. */
  timeline: { step: string; start: number; end: number; note?: string; index?: number; variant?: string; icon?: string }[];
  /** What each ability key casts before each step (`keyCasts[k]`: before step k), and after the last. */
  keyCasts: KeyCasts[];
  /** Seconds from first action to last damage. */
  duration: number;
  /** Seconds the combo's actions take (cast/attack windups). */
  comboTime: number;
  killed: boolean;
  killTime?: number;
  /** The health lines the scenario's executes kill below, as last checked (Sim.deal), whether they
   *  were reached or not; none with settings.executes off. */
  executeLines: ExecuteLine[];
  /** Fraction of the target's starting HP removed (can exceed 1). */
  percentOfHp: number;
  dps: number;
  warnings: string[];
  notes: string[];
}

interface ScheduledEvent {
  time: number;
  seq: number;
  run: () => void;
  /** The crit mark of the step that scheduled it. */
  crit?: boolean;
  /** The combo action that scheduled it. */
  action?: number;
}

interface ActiveBuff {
  id: string;
  label: string;
  expires: number;
  stacks: number;
  spec?: BuffSpec;
  slot?: Slot;
  /** Remaining empowered attacks. */
  charges?: number;
  mods?: Partial<StatMods>;
  amp?: number;
  /** The distance of the cast that applied it (variableDistance), for what it deals. */
  distance?: number;
}

/** A basic attack or attack-like ability hit landing on the target (Sim.performAttackHit). */
export interface AttackHit {
  castId: number;
  /** The hit it's part of, landing with a cast's other parts (DamageInstance.hitId); a new one if omitted. */
  hitId?: number;
  amount?: number;
  comp?: ComponentSpec;
  label?: string;
  sourceLabel?: string;
  fromAbility?: Slot;
  onHitOnly?: boolean;
  /** Optional components enabled for this attack (combo "AA+bounce"). */
  enable?: string[];
  /** What the buffs add to it, decided when it was launched (default: now). */
  buffParts?: BuffPart[];
  /** When the attack was launched, if before now (its missile flew). */
  launched?: number;
  /** Its launch, when launchAttack launched it; else it's launched as it hits. */
  launch?: AttackLaunch;
}

/** What a buff adds to an attack, decided when it's launched: its on-hit components, and its
 *  empowerment, which uses up a charge (a buff whose last charge it takes ends when it hits). */
interface BuffPart {
  id: string;
  label: string;
  slot?: Slot;
  onHit?: ComponentSpec[];
  empower?: NonNullable<BuffSpec["empowerAttacks"]>;
  distance?: number;
}

interface ActiveDebuff {
  id: string;
  label: string;
  expires: number;
  stacks: number;
  castId?: number;
  /** Crowd control: when the uninterrupted CC began (castId is the cast that began it). */
  since?: number;
  stored?: number;
  spec?: DebuffSpec;
  slot?: Slot;
  armorPct?: number;
  armorFlat?: number;
  mrPct?: number;
  mrFlat?: number;
  amp?: number;
}

const ULT: Slot = "R";

/** Each champion's spells by the names kits give them (Sim.findSpell). */
const spellsByName = new WeakMap<ChampionData, Map<string, SpellData | undefined>>();

export class Sim {
  readonly data: GameData;
  readonly champ: ChampionData;
  readonly kit: ChampionKit;
  readonly level: number;
  readonly ranks: Record<Slot, number>;
  readonly opt: Record<string, number>;
  readonly settings: Required<SimSettings>;
  /**
   * The build's items by id, whatever their slots: their effects are created, and their stats added
   * up, in this order, so where an item sits changes nothing, not even which of an attack's on-hits
   * lands first (the wiki gives them no order). The result lists them as given.
   */
  readonly items: ItemData[];
  private readonly slotted: ItemData[];
  readonly runes: RuneData[];
  readonly effects: Effect[] = [];
  readonly warnings: string[] = [];
  readonly notes = new Set<string>();

  time = 0;
  private seq = 0;
  private queue: ScheduledEvent[] = [];
  /** The crit mark of the combo step being resolved: set by the step, and by the events it scheduled
   *  when they run, so it holds for everything the step causes (see critMode). */
  private stepCrit: boolean | undefined;
  /** The combo action being resolved (its castId): set like stepCrit, and dealt damage records it. */
  private action: number | undefined;
  /** While a cast's hits landing together are dealt: what they set off, to deal after them (see landTogether). */
  private setOff: (() => void)[] | null = null;
  private nextCastId = 1;
  private nextInstId = 1;
  private nextHitId = 1;
  /** Hits whose hooks are running: an execute they ask for waits. */
  private dealing = 0;
  /** The execute that counts: the largest (the target dies once), and how the results show it. */
  private execution: Execution | undefined;
  /** Each execute's line as last checked, by its label. */
  private executeLines = new Map<string, ExecuteLine>();
  private staticMods: StatMods;
  private statsCache: Stats | null = null;
  private attackIndex = 0;
  readonly counters = new Map<string, number>();
  /** dotCastId: the cast instance that started the mark's damage over time (its ticks share it). */
  readonly marks = new Map<string, { stacks: number; expires: number; castIds: Set<number>; cooldownUntil: number; ticking: boolean; dotCastId?: number }>();
  readonly buffs = new Map<string, ActiveBuff>();
  readonly debuffs = new Map<string, ActiveDebuff>();
  private cooldownReady = new Map<string, number>();
  private recastCount = new Map<string, number>();
  freeAt = 0;
  /** The attack timer: when the next attack may start. Attack resets bring it forward. */
  attackReadyAt = 0;
  /** Until when attacks are locked out (attackLockout, Jhin's reload): attack resets don't end it. */
  attackLockedUntil = 0;
  /** Until when each ability can't be cast (castLockout). */
  private castLockedUntil = new Map<Slot, number>();
  combatStart = 0;
  /** Time of the last damage that keeps you in combat (everything except aura damage). */
  lastCombatTime = 0;
  readonly events: DamageInstance[] = [];

  readonly target: {
    label: string;
    level?: number;
    maxHp: number;
    hp: number;
    startHp: number;
    baseHp: number;
    bonusHp: number;
    baseArmor: number;
    bonusArmor: number;
    baseMr: number;
    bonusMr: number;
    damageReduction: number;
    killTime?: number;
  };

  constructor(data: GameData, scenario: Scenario) {
    this.data = data;
    this.champ = findChampion(data, scenario.champion);
    this.kit = getKit(this.champ);
    this.level = clampInt(scenario.level ?? 11, 1, GAME.maxLevel);
    this.settings = {
      finishDots: scenario.settings?.finishDots ?? true,
      executes: scenario.settings?.executes ?? true,
      waitForCooldowns: scenario.settings?.waitForCooldowns ?? true,
    };
    this.runes = (scenario.runes ?? []).map((q) => findRune(data, q));
    for (const p of runePageProblems(data, this.runes)) this.warn(p);
    this.ranks = resolveRanks(this.champ, this.level, scenario.ranks, scenario.skillOrder, bonusSkillPoints(this.runes, this.level));

    // Options: kit defaults, then effect defaults, then user values.
    this.opt = {};
    for (const o of this.kit.options ?? []) this.opt[o.key] = o.default;

    this.slotted = (scenario.items ?? []).map((q) => findItem(data, q));
    this.items = [...this.slotted].sort((a, b) => a.id - b.id);
    // Six slots, and a seventh for boots once the bot lane role quest is done.
    const boots = this.items.filter((i) => i.tags.includes("Boots")).length;
    if (this.items.length - Math.min(boots, 1) > 6)
      this.warn(`${this.items.length} items: a champion can hold 6, and a pair of boots in the bot lane quest's slot`);
    for (const [group, ids] of Object.entries(ITEM_GROUPS)) {
      const owned = this.items.filter((i) => ids.includes(i.id));
      if (owned.length > 1) this.warn(`only one ${group} item can be owned (${owned.map((i) => i.name).join(", ")}); the game won't allow this build`);
    }
    if (boots > 1) this.warn("more than one pair of boots");
    const legendaryCount = this.items.filter((i) => isLegendary(i)).length;
    const setup: SetupCtx = { level: this.level, ranged: this.champ.attackType === "ranged", opt: this.opt, champion: this.champ.id, legendaryCount };

    // Effects: kit hooks, items, runes, summoners.
    if (this.kit.hooks) this.effects.push({ id: "kit", label: this.champ.name, source: "kit", ...this.kit.hooks });
    const seenUnique = new Set<string>();
    for (const item of this.items) {
      const eff = createItemEffect(item, setup, this);
      if (!eff) continue;
      // Unique passives (same effect id) apply once.
      if (seenUnique.has(eff.id)) continue;
      seenUnique.add(eff.id);
      this.effects.push(eff);
    }
    this.effects.push(...createRuneEffects(this.runes, setup, this));
    this.effects.push(createSummonerEffect("ignite", setup));
    for (const e of this.effects) for (const o of e.options ?? []) if (!(o.key in this.opt)) this.opt[o.key] = o.default;
    for (const [k, v] of Object.entries(scenario.options ?? {})) this.opt[k] = typeof v === "boolean" ? (v ? 1 : 0) : v;

    // Static stats.
    this.staticMods = emptyMods();
    for (const item of this.items) mergeMods(this.staticMods, itemStatsToMods(item.stats));
    for (const e of this.effects) {
      const m = e.stats?.(setup);
      if (m) mergeMods(this.staticMods, m);
    }
    if (this.kit.stats) {
      const m = this.kit.stats({
        level: this.level,
        opt: this.opt,
        ranks: this.ranks,
        evalExpr: (e, slot) => this.evalExpr(e, { slot: (slot as Slot) ?? "P" }),
      });
      if (m) mergeMods(this.staticMods, m);
    }
    // evalExpr above may have cached stats computed before these mods were merged.
    this.invalidateStats();

    this.target = resolveTarget(data, scenario.target ?? {}, this.level);
    // Unless placed, the target stands at your attack range as the combo starts: range gained later
    // doesn't move it.
    if (scenario.options?.[DISTANCE.key] === undefined) this.opt[DISTANCE.key] = this.stats.range;
  }

  // ---------------------------------------------------------------------------
  // Stats

  private computingStats = false;

  /** How far the target stands, edge to edge (option DISTANCE): attacks, missiles and dashes at it
   *  fly this far. */
  get distance(): number {
    return this.opt[DISTANCE.key];
  }

  get stats(): Stats {
    if (!this.statsCache) {
      if (this.computingStats) {
        // Re-entered from a dynamicStats hook (e.g. it evaluates an expression): answer with the
        // static stats so hooks can read stats without recursing.
        return computeStats(
          { base: this.champ.stats, level: this.level, adaptiveDefault: this.champ.adaptive, ranged: this.champ.attackType === "ranged" },
          this.staticMods,
          selfHp(this.opt),
        );
      }
      this.computingStats = true;
      try {
        this.statsCache = this.computeDynamicStats();
      } finally {
        this.computingStats = false;
      }
    }
    return this.statsCache;
  }

  private computeDynamicStats(): Stats {
    {
      // The static mods, copied once something adds to them (computeStats only reads them).
      let mods: StatMods | undefined;
      for (const e of this.effects) {
        const m = e.dynamicStats?.(this);
        if (m) mergeMods((mods ??= cloneMods(this.staticMods)), m);
      }
      for (const b of this.buffs.values()) {
        if (b.expires < this.time) continue;
        if (b.mods) mergeMods((mods ??= cloneMods(this.staticMods)), b.mods);
      }
      const st = computeStats(
        { base: this.champ.stats, level: this.level, adaptiveDefault: this.champ.adaptive, ranged: this.champ.attackType === "ranged" },
        mods ?? this.staticMods,
        selfHp(this.opt),
      );
      // Kits with a fixed attack speed (Jhin) report it in the stats too.
      if (this.kit.attack?.attackSpeed !== undefined) st.attackSpeed = this.evalExpr(this.kit.attack.attackSpeed, { slot: "P" });
      return st;
    }
  }

  invalidateStats() {
    this.statsCache = null;
  }

  // ---------------------------------------------------------------------------
  // Spells & expressions

  spellFor(slot: Slot, variant?: VariantSpec | AbilitySpec): SpellData {
    const spec = this.kit.abilities[slot];
    const want = (variant as AbilitySpec | undefined)?.spell ?? spec?.spell;
    if (want) {
      const s = this.findSpell(want);
      if (s) return s;
      this.warn(`kit references unknown spell "${want}"`);
    }
    const ab = this.champ.abilities.find((a) => a.slot === slot);
    if (!ab) throw new Error(`${this.champ.name} has no ${slot} ability`);
    return ab.spells[0];
  }

  findSpell(name: string): SpellData | undefined {
    let found = spellsByName.get(this.champ);
    if (!found) spellsByName.set(this.champ, (found = new Map()));
    if (!found.has(name)) found.set(name, this.lookSpell(name));
    return found.get(name);
  }

  private lookSpell(name: string): SpellData | undefined {
    const n = name.toLowerCase();
    for (const ab of this.champ.abilities)
      for (const s of ab.spells) if (s.scriptName.toLowerCase() === n || s.path.toLowerCase() === n || s.path.toLowerCase().endsWith("/" + n)) return s;
    return undefined;
  }

  slotOfSpell(spell: SpellData): Slot {
    for (const ab of this.champ.abilities) if (ab.spells.includes(spell)) return ab.slot === "X" ? "P" : (ab.slot as Slot);
    return "P";
  }

  rankOf(slot: Slot): number {
    return this.ranks[slot] ?? 1;
  }

  siblingsOf(spell: SpellData): SpellData[] {
    const ab = this.champ.abilities.find((a) => a.spells.includes(spell));
    return ab ? ab.spells : [spell];
  }

  dataValue(spell: SpellData, name: string, rank: number): number {
    let arr = spell.dataValues[name];
    if (!arr) {
      for (const s of this.siblingsOf(spell)) if (s.dataValues[name]) arr = s.dataValues[name];
    }
    if (!arr) {
      // Case-insensitive fallback (tooltips are case-insensitive).
      const lower = name.toLowerCase();
      for (const s of this.siblingsOf(spell)) for (const [k, v] of Object.entries(s.dataValues)) if (k.toLowerCase() === lower) arr = v;
    }
    if (!arr) {
      // Legacy effect amounts: dv.Effect5Amount → effects[4][rank].
      const eff = /^Effect(\d+)Amount$/i.exec(name);
      const e = eff ? spell.effects?.[Number(eff[1]) - 1] : undefined;
      if (e) return e[Math.min(rank, e.length - 1)] ?? 0;
      this.warn(`missing data value ${spell.scriptName}.${name}`);
      return 0;
    }
    return arr[Math.min(rank, arr.length - 1)] ?? 0;
  }

  /** Evaluate a game calculation of a spell. */
  calc(spell: SpellData, name: string, rank: number): number {
    const lookup = (n: string): CalcNode | undefined => {
      let c = spell.calcs[n];
      if (!c) for (const s of this.siblingsOf(spell)) if (s.calcs[n]) c = s.calcs[n];
      if (!c) {
        const lower = n.toLowerCase();
        for (const s of this.siblingsOf(spell)) for (const [k, v] of Object.entries(s.calcs)) if (k.toLowerCase() === lower) c = v;
      }
      return c;
    };
    const node = lookup(name);
    if (!node) {
      this.warn(`missing calculation ${spell.scriptName}.${name}`);
      return 0;
    }
    const env = this.calcEnv(spell, rank, lookup);
    return evalCalcNode(node, env, lookup);
  }

  private calcEnv(spell: SpellData, rank: number, lookup: (n: string) => CalcNode | undefined): CalcEnv {
    const st = this.stats;
    const env: CalcEnv = {
      rank,
      level: this.level,
      ranged: st.ranged,
      abilityHaste: st.abilityHaste,
      dataValue: (n) => this.dataValue(spell, n, rank),
      stat: (stat, formula, target) => (target ? this.targetStat(stat, formula) : this.selfStat(stat, formula)),
      buffStacks: (buff) => this.buffStacksFor(buff),
      buffElapsed: (buff) => this.optionNumber(`buffElapsed:${buff}`, 1),
      resource: (_r, formula) => (formula === 1 ? st.baseMana : formula === 2 ? st.bonusMana : st.maxMana),
      itemCount: (ep) => (ep >= 5 ? this.items.filter(isLegendary).length : this.items.length),
      effect: (idx) => {
        const e = spell.effects?.[idx - 1];
        return e ? (e[Math.min(rank, e.length - 1)] ?? 0) : 0;
      },
      externalDataValue: (path, n) => {
        const s = this.findSpell(path);
        return s ? this.dataValue(s, n, this.rankOf(this.slotOfSpell(s))) : 0;
      },
      calc: (n) => {
        const node = lookup(n);
        return node ? evalCalcNode(node, env, lookup) : 0;
      },
    };
    return env;
  }

  /**
   * Evaluate a calculation from item/rune data (scalar data values).
   * `noStats` evaluates without reading current stats (for use inside dynamicStats hooks).
   */
  evalDataCalc(calcs: Record<string, CalcNode>, values: Record<string, number>, name: string, overrides: { level?: number; noStats?: boolean } = {}): number {
    const node = calcs[name];
    if (!node) {
      this.warn(`missing calculation ${name}`);
      return 0;
    }
    if (overrides.noStats) {
      const ranged = this.champ.attackType === "ranged";
      const lookup = (n: string) => calcs[n];
      const env: CalcEnv = {
        rank: 1,
        level: overrides.level ?? this.level,
        ranged,
        abilityHaste: 0,
        dataValue: (n) => values[n] ?? 0,
        stat: () => 0,
        buffStacks: () => 0,
        buffElapsed: () => 1,
        resource: () => 0,
        itemCount: () => 0,
        effect: () => 0,
        externalDataValue: () => 0,
        calc: (n) => (lookup(n) ? evalCalcNode(lookup(n)!, env, lookup) : 0),
      };
      return evalCalcNode(node, env, lookup);
    }
    const st = this.stats;
    const lookup = (n: string) => calcs[n];
    const env: CalcEnv = {
      rank: 1,
      level: overrides.level ?? this.level,
      ranged: st.ranged,
      abilityHaste: st.abilityHaste,
      dataValue: (n) => values[n] ?? 0,
      stat: (stat, formula, target) => (target ? this.targetStat(stat, formula) : this.selfStat(stat, formula)),
      buffStacks: () => 0,
      buffElapsed: () => 1,
      resource: (_r, formula) => (formula === 1 ? st.baseMana : formula === 2 ? st.bonusMana : st.maxMana),
      itemCount: (ep) => (ep >= 5 ? this.items.filter(isLegendary).length : this.items.length),
      effect: () => 0,
      externalDataValue: () => 0,
      calc: (n) => (lookup(n) ? evalCalcNode(lookup(n)!, env, lookup) : 0),
    };
    return evalCalcNode(node, env, lookup);
  }

  private buffStacksFor(buff: string): number {
    const map = (this.kit as any).buffStacks as Record<string, Expr> | undefined;
    if (map?.[buff] !== undefined) return this.evalExpr(map[buff], { slot: "P" });
    return this.optionNumber(`buff:${buff}`, 0);
  }

  private optionNumber(key: string, dflt: number): number {
    return this.opt[key] ?? dflt;
  }

  selfStat(stat: number, formula: number): number {
    const s = this.stats;
    const pick = (total: number, base: number, bonus: number) => (formula === 1 ? base : formula === 2 ? bonus : total);
    switch (stat) {
      case STAT.AbilityPower:
        return s.ap;
      case STAT.Armor:
        return pick(s.armor, s.baseArmor, s.bonusArmor);
      case STAT.AttackDamage:
        return pick(s.ad, s.baseAd, s.bonusAd);
      case STAT.AttackSpeed:
        return pick(s.attackSpeed, s.baseAttackSpeed, s.bonusAttackSpeed);
      case STAT.MagicResist:
        return pick(s.mr, s.baseMr, s.bonusMr);
      case STAT.MoveSpeed:
        return pick(s.moveSpeed, s.moveSpeed - s.bonusMoveSpeed, s.bonusMoveSpeed);
      case STAT.CritChance:
        return s.critChance;
      case STAT.CritDamage:
        // base = the champion record's multiplier (2.0), bonus = crit damage from items etc.
        return pick(s.critDamage, this.champ.stats.critDamageMultiplier, s.critDamage - this.champ.stats.critDamageMultiplier);
      case STAT.CooldownReduction:
        return 1 - 100 / (100 + s.abilityHaste);
      case STAT.AbilityHaste:
        return s.abilityHaste;
      case STAT.MaxHealth:
        return pick(s.maxHp, s.baseHp, s.bonusHp);
      case STAT.CurrentHealth:
        return s.hp;
      case STAT.PercentCurrentHealth:
        return s.hp / s.maxHp;
      case STAT.MissingHealth:
        return s.maxHp - s.hp;
      case STAT.PercentMissingHealth:
        return 1 - s.hp / s.maxHp;
      case STAT.LifeSteal:
        return s.lifeSteal;
      case STAT.Lethality:
        return s.lethality;
      case STAT.AttackRange:
        return pick(s.range, s.range - s.bonusRange, s.bonusRange);
      default:
        this.warn(`unsupported stat id ${stat} in a game formula (treated as 0)`);
        return 0;
    }
  }

  targetStat(stat: number, formula: number): number {
    const t = this.target;
    const pick = (total: number, base: number, bonus: number) => (formula === 1 ? base : formula === 2 ? bonus : total);
    switch (stat) {
      case STAT.Armor:
        return pick(t.baseArmor + t.bonusArmor, t.baseArmor, t.bonusArmor);
      case STAT.MagicResist:
        return pick(t.baseMr + t.bonusMr, t.baseMr, t.bonusMr);
      case STAT.MaxHealth:
        return pick(t.maxHp, t.baseHp, t.bonusHp);
      case STAT.CurrentHealth:
        return Math.max(0, t.hp);
      case STAT.PercentCurrentHealth:
        return Math.max(0, t.hp) / t.maxHp;
      case STAT.MissingHealth:
        return t.maxHp - Math.max(0, t.hp);
      case STAT.PercentMissingHealth:
        return 1 - Math.max(0, t.hp) / t.maxHp;
      default:
        this.warn(`unsupported target stat id ${stat} (treated as 0)`);
        return 0;
    }
  }

  /** Evaluate a kit expression in the context of an ability slot. */
  evalExpr(
    e: Expr,
    ctx: { slot: Slot; spell?: SpellData; rank?: number; hit?: number; hits?: number; recast?: number; castTime?: number; distance?: number },
  ): number {
    if (typeof e === "number") return e;
    const spell = ctx.spell ?? this.spellFor(ctx.slot);
    const rank = ctx.rank ?? this.abilityRank(ctx.slot);
    const full = ctx.spell !== undefined && ctx.rank !== undefined ? (ctx as typeof ctx & { spell: SpellData; rank: number }) : { ...ctx, spell, rank };
    const resolve: Resolver = (path) => this.resolvePath(path, full);
    try {
      return compile(e)(resolve);
    } catch (err) {
      this.warn(`expression error in "${e}": ${(err as Error).message}`);
      return 0;
    }
  }

  abilityRank(slot: Slot): number {
    if (slot === "P") {
      const r = this.kit.abilities.P;
      if (r?.rank !== undefined) return Math.max(1, Math.round(this.evalExpr(r.rank, { slot: "Q", rank: 1 })));
      return 1;
    }
    return this.rankOf(slot);
  }

  private resolvePath(
    path: string[],
    ctx: { slot: Slot; spell: SpellData; rank: number; hit?: number; hits?: number; recast?: number; castTime?: number; distance?: number },
  ): number {
    const h = path[0];
    const distance = ctx.distance ?? this.distance;
    const st = this.stats;
    const t = this.target;
    switch (h) {
      case "castTime":
        return ctx.castTime ?? this.spellValue(ctx.spell, ctx.rank, path, 0, distance);
      case "calc":
      case "dv":
      case "cooldown":
      case "castRange":
      case "missileSpeed":
      case "reach":
        return this.spellValue(ctx.spell, ctx.rank, path, 0, distance);
      case "rank":
        return ctx.rank;
      case "P":
      case "Q":
      case "W":
      case "E":
      case "R": {
        const slot = h as Slot;
        const rank = this.abilityRank(slot);
        if (path[1] === "rank") return rank;
        return this.spellValue(this.spellFor(slot), rank, path, 1, distance);
      }
      case "spell": {
        const s = this.findSpell(path[1]);
        if (!s) throw new Error(`unknown spell ${path[1]}`);
        // Unslotted spells (other forms: Elise spider, Gnar mega…) use the rank of the slot
        // whose expression references them.
        const unslotted = this.champ.abilities.find((a) => a.spells.includes(s))?.slot === "X";
        return this.spellValue(s, unslotted ? ctx.rank : this.abilityRank(this.slotOfSpell(s)), path, 2, distance);
      }
      case "target": {
        const hp = Math.max(0, t.hp);
        switch (path[1]) {
          case "maxHp":
            return t.maxHp;
          case "hp":
            return hp;
          case "missingHp":
            return t.maxHp - hp;
          case "hpPct":
            return hp / t.maxHp;
          case "missingHpPct":
            return 1 - hp / t.maxHp;
          case "bonusHp":
            return t.bonusHp;
          case "baseHp":
            return t.baseHp;
          case "armor":
            return t.baseArmor + t.bonusArmor;
          case "bonusArmor":
            return t.bonusArmor;
          case "mr":
            return t.baseMr + t.bonusMr;
          case "bonusMr":
            return t.bonusMr;
          case "immobilized":
            return this.targetHasCC(["immobilize"]) ? 1 : 0;
          case "slowed":
            return this.targetHasCC(["slow"]) ? 1 : 0;
          case "impaired":
            return this.targetHasCC(["impair"]) ? 1 : 0;
          case "cced":
            return this.targetHasCC(["immobilize", "slow", "impair"]) ? 1 : 0;
        }
        throw new Error(`unknown target.${path[1]}`);
      }
      case "opt":
        return this.opt[path[1]] ?? 0;
      case "stacks":
        return this.markStacks(path[1]) ?? this.counters.get(path[1]) ?? 0;
      case "buff": {
        const b = this.getBuff(path[1]);
        return b ? b.stacks || 1 : 0;
      }
      case "debuff": {
        const d = this.getDebuff(path[1]);
        return d ? d.stacks || 1 : 0;
      }
      case "recast":
        return ctx.recast ?? 1;
      case "charge":
        return this.chargeHeld.get(ctx.slot) ?? this.defaultCharge(ctx.slot);
      case "hit":
        return ctx.hit ?? 0;
      case "hits":
        return ctx.hits ?? 1;
      case "time":
        return this.time;
      case "combatTime":
        return this.time - this.combatStart;
      case "level":
        return this.level;
      case "ad":
        return st.ad;
      case "bonusAd":
        return st.bonusAd;
      case "baseAd":
        return st.baseAd;
      case "ap":
        return st.ap;
      case "maxHp":
        return st.maxHp;
      case "bonusHp":
        return st.bonusHp;
      case "baseHp":
        return st.baseHp;
      case "hp":
        return st.hp;
      case "armor":
        return st.armor;
      case "bonusArmor":
        return st.bonusArmor;
      case "mr":
        return st.mr;
      case "bonusMr":
        return st.bonusMr;
      case "as":
        return st.attackSpeed;
      case "windup":
        // An attack's windup at the current attack speed (casts the wiki times by it: Senna Q).
        return windupFraction(this.champ) / Math.max(0.2, st.attackSpeed);
      case "bonusAs":
        return st.bonusAttackSpeed;
      case "critChance":
        return st.critChance;
      case "critDamage":
        return st.critDamage;
      case "lethality":
        return st.lethality;
      case "ms":
        return st.moveSpeed;
      case "bonusMs":
        return st.bonusMoveSpeed;
      case "mana":
        return st.maxMana;
      case "bonusMana":
        return st.bonusMana;
      case "range":
        return st.range;
      case "distance":
        return distance;
      case "ah":
        return st.abilityHaste;
      case "ranged":
        return st.ranged ? 1 : 0;
    }
    throw new Error(`unknown name "${path.join(".")}"`);
  }

  /** A spell's value an expression names: path[at] and on (calc.X, dv.X, rank, cooldown…). */
  private spellValue(spell: SpellData, rank: number, path: string[], at: number, distance: number): number {
    switch (path[at]) {
      case "calc":
        return this.calc(spell, path[at + 1], rank);
      case "dv":
        return this.dataValue(spell, path[at + 1], rank);
      case "rank":
        return rank;
      case "cooldown":
        return spell.cooldown?.[Math.min(rank, (spell.cooldown?.length ?? 1) - 1)] ?? 0;
      case "castTime":
        return spell.castTime;
      case "castRange":
        if (!spell.castRange) throw new Error(`${spell.name} has no range in the data`);
        return spell.castRange[Math.min(rank, spell.castRange.length - 1)];
      case "missileSpeed":
        if (!spell.missileSpeed) throw new Error(`${spell.name} has no missile speed in the data`);
        return spell.missileSpeed;
      case "reach":
        // How far it goes to the target: there, or as far as its range if that's shorter.
        return spell.castRange ? Math.min(distance, spell.castRange[Math.min(rank, spell.castRange.length - 1)]) : distance;
      default:
        throw new Error(`unknown name ${path.slice(at).join(".")}`);
    }
  }

  // ---------------------------------------------------------------------------
  // Buffs, debuffs, counters

  getBuff(id: string): ActiveBuff | undefined {
    const b = this.buffs.get(id);
    if (!b) return undefined;
    if (b.expires < this.time) {
      this.buffs.delete(id);
      this.invalidateStats();
      return undefined;
    }
    return b;
  }

  addBuff(b: Omit<ActiveBuff, "stacks"> & { stacks?: number }) {
    this.buffs.set(b.id, { stacks: 1, ...b });
    this.invalidateStats();
  }

  removeBuff(id: string) {
    if (this.buffs.delete(id)) this.invalidateStats();
  }

  getDebuff(id: string): ActiveDebuff | undefined {
    const d = this.debuffs.get(id);
    if (!d) return undefined;
    if (d.expires < this.time) {
      this.debuffs.delete(id);
      return undefined;
    }
    return d;
  }

  addDebuff(d: Omit<ActiveDebuff, "stacks"> & { stacks?: number }) {
    this.debuffs.set(d.id, { stacks: 1, ...d });
  }

  removeDebuff(id: string) {
    this.debuffs.delete(id);
  }

  counter(key: string): number {
    return this.counters.get(key) ?? 0;
  }

  setCounter(key: string, v: number) {
    this.counters.set(key, v);
    this.invalidateStats();
  }

  cooldownReadyAt(key: string): number {
    return this.cooldownReady.get(key) ?? -Infinity;
  }

  isReady(key: string): boolean {
    return this.cooldownReadyAt(key) <= this.time + 1e-9;
  }

  startCooldown(key: string, seconds: number) {
    this.cooldownReady.set(key, this.time + seconds);
  }

  /** Periods in which basic ability cooldowns progress faster (Actualizer): rate 0.3 = 30% faster. */
  private cooldownSpeedups: { from: number; until: number; rate: number }[] = [];

  /** When a cooldown of `seconds` that starts at `from` ends, with basic-ability speed-ups for Q/W/E. */
  private cooldownEnd(slot: Slot, from: number, seconds: number): number {
    if (slot !== "Q" && slot !== "W" && slot !== "E") return from + seconds;
    let t = from;
    let left = seconds;
    for (const s of [...this.cooldownSpeedups].sort((a, b) => a.from - b.from)) {
      if (s.until <= t) continue;
      if (s.from > t) {
        if (s.from - t >= left) break;
        left -= s.from - t;
        t = s.from;
      }
      const progress = (s.until - t) * (1 + s.rate);
      if (progress >= left) return t + left / (1 + s.rate);
      left -= progress;
      t = s.until;
    }
    return t + left;
  }

  /** Basic ability cooldowns progress `rate` faster from now until `until`, running ones included. */
  speedUpBasicCooldowns(until: number, rate: number) {
    const running = (["Q", "W", "E"] as const).map((slot) => ({ slot, left: this.cooldownReadyAt(`ability:${slot}`) - this.time }));
    this.cooldownSpeedups.push({ from: this.time, until, rate });
    for (const { slot, left } of running) if (left > 0) this.cooldownReady.set(`ability:${slot}`, this.cooldownEnd(slot, this.time, left));
  }

  warn(msg: string) {
    if (!this.warnings.includes(msg)) this.warnings.push(msg);
  }

  note(msg: string) {
    this.notes.add(msg);
  }

  newCastId(): number {
    return this.nextCastId++;
  }

  private newHitId(): number {
    return this.nextHitId++;
  }

  /** For components landing together (a cast's, a mark's): the hit of each one's hit landing at
   *  `time`, the n-th of each there being one (DamageInstance.hitId), made as the first of them lands. */
  private hitsLandingTogether() {
    const at = new Map<number, { count: Map<ComponentSpec, number>; hits: number[] }>();
    return (time: number, comp: ComponentSpec) => {
      if (!at.has(time)) at.set(time, { count: new Map(), hits: [] });
      const t = at.get(time)!;
      const n = t.count.get(comp) ?? 0;
      t.count.set(comp, n + 1);
      return () => (t.hits[n] ??= this.newHitId());
    };
  }

  // ---------------------------------------------------------------------------
  // Scheduling

  schedule(delay: number, run: () => void) {
    this.scheduleAt(this.time + Math.max(0, delay), run);
  }

  scheduleAt(time: number, run: () => void) {
    const ev = { time: Math.max(this.time, time), seq: this.seq++, run, crit: this.stepCrit, action: this.action };
    // In order of time, then of scheduling: after every event due by then.
    let lo = 0;
    let hi = this.queue.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (this.queue[mid].time > ev.time) hi = mid;
      else lo = mid + 1;
    }
    this.queue.splice(lo, 0, ev);
  }

  processUntil(t: number) {
    const own = this.stepCrit;
    const ownAction = this.action;
    while (this.queue.length && this.queue[0].time <= t + 1e-9) {
      const ev = this.queue.shift()!;
      this.advanceTo(ev.time);
      this.setStepCrit(ev.crit);
      this.action = ev.action;
      ev.run();
    }
    this.setStepCrit(own);
    this.action = ownAction;
    this.advanceTo(t);
  }

  // Stats depend on it through hooks that read critMode (Yasuo's R).
  private setStepCrit(crit: boolean | undefined) {
    if (crit === this.stepCrit) return;
    this.stepCrit = crit;
    this.invalidateStats();
  }

  /** How crits resolve now: by the crit mark of the step being resolved (AA!, Q?), else their
   *  expected value. */
  critMode(): CritMode {
    return this.stepCrit === true ? "always" : this.stepCrit === false ? "never" : "expected";
  }

  private advanceTo(t: number) {
    if (t > this.time) {
      this.time = t;
      this.invalidateStats();
    }
  }

  // ---------------------------------------------------------------------------
  // Damage

  /**
   * Deal one damage request: amps, mitigation, HP update, hooks. An item's, rune's or summoner
   * spell's proc that a cast's hits landing together set off is dealt after them (see landTogether).
   *
   * An execute (flags.execute) is asked for with `amount` the health it kills below, its line, and
   * kills the target if its health is at or under it then; the results mark the line either way
   * (executeLines). Like any damage counted past the kill, it counts for its full value (the line) as
   * true damage, with no amps or mitigation, and sets off nothing. The target dies once: only the
   * largest execute counts, whenever it lands, and takes the place of a smaller one before it. One
   * asked for while hits are being dealt (by a hit's hooks, or among a cast's hits landing together)
   * lands after the rest of this instant's damage: the hits, then what they set off, then the
   * execute, which checks the health they left. With settings.executes off they deal nothing.
   */
  deal(req: DamageRequest) {
    const kind = req.flags?.kind;
    if (req.flags?.execute && (this.dealing || this.setOff)) this.schedule(0, () => this.deal(req));
    else if (this.setOff && (kind === "item" || kind === "rune" || kind === "summoner")) this.setOff.push(() => this.apply(req));
    else this.apply(req);
  }

  private apply(req: DamageRequest) {
    const st = this.stats;
    const execute = !!req.flags?.execute;
    if (execute) {
      if (!this.settings.executes) return;
      this.noteExecuteLine(req.source, req.sourceLabel, req.label, req.amount);
      if (this.target.hp > req.amount || req.amount <= (this.execution?.inst.final ?? 0)) return;
      if (this.execution) this.takeBack(this.execution);
    }
    let type: DamageType = execute ? "true" : req.type === "adaptive" ? (st.adaptiveType === "physical" ? "physical" : "magic") : req.type;
    const flags: DamageFlags = {
      kind: "ability",
      ability: false,
      attack: false,
      onHit: false,
      aoe: false,
      dot: false,
      pet: false,
      proc: false,
      crit: false,
      ...req.flags,
    };
    const inst: DamageInstance = {
      id: this.nextInstId++,
      time: this.time,
      castId: req.castId ?? this.newCastId(),
      hitId: execute ? this.newHitId() : (req.hitId ?? this.newHitId()),
      source: req.source,
      sourceLabel: req.sourceLabel,
      label: req.label,
      type,
      raw: Math.max(0, req.amount),
      flags,
      amps: [],
      ...(req.note ? { note: req.note } : {}),
      ...(req.markSource ? { fromMark: req.markSource } : {}),
      ...(this.action !== undefined ? { action: this.action } : {}),
    };

    if (!execute) {
      // What lands before the hit (Voltaic Cyclosword's Firmament) isn't set off by it.
      const setOff = this.setOff;
      this.setOff = null;
      for (const e of this.effects) e.beforeDamage?.(this, inst);
      this.setOff = setOff;
      for (const b of this.buffs.values()) if (b.expires >= this.time && b.amp) inst.amps.push({ id: b.slot, source: b.label, value: b.amp, kind: "dealt" });
      for (const d of this.debuffs.values()) if (d.expires >= this.time && d.amp) inst.amps.push({ id: d.slot, source: d.label, value: d.amp, kind: "taken" });
      if (inst.flags.unamplified) inst.amps = inst.amps.filter((a) => a.kind === "taken");
      type = inst.type;
    }

    // Mitigation.
    let resistMult = 1;
    let eff = 0;
    if (type !== "true") {
      const red = this.targetReductions();
      const s = this.stats;
      if (type === "physical") {
        eff = effectiveResist(
          { base: this.target.baseArmor, bonus: this.target.bonusArmor },
          { flat: red.armorFlat, percent: red.armorPercent },
          { percent: 1 - (1 - s.armorPenPercent) * (1 - (req.penPercent ?? 0)), bonusPercent: s.bonusArmorPenPercent, flat: s.lethality + s.armorPenFlat },
        );
      } else {
        eff = effectiveResist(
          { base: this.target.baseMr, bonus: this.target.bonusMr },
          { flat: red.mrFlat, percent: red.mrPercent },
          { percent: 1 - (1 - s.magicPenPercent) * (1 - (req.penPercent ?? 0)), bonusPercent: s.bonusMagicPenPercent, flat: s.magicPenFlat },
        );
      }
      resistMult = resistMultiplier(eff);
    }
    const ampMult = combineAmps(inst.amps);
    const final = execute ? inst.raw : inst.raw * resistMult * ampMult * (1 - this.target.damageReduction);
    inst.effectiveResist = eff;
    inst.resistMult = resistMult;
    inst.ampMult = ampMult;
    inst.final = final;
    inst.targetHpBefore = this.target.hp;
    this.target.hp -= final;
    inst.targetHpAfter = this.target.hp;
    if (this.target.hp <= 0 && this.target.killTime === undefined) this.target.killTime = this.time;
    if (!inst.flags.aura) this.lastCombatTime = this.time;
    const records = this.recorded(inst, req);
    for (const r of records) {
      const icon = this.castIcons.get(r.source)?.get(r.sourceLabel);
      if (icon) r.icon = icon;
    }
    this.events.push(...records);
    if (execute) {
      this.execution = { inst, records };
      return;
    }
    for (const d of this.debuffs.values()) if (d.spec?.detonate && d.expires >= this.time && !inst.fromMark) d.stored = (d.stored ?? 0) + final;

    this.dealing++;
    for (const e of this.effects) e.afterDamage?.(this, inst);
    if (!inst.fromMark) {
      this.processConsumes(inst);
      this.processMarks(inst);
    }
    this.dealing--;
  }

  /** Mark an execute's line in the results: its health line as checked now. */
  private noteExecuteLine(source: string, sourceLabel: string, label: string, hp: number) {
    if (this.settings.executes && hp > 0) this.executeLines.set(label, { source, sourceLabel, label, hp });
  }

  /** Take back an execute a larger one replaces: the hits after it find the health it took, and the
   *  kill is when they take it. */
  private takeBack({ inst: ex, records }: Execution) {
    const at = this.events.indexOf(records[0]);
    this.events.splice(at, records.length);
    for (const e of this.events.slice(at)) {
      e.targetHpBefore = e.targetHpBefore! + ex.final!;
      e.targetHpAfter = e.targetHpAfter! + ex.final!;
    }
    this.target.hp += ex.final!;
    this.target.killTime = this.events.find((e) => e.targetHpAfter! <= 0)?.time;
  }

  /** A hit as the results show it: what its multipliers recorded as hits of their own add (amps'
   *  `hit`: Shadowflame's Cinderbloom, Yunara's passive amping the crit) after it, under their sources,
   *  and the hit in two when part of it is what a normal attack would have dealt (see attackPart).
   *  Effects saw it whole. */
  private recorded(inst: DamageInstance, req: DamageRequest): DamageInstance[] {
    const own = inst.amps.filter((a) => a.hit && a.id && a.kind === "multiplier");
    if (!own.length) return this.attackPart(inst, req);
    // A part's raw damage is what its multiplier adds on top of those before it; the hit and its
    // parts are mitigated and amplified alike, by the rest of the amps.
    const amps = inst.amps.filter((a) => !own.includes(a));
    const perRaw = inst.raw > 0 ? (inst.final ?? 0) / inst.raw / own.reduce((m, a) => m * (1 + a.value), 1) : 0;
    let hp = (inst.targetHpBefore ?? 0) - inst.raw * perRaw;
    const out = this.attackPart({ ...inst, amps, ampMult: combineAmps(amps), final: inst.raw * perRaw, targetHpAfter: hp }, req);
    const { note: _, ...same } = inst;
    let raw = inst.raw;
    for (const a of own) {
      const part = raw * a.value;
      raw += part;
      const flags: DamageFlags = { ...inst.flags, kind: sourceKind(a.id!), ability: false, attack: false, onHit: false, proc: true };
      delete flags.slot;
      delete flags.empowered;
      if (flags.kind === "ability") flags.slot = a.id as Slot;
      out.push({
        ...same,
        id: this.nextInstId++,
        hitId: this.newHitId(),
        source: a.id!,
        sourceLabel: a.source,
        label: a.hit!,
        raw: part,
        flags,
        amps,
        ampMult: combineAmps(amps),
        final: part * perRaw,
        targetHpBefore: hp,
        targetHpAfter: (hp -= part * perRaw),
      });
    }
    return out;
  }

  /** A hit in two when part of it is what a normal attack would have dealt (DamageRequest.normalAttack):
   *  the rest first, then that part as the attack's hit, still spell damage when the hit was (Garen Q). */
  private attackPart(inst: DamageInstance, req: DamageRequest): DamageInstance[] {
    const normal = req.normalAttack;
    if (!normal || !(normal.amount > 0) || !(req.amount > 0)) return [inst];
    const share = Math.min(1, normal.amount / req.amount);
    const final = inst.final ?? 0;
    const flags: DamageFlags = { ...inst.flags, kind: "attack", attack: true, onHit: false, crit: normal.crit };
    delete flags.slot;
    delete flags.empowered;
    const rest: DamageInstance = {
      ...inst,
      raw: inst.raw * (1 - share),
      final: final * (1 - share),
      targetHpAfter: (inst.targetHpBefore ?? 0) - final * (1 - share),
    };
    const attack: DamageInstance = {
      ...inst,
      id: share >= 1 ? inst.id : this.nextInstId++,
      source: normal.source,
      sourceLabel: normal.sourceLabel,
      label: normal.label,
      raw: inst.raw * share,
      final: final * share,
      targetHpBefore: share >= 1 ? inst.targetHpBefore : rest.targetHpAfter,
      flags,
    };
    return share >= 1 ? [attack] : [rest, attack];
  }

  // ---------------------------------------------------------------------------
  // Marks (stacking target debuffs driven by your hits)

  /** Set a mark's stacks (hooks: seed, spend or reset a mark). duration refreshes its expiry. */
  setMarkStacks(id: string, stacks: number, duration?: number) {
    let m = this.marks.get(id);
    if (!m) this.marks.set(id, (m = { stacks: 0, expires: 0, castIds: new Set(), cooldownUntil: -Infinity, ticking: false }));
    m.stacks = Math.max(0, stacks);
    if (duration !== undefined) m.expires = this.time + duration;
    if (m.stacks === 0) m.castIds.clear();
    this.invalidateStats();
  }

  /** Put a mark on cooldown (no stacks can be added until then). */
  setMarkCooldown(id: string, seconds: number) {
    let m = this.marks.get(id);
    if (!m) this.marks.set(id, (m = { stacks: 0, expires: 0, castIds: new Set(), cooldownUntil: -Infinity, ticking: false }));
    m.cooldownUntil = this.time + seconds;
  }

  markStacks(id: string): number | undefined {
    const m = this.marks.get(id);
    if (!m) return this.kit.marks?.some((k) => k.id === id) ? 0 : undefined;
    return m.expires >= this.time ? m.stacks : 0;
  }

  private markQualifies(spec: MarkSpec, inst: DamageInstance): boolean {
    if (inst.flags.proc && !inst.flags.pet) return false;
    if (inst.flags.kind !== "ability" && inst.flags.kind !== "attack") return false;
    for (const a of spec.appliedBy) {
      if (a === "attack" && inst.flags.attack) return true;
      if (a === "onhit" && (inst.flags.attack || (inst.flags.onHit && inst.flags.kind === "ability"))) return true;
      if (a === "ability" && inst.flags.kind === "ability" && !inst.flags.attack && inst.flags.slot && inst.flags.slot !== "P") return true;
      if (a === inst.flags.slot && inst.flags.kind === "ability" && !inst.flags.attack) return true;
    }
    return false;
  }

  /** Deal a mark's components as part of cast instance `castId` (a new one if omitted). */
  private dealMarkComponents(spec: MarkSpec, comps: ComponentSpec[], label: string, castId = this.newCastId()) {
    const slot = spec.slot ?? "P";
    const spell = this.spellFor(slot);
    const rank = this.abilityRank(slot);
    const hitAt = this.hitsLandingTogether();
    for (const comp of comps) {
      const hits = Math.max(0, Math.round(this.evalExpr(comp.hits ?? 1, { slot, spell, rank })));
      const delay0 = this.landsAt(comp, { slot, spell, rank });
      const interval = comp.interval !== undefined ? this.evalExpr(comp.interval, { slot, spell, rank }) : 0;
      for (let h = 0; h < hits; h++) {
        const at = delay0 + interval * h;
        const hitId = hitAt(at, comp);
        const run = () => {
          let amount = this.evalExpr(comp.amount, { slot, spell, rank, hit: h, hits });
          if (comp.min !== undefined) amount = Math.max(amount, this.evalExpr(comp.min, { slot, spell, rank }));
          if (comp.max !== undefined) amount = Math.min(amount, this.evalExpr(comp.max, { slot, spell, rank }));
          if (!(amount > 0)) return;
          this.deal({
            source: slot,
            sourceLabel: label,
            label: comp.label,
            type: comp.type,
            amount,
            castId,
            hitId: hitId(),
            flags: componentFlags(comp, slot),
            markSource: spec.id,
          });
        };
        if (at > 0) this.schedule(at, run);
        else run();
      }
    }
  }

  private processMarks(inst: DamageInstance) {
    for (const spec of this.kit.marks ?? []) {
      if (!this.markQualifies(spec, inst)) continue;
      const slot = spec.slot ?? "P";
      const ctx = { slot, spell: this.spellFor(slot), rank: this.abilityRank(slot) };
      let m = this.marks.get(spec.id);
      if (!m || m.expires < this.time) {
        m = { stacks: 0, expires: 0, castIds: new Set(), cooldownUntil: m?.cooldownUntil ?? -Infinity, ticking: false };
        this.marks.set(spec.id, m);
      }
      if (this.time < m.cooldownUntil) continue;
      if (spec.oncePerCast !== false && m.castIds.has(inst.castId)) continue;
      m.castIds.add(inst.castId);
      const max = this.evalExpr(spec.maxStacks, ctx);
      const add = spec.stacksPerHit !== undefined ? this.evalExpr(spec.stacksPerHit, ctx) : 1;
      m.stacks = Math.min(max, m.stacks + add);
      m.expires = this.time + this.evalExpr(spec.duration, ctx);
      this.invalidateStats();
      // Stack damage belongs to the triggering hit's cast instance; damage over time ticks share
      // the cast instance that started them (they aren't separate hits for Electrocute, Conqueror…).
      if (spec.onStack?.length) this.dealMarkComponents(spec, spec.onStack, spec.label, inst.castId);
      if (spec.dot && !m.ticking) {
        m.ticking = true;
        m.dotCastId = inst.castId;
        const mm = m;
        const tick = () => {
          if (mm.expires < this.time || mm.stacks <= 0) {
            mm.ticking = false;
            return;
          }
          this.dealMarkComponents(spec, spec.dot!.components, spec.label, mm.dotCastId);
          this.schedule(this.evalExpr(spec.dot!.interval, ctx), tick);
        };
        this.schedule(this.evalExpr(spec.dot.interval, ctx), tick);
      }
      if (m.stacks >= max && spec.atMax) {
        if (spec.atMax.buff) this.applyBuff(spec.atMax.buff, slot, ctx.spell, ctx.rank);
        // The proc's damage lands first; its debuff/CC apply after (like ability debuffs).
        if (spec.atMax.components.length) this.dealMarkComponents(spec, spec.atMax.components, spec.label, inst.castId);
        if (spec.atMax.debuff) this.applyDebuff(spec.atMax.debuff, slot, ctx.spell, ctx.rank, inst.castId);
        for (const cc of spec.atMax.cc ?? []) this.applyCC(cc.kind, this.evalExpr(cc.duration, ctx), inst.castId, slot);
        if (spec.atMax.consume) {
          m.stacks = 0;
          m.castIds.clear();
        }
        if (spec.atMax.cooldown !== undefined) m.cooldownUntil = this.time + this.evalExpr(spec.atMax.cooldown, ctx);
        this.invalidateStats();
      }
    }
  }

  /** Detonate consumable marks (debuff.consume) with a hit from a different cast. */
  private processConsumes(inst: DamageInstance) {
    if (inst.flags.proc && !inst.flags.pet) return;
    for (const d of [...this.debuffs.values()]) {
      const c = d.spec?.consume;
      if (!c || d.expires < this.time || d.castId === inst.castId) continue;
      const isAttack = inst.flags.attack;
      const isAbility = inst.flags.kind === "ability" && !inst.flags.attack && !!inst.flags.slot && inst.flags.slot !== "P";
      const by = Array.isArray(c.by) ? c.by : [c.by];
      const ok = by.some(
        (b) =>
          (b === "attack" && isAttack) || (b === "ability" && isAbility) || (b === "any" && (isAttack || isAbility)) || (b === inst.flags.slot && isAbility),
      );
      if (!ok) continue;
      this.debuffs.delete(d.id);
      const slot = c.slot ?? d.slot ?? "P";
      const spell = this.spellFor(slot);
      const rank = this.abilityRank(slot);
      const castId = this.newCastId();
      const hitId = this.newHitId();
      for (const comp of c.components) {
        const amount = this.evalExpr(comp.amount, { slot, spell, rank });
        this.deal({
          source: slot,
          sourceLabel: comp.source ?? d.label,
          label: comp.label,
          type: comp.type,
          amount,
          castId,
          hitId,
          flags: componentFlags(comp, slot),
          markSource: d.id,
        });
      }
    }
  }

  targetReductions() {
    const r = { armorFlat: 0, armorPercent: 0, mrFlat: 0, mrPercent: 0 };
    const armorPcts: number[] = [];
    const mrPcts: number[] = [];
    for (const e of this.effects) {
      const x = e.targetResist?.(this);
      if (!x) continue;
      r.armorFlat += x.armorFlat ?? 0;
      r.mrFlat += x.mrFlat ?? 0;
      if (x.armorPercent) armorPcts.push(x.armorPercent);
      if (x.mrPercent) mrPcts.push(x.mrPercent);
    }
    for (const spec of this.kit.marks ?? []) {
      if (spec.armorReductionPerStack === undefined && spec.mrReductionPerStack === undefined) continue;
      const n = this.markStacks(spec.id) ?? 0;
      if (!n) continue;
      const slot = spec.slot ?? "P";
      if (spec.armorReductionPerStack !== undefined) armorPcts.push(Math.min(1, n * this.evalExpr(spec.armorReductionPerStack, { slot })));
      if (spec.mrReductionPerStack !== undefined) mrPcts.push(Math.min(1, n * this.evalExpr(spec.mrReductionPerStack, { slot })));
    }
    for (const d of this.debuffs.values()) {
      if (d.expires < this.time) continue;
      r.armorFlat += d.armorFlat ?? 0;
      r.mrFlat += d.mrFlat ?? 0;
      if (d.armorPct) armorPcts.push(d.armorPct);
      if (d.mrPct) mrPcts.push(d.mrPct);
    }
    r.armorPercent = 1 - armorPcts.reduce((p, x) => p * (1 - x), 1);
    r.mrPercent = 1 - mrPcts.reduce((p, x) => p * (1 - x), 1);
    return r;
  }

  critFactor(): { crit: boolean; factor: number } {
    const st = this.stats;
    const mode = this.critMode();
    if (mode === "always") return { crit: true, factor: st.critDamage };
    if (mode === "never") return { crit: false, factor: 1 };
    // Expected value.
    const factor = 1 + st.critChance * (st.critDamage - 1);
    return { crit: st.critChance >= 1, factor };
  }

  // ---------------------------------------------------------------------------
  // Components (ability hits)

  private dealComponent(
    comp: ComponentSpec,
    ctx: {
      slot: Slot;
      spell: SpellData;
      rank: number;
      castId: number;
      /** The hit it's part of (DamageInstance.hitId). */
      hitId: number;
      sourceLabel: string;
      hit: number;
      hits: number;
      recast?: number;
      castTime?: number;
      distance?: number;
    },
  ) {
    const ectx = {
      slot: ctx.slot,
      spell: ctx.spell,
      rank: ctx.rank,
      hit: ctx.hit,
      hits: ctx.hits,
      recast: ctx.recast,
      castTime: ctx.castTime,
      distance: ctx.distance,
    };
    let amount = this.evalExpr(comp.amount, ectx);
    if (comp.min !== undefined) amount = Math.max(amount, this.evalExpr(comp.min, ectx));
    if (comp.max !== undefined) amount = Math.min(amount, this.evalExpr(comp.max, ectx));
    const source = ctx.slot === "P" ? "P" : ctx.slot;

    if (!comp.attack && !comp.onHit && !(amount > 0)) return; // conditional components that evaluate to 0 deal nothing
    if (comp.attack && comp.onHitOnce && ctx.hit > 0) {
      // A later hit of one attack fired as several (Zeri's Burst Fire rounds): its basic damage only.
      const c = comp.canCrit !== false ? this.critFactor() : { crit: false, factor: 1 };
      this.deal({
        source,
        sourceLabel: ctx.sourceLabel,
        label: comp.label,
        type: comp.type,
        amount: amount * c.factor,
        castId: ctx.castId,
        hitId: ctx.hitId,
        flags: { kind: "ability", slot: ctx.slot, ability: !comp.noProc, crit: c.crit, basic: true },
      });
      return;
    }
    if (comp.attack) {
      // Each hit of a multi-hit attack component is its own attack (Urgot W, Akshan E…) unless sameCast: true.
      const own = !comp.onHitOnce && (comp.sameCast === false || (comp.sameCast !== true && ctx.hits > 1));
      this.performAttackHit({
        castId: own ? this.newCastId() : ctx.castId,
        hitId: ctx.hitId,
        amount,
        comp,
        label: comp.label,
        sourceLabel: ctx.sourceLabel,
        fromAbility: ctx.slot,
      });
      return;
    }
    let crit = false;
    if (comp.canCrit) {
      const c = this.critFactor();
      const mult = comp.critMultiplier !== undefined ? this.evalExpr(comp.critMultiplier, ectx) : this.stats.critDamage;
      const factor = c.crit ? mult : this.critMode() === "expected" ? 1 + this.stats.critChance * (mult - 1) : 1;
      amount *= factor;
      crit = c.crit;
    }
    this.deal({
      source,
      sourceLabel: comp.source ?? ctx.sourceLabel,
      label: comp.label,
      type: comp.type,
      amount,
      castId: comp.sameCast === false ? this.newCastId() : ctx.castId,
      hitId: ctx.hitId,
      ...(comp.penPercent !== undefined ? { penPercent: this.evalExpr(comp.penPercent, ectx) } : {}),
      // Abilities that apply on-hit (Ezreal Q, Fizz Q) count as on-hit for marks like Fizz W.
      flags: { ...componentFlags(comp, ctx.slot), onHit: !!comp.onHit, crit },
      ...(comp.note ? { note: comp.note } : {}),
    });
    if (comp.onHit) {
      // Ability that applies on-hit effects (no base attack damage).
      this.performAttackHit({
        castId: ctx.castId,
        hitId: ctx.hitId,
        amount: 0,
        comp: { ...comp, attack: true },
        label: comp.label,
        sourceLabel: ctx.sourceLabel,
        fromAbility: ctx.slot,
        onHitOnly: true,
      });
    }
  }

  // ---------------------------------------------------------------------------
  // Basic attacks

  /** What the buffs add to an attack launched now, in their order; an ability's hit isn't empowered. */
  private takeBuffParts(fromAbility: boolean): BuffPart[] {
    const out: BuffPart[] = [];
    for (const b of this.buffs.values()) {
      if (b.expires < this.time || !b.spec) continue;
      const empower = !fromAbility && (b.charges ?? 0) > 0 ? b.spec.empowerAttacks : undefined;
      if (!b.spec.onHit && !empower) continue;
      out.push({
        id: b.id,
        label: b.label,
        slot: b.slot,
        ...(b.spec.onHit ? { onHit: b.spec.onHit } : {}),
        ...(empower ? { empower } : {}),
        ...(b.distance !== undefined ? { distance: b.distance } : {}),
      });
      if (empower) b.charges = (b.charges ?? 1) - 1;
    }
    return out;
  }

  /** Seconds a basic attack's missile flies to the target (`distance`, from attack range at most):
   *  0 for melee champions and forms (Elise's Spider Form) and attacks that hit at once (Senna, Zeri). */
  attackTravel(): number {
    const missile = this.champ.stats.attackMissile;
    const melee = this.kit.attack?.melee;
    if (!missile || this.champ.attackType !== "ranged" || (melee !== undefined && this.evalExpr(melee, { slot: "P" }))) return 0;
    return missileTime(missile, Math.min(this.distance, this.stats.range));
  }

  /**
   * Launch a basic attack now (its windup ended): on-attack effects and what empowers it are decided
   * now, and it hits (on-hit effects, its damage) when its missile arrives. Kits fire extra shots with
   * it (Lucian's second).
   */
  launchAttack(o: Omit<AttackHit, "fromAbility" | "buffParts" | "launched" | "launch">) {
    const launch: AttackLaunch = { castId: o.castId };
    for (const e of this.attackEffects(false)) e.onLaunch?.(this, launch);
    const buffParts = this.takeBuffParts(false);
    const travel = this.attackTravel();
    if (travel > 0) {
      const launched = this.time;
      this.schedule(travel, () => this.performAttackHit({ ...o, buffParts, launched, launch }));
    } else this.performAttackHit({ ...o, buffParts, launch });
  }

  /** The effects an attack triggers: all, or the kit's own for an attack that is an ability
   *  (kit.attack.ability), which applies no on-hit or on-attack effects. */
  private attackEffects(fromAbility: boolean): Effect[] {
    return !fromAbility && this.kit.attack?.ability ? this.effects.filter((e) => e.source === "kit") : this.effects;
  }

  /**
   * How an attack's crit, natural or guaranteed, applies to what it deals, once it's known (after its
   * preAttack and onAttack effects). For every attack:
   * - its own damage takes the crit (atk.critFactor, by performAttackHit), and so do the parts that
   *   crit with it (DamageRequest.critMultiplier: canCrit components), each by its own multiplier,
   *   but on-hit effects that crit (Corki's, Shaco's clone) only by the attack's own roll: guaranteed
   *   crits are the attack's and its empowering ability's;
   * - where an ability's damage replaces it (replaceBase), the attack is as much of that damage as it
   *   would have dealt (`plain`), which crits so, on its first hit, and the ability's bonus beyond it
   *   doesn't (the wiki's "the bonus damage does not crit": Garen Q, Volibear Q, Vi E), unless its
   *   components crit (canCrit: Nasus Q, Pantheon W), which then are all of its crit; an attack whose
   *   first component can't crit (canCrit: false), or someone else's, can't (performAttackHit);
   * - a guaranteed crit's modifier (Sundered Sky's and Fiendhunter Bolts' 80%) scales all of the
   *   attack's own damage and of its empowered ability's, the bonus that doesn't crit too, but not
   *   its on-hit effects. In the practice tool (16.20), Trundle's Chomp with Sundered Sky deals
   *   (AD × 200% + its bonus) × 80% (206), and an attack with Sundered Sky and Recurve Bow
   *   AD × 160% + 15 (199).
   * `later`: its parts that land later (bleeds), which crit with it but aren't its own damage.
   */
  private critAttack(atk: AttackInfo, plain: number, later: DamageRequest[]) {
    const f = atk.canCrit ? atk.forcedCrit : undefined;
    const scale = f ? atk.naturalCrit * f.naturalModifier + (1 - atk.naturalCrit) * f.modifier : 1;
    const rolled = (m: number) => (!atk.canCrit || atk.naturalCrit === 0 ? 1 : atk.naturalCrit === 1 ? m : 1 + this.stats.critChance * (m - 1));
    const replaced = atk.replaceBase ? (atk.replacedBy ?? []) : [];
    const critting = replaced.filter((x) => x.critMultiplier !== undefined);
    const total = replaced.reduce((s, x) => s + x.amount, 0);
    // The attack's part of what replaces it, where none of it crits on its own.
    const own = critting.length ? 0 : Math.min(plain, total);
    for (const x of [...atk.extra, ...later]) {
      const m = x.critMultiplier;
      if (m !== undefined) {
        const onHit = !!x.flags?.onHit && !x.flags.empowered;
        x.amount *= !atk.canCrit ? 1 : onHit ? rolled(m) : m === atk.critMultiplier ? atk.critFactor : f ? m * scale : rolled(m);
        x.flags = { ...x.flags, crit: atk.canCrit && (onHit ? atk.naturalCrit === 1 : atk.crit) };
        delete x.critMultiplier;
      } else if (scale !== 1 && x.flags?.empowered && !later.includes(x)) x.amount *= scale;
    }
    if (own > 0 && atk.critFactor !== scale) replaced[0].amount += own * (atk.critFactor - scale);
    // The attack is recorded as the parts that crit with it first (Zaahen Q's AD halves), then in order.
    if (atk.replacedBy && critting.length) atk.replacedBy = [...critting, ...atk.replacedBy.filter((x) => !critting.includes(x))];
  }

  /** Resolve a basic attack (or an attack-like ability hit) landing on the target: launched now,
   *  unless launchAttack launched it. */
  performAttackHit(o: AttackHit) {
    const effects = this.attackEffects(!!o.fromAbility);
    const hitId = o.hitId ?? this.newHitId();
    /** A basic attack that is an ability (Zeri's): spell damage, no on-hit or on-attack effects. */
    const abilityAttack = !o.fromAbility && !!this.kit.attack?.ability;
    // It counts as a cast as it hits (Spellblade is granted then: Burst Fire's rounds landing before
    // it don't use it).
    if (abilityAttack)
      for (const e of this.effects) e.onCast?.(this, { castId: o.castId, slot: "P", hitsTarget: true, isUltimate: false, label: "Basic attack", castTime: 0 });
    if (!o.launch && (!o.fromAbility || o.comp?.onAttack)) {
      const launch: AttackLaunch = { castId: o.castId, ...(o.fromAbility ? { fromAbility: o.fromAbility } : {}) };
      for (const e of effects) e.onLaunch?.(this, launch);
    }
    const st = this.stats;
    // The champion's crit rules are its basic attacks'; an ability's attack hit crits by its own.
    const canCrit = (!!o.fromAbility || this.kit.attack?.canCrit !== false) && (o.comp ? o.comp.canCrit !== false : true);
    const c = canCrit ? this.critFactor() : { crit: false, factor: 1 };
    const expected = this.critMode() === "expected";
    let critMult = st.critDamage;
    if (canCrit && this.kit.attack?.critMultiplier !== undefined && !o.fromAbility) critMult = this.evalExpr(this.kit.attack.critMultiplier, { slot: "P" });
    const factor = !canCrit ? 1 : c.crit ? critMult : expected ? 1 + st.critChance * (critMult - 1) : 1;
    const naturalCrit = !canCrit ? 0 : c.crit ? 1 : expected ? Math.min(1, st.critChance) : 0;

    const atk: AttackInfo = {
      castId: o.castId,
      index: this.attackIndex++,
      crit: c.crit,
      critFactor: factor,
      canCrit,
      naturalCrit,
      critMultiplier: critMult,
      extra: [],
      baseMult: 1,
      ...(o.fromAbility ? { fromAbility: o.fromAbility } : {}),
      onAttack: o.fromAbility ? !!o.comp?.onAttack : !abilityAttack,
      ...(o.comp?.areaOnHit ? { areaOnHit: true } : {}),
      ...(o.launched !== undefined ? { launched: o.launched } : {}),
    };
    /** Its parts that land later (critAttack). */
    const later: DamageRequest[] = [];

    // Champion passive on-hits, every-Nth procs and empowered attacks from buffs.
    const kitAtk = this.kit.attack;
    const pushCompsTo = (target: AttackInfo, comps: ComponentSpec[], sourceLabel: string, from: Slot = "P", empowered = false, distance?: number) => {
      for (const comp of comps) {
        if (comp.optional && !o.enable?.includes(comp.id)) continue;
        const slot = comp.slot ?? from;
        const spell = this.spellFor(slot);
        const rank = this.abilityRank(slot);
        const hits = Math.max(0, Math.round(this.evalExpr(comp.hits ?? 1, { slot, spell, rank, distance })));
        for (let h = 0; h < hits; h++) {
          let amount = this.evalExpr(comp.amount, { slot, spell, rank, hit: h, hits, distance });
          if (comp.min !== undefined) amount = Math.max(amount, this.evalExpr(comp.min, { slot, spell, rank, distance }));
          if (comp.max !== undefined) amount = Math.min(amount, this.evalExpr(comp.max, { slot, spell, rank, distance }));
          if (!(amount > 0)) continue;
          const flags = componentFlags(comp, slot);
          const req: DamageRequest = {
            source: slot,
            sourceLabel: comp.source ?? (comp.slot ? this.slotName(comp.slot) : sourceLabel),
            label: comp.label,
            type: comp.type,
            amount,
            castId: o.castId,
            // Empowered-attack damage from an ability counts as ability damage; passive on-hits don't,
            // unless marked spell damage.
            flags: {
              ...flags,
              onHit: true,
              ability: (from !== "P" || !!comp.spell || abilityAttack) && flags.ability,
              crit: false,
              ...(empowered ? { empowered } : {}),
            },
            // It crits with the attack, once its crit is known (critAttack).
            ...(comp.canCrit
              ? { critMultiplier: comp.critMultiplier !== undefined ? this.evalExpr(comp.critMultiplier, { slot, spell, rank, distance }) : critMult }
              : {}),
          };
          // Delayed / periodic parts of an empowered attack (bleeds, lightning) land later.
          const delay =
            this.landsAt(comp, { slot, spell, rank, distance }) +
            (comp.interval !== undefined ? this.evalExpr(comp.interval, { slot, spell, rank, distance }) * h : 0);
          if (delay > 0) {
            later.push(req);
            this.schedule(delay, () => this.deal(req));
          } else target.extra.push(req);
        }
      }
    };
    const pushComps = (comps: ComponentSpec[], sourceLabel: string, slot: Slot = "P", empowered = false, distance?: number) =>
      pushCompsTo(atk, comps, sourceLabel, slot, empowered, distance);
    const pendingCC: (() => void)[] = [];
    let empoweredEff: number | undefined;
    /** The ability whose spell damage the attack itself also is (empowerAttacks.spell). */
    let spellOf: Slot | undefined;
    if (!o.onHitOnly || o.fromAbility) {
      if (kitAtk?.onHit && !o.fromAbility) pushComps(kitAtk.onHit, this.champ.passive.name);
      if (kitAtk?.everyNth && !o.fromAbility) {
        const key = "kit.nth";
        const n = this.counter(key) + 1;
        if (n >= kitAtk.everyNth.n) {
          this.setCounter(key, 0);
          pushComps(kitAtk.everyNth.components, kitAtk.everyNth.label);
        } else this.setCounter(key, n);
      }
      const parts = o.buffParts ?? this.takeBuffParts(!!o.fromAbility);
      for (const { onHit, empower, label, slot, distance } of parts) {
        if (onHit) pushComps(onHit, label, slot, false, distance);
        if (!empower) continue;
        const before = atk.extra.length;
        pushComps(empower.components, label, slot, true, distance);
        if (empower.onHitRepeats !== undefined) {
          const n = Math.round(this.evalExpr(empower.onHitRepeats, { slot: slot ?? "P" }));
          if (n > 0) addOnHitRepeat(atk, n);
        }
        if (empower.replaceBase) {
          atk.replaceBase = true;
          // The first empowered component *is* the basic attack (counts for attack-based effects).
          const first = atk.extra[before];
          if (first) first.flags = { ...first.flags, attack: true, onHit: false };
          if (!empower.otherAttacker) (atk.replacedBy ??= []).push(...atk.extra.slice(before));
          // Someone else's attack (Azir's soldiers': no Sundered Sky, wiki) can't crit, nor one whose
          // first component can't (Camille Q, Pick a Card: no Fiendhunter Bolts charge, wiki).
          if (empower.otherAttacker || empower.components[0]?.canCrit === false)
            Object.assign(atk, { canCrit: false, crit: false, critFactor: 1, naturalCrit: 0 });
        }
        if (empower.spell) spellOf = slot;
        const effComp = empower.components.find((x) => x.onHitEffectiveness !== undefined);
        if (effComp) empoweredEff = this.evalExpr(effComp.onHitEffectiveness!, { slot: slot ?? "P" });
        for (const cc of empower.cc ?? []) {
          const dur = this.evalExpr(cc.duration, { slot: slot ?? "P" });
          const delay = cc.delay !== undefined ? this.evalExpr(cc.delay, { slot: slot ?? "P" }) : 0;
          pendingCC.push(() =>
            delay > 0 ? this.schedule(delay, () => this.applyCC(cc.kind, dur, o.castId, slot)) : this.applyCC(cc.kind, dur, o.castId, slot),
          );
        }
      }
      for (const p of parts) if (p.empower && !((this.buffs.get(p.id)?.charges ?? 1) > 0)) this.removeBuff(p.id);
    }

    for (const e of effects) e.preAttack?.(this, atk);
    if (atk.forcedCrit && atk.canCrit) {
      // Guaranteed crits (Sundered Sky, Fiendhunter Bolts): the natural roll picks the modifier.
      const f = atk.forcedCrit;
      atk.critFactor = atk.critMultiplier * (atk.naturalCrit * f.naturalModifier + (1 - atk.naturalCrit) * f.modifier);
      atk.crit = true;
    }
    for (const e of effects) e.onAttack?.(this, atk);
    const repeats = Math.max(0, Math.round(atk.repeatOnHit ?? 0));
    for (let i = 0; i < repeats; i++) {
      // Extra application of on-hit effects (no base damage, no passive every-Nth counting), a hit of
      // its own. Unlike the attack's own, it takes the buffs' on-hits as it lands: Dusk and Dawn's
      // after a cast while the attack flew gets Yunara's Q, which the attack doesn't.
      const again: AttackInfo = { ...atk, extra: [], phantom: true, repeatOnHit: 0 };
      if (kitAtk?.onHit && !o.fromAbility) pushCompsTo(again, kitAtk.onHit, this.champ.passive.name);
      for (const b of this.buffs.values()) if (b.expires >= this.time && b.spec?.onHit) pushCompsTo(again, b.spec.onHit, b.label, b.slot, false, b.distance);
      for (const e of effects) e.onAttack?.(this, again);
      const repeated = this.newHitId();
      atk.extra.push(...again.extra.map((x) => ({ ...x, hitId: x.hitId ?? repeated })));
    }

    const plain = (o.amount ?? st.ad * (kitAtk?.damageMult !== undefined ? this.evalExpr(kitAtk.damageMult, { slot: "P" }) : 1)) * atk.baseMult;
    this.critAttack(atk, o.onHitOnly ? 0 : plain, later);
    const base = plain * atk.critFactor;
    const label = o.label ?? (atk.crit ? "Attack (crit)" : expected && st.critChance > 0 && st.critChance < 1 && atk.canCrit ? "Attack (avg. crit)" : "Attack");
    if (!o.onHitOnly && atk.replaceBase && atk.replacedBy?.length) {
      // What replaced the attack is recorded as the attack for what it would have dealt (crediting
      // the ability only with the extra), taken from its first hits (those that crit first, see
      // critAttack): one attack, one Attack.
      let left = base;
      for (const x of atk.replacedBy) {
        const amount = Math.min(left, Math.max(0, x.amount));
        left -= amount;
        if (amount > 0) x.normalAttack = { amount, source: o.fromAbility ?? "AA", sourceLabel: o.sourceLabel ?? "Basic attack", label, crit: atk.crit };
      }
    }
    // Abilities that apply on-hit at reduced effectiveness (Azir soldiers, Akshan E…).
    const eff = o.comp?.onHitEffectiveness !== undefined ? this.evalExpr(o.comp.onHitEffectiveness, { slot: o.fromAbility ?? "P" }) : (empoweredEff ?? 1);
    // Its on-hit effects, items' too, are part of the attack: not what it sets off.
    const dealExtra = (x: DamageRequest) => {
      const scaled = eff !== 1 && x.flags?.onHit && x.flags.kind !== "ability" && !x.flags.fullOnHit ? { ...x, amount: x.amount * eff } : x;
      this.apply({ ...scaled, castId: x.castId ?? o.castId, hitId: x.hitId ?? hitId });
    };
    const attack = () => {
      for (const x of atk.extra) if (x.beforeAttack) dealExtra(x);
      if (o.onHitOnly || atk.replaceBase) return;
      this.deal({
        source: o.fromAbility ?? "AA",
        sourceLabel: o.sourceLabel ?? "Basic attack",
        label,
        type: o.comp && o.comp.type !== "adaptive" ? o.comp.type : o.comp?.type === "adaptive" ? "adaptive" : (kitAtk?.type ?? "physical"),
        amount: base,
        castId: o.castId,
        hitId,
        // Attack-like ability hits (Urgot W, Azir soldiers…) deal basic damage too, and only that
        // when noProc (Zeri Q); an attack that is also an ability's spell damage (Wukong Q) is
        // flagged as an attack its components replace, and an attack that is an ability (Zeri's) as
        // her passive's.
        flags:
          spellOf || abilityAttack
            ? { kind: "ability", slot: spellOf ?? "P", attack: true, ability: true, crit: atk.crit }
            : {
                kind: o.fromAbility ? "ability" : "attack",
                slot: o.fromAbility,
                attack: !o.fromAbility,
                ability: !!o.fromAbility && !o.comp?.noProc,
                crit: atk.crit,
                ...(o.fromAbility ? { basic: true } : {}),
              },
      });
    };
    const onHits = () => {
      if (atk.extra.some((x) => x.firstOnHit)) {
        const later = atk.extra.filter((x) => !x.beforeAttack && !x.firstOnHit);
        // Right after the attack's own damage: after what replaces it, where something does (Nasus Q).
        const at = atk.replaceBase ? Math.max(0, ...(atk.replacedBy ?? []).map((x) => later.indexOf(x) + 1)) : 0;
        later.splice(at, 0, ...atk.extra.filter((x) => x.firstOnHit && !x.beforeAttack));
        for (const x of later) dealExtra(x);
      } else for (const x of atk.extra) if (!x.beforeAttack) dealExtra(x);
      for (const f of pendingCC) f();
    };
    // An attack-like ability hit lands with the cast's other hits, and applies its on-hit effects
    // after them; an attack lands with its on-hit effects, then what they set off (landTogether).
    if (this.setOff) {
      attack();
      this.setOff.push(onHits);
    } else this.landTogether([attack, onHits]);
  }

  // ---------------------------------------------------------------------------
  // Combo steps

  private abilitySpec(slot: Slot): AbilitySpec {
    return this.kit.abilities[slot] ?? {};
  }

  /** The ability's name as its casts show it. */
  private slotName(slot: Slot): string {
    return this.abilitySpec(slot).name ?? this.spellFor(slot).name;
  }

  private castTimeOf(spec: AbilitySpec, variant: VariantSpec | undefined, ctx: CastCtx): number {
    const ctExpr = variant?.castTime ?? spec.castTime;
    // Its `castTime` is the spell's.
    return Math.max(0, ctExpr !== undefined ? this.evalExpr(ctExpr, { ...ctx, castTime: undefined }) : (ctx.spell.castTime ?? 0));
  }

  /** Seconds the slot's last cast was held to charge (expressions' `charge`). */
  private chargeHeld = new Map<Slot, number>();

  private defaultCharge(slot: Slot): number {
    const c = this.abilitySpec(slot).charge;
    return c ? this.evalExpr(c.default, { slot }) : 0;
  }

  /** What a cast's hits show under: its variant's own name, or the ability's with the variant's label. */
  private castLabel(name: string, variant: VariantSpec | undefined): string {
    return !variant ? name : (variant.name ?? `${name} (${variant.label})`);
  }

  /** The icons of the casts so far, by the source and label their hits show under (and their buffs':
   *  Takedown's empowered attack). */
  private castIcons = new Map<string, Map<string, string>>();

  private setCastIcon(source: string, label: string, icon: string) {
    let byLabel = this.castIcons.get(source);
    if (!byLabel) this.castIcons.set(source, (byLabel = new Map()));
    byLabel.set(label, icon);
  }
  /** The combo step being done. */
  private stepIndex = 0;

  /** A cast's icon (AbilitySpec.icon), else its spell's: the slot's HUD icon for the slot's own. */
  private castIcon(slot: Slot, spec: AbilitySpec, variant: VariantSpec | undefined, spell: SpellData): string | undefined {
    const ref = variant?.icon ?? (variant?.spell === undefined ? spec.icon : undefined);
    if (!ref)
      return (slot !== "P" && spell === this.champ.abilities.find((a) => a.slot === slot)?.spells[0] && this.champ.abilityIcons[slot]) || spell.icons?.[0];
    const [script, at] = ref.split("#");
    const icons = this.findSpell(script)?.icons;
    if (!icons) this.warn(`kit references unknown spell "${script}" for an icon`);
    return icons?.[Math.round(at ? this.evalExpr(at, { slot }) : 0)] ?? icons?.[0] ?? spell.icons?.[0];
  }

  /** What each ability key casts now (KeyCasts). */
  private keyCasts(): KeyCasts {
    const out: KeyCasts = {};
    for (const slot of ["Q", "W", "E", "R"] as Slot[]) {
      const spec = this.abilitySpec(slot);
      const key = this.stateVariant(spec, slot) ?? spec.defaultVariant;
      const variant = key ? findVariant(spec, key)?.[1] : undefined;
      const icon = this.castIcon(slot, spec, variant, this.spellFor(slot, (variant as any) ?? spec));
      const k: NonNullable<KeyCasts[Slot]> = {} as NonNullable<KeyCasts[Slot]>;
      if (variant) k.variant = key;
      if (icon) k.icon = icon;
      k.name = this.castLabel(this.slotName(slot), variant);
      out[slot] = k;
    }
    return out;
  }

  /** The icon an ability's key shows as the combo starts: the kit's (AbilitySpec.icon, by the options:
   *  Yunara's Q once it can be cast, Kayn's by form), else its slot's. */
  slotIcon(slot: Slot): string | undefined {
    const spec = this.abilitySpec(slot);
    return spec.icon ? this.castIcon(slot, spec, undefined, this.spellFor(slot, spec)) : this.champ.abilityIcons[slot];
  }

  /** The variant cast in place of the ability in the state it's in now (VariantSpec.when). */
  private stateVariant(spec: AbilitySpec, slot: Slot): string | undefined {
    return Object.entries(spec.variants ?? {}).find(([, v]) => v.when !== undefined && this.evalExpr(v.when, { slot }))?.[0];
  }

  /** What a cast step can set, where the player chooses it (see CastSetting). */
  castSetting(step: Pick<AbilityStep, "slot" | "variant" | "enable">): CastSetting | null {
    const spec = this.abilitySpec(step.slot);
    const key = step.variant ?? spec.defaultVariant;
    const variant = key ? findVariant(spec, key)?.[1] : undefined;
    const ctx: CastCtx = { slot: step.slot, spell: this.spellFor(step.slot, variant ?? spec), rank: this.abilityRank(step.slot) };
    if (!spec.charge) ctx.castTime = this.castTimeOf(spec, variant, ctx);
    return this.settingOf(spec, variant, step.enable, ctx);
  }

  private settingOf(spec: AbilitySpec, variant: VariantSpec | undefined, enable: string[] | undefined, ctx: CastCtx): CastSetting | null {
    if (spec.charge) {
      // To the hundredth: the data's seconds are floats (0.4000000059604645).
      const held = round2(this.defaultCharge(ctx.slot));
      const min = spec.charge.min !== undefined ? round2(this.evalExpr(spec.charge.min, ctx)) : 0;
      const max = spec.charge.max !== undefined ? round2(this.evalExpr(spec.charge.max, ctx)) : held;
      return { kind: "held", value: held, min: Math.min(min, held), max: Math.max(held, max), unit: "s" };
    }
    const comps = variant?.components ?? spec.components ?? [];
    const vd = variant?.variableDistance === false ? undefined : spec.variableDistance;
    if (vd) {
      // How far it goes: by default the target's distance, up to the cast's range (see variableDistance).
      const cfg = typeof vd === "object" ? vd : {};
      const range = ctx.spell.castRange?.[Math.min(ctx.rank, ctx.spell.castRange.length - 1)];
      const max = cfg.max !== undefined ? this.evalExpr(cfg.max, ctx) : (range ?? Math.max(this.distance, 1));
      const value = cfg.default !== undefined ? this.evalExpr(cfg.default, ctx) : this.distance;
      return { kind: "distance", value: Math.round(Math.min(value, max)), min: 0, max, unit: "u" };
    }
    if (spec.variableCount) {
      const { times, byDefault } = this.firedTimes(comps, enable, ctx);
      return times.length ? { kind: "count", value: byDefault, min: 1, max: times.length, unit: spec.variableCount } : null;
    }
    if (!spec.variableDuration) return null;
    const repeating = this.repeating(comps, enable, ctx);
    const lockout = variant?.lockout ?? spec.lockout;
    // Nothing for its seconds to end: a variant without the repeating hits (Yunara's Arc of Ruin).
    if (!repeating.length && lockout === undefined) return null;
    // Its lockout, or as long as its repeating hits take: by default, and at most; at least until
    // its first hit is fired, a repeating one or another (Yunara W's impact: W{0s} without the
    // linger), and the earliest it can be ended.
    let [first, last, lastMax] = [Infinity, 0, 0];
    for (const r of repeating) {
      first = Math.min(first, Math.max(0, r.first));
      last = Math.max(last, r.first + (r.hits - 1) * r.interval);
      lastMax = Math.max(lastMax, r.first + (r.maxHits - 1) * r.interval);
    }
    for (const c of comps)
      if (!repeating.some((r) => r.id === c.id) && !(c.optional && !enable?.includes(c.id)) && this.evalExpr(c.hits ?? 1, ctx) > 0)
        first = Math.min(first, Math.max(0, this.firedAt(c, ctx)));
    const seconds = Math.max(last, lockout !== undefined ? this.evalExpr(lockout, ctx) - this.castTimeOf(spec, variant, ctx) : 0);
    const max = spec.maxDuration !== undefined ? this.evalExpr(spec.maxDuration, ctx) : lockout !== undefined ? seconds : lastMax;
    const min = Math.max(Number.isFinite(first) ? first : 0, spec.minDuration !== undefined ? this.evalExpr(spec.minDuration, ctx) : 0);
    // Up to the hundredth, so that typed back they still cover every hit.
    const up = (x: number) => Math.max(0, Math.ceil(x * 100 - 1e-6) / 100);
    return { kind: "lasts", value: up(seconds), min: Math.min(up(min), up(seconds)), max: up(Math.max(seconds, max)), unit: "s" };
  }

  /** A cast's repeating hits (components with an interval): by default and at most, when the first
   *  is fired after the cast time (lands, less its travel), and how far apart. */
  private repeating(comps: ComponentSpec[], enable: string[] | undefined, ctx: CastCtx) {
    const out: { id: string; hits: number; maxHits: number; first: number; interval: number }[] = [];
    for (const c of comps) {
      if (c.interval === undefined || (c.optional && !enable?.includes(c.id))) continue;
      const interval = this.evalExpr(c.interval, ctx);
      const hits = Math.max(0, Math.round(this.evalExpr(c.hits ?? 1, ctx)));
      const maxHits = c.maxHits !== undefined ? Math.max(0, Math.round(this.evalExpr(c.maxHits, ctx))) : hits;
      if (interval > 0 && maxHits > 0) out.push({ id: c.id, hits, maxHits, first: this.firedAt(c, ctx), interval });
    }
    return out;
  }

  /** When each of a cast's hits is fired after its cast time, in that order and as many as there can
   *  be (a step's count fires the first so many: Jhin R's 4th shot after the other three); and how
   *  many there are by default. */
  private firedTimes(comps: ComponentSpec[], enable: string[] | undefined, ctx: CastCtx) {
    const times: number[] = [];
    let byDefault = 0;
    for (const c of comps) {
      if (c.optional && !enable?.includes(c.id)) continue;
      const r = this.repeating([c], enable, ctx)[0];
      const n = r?.maxHits ?? Math.max(0, Math.round(this.evalExpr(c.hits ?? 1, ctx)));
      byDefault += r?.hits ?? n;
      for (let k = 0; k < n; k++) times.push(r ? r.first + k * r.interval : this.firedAt(c, ctx));
    }
    return { times: times.sort((a, b) => a - b), byDefault };
  }

  /** Seconds after the cast time a component's first hit is fired: its delay. */
  private firedAt(c: ComponentSpec, ctx: CastCtx) {
    return c.delay !== undefined ? this.evalExpr(c.delay, ctx) : 0;
  }

  /** Seconds after the cast time a component's first hit lands: fired, then its travel. */
  private landsAt(c: ComponentSpec, ctx: CastCtx) {
    return this.firedAt(c, ctx) + this.travelOf(c, ctx);
  }

  /** Seconds a component's hits fly before they land (ComponentSpec.travel). */
  private travelOf(c: ComponentSpec, ctx: { slot: Slot; spell?: SpellData; rank?: number; distance?: number }) {
    if (c.travel === undefined) return 0;
    return this.evalExpr(c.travel === true ? "reach / missileSpeed" : c.travel, ctx);
  }

  /**
   * Why a step does nothing with this champion and build, where it doesn't: an ability not learned,
   * a P without a step, an item active whose item isn't bought or isn't modeled. The step is skipped,
   * and can stay in the combo for when it applies again (Gunblade's active, for the item it's worth).
   */
  skipReason(step: ComboStep): string | null {
    if (step.type === "ability") {
      if (step.slot === "P") return hasPassiveStep(this.kit) ? null : `${this.champ.name} has no P step`;
      return this.abilityRank(step.slot) <= 0 ? `${step.slot} is not learned at level ${this.level} (rank 0)` : null;
    }
    if (step.type === "energize") return this.items.some((i) => ENERGIZED_ITEMS.includes(i.id)) ? null : "energize: no Energized item in the build";
    if (step.type !== "item") return null;
    let item: ItemData;
    try {
      item = findItem(this.data, step.item);
    } catch (err) {
      return (err as Error).message;
    }
    if (!this.items.some((i) => i.id === item.id)) return `${item.name} isn't in the build`;
    return this.itemActive(item) ? null : `${item.name} has no modeled active`;
  }

  /** The effect with an item's active, if it's modeled. */
  private itemActive(item: ItemData): Effect | undefined {
    return this.effects.find((e) => e.source === "item" && e.active && (e.id === `item:${item.id}` || (e as any).itemIds?.includes(item.id)));
  }

  castAbility(step: AbilityStep, timeline: SimResult["timeline"]) {
    const slot = step.slot;
    const spec = this.abilitySpec(slot);
    const rank = this.abilityRank(slot);
    let variantKey = step.variant ?? this.stateVariant(spec, slot) ?? spec.defaultVariant;
    let variant: VariantSpec | undefined;
    if (variantKey) {
      variant = findVariant(spec, variantKey)?.[1];
      if (!variant) {
        this.warn(`${slot} has no variant "${variantKey}" (available: ${Object.keys(spec.variants ?? {}).join(", ") || "none"})`);
        variantKey = undefined;
      }
    }
    let spell = this.spellFor(slot, (variant as any) ?? spec);
    const name = this.slotName(slot);
    let label = this.castLabel(name, variant);

    // Cooldown / recast handling. Process pending hits first: they can reset cooldowns
    // (Diana E, Ekko…) or refund charges.
    const cdKey = `ability:${slot}`;
    const castFree = () => Math.max(this.freeAt, slot === "P" ? 0 : (this.castLockedUntil.get(slot) ?? 0));
    let start = Math.max(this.time, castFree());
    this.processUntil(start);
    while (castFree() > start + 1e-9) {
      start = castFree();
      this.processUntil(start);
    }
    // A recast chain that outlived its window ends: the ability goes on its full cooldown from the first cast.
    if (spec.recastWindow !== undefined && (this.recastCount.get(slot) ?? 0) > 0) {
      const first = this.counters.get(`firstcast:${slot}`) ?? start;
      const from = spec.recastWindowFrom === "previous" ? (this.counters.get(`lastcast:${slot}`) ?? first) : first;
      if (start - from > this.evalExpr(spec.recastWindow, { slot, spell, rank })) {
        const cdSpell = spell.cooldown?.some((x) => x > 0) ? spell : (this.siblingsOf(spell).find((x) => x.cooldown?.some((y) => y > 0)) ?? spell);
        const cdBase =
          spec.cooldown !== undefined
            ? this.evalExpr(spec.cooldown, { slot, spell, rank })
            : (cdSpell.cooldown?.[Math.min(rank, (cdSpell.cooldown?.length ?? 1) - 1)] ?? 0);
        const isU = slot === ULT && !spec.notUltimate;
        const haste = this.stats.abilityHaste + (isU ? this.stats.ultimateHaste : this.stats.basicAbilityHaste);
        this.cooldownReady.set(cdKey, this.cooldownEnd(slot, first, spell.cooldownFixed ? cdBase : hasteCooldown(cdBase, haste)));
        this.recastCount.set(slot, 0);
        this.counters.delete(`firstcast:${slot}`);
      }
    }
    const ammo = slot === "P" ? null : this.ammoFor(slot, spell, rank);
    const waitFrom = start;
    for (let guard = 0; guard < 200; guard++) {
      let next = start;
      if (ammo) {
        this.refreshAmmo(ammo, start);
        if (ammo.state.charges <= 0) next = Math.max(next, ammo.state.nextAt);
      }
      if (slot !== "P") next = Math.max(next, this.cooldownReadyAt(cdKey));
      if (next <= start + 1e-9) break;
      if (!this.settings.waitForCooldowns) {
        this.warn(`${slot} cast while on cooldown (${(next - start).toFixed(2)}s remaining)`);
        break;
      }
      // Step to the next pending event if it comes first: it may reset the cooldown.
      const pending = this.queue.length ? this.queue[0].time : Infinity;
      start = Math.min(next, pending);
      this.processUntil(start);
    }
    if (start > waitFrom + 1e-6) this.note(`Waited ${(start - waitFrom).toFixed(2)}s for ${slot} to be available.`);
    // The state it's cast in is the one it starts in (Transcendent State begun or ended meanwhile).
    if (!step.variant && spec.variants && this.stateVariant(spec, slot) !== variantKey) {
      variantKey = this.stateVariant(spec, slot) ?? spec.defaultVariant;
      variant = variantKey ? findVariant(spec, variantKey)?.[1] : undefined;
      spell = this.spellFor(slot, (variant as any) ?? spec);
      label = this.castLabel(name, variant);
    }
    if (variant?.when !== undefined && !this.evalExpr(variant.when, { slot, spell, rank })) {
      this.warn(`${label} isn't castable now (${variant.when}): ${name} cast instead`);
      variantKey = spec.defaultVariant;
      variant = variantKey ? findVariant(spec, variantKey)?.[1] : undefined;
      spell = this.spellFor(slot, (variant as any) ?? spec);
      label = this.castLabel(name, variant);
    }
    const icon = this.castIcon(slot, spec, variant, spell);
    if (icon) {
      const buffs = variant && "buff" in variant ? variant.buff : spec.buff;
      for (const l of [label, ...[buffs ?? []].flat().map((b) => b.label)]) this.setCastIcon(slot, l, icon);
    }

    if (ammo) {
      ammo.state.charges = Math.max(0, ammo.state.charges - 1);
      if (!Number.isFinite(ammo.state.nextAt)) ammo.state.nextAt = start + ammo.recharge;
    }
    const recast = (this.recastCount.get(slot) ?? 0) + 1;
    const ectx: CastCtx = { slot, spell, rank, recast };
    // Its own cast time, the kit's where it sets one, in all it evaluates (a charge's once it's held).
    if (!spec.charge) ectx.castTime = this.castTimeOf(spec, variant, ectx);
    // The number the step sets, where the player chooses it (see CastSetting), within what the cast
    // allows: the seconds it's held to charge, or after its cast time the seconds it lasts or until
    // its last counted hit is fired (`span`): its repeating hits land within them, and its lockout
    // ends with them.
    const setting = this.settingOf(spec, variant, step.enable, ectx);
    const asked = !setting ? undefined : setting.kind === "count" ? step.count : setting.kind === "distance" ? step.distance : step.duration;
    let set: number | undefined;
    if (setting && asked !== undefined) {
      set = Math.max(setting.min, Math.min(setting.kind === "count" ? Math.round(asked) : asked, setting.max));
      if (Math.abs(set - asked) > 1e-9) this.warn(settingWarning(label, step, setting, asked, set));
    }
    if (step.duration !== undefined && (!setting || setting.kind === "count" || setting.kind === "distance"))
      this.warn(`${label} can't be ended early, kept on or charged: ${formatCombo([step])} casts it in full`);
    if (step.count !== undefined && setting?.kind !== "count") this.warn(`${label}'s hits aren't counted: ${formatCombo([step])} casts it in full`);
    if (step.distance !== undefined && setting?.kind !== "distance")
      this.warn(`${label} doesn't depend on how far the target is: ${formatCombo([step])} is cast at its distance`);
    if (setting?.kind === "held") this.chargeHeld.set(slot, set ?? setting.value);
    // The target stands that far for the cast: its travel and damage go by it.
    if (setting?.kind === "distance") ectx.distance = set ?? setting.value;
    const comps = variant?.components ?? spec.components ?? [];
    const span =
      set === undefined || setting?.kind === "held" || setting?.kind === "distance"
        ? undefined
        : setting?.kind === "count"
          ? this.firedTimes(comps, step.enable, ectx).times[set - 1]
          : set;
    const repeating = span !== undefined ? this.repeating(comps, step.enable, ectx) : [];
    // Hit counts and optional hits the cast doesn't have (another champion's, a typo).
    const ids = (optional: boolean) => comps.filter((c) => !optional || c.optional).map((c) => c.id);
    for (const id of Object.keys(step.hits ?? {}))
      if (!ids(false).includes(id)) this.warn(`${label} has no hit "${id}" (available: ${ids(false).join(", ") || "none"})`);
    for (const id of step.enable ?? [])
      if (!ids(true).includes(id)) this.warn(`${label} has no optional hit "${id}" (available: ${ids(true).join(", ") || "none"})`);

    const castTime = this.castTimeOf(spec, variant, ectx);
    ectx.castTime = castTime;
    const castId = this.newCastId();
    this.action = castId;
    const hitsTarget = !step.miss && !spec.noTarget;
    const resets = variant?.resetsAttack ?? spec.resetsAttack;
    const isUlt = slot === ULT && !spec.notUltimate;
    const cast: CastInfo = {
      castId,
      slot,
      variant: variantKey,
      hitsTarget,
      isUltimate: isUlt,
      label,
      dash: !!(variant?.dash ?? spec.dash),
      resetsAttack: !!resets,
      castTime,
      recast,
      ...(spec.noSpellblade ? { noSpellblade: true } : {}),
      ...(ectx.distance !== undefined ? { distance: ectx.distance } : {}),
    };
    // A P step is a passive proc, not an ability cast: only the kit's own hooks see it.
    for (const e of this.effects) if (slot !== "P" || e.source === "kit") e.onCast?.(this, cast);

    // Cooldown starts on cast (recastable ultimates start it on the first cast).
    if (slot !== "P") {
      const cdSpell = spell.cooldown?.some((x) => x > 0) ? spell : (this.siblingsOf(spell).find((x) => x.cooldown?.some((y) => y > 0)) ?? spell);
      const cdExpr = variant?.cooldown ?? spec.cooldown;
      const cd = cdExpr !== undefined ? this.evalExpr(cdExpr, ectx) : (cdSpell.cooldown?.[Math.min(rank, (cdSpell.cooldown?.length ?? 1) - 1)] ?? 0) || 0;
      const haste = this.stats.abilityHaste + (isUlt ? this.stats.ultimateHaste : this.stats.basicAbilityHaste);
      const cdAfter = spell.cooldownFixed || spec.attackTimer ? cd : hasteCooldown(cd, haste);
      const recasts = spec.recasts ?? 1;
      const used = (this.recastCount.get(slot) ?? 0) + 1;
      this.counters.set(`lastcast:${slot}`, this.time);
      if (used >= recasts) {
        const firstCast = this.counters.get(`firstcast:${slot}`) ?? this.time;
        this.cooldownReady.set(cdKey, this.cooldownEnd(slot, recasts > 1 ? firstCast : this.time, cdAfter));
        this.recastCount.set(slot, 0);
        this.counters.delete(`firstcast:${slot}`);
      } else {
        if (used === 1) this.counters.set(`firstcast:${slot}`, this.time);
        this.recastCount.set(slot, used);
        const delay = spec.recastDelay !== undefined ? this.evalExpr(spec.recastDelay, ectx) : castTime;
        this.cooldownReady.set(cdKey, this.time + Math.max(castTime, delay));
      }
    }

    // Self buff(s) apply on cast.
    const buffs = variant?.buff ?? spec.buff;
    for (const b of Array.isArray(buffs) ? buffs : buffs ? [buffs] : []) this.applyBuff(b, slot, spell, rank, recast, castTime, ectx.distance);

    const end = start + castTime;
    const lockExpr = variant?.lockout ?? spec.lockout;
    const lockout = lockExpr !== undefined ? this.evalExpr(lockExpr, ectx) : 0;
    this.freeAt = span !== undefined && lockExpr !== undefined ? end + span : Math.max(end, start + lockout);
    if (resets) {
      this.attackReadyAt = this.freeAt;
      this.resetAttackTimerCooldowns(this.freeAt);
    }
    // A cast ended early (R{1s}) ends its lockouts with it.
    const until = (e: Expr) => Math.min(start + this.evalExpr(e, ectx), span !== undefined ? end + span : Infinity);
    const attackLock = variant?.attackLockout ?? spec.attackLockout;
    if (attackLock !== undefined) this.lockAttacks(until(attackLock));
    const castLock = variant?.castLockout ?? spec.castLockout;
    if (castLock !== undefined) {
      const perSlot = typeof castLock === "object" ? castLock : { Q: castLock, W: castLock, E: castLock, R: castLock };
      for (const [s, e] of Object.entries(perSlot) as [Slot, Expr][]) this.lockCasts([s], until(e));
    }
    // As cast: W:ruin for a W in Transcendent State.
    const asCast = variantKey === step.variant || (!step.variant && variantKey === spec.defaultVariant) ? step : { ...step, variant: variantKey };
    timeline.push({
      step: formatCombo([asCast]),
      start,
      end: this.freeAt,
      index: this.stepIndex,
      ...(variantKey ? { variant: variantKey } : {}),
      ...(icon ? { icon } : {}),
    });

    if (!hitsTarget) return;
    const debuff = variant && "debuff" in variant ? (variant.debuff ?? undefined) : spec.debuff;
    const ccs = variant?.cc ?? spec.cc ?? [];
    let landed = 0;
    // Debuffs and crowd control apply with the cast's first landed hit (after its damage unless
    // the debuff says otherwise), or after `afterHits` hits.
    const debuffAt = debuff?.afterHits ?? 1;
    const onHitN = (n: number, phase: "before" | "after") => {
      if (debuff && n === debuffAt && !!debuff.applyBeforeHit === (phase === "before")) this.applyDebuff(debuff, slot, spell, rank, castId, castTime);
      if (phase === "after" && n === 1)
        for (const cc of ccs) {
          const apply = () => this.applyCC(cc.kind, this.evalExpr(cc.duration, ectx), castId, slot);
          const delay = cc.delay !== undefined ? this.evalExpr(cc.delay, ectx) : 0;
          if (delay > 0) this.schedule(delay, apply);
          else apply();
        }
    };
    const landing = new Map<number, (() => void)[]>();
    const hitAt = this.hitsLandingTogether();
    for (const comp of comps) {
      const enabled = step.enable?.includes(comp.id) || !comp.optional;
      // An execute's line shows whether it hits or not (Pyke's R deals its other hit instead).
      if (comp.execute && enabled) this.noteExecuteLine(slot, label, comp.label, this.evalExpr(comp.amount, ectx));
      let hits = step.hits?.[comp.id] ?? (enabled ? this.evalExpr(comp.hits ?? 1, ectx) : 0);
      hits = Math.max(0, Math.round(hits));
      const delay = this.landsAt(comp, ectx);
      const interval = comp.interval !== undefined ? this.evalExpr(comp.interval, ectx) : 0;
      // Ended early: the repeating hits fired by then land, and a hit at its end (Fiddlesticks W's last tick) doesn't.
      const r = repeating.find((x) => x.id === comp.id);
      if (span !== undefined && step.hits?.[comp.id] === undefined) {
        if (r) hits = hitsWithin(r.first, r.interval, r.maxHits, span);
        else if (interval <= 0 && this.firedAt(comp, ectx) > span + 1e-6) hits = 0;
      }
      for (let h = 0; h < hits; h++) {
        const at = end + delay + interval * h;
        const hitIdx = h;
        const hitId = hitAt(at, comp);
        if (!landing.has(at)) landing.set(at, []);
        landing.get(at)!.push(() => {
          const n = ++landed;
          onHitN(n, "before");
          this.dealComponent(comp, {
            slot,
            spell,
            rank,
            castId,
            hitId: hitId(),
            sourceLabel: label,
            hit: hitIdx,
            hits,
            recast,
            castTime,
            distance: ectx.distance,
          });
          onHitN(n, "after");
        });
      }
    }
    for (const [at, together] of landing) this.scheduleAt(at, () => this.landTogether(together));
    if (!comps.length && (debuff || ccs.length))
      this.scheduleAt(end, () => {
        onHitN(1, "before");
        onHitN(1, "after");
      });
  }

  /**
   * Deal a cast's hits that land at the same moment, then what they set off: the on-hit effects they
   * apply and their items', runes' and summoner spells' procs. An ability's parts read as one hit,
   * as an attack's do before its items' on-hits: Smolder's Q, then its Dragon Practice bonus, then
   * Essence Reaver's Spellblade.
   */
  private landTogether(hits: (() => void)[]) {
    const outer = this.setOff;
    const setOff: (() => void)[] = (this.setOff = []);
    for (const hit of hits) hit();
    this.setOff = outer;
    for (const f of setOff) f();
  }

  /** Crowd control on the target: tracked as a debuff and announced to effects (Aftershock, Cheap Shot…). */
  applyCC(kind: "immobilize" | "slow" | "impair", duration: number, castId: number, slot?: Slot) {
    if (!(duration > 0)) return; // conditional CC can evaluate to 0 (e.g. Ryze W root vs slow)
    const id = `cc:${kind}`;
    const prev = this.getDebuff(id);
    const expires = Math.max(prev?.expires ?? 0, this.time + duration);
    // An uninterrupted CC keeps the cast and time that began it (Cheap Shot's same-tick rule).
    this.addDebuff({
      id,
      label: kind === "immobilize" ? "Immobilized" : kind === "slow" ? "Slowed" : "Impaired",
      expires,
      castId: prev ? prev.castId : castId,
      since: prev ? prev.since : this.time,
    });
    for (const e of this.effects) e.onCrowdControl?.(this, { kind, castId, slot, duration });
  }

  /**
   * Target currently has crowd control of these kinds. With `excludeCastId`, CC that this cast
   * applied at this very moment doesn't count (Cheap Shot: not on the same tick as its own CC).
   */
  targetHasCC(kinds: ("immobilize" | "slow" | "impair")[], excludeCastId?: number): boolean {
    return kinds.some((k) => {
      const d = this.getDebuff(`cc:${k}`);
      return !!d && !(excludeCastId !== undefined && d.castId === excludeCastId && Math.abs((d.since ?? -Infinity) - this.time) < 1e-9);
    });
  }

  private ammoState = new Map<Slot, { charges: number; nextAt: number }>();

  /**
   * Charge-based abilities (mMaxAmmo/mAmmoRechargeTime: Rengar, Caitlyn W, Teemo R, Vi E…):
   * returns the charge state when the recharge is what actually limits the ability.
   */
  private ammoFor(slot: Slot, spell: SpellData, rank: number) {
    const src = spell.maxAmmo ? spell : this.spellFor(slot).maxAmmo ? this.spellFor(slot) : null;
    if (!src) return null;
    const at = (v: number[] | number | undefined) => (Array.isArray(v) ? (v[Math.min(rank, v.length - 1)] ?? 0) : (v ?? 0));
    const max = at(src.maxAmmo);
    const base = at(src.ammoRecharge);
    const cd = at(src.cooldown);
    if (!(max >= 1) || !(base > cd + 1e-6) || base > 1000) return null;
    const isUlt = slot === ULT && !this.kit.abilities[slot]?.notUltimate;
    const haste = this.stats.abilityHaste + (isUlt ? this.stats.ultimateHaste : this.stats.basicAbilityHaste);
    const recharge = hasteCooldown(base, haste);
    let state = this.ammoState.get(slot);
    if (!state) this.ammoState.set(slot, (state = { charges: max, nextAt: Infinity }));
    return { max, recharge, state };
  }

  private refreshAmmo(a: { max: number; recharge: number; state: { charges: number; nextAt: number } }, t: number) {
    while (a.state.charges < a.max && t >= a.state.nextAt - 1e-9) {
      a.state.charges++;
      a.state.nextAt = a.state.charges < a.max ? a.state.nextAt + a.recharge : Infinity;
    }
  }

  applyBuff(buff: BuffSpec, slot: Slot, spell: SpellData, rank: number, recast?: number, castTime?: number, distance?: number) {
    const ctx = { slot, spell, rank, recast, castTime, distance };
    const mods: Partial<StatMods> = {};
    for (const [k, v] of Object.entries(buff.stats ?? {})) (mods as any)[k] = this.evalExpr(v as Expr, ctx);
    if (buff.armorPenPercent !== undefined) mods.armorPenPercent = [this.evalExpr(buff.armorPenPercent, ctx)];
    if (buff.magicPenPercent !== undefined) mods.magicPenPercent = [this.evalExpr(buff.magicPenPercent, ctx)];
    if (buff.bonusArmorPenPercent !== undefined) mods.bonusArmorPenPercent = [this.evalExpr(buff.bonusArmorPenPercent, ctx)];
    if (buff.bonusMagicPenPercent !== undefined) mods.bonusMagicPenPercent = [this.evalExpr(buff.bonusMagicPenPercent, ctx)];
    this.addBuff({
      id: buff.id,
      label: buff.label,
      expires: this.time + this.evalExpr(buff.duration, ctx),
      spec: buff,
      slot,
      mods,
      ...(buff.empowerAttacks ? { charges: Math.round(this.evalExpr(buff.empowerAttacks.count, ctx)) } : {}),
      ...(buff.damageAmp !== undefined ? { amp: this.evalExpr(buff.damageAmp, ctx) } : {}),
      ...(distance !== undefined ? { distance } : {}),
    });
    if (buff.empowerAttacks?.resetsAttack) this.resetAttack();
  }

  /** Resets the attack timer: the next attack can start now (once nothing locks attacks out). */
  resetAttack() {
    this.attackReadyAt = Math.min(this.attackReadyAt, this.time);
    this.resetAttackTimerCooldowns(this.time);
  }

  /** An attack reset also resets the cooldowns that are attack timers (AbilitySpec.attackTimer). */
  private resetAttackTimerCooldowns(at: number) {
    for (const slot of ["Q", "W", "E", "R"] as const) {
      const key = `ability:${slot}`;
      if (this.kit.abilities[slot]?.attackTimer && this.cooldownReadyAt(key) > at) this.cooldownReady.set(key, at);
    }
  }

  /** No attack starts before `until` (attack resets don't change that). */
  lockAttacks(until: number) {
    this.attackLockedUntil = Math.max(this.attackLockedUntil, until);
  }

  /** The abilities can't be cast before `until`. */
  lockCasts(slots: Slot[], until: number) {
    for (const s of slots) this.castLockedUntil.set(s, Math.max(this.castLockedUntil.get(s) ?? 0, until));
  }

  applyDebuff(d: DebuffSpec, slot: Slot, spell: SpellData, rank: number, castId?: number, castTime?: number) {
    const ctx = { slot, spell, rank, castTime };
    const prev = this.getDebuff(d.id);
    const max = d.maxStacks !== undefined ? this.evalExpr(d.maxStacks, ctx) : 1;
    const stacks = Math.min(max, (prev?.stacks ?? 0) + 1);
    const per = (e?: Expr) => (e === undefined ? undefined : this.evalExpr(e, ctx) * (d.maxStacks !== undefined ? stacks : 1));
    this.addDebuff({
      id: d.id,
      label: d.label,
      expires: this.time + this.evalExpr(d.duration, ctx),
      stacks,
      spec: d,
      slot,
      armorPct: per(d.armorReduction),
      armorFlat: per(d.armorReductionFlat),
      mrPct: per(d.mrReduction),
      mrFlat: per(d.mrReductionFlat),
      amp: per(d.damageTakenAmp),
      castId,
    });
    if (d.detonate) {
      const det = d.detonate;
      const appliedAt = this.time;
      this.schedule(this.evalExpr(d.duration, ctx), () => {
        const cur = this.debuffs.get(d.id);
        if (!cur || Math.abs(cur.expires - this.time) > 1e-6) return; // refreshed or removed
        this.debuffs.delete(d.id);
        const id = this.newCastId();
        for (const comp of det.components) {
          const amount = this.evalExpr(comp.amount, ctx);
          if (amount > 0)
            this.deal({
              source: slot,
              sourceLabel: det.label ?? d.label,
              label: comp.label,
              type: comp.type,
              amount,
              castId: id,
              flags: componentFlags(comp, slot),
              markSource: d.id,
            });
        }
        if (det.storeFraction !== undefined && (cur.stored ?? 0) > 0) {
          const frac = this.evalExpr(det.storeFraction, ctx);
          this.deal({
            source: slot,
            sourceLabel: det.label ?? d.label,
            label: `${det.label ?? d.label} (stored damage)`,
            type: det.storeType ?? "physical",
            amount: (cur.stored ?? 0) * frac,
            castId: id,
            flags: { kind: "ability", slot, ability: true },
            markSource: d.id,
          });
        }
        void appliedAt;
      });
    }
  }

  /** Attack `count` times; as `ability`, a step that is an attack its buff empowers (AbilitySpec.attack). */
  attack(step: Extract<ComboStep, { type: "attack" }>, timeline: SimResult["timeline"], ability?: AbilityStep) {
    const count = Math.max(1, step.count ?? 1);
    const options = attackOptions(this.kit);
    for (const id of step.enable ?? [])
      if (!options.has(id)) this.warn(`Attacks have no optional hit "${id}" (available: ${[...options].join(", ") || "none"})`);
    for (let i = 0; i < count; i++) {
      const attackFree = () => Math.max(this.freeAt, this.attackReadyAt, this.attackLockedUntil);
      let start = Math.max(this.time, attackFree());
      this.processUntil(start);
      // What happened meanwhile can hold it longer (Jhin's reload after his 4th shot lands).
      while (attackFree() > start + 1e-9) {
        start = attackFree();
        this.processUntil(start);
      }
      const period = 1 / Math.max(0.2, this.stats.attackSpeed);
      const windup = period * windupFraction(this.champ);
      const castId = this.newCastId();
      this.action = castId;
      this.freeAt = start + windup;
      this.attackReadyAt = start + period;
      if (ability) {
        const buffs = this.abilitySpec(ability.slot).buff;
        for (const b of Array.isArray(buffs) ? buffs : buffs ? [buffs] : [])
          this.applyBuff(b, ability.slot, this.spellFor(ability.slot), this.abilityRank(ability.slot));
      }
      const label = ability ? formatCombo([ability]) : step.crit === true ? "AA!" : step.crit === false ? "AA?" : "AA";
      timeline.push({ step: label, start, end: start + windup });
      this.scheduleAt(start + windup, () => this.launchAttack({ castId, enable: step.enable }));
    }
  }

  useActive(effect: Effect, timeline: SimResult["timeline"], stepLabel: string) {
    const active = effect.active!;
    const key = `active:${effect.id}`;
    let start = Math.max(this.time, this.freeAt);
    const ready = this.cooldownReadyAt(key);
    if (ready > start) {
      if (this.settings.waitForCooldowns) start = ready;
      else this.warn(`${active.label} used while on cooldown`);
    }
    this.processUntil(start);
    const castId = this.newCastId();
    this.action = castId;
    const castTime = active.castTime ?? 0;
    this.cooldownReady.set(key, start + active.cooldown);
    this.freeAt = start + castTime;
    timeline.push({ step: stepLabel, start, end: start + castTime });
    active.cast(this, castId);
  }

  // ---------------------------------------------------------------------------

  run(steps: ComboStep[]): SimResult {
    const timeline: SimResult["timeline"] = [];
    const initialStats = this.stats;
    this.combatStart = -(this.opt[IN_COMBAT.key] ?? 0);
    for (const e of this.effects) e.onStart?.(this);
    const startHp = this.target.hp;
    const initialRed = this.targetReductions();

    // An ability whose icon the kit picks (Kayn's by form) shows it on what hooks deal under it too.
    for (const slot of ["P", "Q", "W", "E", "R"] as Slot[]) {
      const spec = this.kit.abilities[slot];
      const icon = spec?.icon && this.castIcon(slot, spec, undefined, this.spellFor(slot, spec));
      if (!icon) continue;
      this.setCastIcon(slot, this.slotName(slot), icon);
      if (slot === "P") this.setCastIcon("P", this.champ.passive.name, icon);
    }
    const keyCasts: KeyCasts[] = [];
    for (const [index, step] of steps.entries()) {
      keyCasts.push(this.keyCasts());
      this.stepIndex = index;
      const skip = this.skipReason(step);
      if (skip) {
        this.warn(`${skip}; step skipped`);
        continue;
      }
      // A crit mark holds only on a step that can crit (Q! on a cast without a crit-capable hit runs as Q).
      const marked = (step.type === "ability" || step.type === "attack") && step.crit !== undefined;
      const crits = marked && rollsCrits(step, this.kit);
      if (marked && !crits && step.crit) this.warn(`${formatCombo([step])} can't crit, so it runs as ${formatCombo([{ ...step, crit: undefined }])}`);
      this.setStepCrit(crits ? step.crit : undefined);
      switch (step.type) {
        case "ability":
          if (this.abilitySpec(step.slot).attack) this.attack({ type: "attack", enable: step.enable, crit: step.crit }, timeline, step);
          else this.castAbility(step, timeline);
          break;
        case "attack":
          this.attack(step, timeline);
          break;
        case "wait": {
          const start = Math.max(this.time, this.freeAt);
          this.processUntil(start + (step.seconds ?? 1));
          this.freeAt = this.time;
          timeline.push({ step: formatCombo([step]), start, end: this.time });
          break;
        }
        case "summoner": {
          const eff = this.effects.find((e) => e.id === "summoner:ignite");
          if (eff?.active) this.useActive(eff, timeline, "ignite");
          break;
        }
        case "energize": {
          // As the next action could start: an attack launched before it isn't Energized.
          const at = Math.max(this.time, this.freeAt);
          this.processUntil(at);
          energize(this);
          timeline.push({ step: "energize", start: at, end: at });
          break;
        }
        case "item": {
          const item = findItem(this.data, step.item);
          this.useActive(this.itemActive(item)!, timeline, `item:${item.name}`);
          break;
        }
      }
    }
    this.setStepCrit(undefined);
    this.action = undefined;
    const comboEnd = Math.max(this.time, this.freeAt);
    this.processUntil(comboEnd);
    keyCasts.push(this.keyCasts());
    // Delayed hits (projectiles, detonations) always land; DoTs continue only with finishDots.
    this.processUntil(comboEnd + (this.settings.finishDots ? 30 : 3));
    let dotDamage = 0;
    let comboDamage = 0;
    let total = 0;
    let raw = 0;
    const byType: Record<DamageType, number> = { physical: 0, magic: 0, true: 0 };
    // By source, then label; in the order they first deal damage.
    const bySourceMap = new Map<string, Map<string, SourceTotal>>();
    const bySource: SourceTotal[] = [];
    for (const e of this.events) {
      const final = e.final ?? 0;
      dotDamage += e.flags.dot ? final : 0;
      comboDamage += e.flags.dot ? 0 : final;
      total += final;
      raw += e.raw;
      byType[e.type] += final;
      let byLabel = bySourceMap.get(e.source);
      if (!byLabel) bySourceMap.set(e.source, (byLabel = new Map()));
      let s = byLabel.get(e.sourceLabel);
      if (!s) {
        s = { source: e.source, label: e.sourceLabel } as SourceTotal;
        if (e.icon) s.icon = e.icon;
        Object.assign(s, { damage: 0, raw: 0, hits: 0, type: {} });
        byLabel.set(e.sourceLabel, s);
        bySource.push(s);
      }
      s.damage += final;
      s.raw += e.raw;
      s.hits++;
      s.type[e.type] = (s.type[e.type] ?? 0) + final;
    }
    const lastDamage = this.events.length ? this.events[this.events.length - 1].time : 0;
    const st = initialStats;
    const effArmor = effectiveResist(
      { base: this.target.baseArmor, bonus: this.target.bonusArmor },
      { flat: initialRed.armorFlat, percent: initialRed.armorPercent },
      { percent: st.armorPenPercent, bonusPercent: st.bonusArmorPenPercent, flat: st.lethality + st.armorPenFlat },
    );
    const effMr = effectiveResist(
      { base: this.target.baseMr, bonus: this.target.bonusMr },
      { flat: initialRed.mrFlat, percent: initialRed.mrPercent },
      { percent: st.magicPenPercent, bonusPercent: st.bonusMagicPenPercent, flat: st.magicPenFlat },
    );
    for (const e of this.effects) for (const l of e.limitations ?? []) this.note(`${e.label}: ${l}`);
    for (const n of this.kit.notes ?? []) this.note(`${this.champ.name}: ${n}`);
    if (this.kit.status === "auto")
      this.note(
        `${this.champ.name}'s kit is auto-generated from tooltips: per-hit numbers come from the game's formulas, but hit counts, conditions and passive interactions may be incomplete.`,
      );

    return {
      patch: this.data.meta.patch,
      champion: { id: this.champ.id, name: this.champ.name, level: this.level, ranks: { ...this.ranks }, kitStatus: this.kit.status },
      items: this.slotted.map((i) => ({ id: i.id, name: i.name, gold: i.gold.total })),
      runes: this.runes.map((r) => ({ id: r.id, name: r.name })),
      gold: this.items.reduce((s, i) => s + i.gold.total, 0),
      combo: formatCombo(steps),
      stats: initialStats,
      target: {
        label: this.target.label,
        ...(this.target.level !== undefined ? { level: this.target.level } : {}),
        maxHp: this.target.maxHp,
        bonusHp: this.target.bonusHp,
        startHp,
        endHp: Math.max(0, this.target.hp),
        armor: this.target.baseArmor + this.target.bonusArmor,
        bonusArmor: this.target.bonusArmor,
        mr: this.target.baseMr + this.target.bonusMr,
        bonusMr: this.target.bonusMr,
        effectiveArmor: effArmor,
        effectiveMr: effMr,
        physicalMultiplier: resistMultiplier(effArmor),
        magicMultiplier: resistMultiplier(effMr),
      },
      totalDamage: total,
      comboDamage,
      dotDamage,
      rawDamage: raw,
      byType,
      bySource: bySource.sort((a, b) => b.damage - a.damage),
      events: this.events,
      timeline,
      keyCasts,
      duration: lastDamage,
      comboTime: comboEnd,
      killed: this.target.killTime !== undefined,
      ...(this.target.killTime !== undefined ? { killTime: this.target.killTime } : {}),
      executeLines: [...this.executeLines.values()],
      percentOfHp: total / startHp,
      dps: lastDamage > 0 ? total / lastDamage : total,
      warnings: this.warnings,
      notes: [...this.notes],
    };
  }
}

// -----------------------------------------------------------------------------

/** Combine damage modifiers: damage-dealt amps add (since 26.9); damage-taken and other multipliers multiply. */
export function combineAmps(amps: DamageInstance["amps"]): number {
  let dealt = 1;
  let mult = 1;
  for (const a of amps) {
    if ((a.kind ?? "dealt") === "dealt") dealt += a.value;
    else mult *= 1 + a.value;
  }
  return Math.max(0, dealt) * mult;
}

/** What kind of damage a source deals, by its id ('item:3165', 'rune:8005', 'summoner:ignite', a slot). */
function sourceKind(id: string): DamageFlags["kind"] {
  const kind = id.split(":")[0];
  return kind === "item" || kind === "rune" || kind === "summoner" ? kind : "ability";
}

/** Damage flags of a kit component's hit. Proc damage is not ability damage: it applies no spell
 *  effects and triggers no runes, marks or detonations (pets' excepted). */
function componentFlags(comp: ComponentSpec, slot: Slot): Partial<DamageFlags> {
  return {
    kind: "ability",
    slot,
    ability: !comp.noProc && !comp.proc && !comp.execute,
    proc: !!comp.proc,
    aoe: !!comp.aoe,
    dot: !!comp.dot,
    pet: !!comp.pet,
    ...(comp.harvest ? { harvest: true } : {}),
    ...(comp.execute ? { execute: true } : {}),
  };
}

function clampInt(v: number, lo: number, hi: number) {
  return Math.min(hi, Math.max(lo, Math.round(v)));
}

/** The mods that are lists (mergeMods adds to a list in place). */
const LIST_MODS = Object.entries(emptyMods()).flatMap(([k, v]) => (Array.isArray(v) ? [k as keyof StatMods] : []));

function cloneMods(m: StatMods): StatMods {
  const out = { ...m } as any;
  for (const k of LIST_MODS) out[k] = [...(m[k] as unknown[])];
  return out;
}

export function isLegendary(item: ItemData): boolean {
  return item.gold.total >= 2000 && !item.into.length && !item.tags.includes("Boots") && !item.tags.includes("Consumable");
}

/** Seconds a missile takes to fly `distance` units: at its speed, or speeding up or slowing down at
 *  its acceleration until it reaches its max or min speed (Aurelion Sol's attacks). */
export function missileTime(m: NonNullable<ChampionData["stats"]["attackMissile"]>, distance: number): number {
  const a = m.acceleration ?? 0;
  const limit = a > 0 ? (m.maxSpeed ?? Infinity) : a < 0 ? (m.minSpeed ?? 0) : m.speed;
  if (!a || !(limit > 0) || limit === m.speed) return distance / m.speed;
  // Accelerating until the speed limit, then at it.
  const accelTime = (limit - m.speed) / a;
  const accelDistance = ((m.speed + limit) / 2) * accelTime;
  if (distance >= accelDistance) return accelTime + (distance - accelDistance) / limit;
  return (-m.speed + Math.sqrt(m.speed * m.speed + 2 * a * distance)) / a;
}

export function windupFraction(champ: ChampionData): number {
  const s = champ.stats;
  if (s.attackCastTime && s.attackTotalTime) return s.attackCastTime / s.attackTotalTime;
  return Math.min(0.9, Math.max(0.05, 0.3 + (s.attackWindupOffset ?? 0)));
}

/** Max rank per slot for this champion (from tooltip level-up lists; R defaults to 3). */
export function maxRanks(champ: ChampionData): Record<"Q" | "W" | "E" | "R", number> {
  const out = { Q: 5, W: 5, E: 5, R: 3 } as Record<"Q" | "W" | "E" | "R", number>;
  for (const ab of champ.abilities) {
    if (ab.slot === "Q" || ab.slot === "W" || ab.slot === "E" || ab.slot === "R") {
      const lc = ab.spells[0]?.levelCount;
      if (lc && lc >= 1 && lc <= 6) out[ab.slot] = lc;
    }
  }
  return out;
}

/**
 * Default ability ranks for a level: ult at 6/11/16, one point in each basic by level 3,
 * then max in skillOrder (default Q > W > E). `extraPoints`: skill points beyond one per level
 * (Triple Tonic's Elixir of Skill), still limited by the level requirements of each rank.
 */
export function resolveRanks(champ: ChampionData, level: number, given: Scenario["ranks"], skillOrder = "QWE", extraPoints = 0): Record<Slot, number> {
  const max = maxRanks(champ);
  const ultLevels = max.R >= 4 ? [1, 6, 11, 16] : [6, 11, 16];
  const r = ultLevels.filter((l) => level >= l).length;
  const ranks: Record<Slot, number> = { P: 1, Q: 0, W: 0, E: 0, R: Math.min(r, max.R) };
  let points = level - ranks.R + extraPoints;
  const order = (skillOrder.toUpperCase().replace(/[^QWE]/g, "") + "QWE").split("").filter((c, i, a) => a.indexOf(c) === i) as ("Q" | "W" | "E")[];
  // One point in each basic ability first (in max order), then max in order.
  for (const s of order) {
    if (points <= 0) break;
    ranks[s] = 1;
    points--;
  }
  for (const s of order) {
    // A basic ability can be ranked to at most ceil(level/2).
    while (points > 0 && ranks[s] < max[s] && ranks[s] < Math.ceil(level / 2)) {
      ranks[s]++;
      points--;
    }
  }
  for (const s of order) {
    while (points > 0 && ranks[s] < max[s]) {
      ranks[s]++;
      points--;
    }
  }
  for (const [k, v] of Object.entries(given ?? {})) if (v !== undefined) ranks[k as Slot] = Math.max(0, Math.min(v, max[k as "Q"] ?? 5));
  return ranks;
}

interface BaseBonus {
  base: number;
  bonus: number;
}

/** A stat after the scenario's numbers (see TargetSpec): `hasBase` = from a champion or preset. */
function overrideStat(cur: BaseBonus, hasBase: boolean, total?: number, bonus?: number): BaseBonus {
  if (total !== undefined) {
    if (bonus !== undefined) {
      const b = Math.max(0, Math.min(bonus, total));
      return { base: total - b, bonus: b };
    }
    const base = hasBase ? Math.min(cur.base, total) : total;
    return { base, bonus: total - base };
  }
  return bonus !== undefined ? { base: cur.base, bonus } : cur;
}

function resolveTarget(data: GameData, spec: TargetSpec, attackerLevel: number): Sim["target"] {
  let hp: BaseBonus = { base: 2000, bonus: 0 };
  let armor: BaseBonus = { base: 80, bonus: 0 };
  let mr: BaseBonus = { base: 50, bonus: 0 };
  let label = spec.label;
  const lvl = clampInt(spec.level ?? attackerLevel + (spec.levelDiff ?? 0), 1, GAME.maxLevel);
  let level: number | undefined;
  const hasBase = !!(spec.champion || spec.preset);
  if (hasBase) {
    const items = spec.items?.map((q) => findItem(data, q));
    let st: Stats;
    if (spec.champion) {
      const c = findChampion(data, spec.champion);
      const mods = emptyMods();
      for (const it of items ?? []) mergeMods(mods, itemStatsToMods(it.stats));
      st = computeStats({ base: c.stats, level: lvl, adaptiveDefault: c.adaptive, ranged: c.attackType === "ranged" }, mods);
      label ??= `${c.name} lvl ${lvl}${items?.length ? ` (${items.map((i) => i.name).join(", ")})` : ""}`;
    } else {
      const p = resolvePreset(data, spec.preset!, lvl, items);
      const mods = emptyMods();
      for (const it of p.items) mergeMods(mods, itemStatsToMods(it.stats));
      mods.hp += p.shardHp;
      st = computeStats({ base: p.base, level: lvl, adaptiveDefault: "physical", ranged: false }, mods);
      label ??= p.label;
    }
    level = lvl;
    hp = { base: st.baseHp, bonus: st.maxHp - st.baseHp };
    armor = { base: st.baseArmor, bonus: st.bonusArmor };
    mr = { base: st.baseMr, bonus: st.bonusMr };
  }
  hp = overrideStat(hp, hasBase, spec.maxHp, spec.bonusHp);
  armor = overrideStat(armor, hasBase, spec.armor, spec.bonusArmor);
  mr = overrideStat(mr, hasBase, spec.mr, spec.bonusMr);
  const maxHp = hp.base + hp.bonus;
  const current = spec.hp ?? (maxHp * (spec.hpPercent ?? 100)) / 100;
  label ??= `${Math.round(maxHp)} HP / ${Math.round(armor.base + armor.bonus)} armor / ${Math.round(mr.base + mr.bonus)} MR`;
  return {
    label,
    ...(level !== undefined ? { level } : {}),
    maxHp,
    hp: current,
    startHp: current,
    baseHp: hp.base,
    bonusHp: hp.bonus,
    baseArmor: armor.base,
    bonusArmor: armor.bonus,
    baseMr: mr.base,
    bonusMr: mr.bonus,
    damageReduction: spec.damageReduction ?? 0,
  };
}

export function simulate(data: GameData, scenario: Scenario): SimResult {
  const sim = new Sim(data, scenario);
  const steps = typeof scenario.combo === "string" ? parseCombo(scenario.combo) : scenario.combo;
  return sim.run(steps);
}

export { GAME };
