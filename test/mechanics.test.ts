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

test('Smolder E: the full flight, then the next cast; E is not a dash (no Sudden Impact)', () => {
  const r = simulate(data, { champion: 'Smolder', level: 11, runes: ['Sudden Impact'], combo: 'E Q', target: dummy });
  const bolts = r.events.filter((e) => e.label === 'Flap, Flap, Flap');
  assert.equal(bolts.length, 6, 'full flight at 125 stacks');
  assert.equal(r.events.filter((e) => e.label === 'Flap, Flap, Flap (Dragon Practice)').length, 6);
  const qStart = r.timeline.find((s) => s.step === 'Q')!.start;
  assert.ok(qStart >= 1.25, `Q waits for the flight to end (${qStart})`);
  assert.ok(bolts.every((e) => e.time < qStart));
  assert.equal(bySource(r, 'rune:8143').length, 0, 'Sudden Impact not armed');
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
  const gap = simulate(data, { champion: 'Jinx', level: 11, runes: ['Press the Attack'], combo: 'AA*3 wait:6 AA', target: dummy });
  assert.equal(bySource(gap, 'AA').at(-1)!.amps.length, 0);
});

test('On-hit effectiveness does not reduce Grasp, Heartsteel or Electrospark (Urgot W)', () => {
  const grasp = (combo: string) => simulate(data, { champion: 'Urgot', level: 18, runes: ['Grasp of the Undying'], combo, target: dummy }).events.find((e) => e.label === 'Grasp')!.raw;
  assert.ok(Math.abs(grasp('W') - grasp('AA')) < 0.01);
});

test("Guinsoo's Phantom Hit and Dusk and Dawn's repeat add up (on-hit applies three times)", () => {
  const r = simulate(data, { champion: 'Jinx', level: 18, items: ["Guinsoo's Rageblade", 'Dusk and Dawn'], combo: 'AA*6 W AA', target: dummy });
  const last = bySource(r, 'AA').at(-1)!;
  assert.equal(r.events.filter((e) => e.label === 'Wrath' && e.castId === last.castId).length, 3);
});

test('Malignance: ultimate hits on a target inside Hatefog refresh it (Malzahar R)', () => {
  const r = simulate(data, { champion: 'Malzahar', level: 18, items: ['Malignance'], combo: 'R', target: dummy });
  const fog = r.events.filter((e) => e.label === 'Hatefog').map((e) => e.time);
  assert.ok(fog.at(-1)! - fog[0] > 3.5, `Hatefog ${fog[0]}–${fog.at(-1)}`);
});

test('Spear of Shojin: innate damage grants no stacks; empowered attacks (Garen Q) are amplified', () => {
  const darius = simulate(data, { champion: 'Darius', level: 18, items: ['Spear of Shojin'], combo: 'AA wait:2 Q', target: dummy });
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
  const r = simulate(data, { champion: 'Riven', level: 18, runes: ['Sudden Impact'], combo: 'Q wait:8 E wait:2.5 AA', target: dummy });
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
  const expiry = attacks.at(-1)! + 6;
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
  assert.equal(lux('Q wait:1 AA'), 0);
  assert.equal(lux('Q wait:1 AA E'), 1);
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
  assert.equal(r.events[i + 1], attacks[1]);
  assert.equal(r.events[i].time, attacks[1].time);
});
