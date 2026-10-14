// Item, rune and engine-feature behaviour (trigger rules and timing from docs/research).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadGameData } from '../src/node/load.ts';
import { loadAllKits } from '../src/node/kits.ts';
import { simulate } from '../src/engine/sim.ts';

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
  const low = simulate(data, { champion: 'Ahri', level: 11, items: ['Shadowflame', 'Abyssal Mask'], combo: 'E', target: { maxHp: 5000, hpPercent: 0.3, armor: 0, mr: 0 } });
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
  const r = simulate(data, { champion: 'Diana', level: 11, combo: 'Q E E', target: dummy });
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
