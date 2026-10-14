// Human-readable formulas: "35/60/85/110/135 (+50% AP)" style explanations of game calculations.

import type { CalcNode, CalcPart, SpellData } from './data-types.ts';
import { STAT } from './calc.ts';

const STAT_NAMES: Record<number, string> = {
  [STAT.AbilityPower]: 'AP',
  [STAT.Armor]: 'armor',
  [STAT.AttackDamage]: 'AD',
  [STAT.AttackSpeed]: 'attack speed',
  [STAT.MagicResist]: 'MR',
  [STAT.MoveSpeed]: 'move speed',
  [STAT.CritChance]: 'crit chance',
  [STAT.CritDamage]: 'crit damage',
  [STAT.CooldownReduction]: 'CDR',
  [STAT.AbilityHaste]: 'ability haste',
  [STAT.MaxHealth]: 'max health',
  [STAT.CurrentHealth]: 'current health',
  [STAT.PercentCurrentHealth]: '% current health',
  [STAT.MissingHealth]: 'missing health',
  [STAT.PercentMissingHealth]: '% missing health',
  [STAT.LifeSteal]: 'life steal',
  [STAT.Lethality]: 'lethality',
  [STAT.AttackRange]: 'attack range',
};

export function statName(stat: number, formula: number, target?: boolean): string {
  const n = STAT_NAMES[stat] ?? `stat${stat}`;
  const f = formula === 1 ? 'base ' : formula === 2 ? 'bonus ' : '';
  return `${target ? "target's " : ''}${f}${n}`;
}

const fmt = (v: number) => {
  if (!Number.isFinite(v)) return '?';
  const r = Math.round(v * 10000) / 10000;
  return String(r);
};

function rankValues(arr: number[] | undefined, maxRank: number): string {
  if (!arr) return '?';
  const vals = arr.slice(1, maxRank + 1);
  if (!vals.length) return fmt(arr[0] ?? 0);
  if (vals.every((v) => v === vals[0])) return fmt(vals[0]);
  return vals.map(fmt).join('/');
}

export function explainPart(p: CalcPart, spell: SpellData, maxRank: number): string {
  const dv = (n: string) => rankValues(spell.dataValues[n] ?? spell.dataValues[Object.keys(spell.dataValues).find((k) => k.toLowerCase() === n.toLowerCase()) ?? ''], maxRank);
  switch (p.t) {
    case 'num':
      return fmt(p.v);
    case 'dv':
      return `${p.name}[${dv(p.name)}]`;
    case 'stat':
      return `${fmt(p.coef)}×${statName(p.stat, p.formula, p.target)}`;
    case 'statdv':
      return `${p.dv}[${dv(p.dv)}]×${statName(p.stat, p.formula, p.target)}`;
    case 'statsub':
      return `(${explainPart(p.sub, spell, maxRank)})×${statName(p.stat, p.formula, p.target)}`;
    case 'sum':
      return `(${p.parts.map((x) => explainPart(x, spell, maxRank)).join(' + ')})`;
    case 'prod':
      return `${explainPart(p.a, spell, maxRank)} × ${explainPart(p.b, spell, maxRank)}`;
    case 'lerp':
      return `[${fmt(p.start)}→${fmt(p.end)} by level${p.statProgression ? ', stat curve' : ''}]`;
    case 'bp': {
      const bps = p.bps.map((b) => `L${b.level}:${b.perLevel ? `+${fmt(b.perLevel)}/lvl` : ''}${b.add ? ` +${fmt(b.add)}` : ''}`).join(', ');
      return `[${fmt(p.l1)} at L1${p.init ? `, +${fmt(p.init)}/lvl` : ''}${bps ? '; ' + bps : ''}]`;
    }
    case 'lvltable':
      return `[by level 1-18: ${p.values.slice(1, 19).map(fmt).join('/')}]`;
    case 'effect':
      return `Effect${p.idx}[${rankValues(spell.effects?.[p.idx - 1], maxRank)}]`;
    case 'cdmult':
      return 'cooldownMultiplier';
    case 'resource':
      return `${fmt(p.coef)}×${p.formula === 2 ? 'bonus ' : ''}mana`;
    case 'buff':
      return `${fmt(p.coef)}×stacks(${p.buff})`;
    case 'buffdv':
      return `${p.dv}[${dv(p.dv)}]×stacks(${p.buff})`;
    case 'clamp':
      return `clamp(${p.parts.map((x) => explainPart(x, spell, maxRank)).join(' + ')}, ${p.floor ?? '-∞'}, ${p.ceil ?? '∞'})`;
    case 'pow':
      return `(${p.parts.map((x) => explainPart(x, spell, maxRank)).join(' + ')})^${p.exp}`;
    case 'ref':
      return `{${p.name}}`;
    case 'extdv':
      return `${p.spell.split('/').pop()}.${p.name}`;
    case 'lerpdv':
      return `[${p.start}→${p.end} by level]`;
    case 'bpdv':
      return `[${p.l1} at L1 +${p.init}/lvl; ${p.bps.map((b) => `L${b.level}`).join(', ')}]`;
    case 'lvldv':
      return `(${p.base}[${dv(p.base)}] + ${p.perLevel}[${dv(p.perLevel)}]×(level-1))`;
    case 'buffelapsed':
      return `${fmt(p.coef)}×elapsed(${p.buff})`;
    case 'itemcount':
      return `${fmt(p.coef)}×legendaryItems`;
    case 'unknown':
      return `?${p.type}`;
  }
}

export function explainCalc(node: CalcNode, spell: SpellData, maxRank = 5): string {
  switch (node.t) {
    case 'calc': {
      let s = node.parts.map((x) => explainPart(x, spell, maxRank)).join(' + ') || '0';
      if (node.mult) s = `(${s}) × ${explainPart(node.mult, spell, maxRank)}`;
      if (node.rangedMult) s = `(${s}) × (ranged ? ${explainPart(node.rangedMult, spell, maxRank)} : 1)`;
      return s + (node.pct ? '  [shown as %]' : '');
    }
    case 'mod':
      return `{${node.of}} × ${explainPart(node.mult, spell, maxRank)}${node.rank !== undefined ? ` (at rank ${node.rank})` : ''}`;
    case 'cond':
      return `${node.requirement.type}${node.requirement.buff ? `(${node.requirement.buff})` : ''} ? {${node.conditional}} : {${node.default ?? '0'}}`;
  }
}
