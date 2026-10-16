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
import { critMarking, formatCombo, markCrit, parseCombo, rollsCrits } from '../src/engine/combo.ts';
import { getKit } from '../src/kits/index.ts';
import { combineAmps } from '../src/engine/sim.ts';
import { rankItems } from '../src/engine/analysis.ts';
import { formatNumber, itemText, renderTooltip, runeText } from '../src/engine/tooltip.ts';
import { NOT_LIVE_RUNES } from '../src/engine/runes.ts';
import { choosePrimary, chooseSecondary, pageRunes, pickRune, treePicks, type RunePage } from '../src/engine/rune-page.ts';

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
  assert.equal(formatCombo(parseCombo('Q! E? Q:tornado{a:1}!+bonus*2 AA*3?')), 'Q! E? Q:tornado{a:1}!+bonus Q:tornado{a:1}!+bonus AA*3?');
  assert.deepEqual(parseCombo('E{0.5s} R{1.5s,zone:10}'), [
    { type: 'ability', slot: 'E', duration: 0.5 },
    { type: 'ability', slot: 'R', duration: 1.5, hits: { zone: 10 } },
  ]);
  assert.equal(formatCombo(parseCombo('E{0.5s}! R{1.5s,zone:10}')), 'E{0.5s}! R{1.5s,zone:10}');
  assert.throws(() => parseCombo('E{3}'));
});

test('crit marks: the steps that roll crits, marked all at once', () => {
  const yasuo = getKit(data.champions.Yasuo);
  const steps = parseCombo('Q E AA R Q:tornado');
  assert.deepEqual(steps.map((s) => rollsCrits(s, yasuo)), [true, false, true, false, true]);
  assert.equal(critMarking(steps, yasuo), 'expected');
  const marked = steps.map((s) => markCrit(s, yasuo, 'always'));
  assert.equal(formatCombo(marked), 'Q! E AA! R Q:tornado!');
  assert.equal(critMarking(marked, yasuo), 'always');
  assert.equal(formatCombo(marked.map((s) => markCrit(s, yasuo, 'expected'))), 'Q E AA R Q:tornado');
  assert.equal(critMarking(parseCombo('Q! AA?'), yasuo), 'mixed');
  assert.equal(critMarking(parseCombo('E R'), yasuo), null);
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
  const r = simulate(data, { champion: 'Ahri', level: 11, runes: ['Coup de Grace'], combo: 'ignite', target: { ...dummy, hpPercent: 30 } });
  near(r.totalDamage, 300);
  assert.equal(r.events.length, 5);
});

test('crit: 200% base, +30% with Infinity Edge, expected value unless marked', () => {
  const jinx = (combo: string) => simulate(data, { champion: 'Jinx', level: 1, items: ['Infinity Edge'], combo, target: dummy });
  const crit = jinx('AA!');
  const ad = crit.stats.ad;
  near(crit.events[0].raw, ad * 2.3);
  near(jinx('AA').events[0].raw, ad * (1 + 0.25 * 1.3));
  near(jinx('AA?').events[0].raw, ad);
});

