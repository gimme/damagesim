// Core engine tests. Expected values are derived by hand from the 16.20 game data / wiki formulas.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadGameData } from '../src/node/load.ts';
import { loadAllKits } from '../src/node/kits.ts';
import { simulate, Sim, resolveRanks } from '../src/engine/sim.ts';
import { effectiveResist, resistMultiplier } from '../src/engine/damage.ts';
import { computeStats, emptyMods, levelStats } from '../src/engine/stats.ts';
import { statProgression, evalPart } from '../src/engine/calc.ts';
import { compile } from '../src/engine/expr.ts';
import { parseCombo, formatCombo } from '../src/engine/combo.ts';
import { combineAmps } from '../src/engine/sim.ts';
import { rankItems } from '../src/engine/analysis.ts';
import { formatNumber, itemText } from '../src/engine/tooltip.ts';

const data = loadGameData('16.20');
await loadAllKits();
const near = (a: number, b: number, eps = 0.01) => assert.ok(Math.abs(a - b) <= eps, `expected ${b}, got ${a}`);
const dummy = { maxHp: 2000, armor: 0, mr: 0 };

test('resist multiplier for positive and negative resist', () => {
  near(resistMultiplier(100), 0.5);
  near(resistMultiplier(0), 1);
  near(resistMultiplier(-50), 2 - 100 / 150);
});

test('penetration order: flat reduction, % reduction, % pen, flat pen', () => {
  // 100 armor (60 base + 40 bonus), 10 flat reduction, 30% reduction, 35% pen, 18 lethality.
  // 100 → 90 → 63 → 40.95 → 22.95
  near(effectiveResist({ base: 60, bonus: 40 }, { flat: 10, percent: 0.3 }, { percent: 0.35, bonusPercent: 0, flat: 18 }), 22.95);
  // Penetration never takes armor below zero; reduction can.
  near(effectiveResist({ base: 20, bonus: 0 }, { flat: 0, percent: 0 }, { percent: 0, bonusPercent: 0, flat: 50 }), 0);
  near(effectiveResist({ base: 20, bonus: 0 }, { flat: 30, percent: 0.5 }, { percent: 0.4, bonusPercent: 0, flat: 10 }), -10);
  // Bonus-only percent penetration.
  near(effectiveResist({ base: 50, bonus: 50 }, { flat: 0, percent: 0 }, { percent: 0, bonusPercent: 0.5, flat: 0 }), 75);
});

test('stat growth curve', () => {
  near(statProgression(1), 0);
  near(statProgression(18), 1);
  // Level 11: n=10 → 10 × (0.7025 + 0.175) = 8.775 of 17
  near(statProgression(11) * 17, 8.775, 1e-9);
  const ahri = data.champions.Ahri;
  near(levelStats(ahri.stats, 11).ad, 53 + 3 * 8.775, 1e-6);
});

test('attack speed: base + bonus × ratio, capped at 3.0', () => {
  const jinx = data.champions.Jinx;
  const mods = emptyMods();
  mods.attackSpeed = 10; // absurd bonus
  const st = computeStats({ base: jinx.stats, level: 18, adaptiveDefault: 'physical', ranged: true }, mods);
  near(st.attackSpeed, 3.0);
  const st0 = computeStats({ base: jinx.stats, level: 1, adaptiveDefault: 'physical', ranged: true }, emptyMods());
  near(st0.attackSpeed, jinx.stats.attackSpeed, 1e-9);
});

test('adaptive force goes to the higher of bonus AD and AP, ties to champion type', () => {
  const ahri = data.champions.Ahri;
  const m = emptyMods();
  m.adaptive = 9;
  const st = computeStats({ base: ahri.stats, level: 1, adaptiveDefault: 'magic', ranged: true }, m);
  near(st.ap, 9);
  m.ad = 10;
  const st2 = computeStats({ base: ahri.stats, level: 1, adaptiveDefault: 'magic', ranged: true }, m);
  near(st2.bonusAd, 10 + 5.4);
});

test('breakpoint formulas (Ignite 16.20: 70 +20/level, +25/level from 6)', () => {
  const env = { level: 1 } as any;
  const ignite = data.summoners.SummonerDot.calcs.TooltipTrueDamageCalculation as any;
  const at = (level: number) => evalPart(ignite.parts[0], { ...env, level });
  near(at(1), 70);
  near(at(5), 150);
  near(at(6), 175);
  near(at(11), 300);
  near(at(18), 475);
});

test('expression language', () => {
  const r = (p: string[]) => ({ a: 2, b: 3, 'calc.X': 10 })[p.join('.')] ?? 0;
  assert.equal(compile('a + b * 2')(r), 8);
  assert.equal(compile('(a + b) * 2')(r), 10);
  assert.equal(compile('a > 1 ? calc.X : 0')(r), 10);
  assert.equal(compile('min(a, b) + max(a, b) + clamp(10, 0, 4)')(r), 9);
  assert.equal(compile('2 ^ 3 ^ 2')(r), 512);
  assert.equal(compile("calc['X']")(r), 10);
});

