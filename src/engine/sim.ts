// The combat simulator: one attacker, one target, a sequence of combo steps on a timeline.

import type { ChampionData, ItemData, RuneData, SpellData, CalcNode } from './data-types.ts';
import type { GameData } from './gamedata.ts';
import { findChampion, findItem, findRune } from './gamedata.ts';
import { evalCalcNode, STAT, type CalcEnv } from './calc.ts';
import { compile, type Resolver } from './expr.ts';
import { computeStats, emptyMods, hasteCooldown, itemStatsToMods, mergeMods, type Stats, type StatMods, GAME } from './stats.ts';
import { effectiveResist, resistMultiplier, type DamageType } from './damage.ts';
import type { AbilitySpec, BuffSpec, ChampionKit, ComponentSpec, DebuffSpec, Expr, MarkSpec, VariantSpec } from './kit-types.ts';
import { addOnHitRepeat, IN_COMBAT, selfHp, type AttackInfo, type CastInfo, type DamageFlags, type DamageInstance, type DamageRequest, type Effect, type SetupCtx, type Slot } from './effects.ts';
import { parseCombo, formatCombo, type ComboStep, type CritMode } from './combo.ts';
import { getKit } from '../kits/index.ts';
import { createItemEffect, ITEM_GROUPS } from './items.ts';
import { bonusSkillPoints, createRuneEffects } from './runes.ts';
import { runePageProblems } from './rune-page.ts';
import { createSummonerEffect } from './summoners.ts';
import { resolvePreset, type TargetPreset } from './presets.ts';

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
  /** Wait for an ability's cooldown when it's used again (default true); otherwise cast anyway. */
  waitForCooldowns?: boolean;
}

export interface Scenario {
  champion: string;
  level?: number;
  ranks?: Partial<Record<'Q' | 'W' | 'E' | 'R', number>>;
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
 * cast time (AbilitySpec.variableDuration), the seconds it's held to charge (charge), or how many of
 * its repeating hits it fires (variableCount). By default `value`, at most `max`.
 */
export interface CastSetting {
  kind: 'lasts' | 'held' | 'count';
  value: number;
  max: number;
  /** "s", or what the hits are called ("shots"). */
  unit: string;
}

/** How many hits, `first` seconds in and `interval` apart, land within `seconds` (at most `maxHits`). */
const hitsWithin = (first: number, interval: number, maxHits: number, seconds: number) =>
  seconds + 1e-6 < first ? 0 : Math.min(maxHits, Math.floor((seconds - first) / interval + 1e-6) + 1);

type CastCtx = { slot: Slot; spell: SpellData; rank: number; recast?: number };

export interface SourceTotal {
  source: string;
  label: string;
  damage: number;
  raw: number;
  hits: number;
  type: Partial<Record<DamageType, number>>;
}

export interface SimResult {
  patch: string;
  champion: { id: string; name: string; level: number; ranks: Record<string, number>; kitStatus: ChampionKit['status'] };
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
  timeline: { step: string; start: number; end: number; note?: string }[];
  /** Seconds from first action to last damage. */
  duration: number;
  /** Seconds the combo's actions take (cast/attack windups). */
  comboTime: number;
  killed: boolean;
  killTime?: number;
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

const ULT: Slot = 'R';

export class Sim {
  readonly data: GameData;
  readonly champ: ChampionData;
  readonly kit: ChampionKit;
  readonly level: number;
  readonly ranks: Record<Slot, number>;
  readonly opt: Record<string, number>;
  readonly settings: Required<SimSettings>;
  readonly items: ItemData[];
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
  private nextCastId = 1;
  private nextInstId = 1;
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
  attackReadyAt = 0;
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
      waitForCooldowns: scenario.settings?.waitForCooldowns ?? true,
    };
    this.runes = (scenario.runes ?? []).map((q) => findRune(data, q));
    for (const p of runePageProblems(data, this.runes)) this.warn(p);
    this.ranks = resolveRanks(this.champ, this.level, scenario.ranks, scenario.skillOrder, bonusSkillPoints(this.runes, this.level));

    // Options: kit defaults, then effect defaults, then user values.
    this.opt = {};
    for (const o of this.kit.options ?? []) this.opt[o.key] = o.default;

    this.items = (scenario.items ?? []).map((q) => findItem(data, q));
    if (this.items.length > 6) this.warn(`${this.items.length} items: a champion can hold 6`);
    for (const [group, ids] of Object.entries(ITEM_GROUPS)) {
      const owned = this.items.filter((i) => ids.includes(i.id));
      if (owned.length > 1) this.warn(`only one ${group} item can be owned (${owned.map((i) => i.name).join(', ')}); the game won't allow this build`);
    }
    if (this.items.filter((i) => i.tags.includes('Boots')).length > 1) this.warn('more than one pair of boots');
    const legendaryCount = this.items.filter((i) => isLegendary(i)).length;
    const setup: SetupCtx = { level: this.level, ranged: this.champ.attackType === 'ranged', opt: this.opt, champion: this.champ.id, legendaryCount };

    // Effects: kit hooks, items, runes, summoners.
    if (this.kit.hooks) this.effects.push({ id: 'kit', label: this.champ.name, source: 'kit', ...this.kit.hooks });
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
    this.effects.push(createSummonerEffect('ignite', setup));
    for (const e of this.effects) for (const o of e.options ?? []) if (!(o.key in this.opt)) this.opt[o.key] = o.default;
    for (const [k, v] of Object.entries(scenario.options ?? {})) this.opt[k] = typeof v === 'boolean' ? (v ? 1 : 0) : v;

    // Static stats.
    this.staticMods = emptyMods();
    for (const item of this.items) mergeMods(this.staticMods, itemStatsToMods(item.stats));
    for (const e of this.effects) {
      const m = e.stats?.(setup);
      if (m) mergeMods(this.staticMods, m);
    }
    if (this.kit.stats) {
      const m = this.kit.stats({ level: this.level, opt: this.opt, ranks: this.ranks, evalExpr: (e, slot) => this.evalExpr(e, { slot: (slot as Slot) ?? 'P' }) });
      if (m) mergeMods(this.staticMods, m);
    }
    // evalExpr above may have cached stats computed before these mods were merged.
    this.invalidateStats();

    this.target = resolveTarget(data, scenario.target ?? {}, this.level);
  }

  // ---------------------------------------------------------------------------
  // Stats

  private computingStats = false;

