// Item, rune and engine-feature behaviour (trigger rules and timing from docs/research).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadGameData } from '../src/node/load.ts';
import { loadAllKits } from '../src/node/kits.ts';
import { Sim, simulate, type TargetSpec } from '../src/engine/sim.ts';
import { findItem } from '../src/engine/gamedata.ts';
import { parseCombo } from '../src/engine/combo.ts';

const data = loadGameData('16.20');
await loadAllKits();
const dummy = { maxHp: 5000, armor: 0, mr: 0 };
const bySource = (r: ReturnType<typeof simulate>, src: string) => r.events.filter((e) => e.source === src);

test('Press the Attack: proc on the 3rd attack, +8% to later damage but not the trigger', () => {
  const r = simulate(data, { champion: 'Garen', level: 11, runes: ['Press the Attack'], combo: 'AA*4', target: dummy });
  const attacks = bySource(r, 'AA');
  assert.equal(bySource(r, 'rune:8005').length, 1);
  assert.equal(attacks[2].amps.length, 0);
  assert.ok(attacks[3].amps.some((a) => a.source === 'Press the Attack' && Math.abs(a.value - 0.08) < 1e-6));
});

test('Lethal Tempo: bolt only once 6 stacks are built', () => {
  const r = simulate(data, { champion: 'Jinx', level: 11, runes: ['Lethal Tempo'], combo: 'AA*8', target: dummy });
  assert.equal(bySource(r, 'rune:8008').length, 2); // attacks 7 and 8
});

test('Hail of Blades: three empowered attacks', () => {
  const r = simulate(data, { champion: 'Garen', level: 11, runes: ['Hail of Blades'], combo: 'AA*5', target: dummy });
  assert.equal(bySource(r, 'rune:9923').length, 3);
});

test("Guinsoo's Rageblade: first Phantom Hit on the 7th attack doubles on-hit", () => {
  const r = simulate(data, { champion: 'Jinx', level: 11, items: ["Guinsoo's Rageblade"], combo: 'AA*7', target: dummy });
  // 7 attacks → 8 Wrath on-hits (the 7th applies twice).
  assert.equal(r.events.filter((e) => e.label === 'Wrath').length, 8);
});

test('Energized: the attack after reaching 100 charges is Energized', () => {
  const r = simulate(data, { champion: 'Jinx', level: 11, items: ['Rapid Firecannon'], options: { 'energized.start': 94 }, combo: 'AA AA', target: dummy });
  const procs = r.events.filter((e) => e.label === 'Sharpshooter');
  assert.equal(procs.length, 1);
  assert.equal(procs[0].castId, bySource(r, 'AA')[1].castId);
});

test("Shadowflame crits magic damage below 40% health; Abyssal Mask multiplies", () => {
  const low = simulate(data, { champion: 'Ahri', level: 11, items: ['Shadowflame', 'Abyssal Mask'], combo: 'E', target: { maxHp: 5000, hpPercent: 30, armor: 0, mr: 0 } });
  const e = low.events.find((x) => x.source === 'E')!;
  // raw × (1 + 0.2) × (1 + 0.12); MR 0, Shadowflame pen irrelevant.
  assert.ok(Math.abs(e.final! - e.raw * 1.2 * 1.12) < 0.01, `${e.final} vs ${e.raw * 1.2 * 1.12}`);
});

test("Luden's Echo: one full echo plus five at 20% on a single target", () => {
  const r = simulate(data, { champion: 'Ahri', level: 11, items: ["Luden's Echo"], combo: 'E', target: dummy });
  const echoes = bySource(r, 'item:6655');
  assert.equal(echoes.length, 6);
  const total = echoes.reduce((s, x) => s + x.raw, 0);
  assert.ok(Math.abs(total - 2 * echoes[0].raw) < 0.01);
});

test('Ability charges (ammo) limit casts: Rengar Q waits for its recharge', () => {
  const r = simulate(data, { champion: 'Rengar', level: 11, combo: 'Q AA Q AA', target: dummy });
  const steps = r.timeline.filter((s) => s.step === 'Q');
  assert.ok(steps[1].start - steps[0].start > 3.5, `second Q at ${steps[1].start}`);
});

test('Cooldown resets from hits apply before the next cast (Diana E on a Moonlit target)', () => {
  // E waits for Q's bolt to land (as in play), so that it consumes the Moonlight.
  const r = simulate(data, { champion: 'Diana', level: 11, combo: 'Q wait{0.5s} E E', target: dummy });
  const es = r.timeline.filter((s) => s.step === 'E');
  assert.equal(es.length, 2);
  assert.ok(es[1].start - es[0].start < 2, `second E waited ${es[1].start - es[0].start}s`);
});

test('Delayed CC: Aftershock detonates 2.5s after the delayed root lands (Senna W)', () => {
  const r = simulate(data, { champion: 'Senna', level: 11, runes: ['Aftershock'], combo: 'W', target: dummy });
  const shock = bySource(r, 'rune:8439')[0];
  const w = bySource(r, 'W')[0];
  assert.ok(shock && shock.time - w.time > 3.4, `aftershock at ${shock?.time}, W hit at ${w.time}`);
});

test('Reduced on-hit effectiveness: Azir soldier stabs apply on-hit at 50%', () => {
  const base = simulate(data, { champion: 'Azir', level: 11, items: ["Nashor's Tooth"], combo: 'AA', target: dummy });
  const stab = simulate(data, { champion: 'Azir', level: 11, items: ["Nashor's Tooth"], combo: 'W AA', target: dummy });
  const n0 = base.events.find((e) => e.source === 'item:3115')!.raw;
  const n1 = stab.events.find((e) => e.source === 'item:3115')!.raw;
  assert.ok(Math.abs(n1 - n0 * 0.5) < 0.01, `${n1} vs ${n0}`);
});

test('Recast index scales Aatrox Q 1/2/3 (100% / 125% / 150%)', () => {
  const r = simulate(data, { champion: 'Aatrox', level: 11, combo: 'Q AA Q AA AA Q', target: dummy });
  const q = bySource(r, 'Q');
  assert.equal(q.length, 3);
  assert.ok(Math.abs(q[1].raw / q[0].raw - 1.25) < 0.01 && Math.abs(q[2].raw / q[0].raw - 1.5) < 0.01);
});

test('Build legality warnings (two Spellblade items)', () => {
  const r = simulate(data, { champion: 'Ezreal', level: 11, items: ['Trinity Force', 'Lich Bane'], combo: 'Q', target: dummy });
  assert.ok(r.warnings.some((w) => w.includes('Spellblade')));
});