test('combo shorthand round-trips', () => {
  const steps = parseCombo('E > Q, W R:dash AA*3 AA! ignite item:Hextech_Rocketbelt wait:1.5 Q{out:1,back:0} Q+bonus');
  assert.equal(steps.filter((s) => s.type === 'attack').length, 2);
  assert.equal(formatCombo(steps), 'E Q W R:dash AA*3 AA! ignite item:Hextech_Rocketbelt wait:1.5 Q{out:1,back:0} Q+bonus');
  assert.throws(() => parseCombo('Q X'));
});

test('default skill ranks: R at 6/11/16, one point in each basic, then max order', () => {
  const r = resolveRanks(data.champions.Ahri, 11, undefined, 'QWE');
  assert.deepEqual([r.Q, r.W, r.E, r.R], [5, 3, 1, 2]);
  const r1 = resolveRanks(data.champions.Ahri, 1, undefined);
  assert.equal(r1.Q + r1.W + r1.E + r1.R, 1);
});

test('Ahri Q matches the game formula (35/60/85/110/135 + 50% AP)', () => {
  const sim = new Sim(data, { champion: 'Ahri', level: 11, items: ["Rabadon's Deathcap"], combo: [] });
  // Rabadon's: 130 AP × 1.3 = 169 AP
  near(sim.stats.ap, 169);
  near(sim.evalExpr('calc.TotalDamage', { slot: 'Q', rank: 5 }), 135 + 0.5 * 169);
});

test('a combo against a true-dummy deals the sum of its hits', () => {
  const r = simulate(data, { champion: 'Ahri', level: 11, combo: 'Q', target: dummy });
  // Out (magic) + return (true) at rank 5 with 0 AP and 0 MR.
  near(r.totalDamage, 270);
});

test('Ignite: true damage in 5 ticks, not amplified', () => {
  const r = simulate(data, { champion: 'Ahri', level: 11, runes: ['Coup de Grace'], combo: 'ignite', target: { ...dummy, hpPercent: 0.3 } });
  near(r.totalDamage, 300);
  assert.equal(r.events.length, 5);
});

test('crit: 200% base, +30% with Infinity Edge, expected value in default mode', () => {
  const always = simulate(data, { champion: 'Jinx', level: 1, items: ['Infinity Edge'], combo: 'AA', target: dummy, settings: { crit: 'always' } });
  const ad = always.stats.ad;
  near(always.events[0].raw, ad * 2.3);
  const exp = simulate(data, { champion: 'Jinx', level: 1, items: ['Infinity Edge'], combo: 'AA', target: dummy });
  near(exp.events[0].raw, ad * (1 + 0.25 * 1.3));
});

test('lethality is flat armor penetration at all levels', () => {
  const r = simulate(data, { champion: 'Ahri', level: 1, items: ['Serrated Dirk'], combo: 'AA', target: { maxHp: 2000, armor: 50, mr: 0 } });
  near(r.target.effectiveArmor, 40);
});

test('damage-dealt amplifiers add; damage-taken modifiers multiply', () => {
  const amps = [
    { source: 'a', value: 0.08, kind: 'dealt' as const },
    { source: 'b', value: 0.08, kind: 'dealt' as const },
    { source: 'c', value: 0.12, kind: 'taken' as const },
  ];
  near(combineAmps(amps, 'additive'), 1.16 * 1.12, 1e-9);
  near(combineAmps(amps, 'multiplicative'), 1.08 * 1.08 * 1.12, 1e-9);
});

test('Electrocute triggers on the third separate hit within 3s', () => {
  const r = simulate(data, { champion: 'Ahri', level: 11, runes: ['Electrocute'], combo: 'E Q W', target: dummy });
  const strike = r.events.filter((e) => e.source === 'rune:8112');
  assert.equal(strike.length, 1);
  // 60 + 10 × level at level 11 with no bonus AD/AP.
  near(strike[0].raw, 170);
});

test("Liandry's burn: 2% max HP per second for 3s on ability damage", () => {
  const r = simulate(data, { champion: 'Ahri', level: 11, items: ["Liandry's Torment"], combo: 'E', target: { maxHp: 3000, armor: 0, mr: 0 } });
  const burns = r.events.filter((e) => e.source === 'item:6653');
  assert.equal(burns.length, 6);
  near(burns[0].raw, 0.01 * 3000);
});

test('Spellblade: Sheen procs once per 1.5s on the attack after a cast', () => {
  const r = simulate(data, { champion: 'Garen', level: 9, items: ['Sheen'], combo: 'E AA AA', target: dummy });
  const procs = r.events.filter((e) => e.label === 'Spellblade');
  assert.equal(procs.length, 1);
  near(procs[0].raw, r.stats.baseAd);
});

