// Print everything needed to write or check a champion kit: stats, every spell's tooltip,
// data values per rank, formulas (human-readable) and the current kit's components with values.
//
// Usage: node scripts/inspect-champion.ts <Champion> [level=11] [--all-spells] [--ap=100] [--bonusad=50]

import { loadGameData } from '../src/node/load.ts';
import { Sim } from '../src/engine/sim.ts';
import { explainCalc } from '../src/engine/explain.ts';
import { renderTooltip } from '../src/engine/tooltip.ts';
import type { Slot } from '../src/engine/effects.ts';

const args = process.argv.slice(2);
const name = args.find((a) => !a.startsWith('--') && !/^\d+$/.test(a));
if (!name) {
  console.error('usage: node scripts/inspect-champion.ts <Champion> [level] [--all-spells]');
  process.exit(1);
}
const level = Number(args.find((a) => /^\d+$/.test(a)) ?? 11);
const allSpells = args.includes('--all-spells');
const data = loadGameData();
const items: string[] = [];
const ap = Number(args.find((a) => a.startsWith('--ap='))?.slice(5) ?? 0);
const bonusAd = Number(args.find((a) => a.startsWith('--bonusad='))?.slice(10) ?? 0);
const sim = new Sim(data, { champion: name, level, items, combo: [], options: {} });
// Inject flat stats for formula previews.
(sim as any).staticMods.ap += ap;
(sim as any).staticMods.ad += bonusAd;
sim.invalidateStats();

const c = sim.champ;
const st = sim.stats;
console.log(`# ${c.name} (${c.id}) — ${c.attackType}, adaptive ${c.adaptive}, resource ${c.stats.resource}; kit: ${sim.kit.status}`);
console.log(`Base: ${JSON.stringify(c.stats)}`);
console.log(
  `At level ${level} (+${ap} AP, +${bonusAd} bonus AD): HP ${st.maxHp.toFixed(1)}, AD ${st.ad.toFixed(1)} (base ${st.baseAd.toFixed(1)}), AP ${st.ap}, armor ${st.armor.toFixed(1)}, MR ${st.mr.toFixed(1)}, AS ${st.attackSpeed.toFixed(3)}, crit dmg ${st.critDamage}`,
);
console.log(`Ranks: ${JSON.stringify(sim.ranks)}`);
console.log(`Passive "${c.passive.name}": ${c.passive.description.replace(/<[^>]+>/g, '')}\n`);

for (const ab of c.abilities) {
  if (ab.slot === 'X' && !allSpells) {
    console.log(`## (unslotted) ${ab.name}: ${ab.spells.map((s) => s.scriptName).join(', ')}  [use --all-spells]\n`);
    continue;
  }
  const slot = (ab.slot === 'X' ? 'P' : ab.slot) as Slot;
  const maxRank = slot === 'R' ? 3 : slot === 'P' ? 1 : 5;
  console.log(`## ${ab.slot} — ${ab.name}`);
  for (const sp of ab.spells) {
    const hasData = Object.keys(sp.dataValues).length || Object.keys(sp.calcs).length || sp.tooltip;
    if (!hasData) continue;
    console.log(`### spell ${sp.scriptName}  "${sp.name}"  castTime=${sp.castTime}${sp.cooldown ? ` cd=${sp.cooldown.slice(1, maxRank + 1).join('/')}` : ''}${sp.levelCount ? ` ranks=${sp.levelCount}` : ''}`);
    if (sp.tooltip) {
      console.log(`TOOLTIP (raw): ${sp.tooltip.replace(/\n/g, ' ')}`);
      console.log(`TOOLTIP (rendered, rank ${sim.abilityRank(slot)}): ${renderTooltip(sim, slot, sp).replace(/\n/g, ' | ')}`);
    }
    for (const [k, v] of Object.entries(sp.dataValues)) {
      const vals = v.slice(1, maxRank + 1);
      console.log(`  dv ${k} = ${vals.every((x) => x === vals[0]) ? vals[0] : vals.join('/')}`);
    }
    for (const [k, node] of Object.entries(sp.calcs)) {
      let val = '';
      try {
        val = String(Math.round(sim.calc(sp, k, sim.abilityRank(slot)) * 1000) / 1000);
      } catch (e) {
        val = 'ERR';
      }
      console.log(`  calc ${k} = ${explainCalc(node, sp, maxRank)}   => ${val}`);
    }
    if (sp.effects) console.log(`  effects: ${JSON.stringify(sp.effects.map((e) => e.slice(1, maxRank + 1)))}`);
  }
  const spec = sim.kit.abilities[slot];
  if (spec?.components?.length) {
    console.log(`KIT components:`);
    for (const comp of spec.components) {
      const v = sim.evalExpr(comp.amount, { slot });
      console.log(`  - ${comp.id} [${comp.type}${comp.optional ? ', optional' : ''}] ${comp.label}: ${comp.amount} => ${v.toFixed(2)}${comp.note ? `   (${comp.note})` : ''}`);
    }
  }
  console.log('');
}
if (sim.warnings.length) console.log('WARNINGS:', sim.warnings.join('; '));