test('crit marks hold for everything the step causes: casts, and follow-up attacks', () => {
  const sim = (champion: string, combo: string) => simulate(data, { champion, level: 18, items: ['Infinity Edge', 'Bloodthirster'], combo, target: { preset: 'tank' } });
  const yasuo = (combo: string) => sim('Yasuo', combo).totalDamage;
  assert.ok(yasuo('Q!') > yasuo('Q') && yasuo('Q') > yasuo('Q?'));
  // Follow-up attacks crit with the attack that caused them.
  const followUpCrits = (champion: string, combo: string, source: string) => sim(champion, combo).events.find((e) => e.sourceLabel === source)!.flags.crit;
  for (const [champion, combo, source] of [
    ['Akshan', 'AA', 'Dirty Fighting'],
    ['Lucian', 'Q AA', 'Lightslinger'],
    ['MasterYi', 'AA*4', 'Double Strike'],
  ]) {
    assert.equal(followUpCrits(champion, `${combo}!`, source), true, champion);
    assert.equal(followUpCrits(champion, `${combo}?`, source), false, champion);
  }
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
  near(combineAmps(amps), 1.16 * 1.12, 1e-9);
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
  const r = simulate(data, { champion: 'Jinx', level: 18, items: ['The Collector'], combo: 'AA?', target: { maxHp: 1000, hpPercent: 20, armor: 0, mr: 0 } });
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

test("rank items: what an item's hits proc is split from its own damage and its stats", () => {
  // W Q is two hits; Stormsurge's Squall is the third, so Electrocute strikes only with it.
  const base = { champion: 'Smolder', level: 11, items: ['Essence Reaver', 'Ionian Boots of Lucidity'], runes: ['Electrocute'], combo: 'W Q', target: { preset: 'squishy' as const } };
  assert.ok(!simulate(data, base).bySource.some((s) => s.label === 'Electrocute'));
  const electrocute = simulate(data, { ...base, items: [...base.items, 'Stormsurge'] }).bySource.find((s) => s.label === 'Electrocute')!.damage;
  const res = rankItems(data, base, { candidates: ['Stormsurge', "Rabadon's Deathcap"] });
  const storm = res.items.find((x) => x.item === 'Stormsurge')!;
  assert.deepEqual(storm.procs.map((p) => p.name), ['Electrocute']);
  near(storm.procDamage, electrocute, 0.1);
  // The rest of the gain beyond Squall itself is its AP raising W and Q.
  assert.ok(storm.itemDamage > 0 && storm.gain - storm.itemDamage - storm.procDamage > 0);
  const cap = res.items.find((x) => x.item === "Rabadon's Deathcap")!;
  assert.equal(cap.procDamage, 0);
  assert.deepEqual(cap.procs, []);
  // With an attack after it, Electrocute strikes without Squall too: on Squall instead isn't a proc.
  const later = { ...base, combo: 'W Q wait:2 AA' };
  assert.ok(simulate(data, later).bySource.some((s) => s.label === 'Electrocute'));
  assert.equal(rankItems(data, later, { candidates: ['Stormsurge'] }).items[0].procDamage, 0);
  // Any hit that lands only with the item counts: here Smolder's execute, in range only with its damage.
  const exec = { ...base, level: 9, items: ['Essence Reaver'], options: { stacks: 225 }, combo: 'E Q AA Q' };
  const executes = (items: string[]) => simulate(data, { ...exec, items }).events.filter((e) => e.label === 'Execute');
  assert.equal(executes(exec.items).length, 0);
  const [execute] = executes([...exec.items, "Lord Dominik's Regards"]);
  const ldr = rankItems(data, exec, { candidates: ["Lord Dominik's Regards"] }).items[0];
  assert.deepEqual(ldr.procs.map((p) => [p.source, p.name]), [['Q', 'Execute']]);
  near(ldr.procDamage, execute.final!, 0.1);
});

test('item hover text: numbers for the attacker from the template the shop text is generated from', () => {
  const sim = new Sim(data, { champion: 'Ahri', level: 11, items: ["Luden's Echo"], combo: [] });
  const luden = data.items[6655];
  const live = itemText(luden, sim);
  assert.ok(live.live);
  assert.deepEqual(live.stats, ['<attention> 100</attention> Ability Power', '<attention> 600</attention> Mana', '<attention> 10</attention> Ability Haste']);
  assert.ok(live.body.includes(`${formatNumber(sim.evalDataCalc(luden.calcs, luden.dataValues, 'Damage'))} bonus magic damage`), live.body);
  // Without a simulator: the shop text, which leaves the damage blank.
  const shop = itemText(luden);
  assert.ok(!shop.live && shop.body.includes('Damaging Abilities fire 6 Echoes'));
  // Ravenous Hydra's own tooltip string leaves out its active; the template has it.
  const hydra = data.items[3074];
  const hydraText = itemText(hydra, sim).body;
  const crescent = formatNumber(sim.evalDataCalc(hydra.calcs, hydra.dataValues, 'PrimaryDamage'));
  assert.ok(hydraText.includes(`<active>Ravenous Crescent</active> (10s)<br>Deal <physicalDamage>${crescent} physical damage`), hydraText);
  // Melee/ranged values take the champion's side: Serpent's Fang's split, Voltaic Cyclosword's,
  // Black Cleaver's include, Celestial Opposition's pair written out.
  const caitlyn = new Sim(data, { champion: 'Caitlyn', level: 11, combo: [] });
  const darius = new Sim(data, { champion: 'Darius', level: 11, combo: [] });
  const body = (id: number, s: Sim) => itemText(data.items[id], s).body.replace(/<[^>]+>/g, '');
  assert.ok(body(6695, darius).includes('reduces Shields they gain by 50% for 3 seconds'));
  assert.ok(body(6695, caitlyn).includes('reduces Shields they gain by 35% for 3 seconds'));
  assert.ok(body(6699, darius).includes("deals 9% target's Current Health as bonus physical damage and grants you 15 Lethality"));
  assert.ok(body(6699, caitlyn).includes("deals 7% target's Current Health as bonus physical damage and grants you 12 Lethality"));
  assert.ok(body(3071, darius).includes('grants 20 Move Speed') && body(3071, caitlyn).includes('grants 10 Move Speed'));
  assert.ok(body(3869, darius).includes('damage by 35% for') && body(3869, caitlyn).includes('damage by 25% for'));
  for (const item of Object.values(data.items).filter((i) => i.inStore && !i.requiredChampion)) {
    for (const s of [sim, caitlyn]) {
      const t = itemText(item, s);
      // Every item with passive or active text gets numbers.
      assert.ok(t.live || !item.tooltip, `${item.name} falls back to the shop text`);
      for (const line of [...t.stats, t.body]) assert.ok(!/%i:|\{\{|@|^<br>|<br>$/.test(line), `${item.name}: ${line}`);
    }
  }
});

test('rune hover text: the in-game tooltip with numbers for the attacker, else the description', () => {
  const ahri = new Sim(data, { champion: 'Ahri', level: 11, items: ["Luden's Echo"], combo: [] });
  const darius = new Sim(data, { champion: 'Darius', level: 11, items: ['Black Cleaver'], combo: [] });
  const rune = (id: number) => data.runes.find((r) => r.id === id)!;
  const electrocute = rune(8112);
  const live = runeText(electrocute, ahri);
  assert.ok(live.live);
  assert.ok(live.body.includes(`<magicDamage>${formatNumber(ahri.evalDataCalc(electrocute.calcs, electrocute.values, 'TotalDamage'))}</magicDamage>`), live.body);
  // The stats the rune tracks in game are left out.
  assert.ok(!/Total Damage Dealt/i.test(live.body), live.body);
  assert.ok(runeText(electrocute, darius).body.includes('<physicalDamage>adaptive damage</physicalDamage>'));
  // Without a simulator: the description, with ranges and ratios.
  const desc = runeText(electrocute);
  assert.ok(!desc.live && desc.body.includes('Damage: 70 - 240 (+0.1 bonus AD, +0.05 AP) damage.'), desc.body);
  // Numbers the game's script sets in play come from the simulator's model of the rune: Press the
  // Attack's damage at your level, Dark Harvest's with its souls.
  const pta = simulate(data, { champion: 'Ahri', level: 11, runes: ['Press the Attack'], combo: 'AA AA AA', target: dummy });
  const ptaText = runeText(rune(8005), ahri);
  assert.ok(ptaText.live && ptaText.body.includes(`deals <scaleLevel>${formatNumber(pta.events.find((e) => e.source === 'rune:8005')!.raw)}</scaleLevel> bonus <magicDamage>adaptive damage</magicDamage>`), ptaText.body);
  assert.ok(ptaText.body.includes('3-Hit Cooldown: 6s') && !/Bonus Damage Dealt/.test(ptaText.body), ptaText.body);
  assert.ok(runeText(rune(8005)).body.includes('40 - 160 bonus <attention>adaptive damage</attention>'));
  const souls = { champion: 'Ahri', level: 11, items: ["Luden's Echo"], runes: ['Dark Harvest'], options: { 'darkHarvest.souls': 10 } };
  const harvest = simulate(data, { ...souls, combo: 'Q', target: { ...dummy, hpPercent: 30 } }).events.find((e) => e.source === 'rune:8128')!;
  const dh = runeText(rune(8128), new Sim(data, { ...souls, combo: [] }));
  assert.ok(dh.body.includes(`deals <magicDamage>${formatNumber(harvest.raw)} magic damage</magicDamage>`), dh.body);
  assert.ok(dh.body.includes('Souls harvested: <font color=\'#fc314e\'>10</font>') && !/Total damage dealt/i.test(dh.body), dh.body);
  assert.equal(runeText(rune(5008), darius).body, '<scaleAD>+5.4 Attack Damage</scaleAD>');
  // Adaptive Force: colored by what it gives at the attacker's stats.
  assert.match(runeText(rune(8233), ahri).body, /<magicDamage>[\d.]+ Adaptive Force<\/magicDamage>/);
  assert.match(runeText(rune(8233), darius).body, /<physicalDamage>[\d.]+ Adaptive Force<\/physicalDamage>/);
  // Melee/ranged splits take the attacker's side; the ranged share is a modified percentage.
  assert.ok(runeText(rune(8369), ahri).body.includes('<gold>35%</gold> of that damage'));
  assert.ok(runeText(rune(8369), darius).body.includes('<gold>50%</gold> of that damage'));
  assert.ok(runeText(rune(9923), darius).body.includes('gain 90% Attack Speed'));
  // Hashed values get the names the text uses: Jack of All Trades' Adaptive5 and Adaptive10.
  assert.ok(runeText(rune(8316), ahri).body.includes('Gain 8 or 20 bonus <magicDamage>Adaptive Force</magicDamage>'));
  for (const r of data.runes.filter((r) => !NOT_LIVE_RUNES.has(r.id))) {
    for (const sim of [ahri, darius]) {
      const t = runeText(r, sim);
      assert.ok(t.body && !/%i:|\{\{|@|…|^<br>|<br>$|\(\s*\)|\[|\|\|/.test(t.body), `${r.name}: ${t.body}`);
    }
  }
});

test('rune pages: a pick takes its row; the secondary tree gives two, the older going first', () => {
  const id = (name: string) => data.runes.find((r) => r.name === name)!.id;
  const ids = (...names: string[]) => names.map(id);
  const ahri: RunePage = { primary: 'Domination', secondary: 'Sorcery', picks: ids('Electrocute', 'Cheap Shot', 'Grisly Mementos', 'Ultimate Hunter', 'Absolute Focus', 'Scorch'), held: [], shards: [5008, 5008, 5001] };
  // A keystone or a primary rune takes the place of the one in its row.
  assert.deepEqual(pickRune(data, ahri, id('Dark Harvest')).picks, ids('Cheap Shot', 'Grisly Mementos', 'Ultimate Hunter', 'Absolute Focus', 'Scorch', 'Dark Harvest'));
  assert.deepEqual(treePicks(data, pickRune(data, ahri, id('Sudden Impact')), 'Domination'), ids('Electrocute', 'Grisly Mementos', 'Ultimate Hunter', 'Sudden Impact'));
  // A secondary rune in its picks' rows replaces that one; in the third row the older pick.
  assert.deepEqual(treePicks(data, pickRune(data, ahri, id('Celerity')), 'Sorcery'), ids('Scorch', 'Celerity'));
  assert.deepEqual(treePicks(data, pickRune(data, ahri, id('Manaflow Band')), 'Sorcery'), ids('Scorch', 'Manaflow Band'));
  // No keystone in the secondary tree, nothing from a third tree; picking a pick unpicks it.
  assert.equal(pickRune(data, ahri, id('Arcane Comet')), ahri);
  assert.equal(pickRune(data, ahri, id('Conqueror')), ahri);
  assert.deepEqual(pickRune(data, ahri, id('Scorch')).picks, ids('Electrocute', 'Cheap Shot', 'Grisly Mementos', 'Ultimate Hunter', 'Absolute Focus'));
  // As a scenario: keystone, primary rows, secondary rows, shards, whatever the order picked.
  assert.deepEqual(pageRunes(data, pickRune(data, pickRune(data, ahri, id('Cheap Shot')), id('Cheap Shot'))), [...ids('Electrocute', 'Cheap Shot', 'Grisly Mementos', 'Ultimate Hunter', 'Absolute Focus', 'Scorch'), 5008, 5008, 5001]);
});

test('rune pages: a tree remembers a rune per row and shows what fits its place', () => {
  const id = (name: string) => data.runes.find((r) => r.name === name)!.id;
  const ids = (...names: string[]) => names.map(id);
  const ahri: RunePage = { primary: 'Domination', secondary: 'Sorcery', picks: ids('Electrocute', 'Cheap Shot', 'Grisly Mementos', 'Ultimate Hunter', 'Absolute Focus', 'Scorch'), held: [], shards: [5008, 5008, 5001] };
  const shown = (page: RunePage, tree: string) => treePicks(data, page, tree);
  // Taking the secondary tree as primary swaps the two: the new secondary shows its newest two
  // minors and holds the keystone and the other one; swapping back shows them again.
  const swapped = choosePrimary(data, ahri, 'Sorcery');
  assert.deepEqual([swapped.primary, swapped.secondary], ['Sorcery', 'Domination']);
  assert.deepEqual(swapped.picks, ids('Absolute Focus', 'Scorch', 'Grisly Mementos', 'Ultimate Hunter'));
  assert.deepEqual(swapped.held, ids('Electrocute', 'Cheap Shot'));
  assert.deepEqual(chooseSecondary(data, ahri, 'Domination'), swapped);
  assert.deepEqual(choosePrimary(data, swapped, 'Domination'), ahri);
  // A keystone picked meanwhile is held in turn, and comes back with the next swap.
  const comet = choosePrimary(data, pickRune(data, swapped, id('Arcane Comet')), 'Domination');
  assert.deepEqual([comet.picks, comet.held], [ahri.picks, ids('Arcane Comet')]);
  assert.deepEqual(shown(choosePrimary(data, comet, 'Sorcery'), 'Sorcery'), ids('Arcane Comet', 'Absolute Focus', 'Scorch'));
  // Unpicking forgets: a rune removed from the secondary tree doesn't come back.
  assert.deepEqual(shown(choosePrimary(data, pickRune(data, swapped, id('Ultimate Hunter')), 'Domination'), 'Domination'), ids('Electrocute', 'Cheap Shot', 'Grisly Mementos'));
  // Picking in a row replaces what the tree remembers for it; a rune pushed out by a third row is held.
  const tasted = pickRune(data, swapped, id('Taste of Blood'));
  assert.deepEqual([shown(tasted, 'Domination'), tasted.held], [ids('Ultimate Hunter', 'Taste of Blood'), ids('Electrocute', 'Grisly Mementos')]);
  assert.deepEqual(shown(choosePrimary(data, tasted, 'Domination'), 'Domination'), ids('Electrocute', 'Grisly Mementos', 'Ultimate Hunter', 'Taste of Blood'));
  assert.deepEqual(shown(choosePrimary(data, pickRune(data, ahri, id('Manaflow Band')), 'Sorcery'), 'Sorcery'), ids('Absolute Focus', 'Scorch', 'Manaflow Band'));
  // A tree that keeps its place is left alone; it doesn't show what it holds when it gets room.
  const unpicked = pickRune(data, tasted, id('Taste of Blood'));
  assert.deepEqual(shown(choosePrimary(data, unpicked, 'Precision'), 'Domination'), ids('Ultimate Hunter'));
  // A tree taken off the page holds its runes; back on it shows what fits. A new tree starts empty.
  const precision = choosePrimary(data, ahri, 'Precision');
  assert.deepEqual([precision.picks, precision.held], [ids('Absolute Focus', 'Scorch'), ids('Electrocute', 'Cheap Shot', 'Grisly Mementos', 'Ultimate Hunter')]);
  assert.deepEqual(choosePrimary(data, precision, 'Domination'), ahri);
  assert.deepEqual(shown(chooseSecondary(data, precision, 'Domination'), 'Domination'), ids('Grisly Mementos', 'Ultimate Hunter'));
  assert.deepEqual(chooseSecondary(data, ahri, 'Precision').picks, ids('Electrocute', 'Cheap Shot', 'Grisly Mementos', 'Ultimate Hunter'));
});

test('rune pages: the simulator warns about runes no page holds together', () => {
  const warnings = (runes: (string | number)[]) => simulate(data, { champion: 'Ahri', level: 11, runes, combo: 'Q', target: dummy }).warnings;
  assert.deepEqual(warnings(['Electrocute', 'Cheap Shot', 'Grisly Mementos', 'Ultimate Hunter', 'Absolute Focus', 'Scorch', 5008, 5008, 5001]), []);
  assert.deepEqual(warnings(['Electrocute', 'Cheap Shot', 'Sudden Impact']), ['Cheap Shot and Sudden Impact share a row of Domination: a rune page takes one']);
  assert.deepEqual(warnings(['Electrocute', 'Arcane Comet']), ['more than one keystone (Electrocute and Arcane Comet): a rune page has one']);
  assert.match(warnings(['Electrocute', 'Manaflow Band', 'Transcendence', 'Scorch'])[0], /^3 runes from Sorcery, the secondary tree/);
  assert.match(warnings(['Electrocute', 'Triumph', 'Scorch'])[0], /^runes from 3 trees/);
  // Without a keystone, either tree can be the primary one.
  assert.deepEqual(warnings(['Absolute Focus', 'Scorch', 'Cheap Shot', 'Grisly Mementos', 'Ultimate Hunter']), []);
  // Shards: one from each row, in any order. Adaptive Force is offense or flex, not defense.
  assert.deepEqual(warnings([5011, 5008, 5001]), []);
  assert.match(warnings([5008, 5008, 5008])[0], /^no rune page has the shards Adaptive Force, Adaptive Force and Adaptive Force/);
  assert.equal(warnings([5005, 5008, 5005]).length, 1);
  assert.match(warnings([5008, 5008, 5001, 5011])[0], /^4 shards/);
});

test('a modified calculation shows in the format of the one it modifies', () => {
  const sim = new Sim(data, { champion: 'Jax', level: 11, items: [], combo: [] });
  const passive = sim.champ.abilities.flatMap((a) => a.spells).find((s) => s.scriptName === 'JaxPassive')!;
  assert.match(renderTooltip(sim, 'P', passive), /\(max \d+(\.\d+)?% Attack Speed\)/);
});
