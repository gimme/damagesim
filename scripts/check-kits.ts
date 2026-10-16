// Validate champion kits: every expression compiles and evaluates to a finite, non-negative number
// at several levels; referenced game formulas exist; a smoke combo runs without warnings.
//
// Usage: node scripts/check-kits.ts [Champion ...] [--all] [--verbose]
//   (default: all curated kits; --all also checks auto-generated kits)

import { loadGameData } from '../src/node/load.ts';
import { loadAllKits } from '../src/node/kits.ts';
import { Sim, simulate, maxRanks } from '../src/engine/sim.ts';
import { getKit, curatedChampionIds } from '../src/kits/index.ts';
import { references } from '../src/engine/expr.ts';
import type { ChampionKit, ComponentSpec, Expr } from '../src/engine/kit-types.ts';
import type { Slot } from '../src/engine/effects.ts';

const args = process.argv.slice(2);
const verbose = args.includes('--verbose');
const data = loadGameData();
await loadAllKits();

const names = args.filter((a) => !a.startsWith('--'));
const ids = names.length ? names.map((n) => data.championIndex.find((c) => c.id.toLowerCase() === n.toLowerCase() || c.name.toLowerCase() === n.toLowerCase())?.id ?? n) : args.includes('--all') ? data.championIndex.map((c) => c.id) : curatedChampionIds();

let failures = 0;

/** Every expression in a kit, tagged with the slot whose spell gives it context. */
function* expressions(kit: ChampionKit): Generator<{ where: string; slot: Slot; expr: Expr; amount?: boolean; spell?: string }> {
  const comps = function* (where: string, slot: Slot, cs: ComponentSpec[] | undefined, spell?: string) {
    for (const c of cs ?? []) {
      yield { where: `${where}.${c.id}.amount`, slot, expr: c.amount, amount: true, spell };
      for (const k of ['hits', 'interval', 'delay', 'critMultiplier', 'min', 'max'] as const) if (c[k] !== undefined) yield { where: `${where}.${c.id}.${k}`, slot, expr: c[k]!, spell };
    }
  };
  for (const [slot, a] of Object.entries(kit.abilities) as [Slot, any][]) {
    if (!a) continue;
    yield* comps(slot, slot, a.components);
    for (const [vk, v] of Object.entries(a.variants ?? {}) as [string, any][]) {
      // Variants evaluate against their own spell (other forms), like the simulator does.
      const vs = v.spell ?? a.spell;
      yield* comps(`${slot}:${vk}`, slot, v.components, vs);
      for (const vb of (Array.isArray(v.buff) ? v.buff : [v.buff]).filter(Boolean)) {
        if (vb.empowerAttacks) yield* comps(`${slot}:${vk}.buff`, slot, vb.empowerAttacks.components, vs);
        for (const [k, x] of Object.entries(vb.stats ?? {})) yield { where: `${slot}:${vk}.buff.stats.${k}`, slot, expr: x as Expr, spell: vs };
        if (vb.duration !== undefined) yield { where: `${slot}:${vk}.buff.duration`, slot, expr: vb.duration, spell: vs };
      }
      for (const cc of v.cc ?? []) yield { where: `${slot}:${vk}.cc.${cc.kind}`, slot, expr: cc.duration, spell: vs };
      for (const k of ['castTime', 'lockout', 'attackLockout', 'cooldown'] as const) if (v[k] !== undefined) yield { where: `${slot}:${vk}.${k}`, slot, expr: v[k], spell: vs };
    }
    for (const b of (Array.isArray(a.buff) ? a.buff : [a.buff]).filter(Boolean)) {
      yield { where: `${slot}.buff.duration`, slot, expr: b.duration };
      for (const [k, v] of Object.entries(b.stats ?? {})) yield { where: `${slot}.buff.stats.${k}`, slot, expr: v as Expr };
      if (b.empowerAttacks) {
        yield { where: `${slot}.buff.empower.count`, slot, expr: b.empowerAttacks.count };
        yield* comps(`${slot}.buff.empower`, slot, b.empowerAttacks.components);
      }
      yield* comps(`${slot}.buff.onHit`, slot, b.onHit);
      if (b.damageAmp !== undefined) yield { where: `${slot}.buff.damageAmp`, slot, expr: b.damageAmp };
    }
    for (const d of [a.debuff].filter(Boolean)) {
      yield { where: `${slot}.debuff.duration`, slot, expr: d.duration };
      for (const k of ['armorReduction', 'armorReductionFlat', 'mrReduction', 'mrReductionFlat', 'damageTakenAmp', 'maxStacks'])
        if (d[k] !== undefined) yield { where: `${slot}.debuff.${k}`, slot, expr: d[k] };
      if (d.consume) yield* comps(`${slot}.debuff.consume`, slot, d.consume.components);
    }
    for (const cc of a.cc ?? []) yield { where: `${slot}.cc.${cc.kind}`, slot, expr: cc.duration };
    if (a.recastDelay !== undefined) yield { where: `${slot}.recastDelay`, slot, expr: a.recastDelay };
    for (const k of ['castTime', 'lockout', 'attackLockout', 'cooldown', 'recastWindow'] as const) if (a[k] !== undefined) yield { where: `${slot}.${k}`, slot, expr: a[k] };
  }
  for (const m of kit.marks ?? []) {
    const slot = (m.slot ?? 'P') as Slot;
    yield { where: `mark.${m.id}.maxStacks`, slot, expr: m.maxStacks };
    yield { where: `mark.${m.id}.duration`, slot, expr: m.duration };
    if (m.stacksPerHit !== undefined) yield { where: `mark.${m.id}.stacksPerHit`, slot, expr: m.stacksPerHit };
    yield* comps(`mark.${m.id}.onStack`, slot, m.onStack);
    if (m.dot) {
      yield { where: `mark.${m.id}.dot.interval`, slot, expr: m.dot.interval };
      yield* comps(`mark.${m.id}.dot`, slot, m.dot.components);
    }
    if (m.atMax) {
      yield* comps(`mark.${m.id}.atMax`, slot, m.atMax.components);
      if (m.atMax.cooldown !== undefined) yield { where: `mark.${m.id}.atMax.cooldown`, slot, expr: m.atMax.cooldown };
      for (const [k, v] of Object.entries(m.atMax.buff?.stats ?? {})) yield { where: `mark.${m.id}.atMax.buff.${k}`, slot, expr: v as Expr };
    }
  }
  yield* comps('attack.onHit', 'P', kit.attack?.onHit);
  if (kit.attack?.everyNth) yield* comps('attack.everyNth', 'P', kit.attack.everyNth.components);
  if (kit.attack?.damageMult !== undefined) yield { where: 'attack.damageMult', slot: 'P', expr: kit.attack.damageMult };
  if (kit.attack?.critMultiplier !== undefined) yield { where: 'attack.critMultiplier', slot: 'P', expr: kit.attack.critMultiplier };
  for (const [k, v] of Object.entries(kit.buffStacks ?? {})) yield { where: `buffStacks.${k}`, slot: 'P', expr: v };
}