test('Abilities that apply on-hit and trigger on-attack (Smolder Q): Spellblade, Energized and Lethal Tempo stacks', () => {
  const r = simulate(data, { champion: 'Smolder', level: 11, items: ['Essence Reaver', 'Rapid Firecannon'], options: { 'energized.start': 100 }, combo: 'Q', target: dummy });
  assert.equal(bySource(r, 'item:3508').length, 1, 'Spellblade');
  assert.equal(r.events.filter((e) => e.label === 'Sharpshooter').length, 1, 'Energized proc');
  // On-attack: Lethal Tempo stacks from Q casts, so attacks after 6 Qs fire bolts.
  const lt = simulate(data, { champion: 'Smolder', level: 11, runes: ['Lethal Tempo'], combo: 'Q AA Q AA Q AA', target: dummy });
  assert.equal(bySource(lt, 'rune:8008').length, 0);
  const lt2 = simulate(data, { champion: 'Smolder', level: 11, runes: ['Lethal Tempo'], combo: 'Q AA Q AA Q AA AA', target: dummy });
  assert.equal(bySource(lt2, 'rune:8008').length, 1, 'the 7th on-attack (an AA after 3 Q + 3 AA) fires a bolt');
});

test('Smolder E: the full flight, then the next cast; E is not a dash (no Sudden Impact)', () => {
  const r = simulate(data, { champion: 'Smolder', level: 11, runes: ['Sudden Impact'], combo: 'E Q', target: dummy });
  const bolts = r.events.filter((e) => e.label === 'Flap, Flap, Flap');
  assert.equal(bolts.length, 6, 'full flight at 125 stacks');
  assert.equal(r.events.filter((e) => e.label === 'Flap, Flap, Flap (Dragon Practice)').length, 6);
  const qStart = r.timeline.find((s) => s.step === 'Q')!.start;
  assert.ok(qStart >= 1.25, `Q waits for the flight to end (${qStart})`);
  // Fired during the flight, each bolt then flies its range.
  const travel = new Sim(data, { champion: 'Smolder', level: 11, combo: [] }).evalExpr('castRange / missileSpeed', { slot: 'E' });
  assert.ok(bolts.every((e) => e.time - travel < qStart));
  assert.equal(bySource(r, 'rune:8143').length, 0, 'Sudden Impact not armed');
});

test('Smolder E: a flight time lands the bolts fired before it ends, and frees Smolder then', () => {
  const at = (r: ReturnType<typeof simulate>, step: string) => r.timeline.find((s) => s.step === step)!.start;
  const bolts = (r: ReturnType<typeof simulate>) => r.events.filter((e) => e.label === 'Flap, Flap, Flap').map((e) => e.time);
  const full = simulate(data, { champion: 'Smolder', level: 11, combo: 'E Q', target: dummy });
  const all = bolts(full);
  const half = simulate(data, { champion: 'Smolder', level: 11, combo: 'E{0.5s} Q', target: dummy });
  const travel = new Sim(data, { champion: 'Smolder', level: 11, combo: [] }).evalExpr('castRange / missileSpeed', { slot: 'E' });
  assert.deepEqual(bolts(half), all.filter((t) => t - travel <= 0.5 + 1e-9), 'the bolts fired in the first 0.5s, at their times');
  assert.equal(half.events.filter((e) => e.label === 'Flap, Flap, Flap (Dragon Practice)').length, bolts(half).length, 'Dragon Practice follows the bolts');
  assert.ok(Math.abs(at(half, 'Q') - 0.5) < 1e-6, 'Q as the flight ends');
  // Never longer than the full flight.
  const long = simulate(data, { champion: 'Smolder', level: 11, combo: 'E{5s} Q', target: dummy });
  assert.equal(bolts(long).length, all.length);
  assert.equal(at(long, 'Q'), at(full, 'Q'));
  assert.ok(long.warnings.some((w) => /lasts 0s to 1.25s, so E\{5s\} lasts 1.25s/.test(w)));
  // At least until the first bolt is fired: as the flight starts.
  const none = simulate(data, { champion: 'Smolder', level: 11, combo: 'E{0s} Q', target: dummy });
  assert.equal(bolts(none).length, 1);
  assert.ok(Math.abs(at(none, 'Q')) < 1e-6);
  assert.ok(new Sim(data, { champion: 'Smolder', level: 11, combo: [] }).castSetting({ slot: 'E' })!.value === 1.25);
});

