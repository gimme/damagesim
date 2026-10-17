// Evaluator for Riot's GameCalculation formula trees (the formulas behind every tooltip number).
//
// The trees come straight from the game files, so evaluating them with the right ranks, levels
// and stats reproduces the in-game numbers exactly. See data-types.ts for the node shapes.

import type { CalcNode, CalcPart } from "./data-types.ts";

/** Stat ids used by mStat in the game data (verified against tooltips; see README "Data"). */
export const STAT = {
  AbilityPower: 0,
  Armor: 1,
  AttackDamage: 2,
  AttackSpeed: 4,
  MagicResist: 6,
  MoveSpeed: 7,
  CritChance: 8,
  CritDamage: 9,
  CooldownReduction: 10,
  AbilityHaste: 11,
  MaxHealth: 12,
  CurrentHealth: 13,
  PercentCurrentHealth: 14,
  MissingHealth: 15,
  PercentMissingHealth: 16,
  LifeSteal: 18,
  Lethality: 29,
  AttackRange: 31,
} as const;

/** mStatFormula: 0 = total, 1 = base, 2 = bonus. */
export type StatFormula = 0 | 1 | 2;

export interface CalcEnv {
  /** Ability rank (1-based). Data values are indexed by rank. */
  rank: number;
  /** Champion level 1-18. */
  level: number;
  dataValue(name: string): number;
  stat(stat: number, formula: number, target: boolean): number;
  /** Stack count of a buff referenced by hash/name (champion stacks such as Nasus Q, Veigar P). */
  buffStacks(buff: string): number;
  /** Fraction (0-1) of a buff's duration that has elapsed (charge-up abilities). */
  buffElapsed(buff: string): number;
  /** Mana (resource 0) or secondary resource. formula: 0 total, 1 base, 2 bonus. */
  resource(resource: number, formula: number): number;
  ranged: boolean;
  /** Number of items of at least this epicness (legendaries = 5). */
  itemCount(epicness: number): number;
  abilityHaste: number;
  effect(idx: number): number;
  externalDataValue(spellPath: string, name: string): number;
  /** Evaluate another calculation of the same spell (by name). */
  calc(name: string): number;
}

/** Fraction of the level 1→18 stat curve reached at `level` (Riot's stat growth curve). */
export function statProgression(level: number): number {
  const n = level - 1;
  return (n * (0.7025 + 0.0175 * n)) / 17;
}

function evalBreakpoints(level: number, l1: number, init: number, bps: { level: number; perLevel: number; add: number }[]): number {
  const sorted = [...bps].sort((a, b) => a.level - b.level);
  let value = l1;
  let perLevel = init;
  for (let L = 2; L <= level; L++) {
    for (const bp of sorted) {
      if (bp.level === L) {
        perLevel = bp.perLevel;
        value += bp.add;
      }
    }
    value += perLevel;
  }
  return value;
}

export function evalPart(p: CalcPart, env: CalcEnv): number {
  switch (p.t) {
    case "num":
      return p.v;
    case "dv":
      return env.dataValue(p.name);
    case "stat":
      return env.stat(p.stat, p.formula, !!p.target) * p.coef;
    case "statdv":
      return env.stat(p.stat, p.formula, !!p.target) * env.dataValue(p.dv);
    case "statsub":
      return env.stat(p.stat, p.formula, !!p.target) * evalPart(p.sub, env);
    case "sum":
      return p.parts.reduce((s, q) => s + evalPart(q, env), 0);
    case "prod":
      return evalPart(p.a, env) * evalPart(p.b, env);
    case "lerp": {
      const f = p.statProgression ? statProgression(env.level) : (env.level - 1) / 17;
      return p.start + (p.end - p.start) * f;
    }
    case "bp":
      return evalBreakpoints(env.level, p.l1, p.init, p.bps);
    case "lvltable":
      // Index = champion level (index 0 is level 0); verified against the wiki for 10 calcs.
      return p.values[Math.min(Math.max(env.level, 0), p.values.length - 1)] ?? 0;
    case "effect":
      return env.effect(p.idx);
    case "cdmult":
      return 100 / (100 + env.abilityHaste);
    case "resource":
      return env.resource(p.resource, p.formula) * p.coef;
    case "buff":
      return env.buffStacks(p.buff) * p.coef;
    case "buffdv":
      return env.buffStacks(p.buff) * env.dataValue(p.dv);
    case "clamp": {
      const v = p.parts.reduce((s, q) => s + evalPart(q, env), 0);
      let r = v;
      if (p.floor != null) r = Math.max(r, p.floor);
      if (p.ceil != null) r = Math.min(r, p.ceil);
      return r;
    }
    case "pow": {
      const base = p.parts.reduce((s, q) => s + evalPart(q, env), 0);
      return Math.pow(base, typeof p.exp === "number" ? p.exp : 1);
    }
    case "ref":
      return env.calc(p.name);
    case "extdv":
      return env.externalDataValue(p.spell, p.name);
    case "lerpdv":
      return env.dataValue(p.start) + (env.dataValue(p.end) - env.dataValue(p.start)) * ((env.level - 1) / 17);
    case "bpdv":
      return evalBreakpoints(
        env.level,
        env.dataValue(p.l1),
        p.init ? env.dataValue(p.init) : 0,
        p.bps.map((b) => ({ level: b.level, perLevel: b.perLevel ? env.dataValue(b.perLevel) : 0, add: b.add ? env.dataValue(b.add) : 0 })),
      );
    case "lvldv":
      return env.dataValue(p.base) + env.dataValue(p.perLevel) * (env.level - 1);
    case "buffelapsed":
      return env.buffElapsed(p.buff) * p.coef;
    case "itemcount":
      return env.itemCount(p.epicness) * p.coef;
    case "unknown":
      return 0;
  }
}

export function evalCalcNode(node: CalcNode, env: CalcEnv, lookup: (name: string) => CalcNode | undefined, depth = 0): number {
  if (depth > 20) throw new Error("calculation reference cycle");
  switch (node.t) {
    case "calc": {
      let v = node.parts.reduce((s, p) => s + evalPart(p, env), 0);
      if (node.mult) v *= evalPart(node.mult, env);
      if (node.rangedMult && env.ranged) v *= evalPart(node.rangedMult, env);
      return v;
    }
    case "mod": {
      const inner = lookup(node.of);
      if (!inner) return 0;
      const innerEnv = node.rank !== undefined ? { ...env, rank: node.rank } : env;
      return evalCalcNode(inner, innerEnv, lookup, depth + 1) * evalPart(node.mult, env);
    }
    case "cond": {
      // Conditions are buff checks the simulator can't see in general; callers can override via
      // buffStacks(requirement.buff) > 0. Ranged checks are resolved directly.
      let useConditional = false;
      if (node.requirement.type === "IsRangedCastRequirement") useConditional = env.ranged;
      else if (node.requirement.buff) useConditional = env.buffStacks(node.requirement.buff) > 0;
      const name = useConditional ? node.conditional : node.default;
      const target = name ? lookup(name) : undefined;
      return target ? evalCalcNode(target, env, lookup, depth + 1) : 0;
    }
  }
}

/** Collect the stat dependencies of a calculation (for showing "(+50% AP)" style ratios). */
export interface Ratio {
  stat: number;
  formula: number;
  target: boolean;
  coef: number;
}