for (const id of ids) {
  const champ = data.champions[id];
  if (!champ) {
    console.log(`✗ unknown champion ${id}`);
    failures++;
    continue;
  }
  const kit = getKit(champ);
  const problems: string[] = [];
  const optionKeys = new Set((kit.options ?? []).map((o) => o.key));

  // Static checks: referenced options exist.
  for (const e of expressions(kit)) {
    try {
      for (const p of references(e.expr)) if (p[0] === 'opt' && !optionKeys.has(p[1]) && !p[1].includes('.')) problems.push(`${e.where}: opt.${p[1]} is not declared in kit.options`);
    } catch (err) {
      problems.push(`${e.where}: ${(err as Error).message}`);
    }
  }

  // Evaluate at several levels with a mixed stat profile.
  const table: string[] = [];
  for (const level of [1, 6, 11, 16, 18]) {
    const sim = new Sim(data, { champion: id, level, combo: [], items: ['Rabadon\'s Deathcap', 'B. F. Sword'] });
    for (const e of expressions(kit)) {
      const rank = e.slot === 'P' ? undefined : Math.max(1, sim.rankOf(e.slot));
      let v: number;
      try {
        const spell = e.spell ? sim.findSpell(e.spell) : undefined;
        if (e.spell && !spell) throw new Error(`unknown spell ${e.spell}`);
        v = sim.evalExpr(e.expr, { slot: e.slot, rank, ...(spell ? { spell } : {}) });
      } catch (err) {
        problems.push(`L${level} ${e.where}: ${(err as Error).message}`);
        continue;
      }
      if (!Number.isFinite(v)) problems.push(`L${level} ${e.where}: not finite (${v})`);
      else if (e.amount && v < 0) problems.push(`L${level} ${e.where}: negative damage ${v.toFixed(2)}`);
      if (level === 11 && e.amount) table.push(`    ${e.where.padEnd(42)} ${v.toFixed(1)}`);
    }
    for (const w of sim.warnings) problems.push(`L${level}: ${w}`);
  }

  // Smoke combo: every ability once, two attacks.
  const max = maxRanks(champ);
  const r = simulate(data, { champion: id, level: 18, ranks: { Q: max.Q, W: max.W, E: max.E, R: max.R }, combo: 'Q W E R AA AA', target: { maxHp: 3000, armor: 100, mr: 80 } });
  for (const w of r.warnings) problems.push(`smoke: ${w}`);
  if (!(r.totalDamage > 0)) problems.push('smoke: combo dealt no damage');

  const uniq = [...new Set(problems)];
  if (uniq.length) failures++;
  console.log(`${uniq.length ? '✗' : '✓'} ${id} (${kit.status})  smoke combo L18 vs 3000/100/80: ${r.totalDamage.toFixed(0)} dmg`);
  for (const p of uniq.slice(0, 20)) console.log(`    ! ${p}`);
  if (verbose) console.log(table.join('\n'));
}

console.log(`\n${ids.length - failures}/${ids.length} kits OK`);
process.exit(failures ? 1 : 0);