  get stats(): Stats {
    if (!this.statsCache) {
      if (this.computingStats) {
        // Re-entered from a dynamicStats hook (e.g. it evaluates an expression): answer with the
        // static stats so hooks can read stats without recursing.
        return computeStats({ base: this.champ.stats, level: this.level, adaptiveDefault: this.champ.adaptive, ranged: this.champ.attackType === 'ranged' }, this.staticMods, selfHp(this.opt));
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
      const mods = structuredCloneMods(this.staticMods);
      for (const e of this.effects) {
        const m = e.dynamicStats?.(this);
        if (m) mergeMods(mods, m);
      }
      for (const b of this.buffs.values()) {
        if (b.expires < this.time) continue;
        if (b.mods) mergeMods(mods, b.mods);
      }
      const st = computeStats(
        { base: this.champ.stats, level: this.level, adaptiveDefault: this.champ.adaptive, ranged: this.champ.attackType === 'ranged' },
        mods,
        selfHp(this.opt),
      );
      // Kits with a fixed attack speed (Jhin) report it in the stats too.
      if (this.kit.attack?.attackSpeed !== undefined) st.attackSpeed = this.evalExpr(this.kit.attack.attackSpeed, { slot: 'P' });
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
    const n = name.toLowerCase();
    for (const ab of this.champ.abilities)
      for (const s of ab.spells) if (s.scriptName.toLowerCase() === n || s.path.toLowerCase() === n || s.path.toLowerCase().endsWith('/' + n)) return s;
    return undefined;
  }

  slotOfSpell(spell: SpellData): Slot {
    for (const ab of this.champ.abilities) if (ab.spells.includes(spell)) return ab.slot === 'X' ? 'P' : (ab.slot as Slot);
    return 'P';
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
      for (const s of this.siblingsOf(spell))
        for (const [k, v] of Object.entries(s.dataValues)) if (k.toLowerCase() === lower) arr = v;
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
      const ranged = this.champ.attackType === 'ranged';
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
    if (map?.[buff] !== undefined) return this.evalExpr(map[buff], { slot: 'P' });
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
  evalExpr(e: Expr, ctx: { slot: Slot; spell?: SpellData; rank?: number; hit?: number; hits?: number; recast?: number }): number {
    if (typeof e === 'number') return e;
    const spell = ctx.spell ?? this.spellFor(ctx.slot);
    const rank = ctx.rank ?? this.abilityRank(ctx.slot);
    const resolve: Resolver = (path) => this.resolvePath(path, { ...ctx, spell, rank });
    try {
      return compile(e)(resolve);
    } catch (err) {
      this.warn(`expression error in "${e}": ${(err as Error).message}`);
      return 0;
    }
  }

  abilityRank(slot: Slot): number {
    if (slot === 'P') {
      const r = this.kit.abilities.P;
      if (r?.rank !== undefined) return Math.max(1, Math.round(this.evalExpr(r.rank, { slot: 'Q', rank: 1 })));
      return 1;
    }
    return this.rankOf(slot);
  }

  private resolvePath(path: string[], ctx: { slot: Slot; spell: SpellData; rank: number; hit?: number; hits?: number; recast?: number }): number {
    const [h, ...rest] = path;
    const st = this.stats;
    const t = this.target;
    const sub = (spell: SpellData, rank: number, p: string[]): number => {
      switch (p[0]) {
        case 'calc':
          return this.calc(spell, p[1], rank);
        case 'dv':
          return this.dataValue(spell, p[1], rank);
        case 'rank':
          return rank;
        case 'cooldown':
          return spell.cooldown?.[Math.min(rank, (spell.cooldown?.length ?? 1) - 1)] ?? 0;
        default:
          throw new Error(`unknown name ${p.join('.')}`);
      }
    };
    switch (h) {
      case 'calc':
      case 'dv':
      case 'cooldown':
        return sub(ctx.spell, ctx.rank, path);
      case 'rank':
        return ctx.rank;
      case 'P':
      case 'Q':
      case 'W':
      case 'E':
      case 'R': {
        const slot = h as Slot;
        const rank = this.abilityRank(slot);
        if (rest[0] === 'rank') return rank;
        return sub(this.spellFor(slot), rank, rest);
      }
      case 'spell': {
        const s = this.findSpell(rest[0]);
        if (!s) throw new Error(`unknown spell ${rest[0]}`);
        // Unslotted spells (other forms: Elise spider, Gnar mega…) use the rank of the slot
        // whose expression references them.
        const unslotted = this.champ.abilities.find((a) => a.spells.includes(s))?.slot === 'X';
        return sub(s, unslotted ? ctx.rank : this.abilityRank(this.slotOfSpell(s)), rest.slice(1));
      }
      case 'target': {
        const hp = Math.max(0, t.hp);
        switch (rest[0]) {
          case 'maxHp':
            return t.maxHp;
          case 'hp':
            return hp;
          case 'missingHp':
            return t.maxHp - hp;
          case 'hpPct':
            return hp / t.maxHp;
          case 'missingHpPct':
            return 1 - hp / t.maxHp;
          case 'bonusHp':
            return t.bonusHp;
          case 'baseHp':
            return t.baseHp;
          case 'armor':
            return t.baseArmor + t.bonusArmor;
          case 'bonusArmor':
            return t.bonusArmor;
          case 'mr':
            return t.baseMr + t.bonusMr;
          case 'bonusMr':
            return t.bonusMr;
          case 'immobilized':
            return this.targetHasCC(['immobilize']) ? 1 : 0;
          case 'slowed':
            return this.targetHasCC(['slow']) ? 1 : 0;
          case 'impaired':
            return this.targetHasCC(['impair']) ? 1 : 0;
          case 'cced':
            return this.targetHasCC(['immobilize', 'slow', 'impair']) ? 1 : 0;
        }
        throw new Error(`unknown target.${rest[0]}`);
      }
      case 'opt':
        return this.opt[rest[0]] ?? 0;
      case 'stacks':
        return this.markStacks(rest[0]) ?? this.counters.get(rest[0]) ?? 0;
      case 'buff': {
        const b = this.getBuff(rest[0]);
        return b ? b.stacks || 1 : 0;
      }
      case 'debuff': {
        const d = this.getDebuff(rest[0]);
        return d ? d.stacks || 1 : 0;
      }
      case 'recast':
        return ctx.recast ?? 1;
      case 'charge':
        return this.chargeHeld.get(ctx.slot) ?? this.defaultCharge(ctx.slot);
      case 'hit':
        return ctx.hit ?? 0;
      case 'hits':
        return ctx.hits ?? 1;
      case 'time':
        return this.time;
      case 'combatTime':
        return this.time - this.combatStart;
      case 'level':
        return this.level;
      case 'ad':
        return st.ad;
      case 'bonusAd':
        return st.bonusAd;
      case 'baseAd':
        return st.baseAd;
      case 'ap':
        return st.ap;
      case 'maxHp':
        return st.maxHp;
      case 'bonusHp':
        return st.bonusHp;
      case 'baseHp':
        return st.baseHp;
      case 'hp':
        return st.hp;
      case 'armor':
        return st.armor;
      case 'bonusArmor':
        return st.bonusArmor;
      case 'mr':
        return st.mr;
      case 'bonusMr':
        return st.bonusMr;
      case 'as':
        return st.attackSpeed;
      case 'bonusAs':
        return st.bonusAttackSpeed;
      case 'critChance':
        return st.critChance;
      case 'critDamage':
        return st.critDamage;
      case 'lethality':
        return st.lethality;
      case 'ms':
        return st.moveSpeed;
      case 'bonusMs':
        return st.bonusMoveSpeed;
      case 'mana':
        return st.maxMana;
      case 'bonusMana':
        return st.bonusMana;
      case 'range':
        return st.range;
      case 'ah':
        return st.abilityHaste;
      case 'ranged':
        return st.ranged ? 1 : 0;
    }
    throw new Error(`unknown name "${path.join('.')}"`);
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

  addBuff(b: Omit<ActiveBuff, 'stacks'> & { stacks?: number }) {
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

  addDebuff(d: Omit<ActiveDebuff, 'stacks'> & { stacks?: number }) {
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
    if (slot !== 'Q' && slot !== 'W' && slot !== 'E') return from + seconds;
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
    const running = (['Q', 'W', 'E'] as const).map((slot) => ({ slot, left: this.cooldownReadyAt(`ability:${slot}`) - this.time }));
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

  // ---------------------------------------------------------------------------
  // Scheduling

  schedule(delay: number, run: () => void) {
    this.scheduleAt(this.time + Math.max(0, delay), run);
  }

  scheduleAt(time: number, run: () => void) {
    this.queue.push({ time: Math.max(this.time, time), seq: this.seq++, run, crit: this.stepCrit, action: this.action });
    this.queue.sort((a, b) => a.time - b.time || a.seq - b.seq);
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
    return this.stepCrit === true ? 'always' : this.stepCrit === false ? 'never' : 'expected';
  }

  private advanceTo(t: number) {
    if (t > this.time) {
      this.time = t;
      this.invalidateStats();
    }
  }

  // ---------------------------------------------------------------------------
  // Damage

  /** Deal one damage request: amps, mitigation, HP update, hooks. */
  deal(req: DamageRequest): DamageInstance {
    const st = this.stats;
    let type: DamageType = req.type === 'adaptive' ? (st.adaptiveType === 'physical' ? 'physical' : 'magic') : req.type;
    const flags: DamageFlags = {
      kind: 'ability',
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

    for (const e of this.effects) e.beforeDamage?.(this, inst);
    for (const b of this.buffs.values()) if (b.expires >= this.time && b.amp) inst.amps.push({ id: b.slot, source: b.label, value: b.amp, kind: 'dealt' });
    for (const d of this.debuffs.values()) if (d.expires >= this.time && d.amp) inst.amps.push({ id: d.slot, source: d.label, value: d.amp, kind: 'taken' });
    if (inst.flags.unamplified) inst.amps = inst.amps.filter((a) => a.kind === 'taken');
    type = inst.type;

    // Mitigation.
    let resistMult = 1;
    let eff = 0;
    if (type !== 'true') {
      const red = this.targetReductions();
      const s = this.stats;
      if (type === 'physical') {
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
    const final = inst.raw * resistMult * ampMult * (1 - this.target.damageReduction);
    inst.effectiveResist = eff;
    inst.resistMult = resistMult;
    inst.ampMult = ampMult;
    inst.final = final;
    inst.targetHpBefore = this.target.hp;
    this.target.hp -= final;
    inst.targetHpAfter = this.target.hp;
    if (this.target.hp <= 0 && this.target.killTime === undefined) this.target.killTime = this.time;
    if (!inst.flags.aura) this.lastCombatTime = this.time;
    this.events.push(inst);
    for (const d of this.debuffs.values()) if (d.spec?.detonate && d.expires >= this.time && !inst.fromMark) d.stored = (d.stored ?? 0) + final;

    for (const e of this.effects) e.afterDamage?.(this, inst);
    if (!inst.fromMark) {
      this.processConsumes(inst);
      this.processMarks(inst);
    }
    return inst;
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
    if (inst.flags.kind !== 'ability' && inst.flags.kind !== 'attack') return false;
    for (const a of spec.appliedBy) {
      if (a === 'attack' && inst.flags.attack) return true;
      if (a === 'onhit' && (inst.flags.attack || (inst.flags.onHit && inst.flags.kind === 'ability'))) return true;
      if (a === 'ability' && inst.flags.kind === 'ability' && !inst.flags.attack && inst.flags.slot && inst.flags.slot !== 'P') return true;
      if (a === inst.flags.slot && inst.flags.kind === 'ability' && !inst.flags.attack) return true;
    }
    return false;
  }

  /** Deal a mark's components as part of cast instance `castId` (a new one if omitted). */
  private dealMarkComponents(spec: MarkSpec, comps: ComponentSpec[], label: string, castId = this.newCastId()) {
    const slot = spec.slot ?? 'P';
    const spell = this.spellFor(slot);
    const rank = this.abilityRank(slot);
    for (const comp of comps) {
      const hits = Math.max(0, Math.round(this.evalExpr(comp.hits ?? 1, { slot, spell, rank })));
      const delay0 = comp.delay !== undefined ? this.evalExpr(comp.delay, { slot, spell, rank }) : 0;
      const interval = comp.interval !== undefined ? this.evalExpr(comp.interval, { slot, spell, rank }) : 0;
      for (let h = 0; h < hits; h++) {
        const run = () => {
        let amount = this.evalExpr(comp.amount, { slot, spell, rank, hit: h, hits });
        if (comp.min !== undefined) amount = Math.max(amount, this.evalExpr(comp.min, { slot, spell, rank }));
        if (comp.max !== undefined) amount = Math.min(amount, this.evalExpr(comp.max, { slot, spell, rank }));
        if (!(amount > 0)) return;
        const inst = this.deal({
          source: slot,
          sourceLabel: label,
          label: comp.label,
          type: comp.type,
          amount,
          castId,
          flags: componentFlags(comp, slot),
          markSource: spec.id,
        });
        void inst;
        };
        const at = delay0 + interval * h;
        if (at > 0) this.schedule(at, run);
        else run();
      }
    }
  }

  private processMarks(inst: DamageInstance) {
    for (const spec of this.kit.marks ?? []) {
      if (!this.markQualifies(spec, inst)) continue;
      const slot = spec.slot ?? 'P';
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
      const isAbility = inst.flags.kind === 'ability' && !inst.flags.attack && !!inst.flags.slot && inst.flags.slot !== 'P';
      const by = Array.isArray(c.by) ? c.by : [c.by];
      const ok = by.some((b) => (b === 'attack' && isAttack) || (b === 'ability' && isAbility) || (b === 'any' && (isAttack || isAbility)) || (b === inst.flags.slot && isAbility));
      if (!ok) continue;
      this.debuffs.delete(d.id);
      const slot = c.slot ?? d.slot ?? 'P';
      const spell = this.spellFor(slot);
      const rank = this.abilityRank(slot);
      const castId = this.newCastId();
      for (const comp of c.components) {
        const amount = this.evalExpr(comp.amount, { slot, spell, rank });
        this.deal({ source: slot, sourceLabel: comp.source ?? d.label, label: comp.label, type: comp.type, amount, castId, flags: componentFlags(comp, slot), markSource: d.id });
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
      const slot = spec.slot ?? 'P';
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
    if (mode === 'always') return { crit: true, factor: st.critDamage };
    if (mode === 'never') return { crit: false, factor: 1 };
    // Expected value.
    const factor = 1 + st.critChance * (st.critDamage - 1);
    return { crit: st.critChance >= 1, factor };
  }

  // ---------------------------------------------------------------------------
  // Components (ability hits)

  private dealComponent(comp: ComponentSpec, ctx: { slot: Slot; spell: SpellData; rank: number; castId: number; sourceLabel: string; hit: number; hits: number; recast?: number }) {
    const ectx = { slot: ctx.slot, spell: ctx.spell, rank: ctx.rank, hit: ctx.hit, hits: ctx.hits, recast: ctx.recast };
    let amount = this.evalExpr(comp.amount, ectx);
    if (comp.min !== undefined) amount = Math.max(amount, this.evalExpr(comp.min, ectx));
    if (comp.max !== undefined) amount = Math.min(amount, this.evalExpr(comp.max, ectx));
    const source = ctx.slot === 'P' ? 'P' : ctx.slot;

    if (!comp.attack && !comp.onHit && !(amount > 0)) return; // conditional components that evaluate to 0 deal nothing
    if (comp.attack) {
      // Each hit of a multi-hit attack component is its own attack (Urgot W, Akshan E…) unless sameCast: true.
      const own = comp.sameCast === false || (comp.sameCast !== true && ctx.hits > 1);
      this.performAttackHit({ castId: own ? this.newCastId() : ctx.castId, amount, comp, label: comp.label, sourceLabel: ctx.sourceLabel, fromAbility: ctx.slot });
      return;
    }
    let crit = false;
    if (comp.canCrit) {
      const c = this.critFactor();
      const mult = comp.critMultiplier !== undefined ? this.evalExpr(comp.critMultiplier, ectx) : this.stats.critDamage;
      const factor = c.crit ? mult : this.critMode() === 'expected' ? 1 + this.stats.critChance * (mult - 1) : 1;
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
      ...(comp.penPercent !== undefined ? { penPercent: this.evalExpr(comp.penPercent, ectx) } : {}),
      // Abilities that apply on-hit (Ezreal Q, Fizz Q) count as on-hit for marks like Fizz W.
      flags: { ...componentFlags(comp, ctx.slot), onHit: !!comp.onHit, crit },
      ...(comp.note ? { note: comp.note } : {}),
    });
    if (comp.onHit) {
      // Ability that applies on-hit effects (no base attack damage).
      this.performAttackHit({ castId: ctx.castId, amount: 0, comp: { ...comp, attack: true }, label: comp.label, sourceLabel: ctx.sourceLabel, fromAbility: ctx.slot, onHitOnly: true });
    }
  }

  // ---------------------------------------------------------------------------
  // Basic attacks

  /** Resolve a basic attack (or an attack-like ability hit) landing on the target. */
  performAttackHit(o: {
    castId: number;
    amount?: number;
    comp?: ComponentSpec;
    label?: string;
    sourceLabel?: string;
    fromAbility?: Slot;
    onHitOnly?: boolean;
    /** Optional components enabled for this attack (combo "AA+bounce"). */
    enable?: string[];
  }) {
    const st = this.stats;
    const canCrit = this.kit.attack?.canCrit !== false && (o.comp ? o.comp.canCrit !== false : true);
    const c = canCrit ? this.critFactor() : { crit: false, factor: 1 };
    const expected = this.critMode() === 'expected';
    let critMult = st.critDamage;
    if (canCrit && this.kit.attack?.critMultiplier !== undefined && !o.fromAbility) critMult = this.evalExpr(this.kit.attack.critMultiplier, { slot: 'P' });
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
      onAttack: !o.fromAbility || !!o.comp?.onAttack,
      ...(o.comp?.areaOnHit ? { areaOnHit: true } : {}),
    };

    // Champion passive on-hits, every-Nth procs and empowered attacks from buffs.
    const kitAtk = this.kit.attack;
    const pushCompsTo = (target: AttackInfo, comps: ComponentSpec[], sourceLabel: string, slot: Slot = 'P') => {
      for (const comp of comps) {
        if (comp.optional && !o.enable?.includes(comp.id)) continue;
        const spell = this.spellFor(slot);
        const rank = this.abilityRank(slot);
        const hits = Math.max(0, Math.round(this.evalExpr(comp.hits ?? 1, { slot, spell, rank })));
        for (let h = 0; h < hits; h++) {
          let amount = this.evalExpr(comp.amount, { slot, spell, rank, hit: h, hits });
          if (comp.min !== undefined) amount = Math.max(amount, this.evalExpr(comp.min, { slot, spell, rank }));
          if (comp.max !== undefined) amount = Math.min(amount, this.evalExpr(comp.max, { slot, spell, rank }));
          if (comp.canCrit) {
            if (comp.critMultiplier !== undefined) {
              const m = this.evalExpr(comp.critMultiplier, { slot, spell, rank });
              amount *= c.crit ? m : expected ? 1 + this.stats.critChance * (m - 1) : 1;
            } else amount *= factor;
          }
          if (!(amount > 0)) continue;
          const flags = componentFlags(comp, slot);
          const req: DamageRequest = {
            source: slot,
            sourceLabel: comp.source ?? sourceLabel,
            label: comp.label,
            type: comp.type,
            amount,
            castId: o.castId,
            // Empowered-attack damage from an ability counts as ability damage; passive on-hits don't.
            flags: { ...flags, onHit: true, ability: slot !== 'P' && flags.ability, crit: !!comp.canCrit && c.crit },
          };
          // Delayed / periodic parts of an empowered attack (bleeds, lightning) land later.
          const delay = (comp.delay !== undefined ? this.evalExpr(comp.delay, { slot, spell, rank }) : 0) + (comp.interval !== undefined ? this.evalExpr(comp.interval, { slot, spell, rank }) * h : 0);
          if (delay > 0) this.schedule(delay, () => this.deal(req));
          else target.extra.push(req);
        }
      }
    };
    const pushComps = (comps: ComponentSpec[], sourceLabel: string, slot: Slot = 'P') => pushCompsTo(atk, comps, sourceLabel, slot);
    const pendingCC: (() => void)[] = [];
    let empoweredEff: number | undefined;
    if (!o.onHitOnly || o.fromAbility) {
      if (kitAtk?.onHit && !o.fromAbility) pushComps(kitAtk.onHit, this.champ.passive.name);
      if (kitAtk?.everyNth && !o.fromAbility) {
        const key = 'kit.nth';
        const n = this.counter(key) + 1;
        if (n >= kitAtk.everyNth.n) {
          this.setCounter(key, 0);
          pushComps(kitAtk.everyNth.components, kitAtk.everyNth.label);
        } else this.setCounter(key, n);
      }
      for (const b of [...this.buffs.values()]) {
        if (b.expires < this.time || !b.spec) continue;
        if (b.spec.onHit) pushComps(b.spec.onHit, b.label, b.slot);
        if (b.spec.empowerAttacks && (b.charges ?? 0) > 0 && !o.fromAbility) {
          const before = atk.extra.length;
          pushComps(b.spec.empowerAttacks.components, b.label, b.slot);
          if (b.spec.empowerAttacks.onHitRepeats !== undefined) {
            const n = Math.round(this.evalExpr(b.spec.empowerAttacks.onHitRepeats, { slot: b.slot ?? 'P' }));
            if (n > 0) addOnHitRepeat(atk, n);
          }
          if (b.spec.empowerAttacks.replaceBase) {
            atk.replaceBase = true;
            // The first empowered component *is* the basic attack (counts for attack-based effects).
            const first = atk.extra[before];
            if (first) first.flags = { ...first.flags, attack: true, onHit: false };
          }
          const effComp = b.spec.empowerAttacks.components.find((x) => x.onHitEffectiveness !== undefined);
          if (effComp) empoweredEff = this.evalExpr(effComp.onHitEffectiveness!, { slot: b.slot ?? 'P' });
          for (const cc of b.spec.empowerAttacks.cc ?? []) {
            const dur = this.evalExpr(cc.duration, { slot: b.slot ?? 'P' });
            const delay = cc.delay !== undefined ? this.evalExpr(cc.delay, { slot: b.slot ?? 'P' }) : 0;
            const slotB = b.slot;
            pendingCC.push(() => (delay > 0 ? this.schedule(delay, () => this.applyCC(cc.kind, dur, o.castId, slotB)) : this.applyCC(cc.kind, dur, o.castId, slotB)));
          }
          b.charges = (b.charges ?? 1) - 1;
          if (b.charges <= 0) this.removeBuff(b.id);
        }
      }
    }

    for (const e of this.effects) e.preAttack?.(this, atk);
    if (atk.forcedCrit) {
      // Guaranteed crits (Sundered Sky, Fiendhunter Bolts): the natural roll picks the modifier.
      const f = atk.forcedCrit;
      atk.critFactor = atk.critMultiplier * (atk.naturalCrit * f.naturalModifier + (1 - atk.naturalCrit) * f.modifier);
      atk.crit = true;
    }
    for (const e of this.effects) e.onAttack?.(this, atk);
    const repeats = Math.max(0, Math.round(atk.repeatOnHit ?? 0));
    for (let i = 0; i < repeats; i++) {
      // Extra application of on-hit effects (no base damage, no passive every-Nth counting).
      const again: AttackInfo = { ...atk, extra: [], phantom: true, repeatOnHit: 0 };
      if (kitAtk?.onHit && !o.fromAbility) pushCompsTo(again, kitAtk.onHit, this.champ.passive.name);
      for (const e of this.effects) e.onAttack?.(this, again);
      atk.extra.push(...again.extra);
    }

    if (!o.onHitOnly && !atk.replaceBase) {
      const base = (o.amount ?? st.ad * (kitAtk?.damageMult !== undefined ? this.evalExpr(kitAtk.damageMult, { slot: 'P' }) : 1)) * atk.baseMult * atk.critFactor;
      this.deal({
        source: o.fromAbility ?? 'AA',
        sourceLabel: o.sourceLabel ?? 'Basic attack',
        label: o.label ?? (atk.crit ? 'Attack (crit)' : expected && st.critChance > 0 && st.critChance < 1 && canCrit ? 'Attack (avg. crit)' : 'Attack'),
        type: o.comp && o.comp.type !== 'adaptive' ? o.comp.type : o.comp?.type === 'adaptive' ? 'adaptive' : (kitAtk?.type ?? 'physical'),
        amount: base,
        castId: o.castId,
        // Attack-like ability hits (Urgot W, Azir soldiers…) deal basic damage too.
        flags: { kind: o.fromAbility ? 'ability' : 'attack', slot: o.fromAbility, attack: !o.fromAbility, ability: !!o.fromAbility, crit: atk.crit, ...(o.fromAbility ? { basic: true } : {}) },
      });
    }
    // Abilities that apply on-hit at reduced effectiveness (Azir soldiers, Akshan E…).
    const eff = o.comp?.onHitEffectiveness !== undefined ? this.evalExpr(o.comp.onHitEffectiveness, { slot: o.fromAbility ?? 'P' }) : (empoweredEff ?? 1);
    for (const x of atk.extra) {
      const scaled = eff !== 1 && x.flags?.onHit && x.flags.kind !== 'ability' && !x.flags.fullOnHit ? { ...x, amount: x.amount * eff } : x;
      this.deal({ ...scaled, castId: x.castId ?? o.castId });
    }
    for (const f of pendingCC) f();
  }

  // ---------------------------------------------------------------------------
  // Combo steps

  private abilitySpec(slot: Slot): AbilitySpec {
    return this.kit.abilities[slot] ?? {};
  }

  private variantOf(spec: AbilitySpec, key: string): VariantSpec | undefined {
    return spec.variants?.[key] ?? Object.entries(spec.variants ?? {}).find(([k]) => k.toLowerCase() === key.toLowerCase())?.[1];
  }

  private castTimeOf(spec: AbilitySpec, variant: VariantSpec | undefined, ctx: CastCtx): number {
    const ctExpr = variant?.castTime ?? spec.castTime;
    return Math.max(0, ctExpr !== undefined ? this.evalExpr(ctExpr, ctx) : (ctx.spell.castTime ?? 0));
  }

  /** Seconds the slot's last cast was held to charge (expressions' `charge`). */
  private chargeHeld = new Map<Slot, number>();

  private defaultCharge(slot: Slot): number {
    const c = this.abilitySpec(slot).charge;
    return c ? this.evalExpr(c.default, { slot }) : 0;
  }

  /** What a cast step can set, where the player chooses it (see CastSetting). */
  castSetting(step: Pick<Extract<ComboStep, { type: 'ability' }>, 'slot' | 'variant' | 'enable'>): CastSetting | null {
    const spec = this.abilitySpec(step.slot);
    if (spec.charge) {
      const held = this.defaultCharge(step.slot);
      return { kind: 'held', value: held, max: Math.max(held, spec.charge.max !== undefined ? this.evalExpr(spec.charge.max, { slot: step.slot }) : held), unit: 's' };
    }
    const key = step.variant ?? spec.defaultVariant;
    const variant = key ? this.variantOf(spec, key) : undefined;
    const ctx = { slot: step.slot, spell: this.spellFor(step.slot, variant ?? spec), rank: this.abilityRank(step.slot) };
    if (spec.variableCount) {
      const r = this.repeating(variant?.components ?? spec.components ?? [], step.enable, ctx)[0];
      return r ? { kind: 'count', value: r.hits, max: r.maxHits, unit: spec.variableCount } : null;
    }
    const range = this.durationOf(spec, variant, step.enable, ctx, this.castTimeOf(spec, variant, ctx));
    return range && { kind: 'lasts', value: range.seconds, max: range.maxSeconds, unit: 's' };
  }

  private durationOf(spec: AbilitySpec, variant: VariantSpec | undefined, enable: string[] | undefined, ctx: CastCtx, castTime: number) {
    if (!spec.variableDuration) return null;
    // Its lockout, or as long as its repeating hits take: by default, and at most.
    let [last, lastMax] = [0, 0];
    for (const r of this.repeating(variant?.components ?? spec.components ?? [], enable, ctx)) {
      last = Math.max(last, r.first + (r.hits - 1) * r.interval);
      lastMax = Math.max(lastMax, r.first + (r.maxHits - 1) * r.interval);
    }
    const lockout = variant?.lockout ?? spec.lockout;
    const seconds = Math.max(last, lockout !== undefined ? this.evalExpr(lockout, ctx) - castTime : 0);
    const max = spec.maxDuration !== undefined ? this.evalExpr(spec.maxDuration, ctx) : lockout !== undefined ? seconds : lastMax;
    // Up to the hundredth, so that typed back they still cover every hit.
    const up = (x: number) => Math.ceil(x * 100 - 1e-6) / 100;
    return { seconds: up(seconds), maxSeconds: up(Math.max(seconds, max)) };
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

  /** Seconds after the cast time a component's first hit is fired: its delay, less its travel. */
  private firedAt(c: ComponentSpec, ctx: CastCtx) {
    return (c.delay !== undefined ? this.evalExpr(c.delay, ctx) : 0) - (c.travel !== undefined ? this.evalExpr(c.travel, ctx) : 0);
  }

  castAbility(step: Extract<ComboStep, { type: 'ability' }>, timeline: SimResult['timeline']) {
    const slot = step.slot;
    const spec = this.abilitySpec(slot);
    const rank = this.abilityRank(slot);
    if (slot !== 'P' && rank <= 0) {
      this.warn(`${slot} is not learned at level ${this.level} (rank 0); step skipped`);
      return;
    }
    let variantKey = step.variant ?? spec.defaultVariant;
    let variant: VariantSpec | undefined;
    if (variantKey) {
      variant = this.variantOf(spec, variantKey);
      if (!variant) {
        this.warn(`${slot} has no variant "${variantKey}" (available: ${Object.keys(spec.variants ?? {}).join(', ') || 'none'})`);
        variantKey = undefined;
      }
    }
    const spell = this.spellFor(slot, (variant as any) ?? spec);
    const name = spec.name ?? this.spellFor(slot).name;
    const label = variant ? `${name} (${variant.label})` : name;

    // Cooldown / recast handling. Process pending hits first: they can reset cooldowns
    // (Diana E, Ekko…) or refund charges.
    const cdKey = `ability:${slot}`;
    let start = Math.max(this.time, this.freeAt);
    this.processUntil(start);
    // A recast chain that outlived its window ends: the ability goes on its full cooldown from the first cast.
    if (spec.recastWindow !== undefined && (this.recastCount.get(slot) ?? 0) > 0) {
      const first = this.counters.get(`firstcast:${slot}`) ?? start;
      const from = spec.recastWindowFrom === 'previous' ? (this.counters.get(`lastcast:${slot}`) ?? first) : first;
      if (start - from > this.evalExpr(spec.recastWindow, { slot, spell, rank })) {
        const cdSpell = spell.cooldown?.some((x) => x > 0) ? spell : (this.siblingsOf(spell).find((x) => x.cooldown?.some((y) => y > 0)) ?? spell);
        const cdBase = spec.cooldown !== undefined ? this.evalExpr(spec.cooldown, { slot, spell, rank }) : (cdSpell.cooldown?.[Math.min(rank, (cdSpell.cooldown?.length ?? 1) - 1)] ?? 0);
        const isU = slot === ULT && !spec.notUltimate;
        const haste = this.stats.abilityHaste + (isU ? this.stats.ultimateHaste : this.stats.basicAbilityHaste);
        this.cooldownReady.set(cdKey, this.cooldownEnd(slot, first, spell.cooldownFixed ? cdBase : hasteCooldown(cdBase, haste)));
        this.recastCount.set(slot, 0);
        this.counters.delete(`firstcast:${slot}`);
      }
    }
    const ammo = slot === 'P' ? null : this.ammoFor(slot, spell, rank);
    const waitFrom = start;
    for (let guard = 0; guard < 200; guard++) {
      let next = start;
      if (ammo) {
        this.refreshAmmo(ammo, start);
        if (ammo.state.charges <= 0) next = Math.max(next, ammo.state.nextAt);
      }
      if (slot !== 'P') next = Math.max(next, this.cooldownReadyAt(cdKey));
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

    if (ammo) {
      ammo.state.charges = Math.max(0, ammo.state.charges - 1);
      if (!Number.isFinite(ammo.state.nextAt)) ammo.state.nextAt = start + ammo.recharge;
    }
    // A charged cast: held for the step's seconds (at most the longest hold), else its default.
    if (spec.charge) {
      const held = this.castSetting(step)!;
      this.chargeHeld.set(slot, Math.max(0, Math.min(step.duration ?? held.value, held.max)));
    }
    const castTime = this.castTimeOf(spec, variant, { slot, spell, rank });
    const castId = this.newCastId();
    this.action = castId;
    const hitsTarget = !step.miss && !spec.noTarget;
    const resets = variant?.resetsAttack ?? spec.resetsAttack;
    const recast = (this.recastCount.get(slot) ?? 0) + 1;
    const ectx = { slot, spell, rank, recast };
    const isUlt = slot === ULT && !spec.notUltimate;
    const cast: CastInfo = { castId, slot, variant: variantKey, hitsTarget, isUltimate: isUlt, label, dash: !!(variant?.dash ?? spec.dash), resetsAttack: !!resets };
    // A P step is a passive proc, not an ability cast: only the kit's own hooks see it.
    for (const e of this.effects) if (slot !== 'P' || e.source === 'kit') e.onCast?.(this, cast);

    // Cooldown starts on cast (recastable ultimates start it on the first cast).
    if (slot !== 'P') {
      const cdSpell = spell.cooldown?.some((x) => x > 0) ? spell : (this.siblingsOf(spell).find((x) => x.cooldown?.some((y) => y > 0)) ?? spell);
      const cdExpr = variant?.cooldown ?? spec.cooldown;
      const cd = cdExpr !== undefined ? this.evalExpr(cdExpr, ectx) : (cdSpell.cooldown?.[Math.min(rank, (cdSpell.cooldown?.length ?? 1) - 1)] ?? 0) || 0;
      const haste = this.stats.abilityHaste + (isUlt ? this.stats.ultimateHaste : this.stats.basicAbilityHaste);
      const cdAfter = spell.cooldownFixed ? cd : hasteCooldown(cd, haste);
      const recasts = spec.recasts ?? 1;
      const used = (this.recastCount.get(slot) ?? 0) + 1;
      this.counters.set(`lastcast:${slot}`, this.time);
      if (used >= recasts) {
        const firstCast = (this.counters.get(`firstcast:${slot}`) ?? this.time);
        this.cooldownReady.set(cdKey, this.cooldownEnd(slot, recasts > 1 ? firstCast : this.time, cdAfter));
        this.recastCount.set(slot, 0);
        this.counters.delete(`firstcast:${slot}`);
      } else {
        if (used === 1) this.counters.set(`firstcast:${slot}`, this.time);
        this.recastCount.set(slot, used);
        const delay = spec.recastDelay !== undefined ? this.evalExpr(spec.recastDelay, { slot, spell, rank }) : castTime;
        this.cooldownReady.set(cdKey, this.time + Math.max(castTime, delay));
      }
    }

    // Self buff(s) apply on cast.
    const buffs = variant?.buff ?? spec.buff;
    for (const b of Array.isArray(buffs) ? buffs : buffs ? [buffs] : []) this.applyBuff(b, slot, spell, rank, recast);

    // The seconds the player keeps it going after the cast time (a channel ended early, a toggle
    // left on), or as long as the hits it fires take: its repeating hits land within them, and its
    // lockout ends with them.
    const comps = variant?.components ?? spec.components ?? [];
    let span: number | undefined;
    if (step.duration !== undefined) {
      const range = this.durationOf(spec, variant, step.enable, ectx, castTime);
      if (range) span = Math.min(step.duration, range.maxSeconds);
      else if (!spec.charge) this.warn(`${label} can't be ended early, kept on or charged: ${formatCombo([step])} casts it in full`);
    }
    if (step.count !== undefined) {
      const r = spec.variableCount ? this.repeating(comps, step.enable, ectx)[0] : undefined;
      const n = r ? Math.max(0, Math.min(Math.round(step.count), r.maxHits)) : 0;
      if (r) span = n > 0 ? r.first + (n - 1) * r.interval : 0;
      else this.warn(`${label}'s hits aren't counted: ${formatCombo([step])} casts it in full`);
    }
    const repeating = span !== undefined ? this.repeating(comps, step.enable, ectx) : [];

    const end = start + castTime;
    const lockExpr = variant?.lockout ?? spec.lockout;
    const lockout = lockExpr !== undefined ? this.evalExpr(lockExpr, ectx) : 0;
    this.freeAt = span !== undefined && lockExpr !== undefined ? end + span : Math.max(end, start + lockout);
    if (resets) this.attackReadyAt = this.freeAt;
    timeline.push({ step: formatCombo([step]), start, end: this.freeAt });

    if (!hitsTarget) return;
    const debuff = variant && 'debuff' in variant ? (variant.debuff ?? undefined) : spec.debuff;
    const ccs = variant?.cc ?? spec.cc ?? [];
    let landed = 0;
    // Debuffs and crowd control apply with the cast's first landed hit (after its damage unless
    // the debuff says otherwise), or after `afterHits` hits.
    const debuffAt = debuff?.afterHits ?? 1;
    const onHitN = (n: number, phase: 'before' | 'after') => {
      if (debuff && n === debuffAt && !!debuff.applyBeforeHit === (phase === 'before')) this.applyDebuff(debuff, slot, spell, rank, castId);
      if (phase === 'after' && n === 1)
        for (const cc of ccs) {
          const apply = () => this.applyCC(cc.kind, this.evalExpr(cc.duration, ectx), castId, slot);
          const delay = cc.delay !== undefined ? this.evalExpr(cc.delay, ectx) : 0;
          if (delay > 0) this.schedule(delay, apply);
          else apply();
        }
    };
    for (const comp of comps) {
      const enabled = step.enable?.includes(comp.id) || !comp.optional;
      let hits = step.hits?.[comp.id] ?? (enabled ? this.evalExpr(comp.hits ?? 1, ectx) : 0);
      hits = Math.max(0, Math.round(hits));
      const delay = comp.delay !== undefined ? this.evalExpr(comp.delay, ectx) : 0;
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
        this.scheduleAt(at, () => {
          const n = ++landed;
          onHitN(n, 'before');
          this.dealComponent(comp, { slot, spell, rank, castId, sourceLabel: label, hit: hitIdx, hits, recast });
          onHitN(n, 'after');
        });
      }
    }
    if (!comps.length && (debuff || ccs.length))
      this.scheduleAt(end, () => {
        onHitN(1, 'before');
        onHitN(1, 'after');
      });
  }

  /** Crowd control on the target: tracked as a debuff and announced to effects (Aftershock, Cheap Shot…). */
  applyCC(kind: 'immobilize' | 'slow' | 'impair', duration: number, castId: number, slot?: Slot) {
    if (!(duration > 0)) return; // conditional CC can evaluate to 0 (e.g. Ryze W root vs slow)
    const id = `cc:${kind}`;
    const prev = this.getDebuff(id);
    const expires = Math.max(prev?.expires ?? 0, this.time + duration);
    // An uninterrupted CC keeps the cast and time that began it (Cheap Shot's same-tick rule).
    this.addDebuff({ id, label: kind === 'immobilize' ? 'Immobilized' : kind === 'slow' ? 'Slowed' : 'Impaired', expires, castId: prev ? prev.castId : castId, since: prev ? prev.since : this.time });
    for (const e of this.effects) e.onCrowdControl?.(this, { kind, castId, slot, duration });
  }

  /**
   * Target currently has crowd control of these kinds. With `excludeCastId`, CC that this cast
   * applied at this very moment doesn't count (Cheap Shot: not on the same tick as its own CC).
   */
  targetHasCC(kinds: ('immobilize' | 'slow' | 'impair')[], excludeCastId?: number): boolean {
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

  applyBuff(buff: BuffSpec, slot: Slot, spell: SpellData, rank: number, recast?: number) {
    const ctx = { slot, spell, rank, recast };
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
    });
    if (buff.empowerAttacks?.resetsAttack) this.attackReadyAt = Math.min(this.attackReadyAt, this.time);
  }

  applyDebuff(d: DebuffSpec, slot: Slot, spell: SpellData, rank: number, castId?: number) {
    const ctx = { slot, spell, rank };
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
          if (amount > 0) this.deal({ source: slot, sourceLabel: det.label ?? d.label, label: comp.label, type: comp.type, amount, castId: id, flags: componentFlags(comp, slot), markSource: d.id });
        }
        if (det.storeFraction !== undefined && (cur.stored ?? 0) > 0) {
          const frac = this.evalExpr(det.storeFraction, ctx);
          this.deal({ source: slot, sourceLabel: det.label ?? d.label, label: 'Stored damage', type: det.storeType ?? 'physical', amount: (cur.stored ?? 0) * frac, castId: id, flags: { kind: 'ability', slot, ability: true }, markSource: d.id });
        }
        void appliedAt;
      });
    }
  }

  attack(step: Extract<ComboStep, { type: 'attack' }>, timeline: SimResult['timeline']) {
    const count = Math.max(1, step.count ?? 1);
    for (let i = 0; i < count; i++) {
      const start = Math.max(this.time, this.freeAt, this.attackReadyAt);
      this.processUntil(start);
      const st = this.stats;
      const as = this.kit.attack?.attackSpeed !== undefined ? this.evalExpr(this.kit.attack.attackSpeed, { slot: 'P' }) : st.attackSpeed;
      const period = 1 / Math.max(0.2, as);
      const windup = period * windupFraction(this.champ);
      const castId = this.newCastId();
      this.action = castId;
      this.freeAt = start + windup;
      this.attackReadyAt = start + period;
      timeline.push({ step: step.crit === true ? 'AA!' : step.crit === false ? 'AA?' : 'AA', start, end: start + windup });
      this.scheduleAt(start + windup, () => this.performAttackHit({ castId, enable: step.enable }));
    }
  }

  useActive(effect: Effect, timeline: SimResult['timeline'], stepLabel: string) {
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
    const timeline: SimResult['timeline'] = [];
    const initialStats = this.stats;
    this.combatStart = -(this.opt[IN_COMBAT.key] ?? 0);
    for (const e of this.effects) e.onStart?.(this);
    const startHp = this.target.hp;
    const initialRed = this.targetReductions();

    for (const step of steps) {
      this.setStepCrit(step.type === 'ability' || step.type === 'attack' ? step.crit : undefined);
      switch (step.type) {
        case 'ability':
          this.castAbility(step, timeline);
          break;
        case 'attack':
          this.attack(step, timeline);
          break;
        case 'wait': {
          const start = Math.max(this.time, this.freeAt);
          this.processUntil(start + (step.seconds ?? 1));
          this.freeAt = this.time;
          timeline.push({ step: formatCombo([step]), start, end: this.time });
          break;
        }
        case 'summoner': {
          const eff = this.effects.find((e) => e.id === 'summoner:ignite');
          if (eff?.active) this.useActive(eff, timeline, 'ignite');
          break;
        }
        case 'item': {
          let item: ItemData;
          try {
            item = findItem(this.data, step.item);
          } catch (err) {
            this.warn((err as Error).message);
            break;
          }
          const eff = this.effects.find((e) => e.source === 'item' && e.active && (e.id === `item:${item.id}` || (e as any).itemIds?.includes(item.id)));
          if (!this.items.some((i) => i.id === item.id)) {
            this.warn(`item active "${item.name}" used but the item is not in the build`);
            break;
          }
          if (!eff?.active) {
            this.warn(`${item.name} has no modeled active`);
            break;
          }
          this.useActive(eff, timeline, `item:${item.name}`);
          break;
        }
      }
    }
    this.setStepCrit(undefined);
    this.action = undefined;
    const comboEnd = Math.max(this.time, this.freeAt);
    this.processUntil(comboEnd);
    // Delayed hits (projectiles, detonations) always land; DoTs continue only with finishDots.
    this.processUntil(comboEnd + (this.settings.finishDots ? 30 : 3));
    const dotDamage = this.events.reduce((s, e) => s + (e.flags.dot ? (e.final ?? 0) : 0), 0);
    const comboDamage = this.events.reduce((s, e) => s + (e.flags.dot ? 0 : (e.final ?? 0)), 0);

    const total = this.events.reduce((s, e) => s + (e.final ?? 0), 0);
    const raw = this.events.reduce((s, e) => s + e.raw, 0);
    const byType: Record<DamageType, number> = { physical: 0, magic: 0, true: 0 };
    const bySourceMap = new Map<string, SourceTotal>();
    for (const e of this.events) {
      byType[e.type] += e.final ?? 0;
      const key = `${e.source}|${e.sourceLabel}`;
      let s = bySourceMap.get(key);
      if (!s) bySourceMap.set(key, (s = { source: e.source, label: e.sourceLabel, damage: 0, raw: 0, hits: 0, type: {} }));
      s.damage += e.final ?? 0;
      s.raw += e.raw;
      s.hits++;
      s.type[e.type] = (s.type[e.type] ?? 0) + (e.final ?? 0);
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
    if (this.kit.status === 'auto')
      this.note(
        `${this.champ.name}'s kit is auto-generated from tooltips: per-hit numbers come from the game's formulas, but hit counts, conditions and passive interactions may be incomplete.`,
      );

    return {
      patch: this.data.meta.patch,
      champion: { id: this.champ.id, name: this.champ.name, level: this.level, ranks: { ...this.ranks }, kitStatus: this.kit.status },
      items: this.items.map((i) => ({ id: i.id, name: i.name, gold: i.gold.total })),
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
      bySource: [...bySourceMap.values()].sort((a, b) => b.damage - a.damage),
      events: this.events,
      timeline,
      duration: lastDamage,
      comboTime: comboEnd,
      killed: this.target.killTime !== undefined,
      ...(this.target.killTime !== undefined ? { killTime: this.target.killTime } : {}),
      percentOfHp: total / startHp,
      dps: lastDamage > 0 ? total / lastDamage : total,
      warnings: this.warnings,
      notes: [...this.notes],
    };
  }
}

// -----------------------------------------------------------------------------

/** Combine damage modifiers: damage-dealt amps add (since 26.9); damage-taken and other multipliers multiply. */
export function combineAmps(amps: DamageInstance['amps']): number {
  let dealt = 1;
  let mult = 1;
  for (const a of amps) {
    if ((a.kind ?? 'dealt') === 'dealt') dealt += a.value;
    else mult *= 1 + a.value;
  }
  return Math.max(0, dealt) * mult;
}

/** Damage flags of a kit component's hit. Proc damage is not ability damage: it applies no spell
 *  effects and triggers no runes, marks or detonations (pets' excepted). */
function componentFlags(comp: ComponentSpec, slot: Slot): Partial<DamageFlags> {
  return {
    kind: 'ability',
    slot,
    ability: !comp.noProc && !comp.proc,
    proc: !!comp.proc,
    aoe: !!comp.aoe,
    dot: !!comp.dot,
    pet: !!comp.pet,
    ...(comp.harvest ? { harvest: true } : {}),
  };
}

function clampInt(v: number, lo: number, hi: number) {
  return Math.min(hi, Math.max(lo, Math.round(v)));
}

function structuredCloneMods(m: StatMods): StatMods {
  const out = { ...m } as any;
  for (const [k, v] of Object.entries(m)) if (Array.isArray(v)) out[k] = [...v];
  return out;
}

export function isLegendary(item: ItemData): boolean {
  return item.gold.total >= 2000 && !item.into.length && !item.tags.includes('Boots') && !item.tags.includes('Consumable');
}

export function windupFraction(champ: ChampionData): number {
  const s = champ.stats;
  if (s.attackCastTime && s.attackTotalTime) return s.attackCastTime / s.attackTotalTime;
  return Math.min(0.9, Math.max(0.05, 0.3 + (s.attackWindupOffset ?? 0)));
}

/** Max rank per slot for this champion (from tooltip level-up lists; R defaults to 3). */
export function maxRanks(champ: ChampionData): Record<'Q' | 'W' | 'E' | 'R', number> {
  const out = { Q: 5, W: 5, E: 5, R: 3 } as Record<'Q' | 'W' | 'E' | 'R', number>;
  for (const ab of champ.abilities) {
    if (ab.slot === 'Q' || ab.slot === 'W' || ab.slot === 'E' || ab.slot === 'R') {
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
export function resolveRanks(champ: ChampionData, level: number, given: Scenario['ranks'], skillOrder = 'QWE', extraPoints = 0): Record<Slot, number> {
  const max = maxRanks(champ);
  const ultLevels = max.R >= 4 ? [1, 6, 11, 16] : [6, 11, 16];
  const r = ultLevels.filter((l) => level >= l).length;
  const ranks: Record<Slot, number> = { P: 1, Q: 0, W: 0, E: 0, R: Math.min(r, max.R) };
  let points = level - ranks.R + extraPoints;
  const order = (skillOrder.toUpperCase().replace(/[^QWE]/g, '') + 'QWE').split('').filter((c, i, a) => a.indexOf(c) === i) as ('Q' | 'W' | 'E')[];
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
  for (const [k, v] of Object.entries(given ?? {})) if (v !== undefined) ranks[k as Slot] = Math.max(0, Math.min(v, max[k as 'Q'] ?? 5));
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

function resolveTarget(data: GameData, spec: TargetSpec, attackerLevel: number): Sim['target'] {
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
      st = computeStats({ base: c.stats, level: lvl, adaptiveDefault: c.adaptive, ranged: c.attackType === 'ranged' }, mods);
      label ??= `${c.name} lvl ${lvl}${items?.length ? ` (${items.map((i) => i.name).join(', ')})` : ''}`;
    } else {
      const p = resolvePreset(data, spec.preset!, lvl, items);
      const mods = emptyMods();
      for (const it of p.items) mergeMods(mods, itemStatsToMods(it.stats));
      mods.hp += p.shardHp;
      st = computeStats({ base: p.base, level: lvl, adaptiveDefault: 'physical', ranged: false }, mods);
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
  const steps = typeof scenario.combo === 'string' ? parseCombo(scenario.combo) : scenario.combo;
  return sim.run(steps);
}

export { GAME };