test('A toggle left on longer ticks longer, without busying the caster; a burn can\'t be ended early', () => {
  const karthus = (combo: string) => simulate(data, { champion: 'Karthus', level: 11, combo, target: dummy });
  const ticks = (combo: string) => karthus(combo).events.filter((e) => e.label === 'Defile').length;
  assert.equal(ticks('E'), 16, '4s by default');
  assert.equal(ticks('E{1s}'), 4);
  assert.equal(ticks('E{8s}'), 32);
  assert.equal(karthus('E{8s} W').timeline[1].start, karthus('E W').timeline[1].start, 'Karthus acts while Defile is on');
  const r = simulate(data, { champion: 'Smolder', level: 11, options: { stacks: 250 }, combo: 'Q{1s}', target: dummy });
  assert.equal(r.events.filter((e) => e.label === 'Super Scorcher Breath (burn)').length, 3);
  assert.ok(r.warnings.some((m) => /can't be ended early/.test(m)));
  assert.equal(new Sim(data, { champion: 'Smolder', level: 11, combo: [] }).castSetting({ slot: 'Q' }), null);
});

test('A charge held for a step\'s seconds: damage, crowd control and cast time follow the hold', () => {
  const sion = (combo: string) => simulate(data, { champion: 'Sion', level: 11, combo, target: dummy });
  const smash = (r: ReturnType<typeof simulate>) => r.events.find((e) => e.source === 'Q')!;
  const sim = new Sim(data, { champion: 'Sion', level: 11, combo: [] });
  const [min, max] = [sim.evalExpr('calc.MinDamageTotal', { slot: 'Q' }), sim.evalExpr('calc.MaxDamageTotal', { slot: 'Q' })];
  assert.ok(Math.abs(smash(sion('Q')).raw - max) < 1e-6, 'full charge by default');
  assert.ok(Math.abs(smash(sion('Q{0s}')).raw - min) < 1e-6);
  assert.ok(Math.abs(smash(sion('Q{1s}')).raw - (min + max) / 2) < 1e-6);
  assert.equal(sion('Q{1s}').timeline[0].end, 1.25, 'the 1s hold, then locked out for 0.25s');
  assert.deepEqual(sim.castSetting({ slot: 'Q' }), { kind: 'held', value: 2, min: 0, max: 2, unit: 's' });
  // Stunned only when charged 1s or more: 1.25s, plus 0.25s per 0.25s beyond.
  const stun = (combo: string) => {
    const s = new Sim(data, { champion: 'Sion', level: 11, combo: [] });
    s.run(parseCombo(combo));
    return s.evalExpr(s.kit.abilities.Q!.cc![0].duration, { slot: 'Q' });
  };
  assert.equal(stun('Q{0.5s}'), 0);
  assert.equal(stun('Q{1s}'), 1.25);
  assert.equal(stun('Q{1.5s}'), 1.75);
  // K'Sante W is released after 0.4s at the earliest.
  assert.ok(Math.abs(simulate(data, { champion: 'KSante', level: 11, combo: 'W{0s}', target: dummy }).timeline[0].end - 0.4) < 1e-6);
  // Viego W defaults to a quick release.
  assert.equal(simulate(data, { champion: 'Viego', level: 11, combo: 'W', target: dummy }).timeline[0].end, 0);
  // Janna's tornado grows while she acts: it hits later, harder, and she isn't held up.
  const janna = (combo: string) => simulate(data, { champion: 'Janna', level: 11, combo, target: dummy });
  const gale = (r: ReturnType<typeof simulate>) => r.events.find((e) => e.source === 'Q')!;
  const j = new Sim(data, { champion: 'Janna', level: 11, combo: [] });
  const [jmin, jmax] = [j.evalExpr('calc.MinimumDamage', { slot: 'Q' }), j.evalExpr('calc.MaxDamage', { slot: 'Q' })];
  assert.ok(Math.abs(gale(janna('Q')).raw - jmin) < 1e-6);
  assert.ok(Math.abs(gale(janna('Q{1.5s}')).raw - (jmin + jmax) / 2) < 1e-6);
  // Sent 3s later, it reaches the target sooner: its range grew, and it always takes 1.25s for all of it.
  const later = gale(janna('Q{3s}')).time - gale(janna('Q')).time;
  assert.ok(Math.abs(gale(janna('Q{3s}')).raw - jmax) < 1e-6 && later > 2.5 && later < 3);
  assert.equal(janna('Q{3s} W').timeline[1].start, janna('Q W').timeline[1].start);
});

test('A channel ended early lands the hits fired by then, not the one at its end', () => {
  // Xerath R: the shots fired, the last at 1.7s (0.5s, then every 0.6s) and landing 0.627s later.
  const xerath = simulate(data, { champion: 'Xerath', level: 11, combo: 'R{3} Q', target: dummy });
  assert.deepEqual(xerath.events.filter((e) => e.source === 'R').map((e) => Math.round(e.time * 1000) / 1000), [1.127, 1.727, 2.327]);
  const castTime = new Sim(data, { champion: 'Xerath', level: 11, combo: [] }).spellFor('R').castTime ?? 0;
  assert.ok(Math.abs(xerath.timeline[1].start - (castTime + 1.7)) < 1e-6, 'free once the last shot is fired');
  assert.equal(simulate(data, { champion: 'Xerath', level: 11, combo: 'R{0}', target: dummy }).events.filter((e) => e.source === 'R').length, 1, 'at least one shot');
  const fiddle = (combo: string) => simulate(data, { champion: 'Fiddlesticks', level: 11, combo, target: dummy }).events.filter((e) => e.label === 'Bountiful Harvest (final)').length;
  assert.equal(fiddle('W'), 1);
  assert.equal(fiddle('W{1s}'), 0);
  // Jhin R: the shots in the order they're fired, the 4th (its own component) last.
  const jhin = (combo: string) => simulate(data, { champion: 'Jhin', level: 11, combo, target: dummy });
  const shots = (r: ReturnType<typeof simulate>) => r.events.filter((e) => e.source === 'R').map((e) => e.label);
  assert.deepEqual(shots(jhin('R')), ['Curtain Call', 'Curtain Call', 'Curtain Call', 'Curtain Call (4th shot)']);
  assert.deepEqual(shots(jhin('R{2}')), ['Curtain Call', 'Curtain Call']);
  assert.ok(jhin('R{2} AA').timeline[1].start < jhin('R AA').timeline[1].start, 'free once the 2nd shot is fired');
  assert.deepEqual(new Sim(data, { champion: 'Jhin', level: 11, combo: [] }).castSetting({ slot: 'R' }), { kind: 'count', value: 4, min: 1, max: 4, unit: 'shots' });
  // Bel'Veth E: another ability ends it.
  const belveth = simulate(data, { champion: 'Belveth', level: 11, combo: 'E{0.5s} Q', target: dummy });
  assert.ok(belveth.events.filter((e) => e.source === 'E').every((e) => e.time <= 0.5));
  assert.equal(belveth.timeline[1].start, 0.5);
});

test("A number, hit or optional hit a cast doesn't take is warned about", () => {
  const warnings = (champion: string, combo: string) => simulate(data, { champion, level: 11, combo, target: dummy }).warnings;
  assert.deepEqual(warnings('Xerath', 'R{2.5}'), ['Rite of the Arcane fires whole shots, so R{2.5} fires 3']);
  assert.deepEqual(warnings('Xerath', 'R{9}'), ['Rite of the Arcane fires 1 to 5 shots, so R{9} fires 5']);
  assert.deepEqual(warnings('Ahri', 'Q{foo:3}+bar AA+baz'), [
    'Orb of Deception has no hit "foo" (available: out, back)',
    'Orb of Deception has no optional hit "bar" (available: none)',
    'Attacks have no optional hit "baz" (available: none)',
  ]);
  assert.deepEqual(warnings('Swain', 'R+endFlare'), []);
  // A crit mark on a step that can't crit is ignored; "no crit" asks for what it gets.
  assert.deepEqual(warnings('Ahri', 'Q! Q?'), ["Q! can't crit, so it runs as Q"]);
});

test("Viego's second hit on a marked target, after an attack or R (checked in game)", () => {
  const viego = (combo: string, items: string[] = [], runes: string[] = []) => simulate(data, { champion: 'Viego', level: 16, items, runes, combo, target: dummy });
  const labels = (r: ReturnType<typeof simulate>) => r.events.map((e) => e.label);
  // After an attack, it counts as one for on-attack effects: Kraken Slayer's 3rd attack is the next.
  assert.ok(viego('Q AA AA', ['Kraken Slayer']).events.some((e) => e.source === 'item:6672'));
  // A separate hit: Q, then the attack or R and its second hit, set off Electrocute.
  assert.ok(viego('Q AA', [], ['Electrocute']).events.some((e) => e.source === 'rune:8112'));
  assert.ok(viego('Q R', [], ['Electrocute']).events.some((e) => e.source === 'rune:8112'));
  // On-hit effects apply to R's strike and its second hit.
  assert.equal(labels(viego('W R', ["Nashor's Tooth"])).filter((l) => l === 'Icathian Bite').length, 2);
  // It can crit after R, so R! and R? mark it.
  const second = (combo: string) => viego(combo, ['Infinity Edge']).events.find((e) => e.label === 'Second strike')!.raw;
  assert.ok(second('W R!') > second('W R') && second('W R') > second('W R?'));
  assert.deepEqual(viego('W R!').warnings, []);
});

test('On-hit-only abilities (Fizz Q) consume Spellblade but do not trigger on-attack effects', () => {
  const r = simulate(data, { champion: 'Fizz', level: 11, items: ['Lich Bane'], runes: ['Lethal Tempo'], combo: 'Q', target: dummy });
  assert.equal(bySource(r, 'item:3100').length, 1, 'Spellblade');
  const lt = simulate(data, { champion: 'Fizz', level: 11, runes: ['Lethal Tempo'], combo: 'AA AA AA AA AA AA Q AA', target: dummy });
  // 6 attacks build max stacks; Q (no on-attack) neither adds a stack nor fires; the next AA fires.
  assert.equal(bySource(lt, 'rune:8008').length, 1);
});

test('Press the Attack: single-target on-hit abilities stack it, area on-hits (Katarina daggers) do not', () => {
  const yas = simulate(data, { champion: 'Yasuo', level: 11, runes: ['Press the Attack'], combo: 'Q AA AA', target: dummy });
  assert.equal(bySource(yas, 'rune:8005').length, 1);
  // Shunpo + Dagger slash + attack: the slash is an area on-hit, so only two stacks.
  const kat = simulate(data, { champion: 'Katarina', level: 11, runes: ['Press the Attack'], combo: 'E P AA', target: dummy });
  assert.ok(kat.events.some((e) => e.label === 'Voracity (Dagger)'));
  assert.equal(bySource(kat, 'rune:8005').length, 0);
});

test('Target presets follow the target level; levelDiff is relative to yours; numbers override', () => {
  const at = (level: number, levelDiff = 0) => simulate(data, { champion: 'Ahri', level, combo: 'AA', target: { preset: 'tank', levelDiff } }).target;
  const t11 = at(11);
  const t13 = at(11, 2);
  assert.equal(t11.level, 11);
  assert.equal(t13.level, 13);
  assert.ok(t13.maxHp > t11.maxHp && t13.armor > t11.armor);
  assert.ok(at(18).maxHp > at(11).maxHp + 1500, 'more items at 18');
  const squishy = simulate(data, { champion: 'Ahri', level: 11, combo: 'AA', target: { preset: 'squishy' } }).target;
  assert.ok(squishy.maxHp < t11.maxHp && squishy.armor < t11.armor);
  const over = simulate(data, { champion: 'Ahri', level: 11, combo: 'AA', target: { preset: 'tank', mr: 30 } }).target;
  assert.equal(over.mr, 30);
  const champ = simulate(data, { champion: 'Ahri', level: 11, combo: 'AA', target: { champion: 'Jinx', levelDiff: -2 } }).target;
  assert.equal(champ.level, 9);
});

test("A preset's items replace its typical build; only their stats count", () => {
  const at = (target: TargetSpec) => simulate(data, { champion: 'Ahri', level: 16, combo: 'AA', target }).target;
  const typical = at({ preset: 'squishy' });
  assert.equal(typical.bonusArmor, findItem(data, 'Guardian Angel').stats.armor, 'Guardian Angel as the 5th item at 16');
  const zhonya = at({ preset: 'squishy', items: ["Zhonya's Hourglass"] });
  assert.equal(zhonya.bonusArmor, findItem(data, "Zhonya's Hourglass").stats.armor);
  assert.ok(Math.abs(zhonya.armor - zhonya.bonusArmor - (typical.armor - typical.bonusArmor)) < 1e-9, 'same base');
  const none = at({ preset: 'tank', items: [] });
  assert.equal(none.bonusArmor, 0);
  assert.ok(none.bonusHp > 0, 'health shards stay');
});

test('Target totals keep the base and set the bonus; a bonus adds to the base; raw numbers are base', () => {
  const at = (target: TargetSpec) => simulate(data, { champion: 'Ahri', level: 11, combo: 'AA', target }).target;
  const close = (a: number, b: number) => assert.ok(Math.abs(a - b) < 1e-9, `${a} ≈ ${b}`);
  const tank = at({ preset: 'tank' });
  const base = tank.armor - tank.bonusArmor;
  const more = at({ preset: 'tank', armor: 300 });
  assert.equal(more.armor, 300);
  close(more.armor - more.bonusArmor, base);
  const below = at({ preset: 'tank', armor: 10 });
  assert.deepEqual([below.armor, below.bonusArmor], [10, 0]);
  const noItems = at({ preset: 'tank', bonusArmor: 0, bonusMr: 0 });
  close(noItems.armor, base);
  close(noItems.mr, tank.mr - tank.bonusMr);
  const raw = at({ maxHp: 2500, armor: 100, mr: 60, bonusMr: 20 });
  assert.deepEqual([raw.maxHp, raw.bonusHp, raw.armor, raw.bonusArmor, raw.mr, raw.bonusMr], [2500, 0, 100, 0, 60, 20]);
});

// -----------------------------------------------------------------------------
// Wiki audit fixes (docs/research/validation.md, "Item and rune audit").

/** Highest adaptive force Conqueror reached from damage dealt before `before` seconds. */
function maxAdaptive(champion: string, combo: string, before = Infinity) {
  const sim = new Sim(data, { champion, level: 18, runes: ['Conqueror'], combo, target: dummy });
  let max = 0;
  const deal = sim.deal.bind(sim);
  sim.deal = (req) => {
    const inst = deal(req);
    if (sim.time < before) max = Math.max(max, sim.stats.adaptiveForce);
    return inst;
  };
  sim.run(parseCombo(combo));
  return max;
}

test('Damage over time shares the cast instance that started it: no Electrocute from one hit, Conqueror once per 4s', () => {
  for (const [champion, combo] of [['Brand', 'Q'], ['Morgana', 'W'], ['Teemo', 'AA'], ['Twitch', 'AA']])
    assert.equal(bySource(simulate(data, { champion, level: 18, runes: ['Electrocute'], combo, target: dummy }), 'rune:8112').length, 0, champion);
  // Tormented Shadow's first tick (2 stacks) + ticks within 4s of it (no more): 2 × 4 adaptive at
  // level 18; a tick 4s or more after the first stacks again.
  assert.equal(maxAdaptive('Morgana', 'W', 4), 8);
  assert.equal(maxAdaptive('Morgana', 'W'), 16);
  // Darius's bleed is proc damage: his attack's 2 stacks only.
  assert.equal(maxAdaptive('Darius', 'AA'), 8);
});

test('Conqueror: an empowered attack stacks once (Jax W)', () => {
  assert.equal(maxAdaptive('Jax', 'W AA'), 8);
});

test('Unending Despair + Liandry\'s burn stop pulsing after combat', () => {
  const r = simulate(data, { champion: 'Ornn', level: 18, items: ["Liandry's Torment", 'Unending Despair'], combo: 'Q AA W AA E AA AA AA', target: dummy });
  const lastHit = Math.max(...r.events.filter((e) => e.source === 'AA').map((e) => e.time));
  const anguish = r.events.filter((e) => e.label === 'Anguish').map((e) => e.time);
  assert.ok(Math.max(...anguish) < lastHit + 7, `last Anguish at ${Math.max(...anguish)}, last attack at ${lastHit}`);
});

test('Press the Attack: 6s cooldown between procs; the amp ends 5s after combat', () => {
  const r = simulate(data, { champion: 'Jinx', level: 11, runes: ['Press the Attack'], combo: 'AA*20', target: dummy });
  assert.equal(bySource(r, 'rune:8005').length, 2);
  const gap = simulate(data, { champion: 'Jinx', level: 11, runes: ['Press the Attack'], combo: 'AA*3 wait{6s} AA', target: dummy });
  assert.equal(bySource(gap, 'AA').at(-1)!.amps.length, 0);
});

test('On-hit effectiveness does not reduce Grasp, Heartsteel or Electrospark (Urgot W)', () => {
  const grasp = (combo: string) => simulate(data, { champion: 'Urgot', level: 18, runes: ['Grasp of the Undying'], combo, target: dummy }).events.find((e) => e.label === 'Grasp')!.raw;
  assert.ok(Math.abs(grasp('W') - grasp('AA')) < 0.01);
});

test("Guinsoo's Phantom Hit and Dusk and Dawn's repeat add up (on-hit applies three times)", () => {
  // W after the 6th attack has landed, which would take Dusk and Dawn's Spellblade in flight.
  const r = simulate(data, { champion: 'Jinx', level: 18, items: ["Guinsoo's Rageblade", 'Dusk and Dawn'], combo: 'AA*6 wait{0.3s} W AA', target: dummy });
  const last = bySource(r, 'AA').at(-1)!;
  assert.equal(r.events.filter((e) => e.label === 'Wrath' && e.castId === last.castId).length, 3);
});

test('Malignance: ultimate hits on a target inside Hatefog refresh it (Malzahar R)', () => {
  const r = simulate(data, { champion: 'Malzahar', level: 18, items: ['Malignance'], combo: 'R', target: dummy });
  const fog = r.events.filter((e) => e.label === 'Hatefog').map((e) => e.time);
  assert.ok(fog.at(-1)! - fog[0] > 3.5, `Hatefog ${fog[0]}–${fog.at(-1)}`);
});

test('Spear of Shojin: innate damage grants no stacks; empowered attacks (Garen Q) are amplified', () => {
  const darius = simulate(data, { champion: 'Darius', level: 18, items: ['Spear of Shojin'], combo: 'AA wait{2s} Q', target: dummy });
  assert.ok(bySource(darius, 'Q').every((e) => !e.amps.some((a) => a.source === 'Spear of Shojin')));
  const garen = simulate(data, { champion: 'Garen', level: 18, items: ['Spear of Shojin'], combo: 'E Q AA', target: dummy });
  assert.ok(bySource(garen, 'Q').some((e) => e.amps.some((a) => a.source === 'Spear of Shojin')));
});

test('Voltaic Cyclosword: Galvanize lands Firmament before the triggering ability, which gets the lethality', () => {
  const r = simulate(data, { champion: 'Talon', level: 18, items: ['Voltaic Cyclosword'], combo: 'Q', target: { maxHp: 5000, armor: 100, mr: 0 } });
  assert.equal(r.events[0].label, 'Firmament');
  const q = bySource(r, 'Q')[0];
  assert.ok(q.effectiveResist! < 100 - r.stats.lethality - 1, `effective armor ${q.effectiveResist}`);
});

test('Deathfire Touch: a spell burn has 8 ticks, the last 2 amplified; a burn after expiry starts over', () => {
  const r = simulate(data, { champion: 'Ahri', level: 18, runes: ['Deathfire Touch'], combo: 'E', target: dummy });
  const ticks = bySource(r, 'rune:8992');
  assert.equal(ticks.length, 8);
  assert.equal(ticks.filter((e) => e.label === 'Burn (amplified)').length, 2);
});

test('Actualizer: basic ability cooldowns progress 30% faster during the active', () => {
  const qs = (items: string[], combo: string) => simulate(data, { champion: 'Ahri', level: 18, items, combo, target: dummy }).timeline.filter((s) => s.step === 'Q');
  const [a, b] = qs(['Actualizer'], 'item:actualizer Q Q');
  const [c, d] = qs(['Actualizer'], 'Q Q');
  assert.ok(Math.abs((b.start - a.start) * 1.3 - (d.start - c.start)) < 0.02, `${b.start - a.start} vs ${d.start - c.start}`);
});

test('Hail of Blades: only basic attacks trigger it (not Ezreal Q)', () => {
  const r = simulate(data, { champion: 'Ezreal', level: 18, runes: ['Hail of Blades'], combo: 'Q AA AA AA', target: dummy });
  const q = bySource(r, 'Q')[0];
  const procs = bySource(r, 'rune:9923');
  assert.equal(procs.length, 3);
  assert.ok(procs.every((p) => p.castId !== q.castId));
});

test('Cheap Shot: later hits of the cast that applied the CC trigger it (Malzahar R), its first hit does not', () => {
  const r = simulate(data, { champion: 'Malzahar', level: 18, runes: ['Cheap Shot'], combo: 'R', target: dummy });
  const shot = bySource(r, 'rune:8126');
  assert.equal(shot.length, 1);
  assert.ok(shot[0].time > bySource(r, 'R')[0].time);
});

test('Summon Aery: ability damage over time sends her (Malzahar E); persistent proc damage does not', () => {
  assert.ok(bySource(simulate(data, { champion: 'Malzahar', level: 18, runes: ['Summon Aery'], combo: 'E', target: dummy }), 'rune:8214').length >= 1);
});

test('Sudden Impact: a dash during its cooldown does not arm it', () => {
  const r = simulate(data, { champion: 'Riven', level: 18, runes: ['Sudden Impact'], combo: 'Q wait{8s} E wait{2.5s} AA', target: dummy });
  assert.equal(bySource(r, 'rune:8143').length, 1);
});

test("Triple Tonic: Elixir of Skill's extra skill point from level 9", () => {
  const ranks = (runes: string[]) => Object.values(simulate(data, { champion: 'Ahri', level: 9, runes, combo: 'Q', target: dummy }).champion.ranks).reduce((s, x) => s + x, 0);
  assert.equal(ranks(['Triple Tonic']), ranks([]) + 1);
});

test('Titanic Hydra: the empowered attack replaces Cleave; the cooldown starts when it is used', () => {
  const r = simulate(data, { champion: 'Sion', level: 18, items: ['Titanic Hydra'], combo: 'item:titanic AA AA', target: dummy });
  assert.deepEqual(r.events.filter((e) => e.source === 'item:3748').map((e) => e.label), ['Titanic Crescent', 'Cleave']);
});

test('Sundered Sky + Fiendhunter Bolts: same result in either item order, with the champion crit multiplier', () => {
  const total = (items: string[]) => simulate(data, { champion: 'Jhin', level: 18, items, combo: 'R AA', target: dummy }).totalDamage;
  assert.ok(Math.abs(total(['Fiendhunter Bolts', 'Sundered Sky']) - total(['Sundered Sky', 'Fiendhunter Bolts'])) < 0.01);
});

test("Hexoptics C44 amplifies Kraken Slayer's basic damage", () => {
  const r = simulate(data, { champion: 'Jinx', level: 18, items: ['Kraken Slayer', 'Hexoptics C44'], combo: 'AA*3', target: dummy });
  assert.ok(r.events.find((e) => e.label === 'Bring It Down')!.amps.some((a) => a.source === 'Hexoptics C44'));
});

test("% AP increases add up (Rabadon's + Blackfire Torch while burning)", () => {
  const sim = new Sim(data, { champion: 'Brand', level: 18, items: ["Rabadon's Deathcap", 'Blackfire Torch'], combo: 'E', target: dummy });
  const ap = sim.stats.ap / 1.3;
  sim.setCounter('burn:2503', 1);
  assert.ok(Math.abs(sim.stats.ap - ap * 1.34) < 0.01, `${sim.stats.ap} vs ${ap * 1.34}`);
});

test('Lethal Tempo: stacks decay one by one after the duration', () => {
  const sim = new Sim(data, { champion: 'Jinx', level: 18, runes: ['Lethal Tempo'], combo: 'AA*6', target: dummy });
  const attacks: number[] = [];
  sim.run(parseCombo('AA*6'));
  for (const e of sim.events) if (e.source === 'AA') attacks.push(e.time);
  // Stacks last from when the attack is launched, its missile's flight before it hits.
  const expiry = attacks.at(-1)! - sim.attackTravel() + 6;
  const asAt = (t: number) => {
    sim.time = t;
    sim.invalidateStats();
    return sim.stats.attackSpeed;
  };
  const [full, one, three] = [asAt(expiry - 0.1), asAt(expiry + 0.1), asAt(expiry + 0.7)];
  assert.ok(full > one && one > three && three > asAt(expiry + 2), `${full} ${one} ${three}`);
});

test('Damage records the combo action that set it off, across separate-cast hits, procs and DoTs', () => {
  const zed = simulate(data, { champion: 'Zed', level: 11, combo: 'W Q AA*2', target: dummy });
  const [q, shadow] = bySource(zed, 'Q');
  assert.notEqual(shadow.castId, q.castId);
  assert.equal(shadow.action, q.castId);
  const attacks = bySource(zed, 'AA');
  assert.equal(attacks.length, 2);
  assert.ok(attacks.every((a) => a.action === a.castId));
  const brand = simulate(data, { champion: 'Brand', level: 13, items: ["Liandry's Torment"], combo: 'E Q', target: dummy });
  const e = bySource(brand, 'E')[0];
  const ticks = bySource(brand, 'item:6653');
  assert.ok(ticks.length > 1 && ticks.every((t) => t.action === e.castId));
});

test("Iceborn Gauntlet's frost field adds no Electrocute stack; Smolder's execute is part of the hit that executes", () => {
  // W and Q are two hits; Q's Spellblade field doesn't make a third (in game, 16.20).
  const smolder = { champion: 'Smolder', level: 11, items: ['Iceborn Gauntlet'], runes: ['Electrocute'], combo: 'W Q', target: { preset: 'squishy' as const } };
  const iceborn = simulate(data, smolder);
  assert.ok(bySource(iceborn, 'item:6662').length > 0);
  assert.equal(bySource(iceborn, 'rune:8112').length, 0);
  const r = simulate(data, { ...smolder, level: 9, items: ['Essence Reaver', "Lord Dominik's Regards"], options: { stacks: 225 }, combo: 'E Q AA Q' });
  const execute = r.events.find((e) => e.label === 'Execute')!;
  assert.ok(r.events.some((e) => e.source === 'Q' && e.label !== 'Execute' && e.castId === execute.castId && e.time === execute.time));
});

test("Smolder's Q burn is proc damage: it doesn't keep Liandry's burning, unlike Brand's Blaze", () => {
  const torment = (stacks: number) => bySource(simulate(data, { champion: 'Smolder', level: 11, items: ["Liandry's Torment"], options: { stacks }, combo: 'Q', target: dummy }), 'item:6653');
  const burning = simulate(data, { champion: 'Smolder', level: 11, items: ["Liandry's Torment"], options: { stacks: 225 }, combo: 'Q', target: dummy });
  assert.ok(burning.events.some((e) => e.label === 'Super Scorcher Breath (burn)' && e.flags.proc));
  assert.equal(torment(225).length, torment(125).length);
  // Blaze's ticks refresh Liandry's: it burns past its 3s.
  const brand = simulate(data, { champion: 'Brand', level: 11, items: ["Liandry's Torment"], combo: 'Q', target: dummy });
  const ticks = bySource(brand, 'item:6653');
  assert.ok(ticks[ticks.length - 1].time - ticks[0].time > 3);
});

test("Champion proc damage triggers nothing: Kog'Maw W's on-hit lights no Liandry's, Lux's Illumination is no Electrocute hit", () => {
  const kog = simulate(data, { champion: 'KogMaw', level: 11, items: ["Liandry's Torment"], combo: 'W AA AA', target: dummy });
  assert.ok(kog.events.some((e) => e.label === 'Bio-Arcane Barrage' && e.flags.proc));
  assert.equal(bySource(kog, 'item:6653').length, 0);
  // Light Binding, the attack and the detonation are three casts, but only two hits for Electrocute.
  const lux = (combo: string) => bySource(simulate(data, { champion: 'Lux', level: 11, runes: ['Electrocute'], combo, target: dummy }), 'rune:8112').length;
  assert.equal(lux('Q wait{1s} AA'), 0);
  assert.equal(lux('Q wait{1s} AA E'), 1);
});

test("Teemo's Toxic Shot is proc damage that still triggers Dark Harvest (wiki special case); Warwick's Eternal Hunger doesn't", () => {
  // The attack takes the target from 51% to below 50%: only the on-hit after it can harvest.
  const harvests = (champion: string) => bySource(simulate(data, { champion, level: 11, runes: ['Dark Harvest'], combo: 'AA', target: { ...dummy, hpPercent: 51 } }), 'rune:8128').length;
  assert.equal(harvests('Teemo'), 1);
  assert.equal(harvests('Warwick'), 0);
});

test("Kalista's Soul-Marked: ability damage, dealt as her next attack goes off and before it lands", () => {
  const r = simulate(data, { champion: 'Kalista', level: 11, combo: 'AA P AA', target: dummy });
  const i = r.events.findIndex((e) => e.label === 'Soul-Marked');
  const attacks = bySource(r, 'AA');
  assert.ok(r.events[i].flags.ability);
  assert.equal(r.events[i].source, 'W'); // Sentinel's passive, shown under W
  // As the second attack is launched, while its spear flies.
  assert.equal(r.events[i].castId, attacks[1].castId);
  assert.ok(r.events[i].time > attacks[0].time && r.events[i].time < attacks[1].time, `${r.events[i].time} vs attacks at ${attacks.map((a) => a.time)}`);
});

test("Attacks that are also spell damage light Liandry's: Wukong Q's, Kayle E's, Dr. Mundo E's, Galio's Colossal Smash, Diana's third hit", () => {
  const torments = (champion: string, combo: string) => bySource(simulate(data, { champion, level: 11, items: ["Liandry's Torment"], combo, target: dummy }), 'item:6653').length;
  assert.equal(torments('MonkeyKing', 'AA'), 0);
  assert.ok(torments('MonkeyKing', 'Q AA') > 0);
  assert.ok(torments('Kayle', 'E AA') > 0);
  assert.ok(torments('DrMundo', 'E AA') > 0);
  assert.ok(torments('Galio', 'AA') > 0);
  assert.equal(torments('Diana', 'AA AA'), 0);
  assert.ok(torments('Diana', 'AA AA AA') > 0);
  // Wukong's attack itself is the spell damage (its bonus is proc damage), flagged like Garen Q's strike.
  const wukong = simulate(data, { champion: 'MonkeyKing', level: 11, combo: 'Q AA', target: dummy });
  const attack = bySource(wukong, 'AA')[0];
  assert.deepEqual([attack.flags.attack, attack.flags.ability, attack.flags.slot], [true, true, 'Q']);
  assert.ok(wukong.events.find((e) => e.label === 'Crushing Blow')!.flags.proc);
});

test("An ability's passive on-hit shows under that ability: Ekko's Parallel Convergence, Kayle's Starfire Spellblade", () => {
  const ekko = simulate(data, { champion: 'Ekko', level: 11, combo: 'AA', target: { ...dummy, hpPercent: 25 } });
  const convergence = ekko.events.find((e) => e.label === 'Parallel Convergence')!;
  assert.deepEqual([convergence.source, convergence.sourceLabel], ['W', 'Parallel Convergence']);
  const kayle = simulate(data, { champion: 'Kayle', level: 11, combo: 'AA', target: dummy });
  assert.equal(kayle.events.find((e) => e.label === 'Starfire Spellblade')!.source, 'E');
});

test("Qiyana: Terrashape's enchantment adds its damage once per Q or E cast, not to R", () => {
  const bonus = (enchanted: number) =>
    simulate(data, { champion: 'Qiyana', level: 11, options: { enchanted }, combo: 'Q+tremor E R', target: { ...dummy, hpPercent: 40 } }).events.filter((e) => e.label === 'Terrashape (enchanted)');
  assert.deepEqual(bonus(1).map((e) => e.castId === bonus(1)[0].castId), [true, false]);
  assert.equal(bonus(0).length, 0);
});

test("Kai'Sa: Void Seeker's Plasma stacks deal Caustic Wounds as if applied one by one, rolling over past the burst", () => {
  const plasma = (combo: string) => simulate(data, { champion: 'Kaisa', level: 11, combo, target: dummy }).events.filter((e) => e.sourceLabel === 'Second Skin');
  const [first, second] = plasma('AA AA').map((e) => e.raw);
  assert.ok(Math.abs(plasma('W')[0].raw - (first + second)) < 1e-6);
  // 4 stacks: the first of W's two stacks bursts, the second starts over.
  assert.deepEqual(plasma('AA AA AA AA W').slice(4).map((e) => e.label), ['Plasma', 'Plasma burst', 'Plasma']);
});

test("A ranged attack lands after its missile's flight (attack range / the game's missile speed); a melee one at the end of its windup", () => {
  // Jhin Q (0.25s cast, grenade lands 0.25s later) then AA: the attack only starts after the cast and flies 550 / 2600 s.
  const jhin = new Sim(data, { champion: 'Jhin', level: 11, combo: 'Q AA', target: dummy });
  const r = jhin.run(parseCombo('Q AA'));
  const [grenade] = bySource(r, 'Q');
  const [attack] = bySource(r, 'AA');
  assert.ok(grenade.time < attack.time, `grenade ${grenade.time}, attack ${attack.time}`);
  assert.ok(Math.abs(jhin.attackTravel() - 550 / 2600) < 1e-9);
  const step = r.timeline.find((s) => s.step === 'AA')!;
  assert.ok(Math.abs(attack.time - (step.end + 550 / 2600)) < 1e-6);
  const garen = new Sim(data, { champion: 'Garen', level: 11, combo: 'AA', target: dummy });
  assert.equal(garen.attackTravel(), 0);
  // Attacks that hit at once (no missile in the game files) don't fly either.
  assert.equal(new Sim(data, { champion: 'Senna', level: 11, combo: 'AA', target: dummy }).attackTravel(), 0);
});

test("Jhin reloads after his 4th shot: the 5th waits P.dv.ReloadTime from when the 4th was fired", () => {
  const sim = new Sim(data, { champion: 'Jhin', level: 11, combo: 'AA*5', target: dummy });
  const steps = sim.run(parseCombo('AA*5')).timeline;
  assert.ok(Math.abs(steps[4].start - (steps[3].end + 2.5)) < 1e-6, `4th fired at ${steps[3].end}, 5th started at ${steps[4].start}`);
});

test('What kit buffs add to an attack is decided at launch: a cast while it flies empowers the next one (Vayne Q, Kog\'Maw W)', () => {
  const vayne = simulate(data, { champion: 'Vayne', level: 11, combo: 'AA Q AA', target: dummy });
  const tumble = bySource(vayne, 'Q').filter((e) => e.label === 'Tumble');
  assert.equal(tumble.length, 1);
  assert.equal(tumble[0].castId, bySource(vayne, 'AA')[1].castId);
  const kog = simulate(data, { champion: 'KogMaw', level: 11, combo: 'AA W AA', target: dummy });
  const [first, second] = bySource(kog, 'AA');
  const barrage = kog.events.filter((e) => e.label === 'Bio-Arcane Barrage');
  assert.ok(barrage.every((e) => e.castId !== first.castId) && barrage.some((e) => e.castId === second.castId));
});

test("On-attack effects trigger at launch (Lucian's double shot), on-hit ones as it hits (Spellblade, granted as a cast starts)", () => {
  // Each ability grants its own second shot, though the next cast comes while the first attack flies.
  const lucian = simulate(data, { champion: 'Lucian', level: 11, combo: 'Q AA W AA', target: dummy });
  assert.equal(lucian.events.filter((e) => e.label === 'Lightslinger (2nd shot)').length, 2);
  // Sheen's Spellblade, granted by W while the attack flies, is used by that attack (on-hit, wiki).
  const ezreal = simulate(data, { champion: 'Ezreal', level: 11, items: ['Sheen'], combo: 'AA W', target: dummy });
  const blade = ezreal.events.find((e) => e.label === 'Spellblade')!;
  assert.equal(blade.castId, bySource(ezreal, 'AA')[0].castId);
});

test("An attack reset doesn't end an attack lockout: the attack an ability empowers waits like any other (Blitzcrank Q E AA, Darius Q W AA)", () => {
  const start = (champion: string, combo: string) => new Sim(data, { champion, level: 11, combo, target: dummy }).run(parseCombo(combo)).timeline.find((s) => s.step === 'AA')!.start;
  assert.ok(Math.abs(start('Blitzcrank', 'Q E AA') - start('Blitzcrank', 'Q AA')) < 1e-9);
  assert.ok(Math.abs(start('Darius', 'Q W AA') - 0.75) < 1e-9);
});

test('A cast lockout holds only the abilities it lists (Darius R: Q and E, not attacks)', () => {
  const steps = (combo: string) => new Sim(data, { champion: 'Darius', level: 11, combo, target: dummy }).run(parseCombo(combo)).timeline;
  assert.ok(Math.abs(steps('R Q')[1].start - 0.6167) < 1e-9);
  const [r, aa] = steps('R AA');
  assert.ok(Math.abs(aa.start - r.end) < 1e-9);
});

test('The target stands at your attack range unless the distance option places it: missiles fly there, at most their range, and range gained later leaves it (Twitch R)', () => {
  const lands = (champion: string, combo: string, options = {}) => bySource(simulate(data, { champion, level: 11, combo, options, target: dummy }), 'Q')[0].time;
  const ezreal = new Sim(data, { champion: 'Ezreal', level: 11, combo: 'Q', target: dummy });
  const speed = ezreal.evalExpr('Q.missileSpeed', { slot: 'Q' });
  assert.equal(ezreal.distance, 550);
  assert.ok(Math.abs(lands('Ezreal', 'Q', { distance: 1000 }) - lands('Ezreal', 'Q') - 450 / speed) < 1e-9);
  // Jhin Q reaches 550: no further.
  assert.ok(Math.abs(lands('Jhin', 'Q', { distance: 1000 }) - lands('Jhin', 'Q')) < 1e-9);
  const flight = (combo: string) => {
    const r = simulate(data, { champion: 'Twitch', level: 11, combo, target: dummy });
    return bySource(r, 'AA')[0].time - r.timeline.find((s) => s.step === 'AA')!.end;
  };
  assert.ok(flight('AA') > 0);
  assert.ok(Math.abs(flight('R AA') - flight('AA')) < 1e-9);
});

test("Kalista: Rend counts the spears that land during its cast; those still flying when it goes off are ripped out as they land", () => {
  const rend = (combo: string, distance?: number) => bySource(simulate(data, { champion: 'Kalista', level: 11, combo, ...(distance ? { options: { distance } } : {}), target: dummy }), 'E');
  const sim = new Sim(data, { champion: 'Kalista', level: 11, combo: [], target: dummy });
  const [one] = rend('AA E');
  assert.ok(Math.abs(one.raw - sim.evalExpr('E.calc.NormalDamage', { slot: 'E' })) < 1e-9);
  // From 1100 units the second spear is still flying when Rend goes off: the same damage, part later.
  const flying = rend('AA AA E', 1100);
  const total = (hits: ReturnType<typeof rend>) => hits.reduce((s, e) => s + e.raw, 0);
  assert.equal(flying.length, 2);
  assert.ok(flying[1].time > flying[0].time);
  assert.ok(Math.abs(total(flying) - total(rend('AA AA wait{1s} E', 1100))) < 1e-9);
});

test('Vex R is two parts: the recast dashes to the target once the shadow lands', () => {
  const r = simulate(data, { champion: 'Vex', level: 11, combo: 'R R', target: dummy });
  const sim = new Sim(data, { champion: 'Vex', level: 11, combo: [], target: dummy });
  const [surge, dash] = bySource(r, 'R');
  assert.ok(Math.abs(r.timeline[1].start - surge.time) < 1e-9);
  assert.ok(Math.abs(dash.time - surge.time - sim.distance / 2200) < 1e-9);
  assert.equal(bySource(simulate(data, { champion: 'Vex', level: 11, combo: 'R', target: dummy }), 'R').length, 1);
});

test('Xayah: Bladecaller recalls feathers still flying once they land (Q E), each after the last', () => {
  const r = simulate(data, { champion: 'Xayah', level: 11, combo: 'Q E', target: dummy });
  const [d1, d2] = bySource(r, 'Q');
  const [f1, f2] = bySource(r, 'E');
  assert.equal(bySource(r, 'E').length, 2);
  assert.ok(f1.time > d1.time && f2.time > d2.time && f2.raw < f1.raw);
  // A Clean Cuts attack still flying counts too.
  assert.equal(bySource(simulate(data, { champion: 'Xayah', level: 11, combo: 'W AA AA E', target: dummy }), 'E').length, 2);
});

test("Voltaic Cyclosword's Firmament lands before the attack or ability that fires it (wiki)", () => {
  const order = (combo: string) => simulate(data, { champion: 'Talon', level: 11, items: ['Voltaic Cyclosword'], combo, target: dummy }).events.slice(0, 2).map((e) => e.source);
  assert.deepEqual(order('AA'), ['item:6699', 'AA']);
  assert.deepEqual(order('Q'), ['item:6699', 'Q']);
});