test('Black Cleaver shreds armor per physical hit (max 30%)', () => {
  const r = simulate(data, { champion: 'Garen', level: 11, items: ['Black Cleaver'], combo: 'AA*6', target: { maxHp: 5000, armor: 100, mr: 0 } });
  const last = r.events[r.events.length - 1];
  near(last.effectiveResist!, 70, 0.5);
});

test('Garen Q replaces the next attack; E hits 7 + bonus attack speed spins', () => {
  const r = simulate(data, { champion: 'Garen', level: 11, combo: 'Q AA', target: dummy });
  const hits = r.events.filter((e) => e.source === 'Q' || e.source === 'AA');
  assert.equal(hits.length, 1);
  const sim = new Sim(data, { champion: 'Garen', level: 11, combo: [] });
  near(hits[0].raw, sim.evalExpr('calc.TotalDamage', { slot: 'Q' }));
  const e = simulate(data, { champion: 'Garen', level: 11, combo: 'E', target: dummy });
  assert.equal(e.events.length, 7 + Math.floor(e.stats.bonusAttackSpeed / 0.25));
});

test('Darius R scales with Hemorrhage stacks and caps at 200%', () => {
  const r = simulate(data, { champion: 'Darius', level: 11, combo: 'AA AA AA AA AA R', target: { maxHp: 9000, armor: 0, mr: 0 } });
  const rHit = r.events.find((e) => e.source === 'R')!;
  const sim = new Sim(data, { champion: 'Darius', level: 11, combo: [] });
  // 5 stacks → ×2 (the cap), and Noxian Might's bonus AD feeds the 75% bonus AD ratio.
  const might = sim.evalExpr('P.calc.NoxianMightBonusAD', { slot: 'P' });
  near(rHit.raw, 2 * (sim.evalExpr('dv.RBaseDamage', { slot: 'R' }) + 0.75 * might), 0.1);
});

test('Collector executes below 5% health', () => {
  const r = simulate(data, { champion: 'Jinx', level: 18, items: ['The Collector'], combo: 'AA', target: { maxHp: 1000, hpPercent: 0.2, armor: 0, mr: 0 }, settings: { crit: 'never' } });
  assert.ok(r.killed);
  assert.ok(r.events.some((e) => e.label === 'Execute'));
});

test('rank items per gold: sorted by damage gained per 1000 gold of the item', () => {
  const base = { champion: 'Ahri', level: 11, items: ["Luden's Echo", "Sorcerer's Shoes"], combo: 'E Q W R AA R', target: { preset: 'squishy' as const } };
  const res = rankItems(data, base, { metric: 'damagePerGold', limit: 200 });
  for (let i = 1; i < res.items.length; i++) assert.ok(res.items[i - 1].gainPerGold >= res.items[i].gainPerGold, `${res.items[i - 1].item} before ${res.items[i].item}`);
  const lich = res.items.find((x) => x.item === 'Lich Bane')!;
  near(lich.gainPerGold, (lich.gain / lich.gold) * 1000, 0.2);
  // Lich Bane's own Spellblade hit is part of its gain; Rabadon's only raises your other damage.
  assert.ok(lich.itemDamage > 0 && lich.itemDamage < lich.gain);
  assert.equal(res.items.find((x) => x.item === "Rabadon's Deathcap")!.itemDamage, 0);
});

test('item hover text: numbers for the attacker when the formula tooltip covers the shop text', () => {
  const sim = new Sim(data, { champion: 'Ahri', level: 11, items: ["Luden's Echo"], combo: [] });
  const luden = data.items[6655];
  const live = itemText(luden, sim);
  assert.ok(live.live);
  assert.deepEqual(live.stats, ['<attention> 100</attention> Ability Power', '<attention> 600</attention> Mana', '<attention> 10</attention> Ability Haste']);
  assert.ok(live.body.includes(`${formatNumber(sim.evalDataCalc(luden.calcs, luden.dataValues, 'Damage'))} bonus magic damage`), live.body);
  // Without a simulator: the shop text, which leaves the damage blank.
  const shop = itemText(luden);
  assert.ok(!shop.live && shop.body.includes('Damaging Abilities fire 6 Echoes'));
  // Ravenous Hydra's formula tooltip leaves out its active, so the shop text is used.
  const hydra = itemText(data.items[3074], sim);
  assert.ok(!hydra.live && /<active>Ravenous Crescent<\/active>/.test(hydra.body));
  for (const item of Object.values(data.items).filter((i) => i.inStore && !i.requiredChampion)) {
    const t = itemText(item, sim);
    for (const s of [...t.stats, t.body]) assert.ok(!/%i:|\{\{|@|^<br>|<br>$/.test(s), `${item.name}: ${s}`);
  }
});
