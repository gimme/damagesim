// Item, rune and engine-feature behaviour (trigger rules and timing from docs/research).

import { test } from "node:test";
import assert from "node:assert/strict";
import { loadGameData } from "../src/node/load.ts";
import { loadAllKits } from "../src/node/kits.ts";
import { Sim, simulate, type Scenario, type TargetSpec } from "../src/engine/sim.ts";
import type { DamageInstance } from "../src/engine/effects.ts";
import { findItem } from "../src/engine/gamedata.ts";
import { formatCombo, parseCombo } from "../src/engine/combo.ts";
import { rankItems } from "../src/engine/analysis.ts";
import { getKit, curatedChampionIds } from "../src/kits/index.ts";

const data = loadGameData("16.20");
await loadAllKits();
const dummy = { maxHp: 5000, armor: 0, mr: 0 };
const bySource = (r: ReturnType<typeof simulate>, src: string) => r.events.filter((e) => e.source === src);
const near = (a: number, b: number) => Math.abs(a - b) < 1e-6 * Math.max(1, Math.abs(b));

test("Press the Attack: proc on the 3rd attack, +8% to later damage but not the trigger", () => {
  const r = simulate(data, { champion: "Garen", level: 11, runes: ["Press the Attack"], combo: "AA*4", target: dummy });
  const attacks = bySource(r, "AA");
  assert.equal(bySource(r, "rune:8005").length, 1);
  assert.equal(attacks[2].amps.length, 0);
  assert.ok(attacks[3].amps.some((a) => a.source === "Press the Attack" && Math.abs(a.value - 0.08) < 1e-6));
});

test("Lethal Tempo: bolt only once 6 stacks are built", () => {
  const r = simulate(data, { champion: "Jinx", level: 11, runes: ["Lethal Tempo"], combo: "AA*8", target: dummy });
  assert.equal(bySource(r, "rune:8008").length, 2); // attacks 7 and 8
});

test("Hail of Blades: three empowered attacks", () => {
  const r = simulate(data, { champion: "Garen", level: 11, runes: ["Hail of Blades"], combo: "AA*5", target: dummy });
  assert.equal(bySource(r, "rune:9923").length, 3);
});

test("Guinsoo's Rageblade: first Phantom Hit on the 7th attack doubles on-hit", () => {
  const r = simulate(data, { champion: "Jinx", level: 11, items: ["Guinsoo's Rageblade"], combo: "AA*7", target: dummy });
  // 7 attacks → 8 Wrath on-hits (the 7th applies twice).
  assert.equal(r.events.filter((e) => e.label === "Wrath").length, 8);
});

test("Energized: the attack after reaching 100 charges is Energized", () => {
  const r = simulate(data, { champion: "Jinx", level: 11, items: ["Rapid Firecannon"], options: { "energized.start": 94 }, combo: "AA AA", target: dummy });
  const procs = r.events.filter((e) => e.label === "Sharpshooter");
  assert.equal(procs.length, 1);
  assert.equal(procs[0].castId, bySource(r, "AA")[1].castId);
});

test("Shadowflame crits magic damage below 40% health, shown as its own hit (Cinderbloom); Abyssal Mask multiplies", () => {
  const ahri = (hpPercent: number, items: string[]): Scenario => ({
    champion: "Ahri",
    level: 11,
    items,
    combo: "E",
    target: { maxHp: 5000, hpPercent, armor: 0, mr: 0 },
  });
  const low = simulate(data, ahri(30, ["Shadowflame", "Abyssal Mask"]));
  const e = bySource(low, "E")[0];
  const bloom = bySource(low, "item:4645");
  // Right after E, of its cast: raw × 0.2; both × (1 + 0.12) (MR 0, Shadowflame's pen irrelevant).
  assert.deepEqual(
    bloom.map((x) => [x.label, x.castId, low.events.indexOf(x)]),
    [["Cinderbloom", e.castId, low.events.indexOf(e) + 1]],
  );
  assert.ok(near(e.final!, e.raw * 1.12), `${e.final} vs ${e.raw * 1.12}`);
  assert.ok(near(bloom[0].raw, e.raw * 0.2) && near(bloom[0].final!, e.raw * 0.2 * 1.12), `${bloom[0].final}`);
  assert.ok(near(bloom[0].targetHpAfter!, e.targetHpAfter! - bloom[0].final!));
  assert.ok(low.bySource.some((s) => s.source === "item:4645" && s.label === "Shadowflame"));
  // Infinity Edge's +30% crit damage makes it 26% (wiki); above 40% health nothing crits.
  const ie = simulate(data, ahri(30, ["Shadowflame", "Infinity Edge"]));
  assert.ok(near(bySource(ie, "item:4645")[0].raw, bySource(ie, "E")[0].raw * 0.26));
  assert.equal(bySource(simulate(data, ahri(50, ["Shadowflame"])), "item:4645").length, 0);
  // Item value counts it as the item's own damage.
  assert.deepEqual(
    rankItems(data, ahri(30, []), { candidates: ["Shadowflame"] }).items[0].itemHits.map((h) => h.name),
    ["Cinderbloom"],
  );
});

test("Yunara's passive amps Shadowflame's crits of her magic damage, and its own bonus damage once more (wiki)", () => {
  const sc = (combo: string, hpPercent = 30, items = ["Shadowflame"]): Scenario => ({
    champion: "Yunara",
    level: 11,
    items,
    combo,
    target: { maxHp: 5000, hpPercent, armor: 0, mr: 0 },
  });
  const amp = new Sim(data, sc("")).evalExpr("P.calc.Calc_Damage_Amp", { slot: "P" });
  // The two hits recorded after a hit: Cinderbloom's, then the passive's.
  const next = (r: ReturnType<typeof simulate>, x: DamageInstance) => r.events.slice(r.events.indexOf(x) + 1, r.events.indexOf(x) + 3);
  const pinned = (r: ReturnType<typeof simulate>, x: DamageInstance) => {
    const [bloom, vow] = next(r, x);
    assert.deepEqual([bloom.label, vow.label, vow.source], ["Cinderbloom", "Vow of the First Lands (crit)", "P"]);
    // "Amps it directly": of the crit's whole damage, Cinderbloom's included.
    assert.ok(near(bloom.raw, x.raw * 0.2) && near(vow.raw, x.raw * 1.2 * amp), `${x.label}: ${vow.raw} vs ${x.raw * 1.2 * amp}`);
  };
  const r = simulate(data, sc("W AA!"));
  pinned(
    r,
    r.events.find((e) => e.label === "Arc of Judgment")!,
  );
  pinned(
    r,
    r.events.find((e) => e.label === "Cultivation of Spirit")!,
  );
  // The attack's crit (physical) adds its bonus as a new instance of magic damage: Shadowflame crits it, so the passive amps it again.
  const attack = bySource(r, "AA")[0];
  const bonus = r.events.find((e) => e.source === "P" && e.castId === attack.castId && near(e.raw, amp * attack.raw))!;
  pinned(r, bonus);
  // A crit of true damage (Fiendhunter Bolts' Opening Barrage) gets it as a new instance too.
  const fh = simulate(data, sc("R AA!", 30, ["Shadowflame", "Fiendhunter Bolts"]));
  const barrage = fh.events.find((e) => e.label === "Opening Barrage")!;
  const [bloom] = next(fh, barrage);
  assert.deepEqual([bloom.label, bloom.type], ["Cinderbloom", "true"]);
  const vow = fh.events.find((e) => e.castId === barrage.castId && e.source === "P" && near(e.raw, barrage.raw * 1.2 * amp));
  assert.equal(vow?.type, "magic");
  pinned(fh, vow!);
  // Nor on what Cinderbloom doesn't crit: First Strike's unamplified bonus true damage.
  const first = simulate(data, { ...sc("W"), runes: ["First Strike"] });
  const strikes = bySource(first, "rune:8369");
  assert.ok(strikes.length > 0);
  for (const b of strikes)
    assert.deepEqual(
      first.events.filter((e) => e.castId === b.castId),
      [b],
    );
  // No Cinderbloom, nothing more: above 40% health, or without Shadowflame.
  for (const s of [sc("W AA!", 90), sc("W AA!", 30, [])]) {
    const q = simulate(data, s);
    assert.equal(q.events.filter((e) => e.label === "Vow of the First Lands (crit)").length, 1);
  }
  // Item value: Shadowflame's own hits are Cinderbloom's, its procs what its crits unlock.
  const row = rankItems(data, sc("W AA!", 30, []), { candidates: ["Shadowflame"] }).items[0];
  assert.deepEqual([row.itemHits.map((h) => h.name), row.procs.map((p) => [p.source, p.name])], [["Cinderbloom"], [["P", "Vow of the First Lands (crit)"]]]);
});

test("Luden's Echo: one full echo plus five at 20% on a single target", () => {
  const r = simulate(data, { champion: "Ahri", level: 11, items: ["Luden's Echo"], combo: "E", target: dummy });
  const echoes = bySource(r, "item:6655");
  assert.equal(echoes.length, 6);
  const total = echoes.reduce((s, x) => s + x.raw, 0);
  assert.ok(Math.abs(total - 2 * echoes[0].raw) < 0.01);
});

test("Ability charges (ammo) limit casts: Rengar Q waits for its recharge", () => {
  const r = simulate(data, { champion: "Rengar", level: 11, combo: "Q AA Q AA", target: dummy });
  const steps = r.timeline.filter((s) => s.step === "Q");
  assert.ok(steps[1].start - steps[0].start > 3.5, `second Q at ${steps[1].start}`);
});

test("Cooldown resets from hits apply before the next cast (Diana E on a Moonlit target)", () => {
  // E waits for Q's bolt to land (as in play), so that it consumes the Moonlight.
  const r = simulate(data, { champion: "Diana", level: 11, combo: "Q wait{0.5s} E E", target: dummy });
  const es = r.timeline.filter((s) => s.step === "E");
  assert.equal(es.length, 2);
  assert.ok(es[1].start - es[0].start < 2, `second E waited ${es[1].start - es[0].start}s`);
});

test("Delayed CC: Aftershock detonates 2.5s after the delayed root lands (Senna W)", () => {
  const r = simulate(data, { champion: "Senna", level: 11, runes: ["Aftershock"], combo: "W", target: dummy });
  const shock = bySource(r, "rune:8439")[0];
  const w = bySource(r, "W")[0];
  assert.ok(shock && shock.time - w.time > 3.4, `aftershock at ${shock?.time}, W hit at ${w.time}`);
});

test("Reduced on-hit effectiveness: Azir soldier stabs apply on-hit at 50%", () => {
  const base = simulate(data, { champion: "Azir", level: 11, items: ["Nashor's Tooth"], combo: "AA", target: dummy });
  const stab = simulate(data, { champion: "Azir", level: 11, items: ["Nashor's Tooth"], combo: "W AA", target: dummy });
  const n0 = base.events.find((e) => e.source === "item:3115")!.raw;
  const n1 = stab.events.find((e) => e.source === "item:3115")!.raw;
  assert.ok(Math.abs(n1 - n0 * 0.5) < 0.01, `${n1} vs ${n0}`);
});

test("Recast index scales Aatrox Q 1/2/3 (100% / 125% / 150%)", () => {
  const r = simulate(data, { champion: "Aatrox", level: 11, combo: "Q AA Q AA AA Q", target: dummy });
  const q = bySource(r, "Q");
  assert.equal(q.length, 3);
  assert.ok(Math.abs(q[1].raw / q[0].raw - 1.25) < 0.01 && Math.abs(q[2].raw / q[0].raw - 1.5) < 0.01);
});

test("Build legality warnings (two Spellblade items)", () => {
  const r = simulate(data, { champion: "Ezreal", level: 11, items: ["Trinity Force", "Lich Bane"], combo: "Q", target: dummy });
  assert.ok(r.warnings.some((w) => w.includes("Spellblade")));
});

test("Build legality warnings: a seventh item only as boots, in the bot lane quest's slot", () => {
  const warnings = (items: string[]) => simulate(data, { champion: "Ahri", level: 18, items, combo: "Q", target: dummy }).warnings;
  const six = ["Luden's Echo", "Rabadon's Deathcap", "Void Staff", "Shadowflame", "Zhonya's Hourglass", "Banshee's Veil"];
  assert.deepEqual(warnings(six), []);
  assert.deepEqual(warnings([...six, "Sorcerer's Shoes"]), []);
  assert.match(warnings([...six, "Morellonomicon"])[0], /^7 items: a champion can hold 6/);
  assert.match(warnings([...six, "Sorcerer's Shoes", "Morellonomicon"])[0], /^8 items/);
  // Tier 3 boots are boots, Gunmetal Greaves too, though the game's data doesn't tag it.
  assert.deepEqual(warnings([...six, "Gunmetal Greaves"]), []);
});

test("Abilities that apply on-hit and trigger on-attack (Smolder Q): Spellblade, Energized and Lethal Tempo stacks", () => {
  const r = simulate(data, {
    champion: "Smolder",
    level: 11,
    items: ["Essence Reaver", "Rapid Firecannon"],
    options: { "energized.start": 100 },
    combo: "Q",
    target: dummy,
  });
  assert.equal(bySource(r, "item:3508").length, 1, "Spellblade");
  assert.equal(r.events.filter((e) => e.label === "Sharpshooter").length, 1, "Energized proc");
  // On-attack: Lethal Tempo stacks from Q casts, so attacks after 6 Qs fire bolts.
  const lt = simulate(data, { champion: "Smolder", level: 11, runes: ["Lethal Tempo"], combo: "Q AA Q AA Q AA", target: dummy });
  assert.equal(bySource(lt, "rune:8008").length, 0);
  const lt2 = simulate(data, { champion: "Smolder", level: 11, runes: ["Lethal Tempo"], combo: "Q AA Q AA Q AA AA", target: dummy });
  assert.equal(bySource(lt2, "rune:8008").length, 1, "the 7th on-attack (an AA after 3 Q + 3 AA) fires a bolt");
});

test("Smolder E: the full flight, then the next cast; E is not a dash (no Sudden Impact)", () => {
  const r = simulate(data, { champion: "Smolder", level: 11, runes: ["Sudden Impact"], combo: "E Q", target: dummy });
  const bolts = r.events.filter((e) => e.label === "Flap, Flap, Flap");
  assert.equal(bolts.length, 6, "full flight at 125 stacks");
  assert.equal(r.events.filter((e) => e.label === "Flap, Flap, Flap (Dragon Practice)").length, 6);
  const qStart = r.timeline.find((s) => s.step === "Q")!.start;
  assert.ok(qStart >= 1.25, `Q waits for the flight to end (${qStart})`);
  // Fired during the flight, each bolt then flies its range.
  const travel = new Sim(data, { champion: "Smolder", level: 11, combo: [] }).evalExpr("castRange / missileSpeed", { slot: "E" });
  assert.ok(bolts.every((e) => e.time - travel < qStart));
  assert.equal(bySource(r, "rune:8143").length, 0, "Sudden Impact not armed");
});

test("Smolder E: a flight time lands the bolts fired before it ends, and frees Smolder then", () => {
  const at = (r: ReturnType<typeof simulate>, step: string) => r.timeline.find((s) => s.step === step)!.start;
  const bolts = (r: ReturnType<typeof simulate>) => r.events.filter((e) => e.label === "Flap, Flap, Flap").map((e) => e.time);
  const full = simulate(data, { champion: "Smolder", level: 11, combo: "E Q", target: dummy });
  const all = bolts(full);
  const half = simulate(data, { champion: "Smolder", level: 11, combo: "E{0.5s} Q", target: dummy });
  const travel = new Sim(data, { champion: "Smolder", level: 11, combo: [] }).evalExpr("castRange / missileSpeed", { slot: "E" });
  assert.deepEqual(
    bolts(half),
    all.filter((t) => t - travel <= 0.5 + 1e-9),
    "the bolts fired in the first 0.5s, at their times",
  );
  assert.equal(half.events.filter((e) => e.label === "Flap, Flap, Flap (Dragon Practice)").length, bolts(half).length, "Dragon Practice follows the bolts");
  assert.ok(Math.abs(at(half, "Q") - 0.5) < 1e-6, "Q as the flight ends");
  // Never longer than the full flight.
  const long = simulate(data, { champion: "Smolder", level: 11, combo: "E{5s} Q", target: dummy });
  assert.equal(bolts(long).length, all.length);
  assert.equal(at(long, "Q"), at(full, "Q"));
  assert.ok(long.warnings.some((w) => /lasts 0s to 1.25s, so E\{5s\} lasts 1.25s/.test(w)));
  // At least until the first bolt is fired: as the flight starts.
  const none = simulate(data, { champion: "Smolder", level: 11, combo: "E{0s} Q", target: dummy });
  assert.equal(bolts(none).length, 1);
  assert.ok(Math.abs(at(none, "Q")) < 1e-6);
  assert.ok(new Sim(data, { champion: "Smolder", level: 11, combo: [] }).castSetting({ slot: "E" })!.value === 1.25);
});

test("A toggle left on longer ticks longer, without busying the caster; a burn can't be ended early", () => {
  const karthus = (combo: string) => simulate(data, { champion: "Karthus", level: 11, combo, target: dummy });
  const ticks = (combo: string) => karthus(combo).events.filter((e) => e.label === "Defile").length;
  assert.equal(ticks("E"), 16, "4s by default");
  assert.equal(ticks("E{1s}"), 4);
  assert.equal(ticks("E{8s}"), 32);
  assert.equal(karthus("E{8s} W").timeline[1].start, karthus("E W").timeline[1].start, "Karthus acts while Defile is on");
  const r = simulate(data, { champion: "Smolder", level: 11, options: { stacks: 250 }, combo: "Q{1s}", target: dummy });
  assert.equal(r.events.filter((e) => e.label === "Super Scorcher Breath (burn)").length, 3);
  assert.ok(r.warnings.some((m) => /can't be ended early/.test(m)));
  assert.equal(new Sim(data, { champion: "Smolder", level: 11, combo: [] }).castSetting({ slot: "Q" }), null);
});

test("Yunara's W bead lingers on the target for the step's seconds: by default one standing in its path, at most all its range and 1s more", () => {
  const yunara = (combo: string) => simulate(data, { champion: "Yunara", level: 11, combo, target: dummy });
  const ticks = (combo: string) => yunara(combo).events.filter((e) => e.label === "Arc of Judgment (linger)").length;
  assert.equal(ticks("W"), 6, "1.5s: the bead crosses a standing champion at 150 units/s");
  assert.equal(ticks("W{2s}"), 8);
  assert.equal(ticks("W{0.25s}"), 1);
  // W{0s}: the impact alone (a target stepping out of the bead).
  assert.deepEqual(
    yunara("W{0s}").events.map((e) => e.label),
    ["Arc of Judgment"],
  );
  // Its 1150 range at 150 units/s, then the 1s linger there, however far the target stands.
  for (const distance of [100, 550, 1000]) {
    const sim = new Sim(data, { champion: "Yunara", level: 11, combo: [], options: { distance } });
    assert.deepEqual(sim.castSetting({ slot: "W" }), { kind: "lasts", value: 1.5, min: 0, max: 8.5, unit: "s" });
  }
  assert.equal(ticks("W{10s}"), 34);
  assert.equal(yunara("W{4s} AA").timeline[1].start, yunara("W AA").timeline[1].start, "Yunara acts while it lingers");
});

test("Yunara's W and E cast Arc of Ruin and Untouchable Shadow while Transcendent State lasts", () => {
  const yunara = (combo: string) => simulate(data, { champion: "Yunara", level: 16, combo, target: dummy });
  const cast = (combo: string) => yunara(combo).timeline.map((t) => t.step);
  assert.deepEqual(cast("W E R W E"), ["W", "E", "R", "W:ruin", "E:dash"]);
  assert.deepEqual(
    yunara("R W").events.map((e) => e.sourceLabel),
    ["Arc of Ruin"],
  );
  // Once it ends, W again; W:ruin outside it is W, with a warning.
  const after = new Sim(data, { champion: "Yunara", level: 16, combo: [] }).evalExpr("R.dv.Buff_Duration", { slot: "R" });
  assert.deepEqual(cast(`R wait{${Math.ceil(after) + 1}s} W`).at(-1), "W");
  const named = yunara("W:ruin");
  assert.deepEqual(
    named.timeline.map((t) => t.step),
    ["W"],
  );
  assert.ok(named.warnings.some((w) => /isn't castable now/.test(w)));
  // Arc of Ruin has no linger to set.
  assert.equal(new Sim(data, { champion: "Yunara", level: 16, combo: [] }).castSetting({ slot: "W", variant: "ruin" }), null);
});

test("A form's spells are cast by themselves in it, under their own names: Elise, Jayce, Nidalee, Rek'Sai, Gnar, Karma, Kayn", () => {
  const run = (champion: string, combo: string, options?: Record<string, number>) =>
    simulate(data, { champion, level: 16, combo, options, target: { maxHp: 5000, armor: 50, mr: 50 } });
  const cast = (r: ReturnType<typeof simulate>) => r.timeline.map((t) => t.step);
  const hits = (r: ReturnType<typeof simulate>) => [...new Set(r.events.map((e) => e.sourceLabel))];
  const elise = run("Elise", "Q R Q R");
  assert.deepEqual(cast(elise), ["Q", "R", "Q:spider", "R"]);
  assert.deepEqual(hits(elise).slice(0, 2), ["Neurotoxin", "Venomous Bite"]);
  assert.deepEqual(cast(run("Jayce", "Q R Q")), ["Q", "R", "Q:cannon"]);
  assert.deepEqual(cast(run("Jayce", "Q R Q", { cannon: 1 })), ["Q:cannon", "R:cannon", "Q"]);
  assert.deepEqual(cast(run("Nidalee", "Q R W E Q")), ["Q", "R", "W:pounce", "E:swipe", "Q:takedown"]);
  // Rek'Sai starts burrowed; W toggles it, each form with its own Q cooldown (Queen's Wrath right after Prey Seeker).
  const reksai = run("RekSai", "Q W Q W Q");
  assert.deepEqual(cast(reksai), ["Q:burrowed", "W", "Q", "W:burrow", "Q:burrowed"]);
  assert.ok(reksai.timeline[2].start < 1, "Queen's Wrath isn't held by Prey Seeker's cooldown");
  assert.ok(reksai.timeline[3].start >= reksai.timeline[1].start + 4 - 1e-9, "Burrow's cooldown starts with Un-burrow");
  assert.deepEqual(cast(run("RekSai", "Q W", { burrowed: 0 })), ["Q", "W:burrow"]);
  assert.deepEqual(cast(run("RekSai", "R W")), ["R", "W:burrow"], "Void Rush ends unburrowed");
  // Gnar: Mega by a P step (Rage full) or a Mega-only cast, 15s.
  assert.deepEqual(cast(run("Gnar", "Q P Q")), ["Q", "P", "Q:mega"]);
  assert.deepEqual(cast(run("Gnar", "W E")), ["W", "E:mega"]);
  assert.deepEqual(hits(run("Gnar", "W E")), ["Wallop", "Crunch"]);
  // Karma's Mantra empowers one cast.
  assert.deepEqual(cast(run("Karma", "R Q W")), ["R", "Q:mantra", "W"]);
  assert.deepEqual(cast(run("Kayn", "W", { form: 2 })), ["W:darkin"]);
  assert.deepEqual(cast(run("Kayn", "W")), ["W"]);
  // Options start in the other form.
  assert.deepEqual(cast(run("Elise", "Q R Q", { spider: 1 })), ["Q:spider", "R", "Q"]);
  assert.deepEqual(cast(run("Gnar", "Q", { mega: 1 })), ["Q:mega"]);
  assert.deepEqual(cast(run("Jayce", "Q", { cannon: 1 })), ["Q:cannon"]);
  assert.deepEqual(cast(run("Nidalee", "Q", { cougar: 1 })), ["Q:takedown"]);
});

test("A form's spells show their own icons: on their hits, by source and on their steps", () => {
  const run = (champion: string, combo: string, options?: Record<string, number>) =>
    simulate(data, { champion, level: 16, combo, options, target: { maxHp: 9000, armor: 50, mr: 50 } });
  const file = (p?: string) => p?.split("/").pop();
  const icons = (r: ReturnType<typeof simulate>) => Object.fromEntries(r.bySource.map((s) => [s.label, file(s.icon)]));
  const elise = run("Elise", "Q R Q");
  assert.deepEqual(
    elise.timeline.map((t) => file(t.icon)),
    ["elisehumanq.png", "eliser.png", "elisespiderq.png"],
  );
  assert.equal(icons(elise)["Venomous Bite"], "elisespiderq.png");
  assert.ok(elise.events.filter((e) => e.sourceLabel === "Venomous Bite").every((e) => file(e.icon) === "elisespiderq.png"));
  // A variant without a spell of its own names its icon (Arc of Ruin), or which of its spell's (Soulflare).
  assert.equal(icons(run("Yunara", "R W"))["Arc of Ruin"], "yunara_rw.png");
  assert.equal(icons(run("Karma", "R Q"))["Soulflare"], "karma_q2.png");
  // The empowered attack a cast's buff gives shows the cast's (Takedown); Kayn's icons follow his form.
  assert.equal(icons(run("Nidalee", "Q AA", { cougar: 1 }))["Takedown"], "nidalee_q2.png");
  assert.equal(icons(run("Kayn", "Q", { form: 2 }))["Reaping Slash"], "kayn_q_slay.png");
  assert.equal(icons(run("Kayn", "Q"))["Reaping Slash"], "kayn_q_primary.png");
});

test("Nidalee's Javelin Toss deals more the farther it flies: the step's distance, from 525 to 1300 units (wiki)", () => {
  const javelin = (combo: string) => {
    const r = simulate(data, { champion: "Nidalee", level: 16, combo, target: dummy });
    return { r, hit: r.events.find((e) => e.label === "Javelin Toss")! };
  };
  const sim = new Sim(data, { champion: "Nidalee", level: 16, combo: [] });
  const [min, multi] = [sim.evalExpr("calc.HumanMinimumDamage", { slot: "Q" }), sim.evalExpr("dv.DamageMulti", { slot: "Q" })];
  // By default the target's distance, her attack range: the minimum.
  assert.ok(near(javelin("Q").hit.raw, min));
  assert.ok(near(javelin("Q{900u}").hit.raw, min * (1 + (multi - 1) * (375 / 775))));
  assert.ok(near(javelin("Q{1300u}").hit.raw, min * multi));
  // It flies there at its speed (1300) from the start of the cast.
  const far = javelin("Q{1300u}");
  assert.ok(near(far.hit.time, 1300 / 1300), `${far.hit.time}`);
  // At most its range; nothing to set on Takedown.
  assert.ok(javelin("Q{2000u}").r.warnings.some((w) => /0 to 1500 units/.test(w)));
  assert.deepEqual(sim.castSetting({ slot: "Q" }), { kind: "distance", value: 525, min: 0, max: 1500, unit: "u" });
  assert.equal(sim.castSetting({ slot: "Q", variant: "takedown" }), null);
  assert.deepEqual(parseCombo("Q{1300u}"), [{ type: "ability", slot: "Q", distance: 1300 }]);
  assert.equal(formatCombo(parseCombo("Q{1300u}")), "Q{1300u}");
});

test("Yunara's Q and Samira's R show the HUD's icon once they can be cast, not their first, grayed out", () => {
  const file = (p?: string) => p?.split("/").pop();
  for (const [champion, slot, combo, icon] of [
    ["Yunara", "Q", "AA", "yunara_q2.png"],
    ["Samira", "R", "R", "samirar8.png"],
  ] as const) {
    const r = simulate(data, { champion, level: 16, combo, target: dummy });
    assert.equal(file(new Sim(data, { champion, level: 16, combo: [] }).slotIcon(slot)), icon);
    assert.equal(file(r.keyCasts.at(-1)?.[slot]?.icon), icon);
    // Its hits too, cast or not (Yunara's Q on-hit from attacks alone).
    assert.ok(
      r.bySource.some((s) => s.source === slot && file(s.icon) === icon),
      `${champion} ${slot}`,
    );
  }
});

test("Fizz's shark, Zoe's star and Hecarim's charge go by the step's distance (wiki)", () => {
  const run = (champion: string, combo: string) => simulate(data, { champion, level: 16, combo, target: dummy });
  const hit = (champion: string, combo: string, label: string) => run(champion, combo).events.find((e) => e.label === label)!.raw;
  const sim = (champion: string) => new Sim(data, { champion, level: 16, combo: [] });
  // Fizz: under 455 units, 455 to 910, over 910 (by default the target's distance, in melee).
  const fizz = sim("Fizz");
  const sharks = ["calc.SmallSharkDamage", "calc['{262c3c02}']", "calc.BigSharkDamage"].map((e) => fizz.evalExpr(e, { slot: "R" }));
  assert.deepEqual(
    ["R", "R{454u}", "R{455u}", "R{910u}", "R{911u}"].map((c) => hit("Fizz", c, "Chum the Waters")),
    [sharks[0], sharks[0], sharks[1], sharks[1], sharks[2]],
  );
  // Zoe: +0% to +150% from 800 to 2550 units, +25% at each of the wiki's points; its range at 1200 speed, then 2500.
  const zoe = sim("Zoe");
  const [min, max] = [zoe.evalExpr("calc.TotalDamageTooltip", { slot: "Q" }), zoe.evalExpr("calc.MaxDamageTooltip", { slot: "Q" })];
  assert.ok(near(hit("Zoe", "Q", "Paddle Star!"), min) && near(hit("Zoe", "Q{800u}", "Paddle Star!"), min));
  assert.ok(near(hit("Zoe", "Q{950u}", "Paddle Star!"), min + (max - min) / 6));
  assert.ok(near(hit("Zoe", "Q{1800u}", "Paddle Star!"), min + ((max - min) * 3.5) / 6));
  assert.ok(near(hit("Zoe", "Q{2550u}", "Paddle Star!"), max));
  const star = run("Zoe", "Q{2550u}").events.find((e) => e.label === "Paddle Star!")!;
  assert.ok(near(star.time, zoe.evalExpr("castTime", { slot: "Q" }) + 800 / 1200 + 1750 / 2500), `${star.time}`);
  // Hecarim: the run before the attack, none by default; the buff keeps it through other casts.
  const hec = sim("Hecarim");
  const [hmin, hmax] = [hec.evalExpr("calc.MinDamage", { slot: "E" }), hec.evalExpr("calc.MaxDamage", { slot: "E" })];
  assert.deepEqual(
    ["E AA", "E{600u} AA", "E{1200u} Q AA"].map((c) => hit("Hecarim", c, "Devastating Charge")),
    [hmin, (hmin + hmax) / 2, hmax],
  );
  assert.deepEqual(hec.castSetting({ slot: "E" }), { kind: "distance", value: 0, min: 0, max: 1200, unit: "u" });
  assert.equal(zoe.castSetting({ slot: "Q" })?.max, 2550);
});

test("What each ability key casts through the combo: the form at each step, for the combo card's keys", () => {
  const file = (p?: string) => p?.split("/").pop();
  const r = simulate(data, { champion: "Elise", level: 16, combo: "Q R", target: dummy });
  assert.deepEqual(
    r.keyCasts.map((k) => [k.Q?.name, file(k.Q?.icon)]),
    [
      ["Neurotoxin", "elisehumanq.png"],
      ["Neurotoxin", "elisehumanq.png"],
      ["Venomous Bite", "elisespiderq.png"],
    ],
  );
  // Jayce's R is its other spell in cannon form, and so is the empowered attack it gives.
  const jayce = simulate(data, { champion: "Jayce", level: 16, combo: "R AA", options: { cannon: 1 }, target: dummy });
  assert.equal(file(jayce.timeline[0].icon), "jaycer_melee.png");
  assert.equal(file(jayce.bySource.find((s) => s.label === "Transform: Mercury Hammer")?.icon), "jaycer_melee.png");
  // Shadow Assassin's W, its own spell, and Kayn's passive by form.
  const kayn = simulate(data, { champion: "Kayn", level: 16, combo: "W", options: { form: 1 }, target: dummy });
  assert.deepEqual(
    kayn.bySource.map((s) => file(s.icon)),
    ["kayn_w_ass.png", "kayn_passive_ass.png"],
  );
});

test("A charge held for a step's seconds: damage, crowd control and cast time follow the hold", () => {
  const sion = (combo: string) => simulate(data, { champion: "Sion", level: 11, combo, target: dummy });
  const smash = (r: ReturnType<typeof simulate>) => r.events.find((e) => e.source === "Q")!;
  const sim = new Sim(data, { champion: "Sion", level: 11, combo: [] });
  const [min, max] = [sim.evalExpr("calc.MinDamageTotal", { slot: "Q" }), sim.evalExpr("calc.MaxDamageTotal", { slot: "Q" })];
  assert.ok(Math.abs(smash(sion("Q")).raw - max) < 1e-6, "full charge by default");
  assert.ok(Math.abs(smash(sion("Q{0s}")).raw - min) < 1e-6);
  assert.ok(Math.abs(smash(sion("Q{1s}")).raw - (min + max) / 2) < 1e-6);
  assert.equal(sion("Q{1s}").timeline[0].end, 1.25, "the 1s hold, then locked out for 0.25s");
  assert.deepEqual(sim.castSetting({ slot: "Q" }), { kind: "held", value: 2, min: 0, max: 2, unit: "s" });
  // Stunned only when charged 1s or more: 1.25s, plus 0.25s per 0.25s beyond.
  const stun = (combo: string) => {
    const s = new Sim(data, { champion: "Sion", level: 11, combo: [] });
    s.run(parseCombo(combo));
    return s.evalExpr(s.kit.abilities.Q!.cc![0].duration, { slot: "Q" });
  };
  assert.equal(stun("Q{0.5s}"), 0);
  assert.equal(stun("Q{1s}"), 1.25);
  assert.equal(stun("Q{1.5s}"), 1.75);
  // K'Sante W is released after 0.4s at the earliest.
  assert.ok(Math.abs(simulate(data, { champion: "KSante", level: 11, combo: "W{0s}", target: dummy }).timeline[0].end - 0.4) < 1e-6);
  // Viego W defaults to a quick release.
  assert.equal(simulate(data, { champion: "Viego", level: 11, combo: "W", target: dummy }).timeline[0].end, 0);
  // Janna's tornado grows while she acts: it hits later, harder, and she isn't held up.
  const janna = (combo: string) => simulate(data, { champion: "Janna", level: 11, combo, target: dummy });
  const gale = (r: ReturnType<typeof simulate>) => r.events.find((e) => e.source === "Q")!;
  const j = new Sim(data, { champion: "Janna", level: 11, combo: [] });
  const [jmin, jmax] = [j.evalExpr("calc.MinimumDamage", { slot: "Q" }), j.evalExpr("calc.MaxDamage", { slot: "Q" })];
  assert.ok(Math.abs(gale(janna("Q")).raw - jmin) < 1e-6);
  assert.ok(Math.abs(gale(janna("Q{1.5s}")).raw - (jmin + jmax) / 2) < 1e-6);
  // Sent 3s later, it reaches the target sooner: its range grew, and it always takes 1.25s for all of it.
  const later = gale(janna("Q{3s}")).time - gale(janna("Q")).time;
  assert.ok(Math.abs(gale(janna("Q{3s}")).raw - jmax) < 1e-6 && later > 2.5 && later < 3);
  assert.equal(janna("Q{3s} W").timeline[1].start, janna("Q W").timeline[1].start);
});

test("A channel ended early lands the hits fired by then, not the one at its end", () => {
  // Xerath R: the shots fired, the last at 1.7s (0.5s, then every 0.6s) and landing 0.627s later.
  const xerath = simulate(data, { champion: "Xerath", level: 11, combo: "R{3} Q", target: dummy });
  assert.deepEqual(
    xerath.events.filter((e) => e.source === "R").map((e) => Math.round(e.time * 1000) / 1000),
    [1.127, 1.727, 2.327],
  );
  const castTime = new Sim(data, { champion: "Xerath", level: 11, combo: [] }).spellFor("R").castTime ?? 0;
  assert.ok(Math.abs(xerath.timeline[1].start - (castTime + 1.7)) < 1e-6, "free once the last shot is fired");
  assert.equal(
    simulate(data, { champion: "Xerath", level: 11, combo: "R{0}", target: dummy }).events.filter((e) => e.source === "R").length,
    1,
    "at least one shot",
  );
  const fiddle = (combo: string) =>
    simulate(data, { champion: "Fiddlesticks", level: 11, combo, target: dummy }).events.filter((e) => e.label === "Bountiful Harvest (final)").length;
  assert.equal(fiddle("W"), 1);
  assert.equal(fiddle("W{1s}"), 0);
  // Jhin R: the shots in the order they're fired, the 4th (its own component) last.
  const jhin = (combo: string) => simulate(data, { champion: "Jhin", level: 11, combo, target: dummy });
  const shots = (r: ReturnType<typeof simulate>) => r.events.filter((e) => e.source === "R").map((e) => e.label);
  assert.deepEqual(shots(jhin("R")), ["Curtain Call", "Curtain Call", "Curtain Call", "Curtain Call (4th shot)"]);
  assert.deepEqual(shots(jhin("R{2}")), ["Curtain Call", "Curtain Call"]);
  assert.ok(jhin("R{2} AA").timeline[1].start < jhin("R AA").timeline[1].start, "free once the 2nd shot is fired");
  assert.deepEqual(new Sim(data, { champion: "Jhin", level: 11, combo: [] }).castSetting({ slot: "R" }), {
    kind: "count",
    value: 4,
    min: 1,
    max: 4,
    unit: "shots",
  });
  // Bel'Veth E: another ability ends it.
  const belveth = simulate(data, { champion: "Belveth", level: 11, combo: "E{0.5s} Q", target: dummy });
  assert.ok(belveth.events.filter((e) => e.source === "E").every((e) => e.time <= 0.5));
  assert.equal(belveth.timeline[1].start, 0.5);
});

test("A number, hit or optional hit a cast doesn't take is warned about", () => {
  const warnings = (champion: string, combo: string) => simulate(data, { champion, level: 11, combo, target: dummy }).warnings;
  assert.deepEqual(warnings("Xerath", "R{2.5}"), ["Rite of the Arcane fires whole shots, so R{2.5} fires 3"]);
  assert.deepEqual(warnings("Xerath", "R{9}"), ["Rite of the Arcane fires 1 to 5 shots, so R{9} fires 5"]);
  assert.deepEqual(warnings("Ahri", "Q{foo:3}+bar AA+baz"), [
    'Orb of Deception has no hit "foo" (available: out, back)',
    'Orb of Deception has no optional hit "bar" (available: none)',
    'Attacks have no optional hit "baz" (available: none)',
  ]);
  assert.deepEqual(warnings("Swain", "R+endFlare"), []);
  // A crit mark on a step that can't crit is ignored; "no crit" asks for what it gets.
  assert.deepEqual(warnings("Ahri", "Q! Q?"), ["Q! can't crit, so it runs as Q"]);
});

test("Viego's second hit on a marked target, after an attack or R (checked in game)", () => {
  const viego = (combo: string, items: string[] = [], runes: string[] = []) =>
    simulate(data, { champion: "Viego", level: 16, items, runes, combo, target: dummy });
  const labels = (r: ReturnType<typeof simulate>) => r.events.map((e) => e.label);
  // After an attack, it counts as one for on-attack effects: Kraken Slayer's 3rd attack is the next.
  assert.ok(viego("Q AA AA", ["Kraken Slayer"]).events.some((e) => e.source === "item:6672"));
  // A separate hit: Q, then the attack or R and its second hit, set off Electrocute.
  assert.ok(viego("Q AA", [], ["Electrocute"]).events.some((e) => e.source === "rune:8112"));
  assert.ok(viego("Q R", [], ["Electrocute"]).events.some((e) => e.source === "rune:8112"));
  // On-hit effects apply to R's strike and its second hit.
  assert.equal(labels(viego("W R", ["Nashor's Tooth"])).filter((l) => l === "Icathian Bite").length, 2);
  // It can crit after R, so R! and R? mark it.
  const second = (combo: string) => viego(combo, ["Infinity Edge"]).events.find((e) => e.label === "Second strike")!.raw;
  assert.ok(second("W R!") > second("W R") && second("W R") > second("W R?"));
  assert.deepEqual(viego("W R!").warnings, []);
});

test("On-hit-only abilities (Fizz Q) consume Spellblade but do not trigger on-attack effects", () => {
  const r = simulate(data, { champion: "Fizz", level: 11, items: ["Lich Bane"], runes: ["Lethal Tempo"], combo: "Q", target: dummy });
  assert.equal(bySource(r, "item:3100").length, 1, "Spellblade");
  const lt = simulate(data, { champion: "Fizz", level: 11, runes: ["Lethal Tempo"], combo: "AA AA AA AA AA AA Q AA", target: dummy });
  // 6 attacks build max stacks; Q (no on-attack) neither adds a stack nor fires; the next AA fires.
  assert.equal(bySource(lt, "rune:8008").length, 1);
});

test("Press the Attack: single-target on-hit abilities stack it, area on-hits (Katarina daggers) do not", () => {
  const yas = simulate(data, { champion: "Yasuo", level: 11, runes: ["Press the Attack"], combo: "Q AA AA", target: dummy });
  assert.equal(bySource(yas, "rune:8005").length, 1);
  // Shunpo + Dagger slash + attack: the slash is an area on-hit, so only two stacks.
  const kat = simulate(data, { champion: "Katarina", level: 11, runes: ["Press the Attack"], combo: "E P AA", target: dummy });
  assert.ok(kat.events.some((e) => e.label === "Voracity (Dagger)"));
  assert.equal(bySource(kat, "rune:8005").length, 0);
});

test("Target presets follow the target level; levelDiff is relative to yours; numbers override", () => {
  const at = (level: number, levelDiff = 0) => simulate(data, { champion: "Ahri", level, combo: "AA", target: { preset: "tank", levelDiff } }).target;
  const t11 = at(11);
  const t13 = at(11, 2);
  assert.equal(t11.level, 11);
  assert.equal(t13.level, 13);
  assert.ok(t13.maxHp > t11.maxHp && t13.armor > t11.armor);
  assert.ok(at(18).maxHp > at(11).maxHp + 1500, "more items at 18");
  const squishy = simulate(data, { champion: "Ahri", level: 11, combo: "AA", target: { preset: "squishy" } }).target;
  assert.ok(squishy.maxHp < t11.maxHp && squishy.armor < t11.armor);
  const over = simulate(data, { champion: "Ahri", level: 11, combo: "AA", target: { preset: "tank", mr: 30 } }).target;
  assert.equal(over.mr, 30);
  const champ = simulate(data, { champion: "Ahri", level: 11, combo: "AA", target: { champion: "Jinx", levelDiff: -2 } }).target;
  assert.equal(champ.level, 9);
});

test("A preset's items replace its typical build; only their stats count", () => {
  const at = (target: TargetSpec) => simulate(data, { champion: "Ahri", level: 16, combo: "AA", target }).target;
  const typical = at({ preset: "squishy" });
  assert.equal(typical.bonusArmor, findItem(data, "Guardian Angel").stats.armor, "Guardian Angel as the 5th item at 16");
  const zhonya = at({ preset: "squishy", items: ["Zhonya's Hourglass"] });
  assert.equal(zhonya.bonusArmor, findItem(data, "Zhonya's Hourglass").stats.armor);
  assert.ok(Math.abs(zhonya.armor - zhonya.bonusArmor - (typical.armor - typical.bonusArmor)) < 1e-9, "same base");
  const none = at({ preset: "tank", items: [] });
  assert.equal(none.bonusArmor, 0);
  assert.ok(none.bonusHp > 0, "health shards stay");
});

test("Target totals keep the base and set the bonus; a bonus adds to the base; raw numbers are base", () => {
  const at = (target: TargetSpec) => simulate(data, { champion: "Ahri", level: 11, combo: "AA", target }).target;
  const close = (a: number, b: number) => assert.ok(Math.abs(a - b) < 1e-9, `${a} ≈ ${b}`);
  const tank = at({ preset: "tank" });
  const base = tank.armor - tank.bonusArmor;
  const more = at({ preset: "tank", armor: 300 });
  assert.equal(more.armor, 300);
  close(more.armor - more.bonusArmor, base);
  const below = at({ preset: "tank", armor: 10 });
  assert.deepEqual([below.armor, below.bonusArmor], [10, 0]);
  const noItems = at({ preset: "tank", bonusArmor: 0, bonusMr: 0 });
  close(noItems.armor, base);
  close(noItems.mr, tank.mr - tank.bonusMr);
  const raw = at({ maxHp: 2500, armor: 100, mr: 60, bonusMr: 20 });
  assert.deepEqual([raw.maxHp, raw.bonusHp, raw.armor, raw.bonusArmor, raw.mr, raw.bonusMr], [2500, 0, 100, 0, 60, 20]);
});

// -----------------------------------------------------------------------------
// Wiki audit fixes (docs/research/validation.md, "Item and rune audit").

/** Highest adaptive force Conqueror reached from damage dealt before `before` seconds. */
function maxAdaptive(champion: string, combo: string, before = Infinity) {
  const sim = new Sim(data, { champion, level: 18, runes: ["Conqueror"], combo, target: dummy });
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

test("Damage over time shares the cast instance that started it: no Electrocute from one hit, Conqueror once per 4s", () => {
  for (const [champion, combo] of [
    ["Brand", "Q"],
    ["Morgana", "W"],
    ["Teemo", "AA"],
    ["Twitch", "AA"],
  ])
    assert.equal(bySource(simulate(data, { champion, level: 18, runes: ["Electrocute"], combo, target: dummy }), "rune:8112").length, 0, champion);
  // Tormented Shadow's first tick (2 stacks) + ticks within 4s of it (no more): 2 × 4 adaptive at
  // level 18; a tick 4s or more after the first stacks again.
  assert.equal(maxAdaptive("Morgana", "W", 4), 8);
  assert.equal(maxAdaptive("Morgana", "W"), 16);
  // Darius's bleed is proc damage: his attack's 2 stacks only.
  assert.equal(maxAdaptive("Darius", "AA"), 8);
});

test("Conqueror: an empowered attack stacks once (Jax W)", () => {
  assert.equal(maxAdaptive("Jax", "W AA"), 8);
});

test("Unending Despair + Liandry's burn stop pulsing after combat", () => {
  const r = simulate(data, { champion: "Ornn", level: 18, items: ["Liandry's Torment", "Unending Despair"], combo: "Q AA W AA E AA AA AA", target: dummy });
  const lastHit = Math.max(...r.events.filter((e) => e.source === "AA").map((e) => e.time));
  const anguish = r.events.filter((e) => e.label === "Anguish").map((e) => e.time);
  assert.ok(Math.max(...anguish) < lastHit + 7, `last Anguish at ${Math.max(...anguish)}, last attack at ${lastHit}`);
});

test("Press the Attack: 6s cooldown between procs; the amp ends 5s after combat", () => {
  const r = simulate(data, { champion: "Jinx", level: 11, runes: ["Press the Attack"], combo: "AA*20", target: dummy });
  assert.equal(bySource(r, "rune:8005").length, 2);
  const gap = simulate(data, { champion: "Jinx", level: 11, runes: ["Press the Attack"], combo: "AA*3 wait{6s} AA", target: dummy });
  assert.equal(bySource(gap, "AA").at(-1)!.amps.length, 0);
});

test("On-hit effectiveness does not reduce Grasp, Heartsteel or Electrospark (Urgot W)", () => {
  const grasp = (combo: string) =>
    simulate(data, { champion: "Urgot", level: 18, runes: ["Grasp of the Undying"], combo, target: dummy }).events.find((e) => e.label === "Grasp")!.raw;
  assert.ok(Math.abs(grasp("W") - grasp("AA")) < 0.01);
});

test("Guinsoo's Phantom Hit and Dusk and Dawn's repeat add up (on-hit applies three times)", () => {
  // W after the 6th attack has landed, which would take Dusk and Dawn's Spellblade in flight.
  const r = simulate(data, { champion: "Jinx", level: 18, items: ["Guinsoo's Rageblade", "Dusk and Dawn"], combo: "AA*6 wait{0.3s} W AA", target: dummy });
  const last = bySource(r, "AA").at(-1)!;
  assert.equal(r.events.filter((e) => e.label === "Wrath" && e.castId === last.castId).length, 3);
});

test("Malignance: ultimate hits on a target inside Hatefog refresh it (Malzahar R)", () => {
  const r = simulate(data, { champion: "Malzahar", level: 18, items: ["Malignance"], combo: "R", target: dummy });
  const fog = r.events.filter((e) => e.label === "Hatefog").map((e) => e.time);
  assert.ok(fog.at(-1)! - fog[0] > 3.5, `Hatefog ${fog[0]}–${fog.at(-1)}`);
});

test("Spear of Shojin: innate damage grants no stacks; empowered attacks (Garen Q) are amplified", () => {
  const darius = simulate(data, { champion: "Darius", level: 18, items: ["Spear of Shojin"], combo: "AA wait{2s} Q", target: dummy });
  assert.ok(bySource(darius, "Q").every((e) => !e.amps.some((a) => a.source === "Spear of Shojin")));
  const garen = simulate(data, { champion: "Garen", level: 18, items: ["Spear of Shojin"], combo: "E Q AA", target: dummy });
  assert.ok(bySource(garen, "Q").some((e) => e.amps.some((a) => a.source === "Spear of Shojin")));
});

test("Voltaic Cyclosword: Galvanize lands Firmament before the triggering ability, which gets the lethality", () => {
  const r = simulate(data, { champion: "Talon", level: 18, items: ["Voltaic Cyclosword"], combo: "Q", target: { maxHp: 5000, armor: 100, mr: 0 } });
  assert.equal(r.events[0].label, "Firmament");
  const q = bySource(r, "Q")[0];
  assert.ok(q.effectiveResist! < 100 - r.stats.lethality - 1, `effective armor ${q.effectiveResist}`);
});

test("Deathfire Touch: a spell burn has 8 ticks, the last 2 amplified; a burn after expiry starts over", () => {
  const r = simulate(data, { champion: "Ahri", level: 18, runes: ["Deathfire Touch"], combo: "E", target: dummy });
  const ticks = bySource(r, "rune:8992");
  assert.equal(ticks.length, 8);
  assert.equal(ticks.filter((e) => e.label === "Burn (amplified)").length, 2);
});

test("Actualizer: basic ability cooldowns progress 30% faster during the active", () => {
  const qs = (items: string[], combo: string) =>
    simulate(data, { champion: "Ahri", level: 18, items, combo, target: dummy }).timeline.filter((s) => s.step === "Q");
  const [a, b] = qs(["Actualizer"], "item:actualizer Q Q");
  const [c, d] = qs(["Actualizer"], "Q Q");
  assert.ok(Math.abs((b.start - a.start) * 1.3 - (d.start - c.start)) < 0.02, `${b.start - a.start} vs ${d.start - c.start}`);
});

test("Hail of Blades: only basic attacks trigger it (not Ezreal Q)", () => {
  const r = simulate(data, { champion: "Ezreal", level: 18, runes: ["Hail of Blades"], combo: "Q AA AA AA", target: dummy });
  const q = bySource(r, "Q")[0];
  const procs = bySource(r, "rune:9923");
  assert.equal(procs.length, 3);
  assert.ok(procs.every((p) => p.castId !== q.castId));
});

test("Cheap Shot: later hits of the cast that applied the CC trigger it (Malzahar R), its first hit does not", () => {
  const r = simulate(data, { champion: "Malzahar", level: 18, runes: ["Cheap Shot"], combo: "R", target: dummy });
  const shot = bySource(r, "rune:8126");
  assert.equal(shot.length, 1);
  assert.ok(shot[0].time > bySource(r, "R")[0].time);
});

test("Summon Aery: ability damage over time sends her (Malzahar E); persistent proc damage does not", () => {
  assert.ok(bySource(simulate(data, { champion: "Malzahar", level: 18, runes: ["Summon Aery"], combo: "E", target: dummy }), "rune:8214").length >= 1);
});

test("Sudden Impact: a dash during its cooldown does not arm it", () => {
  const r = simulate(data, { champion: "Riven", level: 18, runes: ["Sudden Impact"], combo: "Q wait{8s} E wait{2.5s} AA", target: dummy });
  assert.equal(bySource(r, "rune:8143").length, 1);
});

test("Triple Tonic: Elixir of Skill's extra skill point from level 9", () => {
  const ranks = (runes: string[]) =>
    Object.values(simulate(data, { champion: "Ahri", level: 9, runes, combo: "Q", target: dummy }).champion.ranks).reduce((s, x) => s + x, 0);
  assert.equal(ranks(["Triple Tonic"]), ranks([]) + 1);
});

test("Titanic Hydra: the empowered attack replaces Cleave; the cooldown starts when it is used", () => {
  const r = simulate(data, { champion: "Sion", level: 18, items: ["Titanic Hydra"], combo: "item:titanic AA AA", target: dummy });
  assert.deepEqual(
    r.events.filter((e) => e.source === "item:3748").map((e) => e.label),
    ["Titanic Crescent", "Cleave"],
  );
});

test("Sundered Sky + Fiendhunter Bolts: same result in either item order, with the champion crit multiplier", () => {
  const total = (items: string[]) => simulate(data, { champion: "Jhin", level: 18, items, combo: "R AA", target: dummy }).totalDamage;
  assert.ok(Math.abs(total(["Fiendhunter Bolts", "Sundered Sky"]) - total(["Sundered Sky", "Fiendhunter Bolts"])) < 0.01);
});

test("Hexoptics C44 amplifies Kraken Slayer's basic damage", () => {
  const r = simulate(data, { champion: "Jinx", level: 18, items: ["Kraken Slayer", "Hexoptics C44"], combo: "AA*3", target: dummy });
  assert.ok(r.events.find((e) => e.label === "Bring It Down")!.amps.some((a) => a.source === "Hexoptics C44"));
});

test("% AP increases add up (Rabadon's + Blackfire Torch while burning)", () => {
  const sim = new Sim(data, { champion: "Brand", level: 18, items: ["Rabadon's Deathcap", "Blackfire Torch"], combo: "E", target: dummy });
  const ap = sim.stats.ap / 1.3;
  sim.setCounter("burn:2503", 1);
  assert.ok(Math.abs(sim.stats.ap - ap * 1.34) < 0.01, `${sim.stats.ap} vs ${ap * 1.34}`);
});

test("Lethal Tempo: stacks decay one by one after the duration", () => {
  const sim = new Sim(data, { champion: "Jinx", level: 18, runes: ["Lethal Tempo"], combo: "AA*6", target: dummy });
  const attacks: number[] = [];
  sim.run(parseCombo("AA*6"));
  for (const e of sim.events) if (e.source === "AA") attacks.push(e.time);
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

test("Damage records the combo action that set it off, across separate-cast hits, procs and DoTs", () => {
  const zed = simulate(data, { champion: "Zed", level: 11, combo: "W Q AA*2", target: dummy });
  const [q, shadow] = bySource(zed, "Q");
  assert.notEqual(shadow.castId, q.castId);
  assert.equal(shadow.action, q.castId);
  const attacks = bySource(zed, "AA");
  assert.equal(attacks.length, 2);
  assert.ok(attacks.every((a) => a.action === a.castId));
  const brand = simulate(data, { champion: "Brand", level: 13, items: ["Liandry's Torment"], combo: "E Q", target: dummy });
  const e = bySource(brand, "E")[0];
  const ticks = bySource(brand, "item:6653");
  assert.ok(ticks.length > 1 && ticks.every((t) => t.action === e.castId));
});

test("Iceborn Gauntlet's frost field adds no Electrocute stack; Smolder's execute is part of the hit that executes", () => {
  // W and Q are two hits; Q's Spellblade field doesn't make a third (in game, 16.20).
  const smolder = { champion: "Smolder", level: 11, items: ["Iceborn Gauntlet"], runes: ["Electrocute"], combo: "W Q", target: { preset: "squishy" as const } };
  const iceborn = simulate(data, smolder);
  assert.ok(bySource(iceborn, "item:6662").length > 0);
  assert.equal(bySource(iceborn, "rune:8112").length, 0);
  const r = simulate(data, { ...smolder, level: 9, items: ["Essence Reaver", "Lord Dominik's Regards"], options: { stacks: 225 }, combo: "E Q AA Q" });
  const execute = r.events.find((e) => e.label === "Super Scorcher Breath (execute)")!;
  assert.ok(r.events.some((e) => e.source === "Q" && e.label !== "Super Scorcher Breath (execute)" && e.castId === execute.castId && e.time === execute.time));
});

test("An execute sets off nothing and counts once, for its full value, after the rest of its instant", () => {
  // W slows. Q's hit procs Cheap Shot and its Dragon Practice part lands; then the execute.
  const target = { maxHp: 1500, armor: 50, mr: 50, hpPercent: 24 };
  const smolder = (o = {}) =>
    simulate(data, { champion: "Smolder", level: 11, runes: ["Electrocute", "Cheap Shot"], options: { stacks: 225 }, combo: "W Q AA", target, ...o });
  const r = smolder();
  const execute = r.events.find((e) => e.label === "Super Scorcher Breath (execute)")!;
  const instant = r.events.filter((e) => e.time === execute.time);
  assert.equal(instant.at(-1), execute);
  assert.ok(instant.some((e) => e.label === "Cheap Shot"));
  // 6.5% of max health, also when Q's parts already killed; Collector's smaller one doesn't count on top.
  for (const run of [r, smolder({ target: { ...target, hpPercent: 20 } }), smolder({ items: ["The Collector"] })]) {
    const executes = run.events.filter((e) => e.flags.execute);
    assert.deepEqual(
      executes.map((e) => e.label),
      ["Super Scorcher Breath (execute)"],
    );
    assert.ok(Math.abs(executes[0].final! - 97.5) < 0.01);
  }
  // Only the largest execute counts, whenever it lands: Collector's, on the hit before Q, gives way to
  // Smolder's, and the hits after it find the health it took. Smolder's comes only once Q's hit burns
  // (not on a W landing after Q's cast); either way Collector's execute adds nothing.
  const page = {
    champion: "Smolder",
    level: 15,
    items: ["Essence Reaver", "Voltaic Cyclosword", "Lord Dominik's Regards", "Bastionbreaker"],
    runes: ["Electrocute", "Cheap Shot", "Absolute Focus", "Gathering Storm"],
    options: { stacks: 225 },
    target: { preset: "squishy" as const },
  };
  for (const combo of ["AA W AA Q AA", "AA AA W Q AA"]) {
    const run = simulate(data, { ...page, items: [...page.items, "The Collector"], combo });
    const executes = run.events.filter((e) => e.flags.execute);
    assert.deepEqual(
      executes.map((e) => e.source),
      ["Q"],
      combo,
    );
    assert.ok(executes[0].time >= run.events.find((e) => e.label === "Super Scorcher Breath")!.time, combo);
    run.events.reduce((hp, e) => (assert.ok(Math.abs(e.targetHpBefore! - hp) < 1e-6, combo), e.targetHpAfter!), run.events[0].targetHpBefore!);
    assert.equal(rankItems(data, { ...page, combo }, { candidates: ["The Collector"] }).items[0].itemDamage, 0, combo);
  }
  // Urgot's Mercy on a target he suppresses: no Cheap Shot.
  const urgot = simulate(data, {
    champion: "Urgot",
    level: 11,
    runes: ["Electrocute", "Cheap Shot"],
    combo: "R R:execute",
    target: { preset: "squishy", hpPercent: 20 },
  });
  assert.ok(urgot.events.some((e) => e.label === "Mercy (execute)"));
  assert.equal(bySource(urgot, "rune:8126").length, 0);
});

test("Smolder's Q burn is proc damage: it doesn't keep Liandry's burning, unlike Brand's Blaze", () => {
  const torment = (stacks: number) =>
    bySource(simulate(data, { champion: "Smolder", level: 11, items: ["Liandry's Torment"], options: { stacks }, combo: "Q", target: dummy }), "item:6653");
  const burning = simulate(data, { champion: "Smolder", level: 11, items: ["Liandry's Torment"], options: { stacks: 225 }, combo: "Q", target: dummy });
  assert.ok(burning.events.some((e) => e.label === "Super Scorcher Breath (burn)" && e.flags.proc));
  assert.equal(torment(225).length, torment(125).length);
  // Blaze's ticks refresh Liandry's: it burns past its 3s.
  const brand = simulate(data, { champion: "Brand", level: 11, items: ["Liandry's Torment"], combo: "Q", target: dummy });
  const ticks = bySource(brand, "item:6653");
  assert.ok(ticks[ticks.length - 1].time - ticks[0].time > 3);
});

test("Champion proc damage triggers nothing: Kog'Maw W's on-hit lights no Liandry's, Lux's Illumination is no Electrocute hit", () => {
  const kog = simulate(data, { champion: "KogMaw", level: 11, items: ["Liandry's Torment"], combo: "W AA AA", target: dummy });
  assert.ok(kog.events.some((e) => e.label === "Bio-Arcane Barrage" && e.flags.proc));
  assert.equal(bySource(kog, "item:6653").length, 0);
  // Light Binding, the attack and the detonation are three casts, but only two hits for Electrocute.
  const lux = (combo: string) => bySource(simulate(data, { champion: "Lux", level: 11, runes: ["Electrocute"], combo, target: dummy }), "rune:8112").length;
  assert.equal(lux("Q wait{1s} AA"), 0);
  assert.equal(lux("Q wait{1s} AA E"), 1);
});

test("Teemo's Toxic Shot is proc damage that still triggers Dark Harvest (wiki special case); Warwick's Eternal Hunger doesn't", () => {
  // The attack takes the target from 51% to below 50%: only the on-hit after it can harvest.
  const harvests = (champion: string) =>
    bySource(simulate(data, { champion, level: 11, runes: ["Dark Harvest"], combo: "AA", target: { ...dummy, hpPercent: 51 } }), "rune:8128").length;
  assert.equal(harvests("Teemo"), 1);
  assert.equal(harvests("Warwick"), 0);
});

test("Kalista's Soul-Marked: ability damage, dealt as her next attack goes off and before it lands", () => {
  const r = simulate(data, { champion: "Kalista", level: 11, combo: "AA P AA", target: dummy });
  const i = r.events.findIndex((e) => e.label === "Soul-Marked");
  const attacks = bySource(r, "AA");
  assert.ok(r.events[i].flags.ability);
  assert.equal(r.events[i].source, "W"); // Sentinel's passive, shown under W
  // As the second attack is launched, while its spear flies.
  assert.equal(r.events[i].castId, attacks[1].castId);
  assert.ok(r.events[i].time > attacks[0].time && r.events[i].time < attacks[1].time, `${r.events[i].time} vs attacks at ${attacks.map((a) => a.time)}`);
});

test("Attacks that are also spell damage light Liandry's: Wukong Q's, Kayle E's, Dr. Mundo E's, Galio's Colossal Smash, Diana's third hit", () => {
  const torments = (champion: string, combo: string) =>
    bySource(simulate(data, { champion, level: 11, items: ["Liandry's Torment"], combo, target: dummy }), "item:6653").length;
  assert.equal(torments("MonkeyKing", "AA"), 0);
  assert.ok(torments("MonkeyKing", "Q AA") > 0);
  assert.ok(torments("Kayle", "E AA") > 0);
  assert.ok(torments("DrMundo", "E AA") > 0);
  assert.ok(torments("Galio", "AA") > 0);
  assert.equal(torments("Diana", "AA AA"), 0);
  assert.ok(torments("Diana", "AA AA AA") > 0);
  // Wukong's attack itself is the spell damage (its bonus is proc damage), flagged like Garen Q's strike.
  const wukong = simulate(data, { champion: "MonkeyKing", level: 11, combo: "Q AA", target: dummy });
  const attack = bySource(wukong, "AA")[0];
  assert.deepEqual([attack.flags.attack, attack.flags.ability, attack.flags.slot], [true, true, "Q"]);
  assert.ok(wukong.events.find((e) => e.label === "Crushing Blow")!.flags.proc);
});

test("An ability's passive on-hit shows under that ability: Ekko's Parallel Convergence, Kayle's Starfire Spellblade", () => {
  const ekko = simulate(data, { champion: "Ekko", level: 11, combo: "AA", target: { ...dummy, hpPercent: 25 } });
  const convergence = ekko.events.find((e) => e.label === "Parallel Convergence")!;
  assert.deepEqual([convergence.source, convergence.sourceLabel], ["W", "Parallel Convergence"]);
  const kayle = simulate(data, { champion: "Kayle", level: 11, combo: "AA", target: dummy });
  assert.equal(kayle.events.find((e) => e.label === "Starfire Spellblade")!.source, "E");
});

test("Qiyana: Terrashape's enchantment adds its damage once per Q or E cast, not to R", () => {
  const bonus = (enchanted: number) =>
    simulate(data, { champion: "Qiyana", level: 11, options: { enchanted }, combo: "Q+tremor E R", target: { ...dummy, hpPercent: 40 } }).events.filter(
      (e) => e.label === "Terrashape (enchanted)",
    );
  assert.deepEqual(
    bonus(1).map((e) => e.castId === bonus(1)[0].castId),
    [true, false],
  );
  assert.equal(bonus(0).length, 0);
});

test("Kai'Sa: Void Seeker's Plasma stacks deal Caustic Wounds as if applied one by one, rolling over past the burst", () => {
  const plasma = (combo: string) =>
    simulate(data, { champion: "Kaisa", level: 11, combo, target: dummy }).events.filter((e) => e.sourceLabel === "Second Skin");
  const [first, second] = plasma("AA AA").map((e) => e.raw);
  assert.ok(Math.abs(plasma("W")[0].raw - (first + second)) < 1e-6);
  // 4 stacks: the first of W's two stacks bursts, the second starts over.
  assert.deepEqual(
    plasma("AA AA AA AA W")
      .slice(4)
      .map((e) => e.label),
    ["Plasma", "Plasma burst", "Plasma"],
  );
});

test("A ranged attack lands after its missile's flight (attack range / the game's missile speed); a melee one at the end of its windup", () => {
  // Jhin Q (0.25s cast, grenade lands 0.25s later) then AA: the attack only starts after the cast and flies 550 / 2600 s.
  const jhin = new Sim(data, { champion: "Jhin", level: 11, combo: "Q AA", target: dummy });
  const r = jhin.run(parseCombo("Q AA"));
  const [grenade] = bySource(r, "Q");
  const [attack] = bySource(r, "AA");
  assert.ok(grenade.time < attack.time, `grenade ${grenade.time}, attack ${attack.time}`);
  assert.ok(Math.abs(jhin.attackTravel() - 550 / 2600) < 1e-9);
  const step = r.timeline.find((s) => s.step === "AA")!;
  assert.ok(Math.abs(attack.time - (step.end + 550 / 2600)) < 1e-6);
  const garen = new Sim(data, { champion: "Garen", level: 11, combo: "AA", target: dummy });
  assert.equal(garen.attackTravel(), 0);
  // Attacks that hit at once (no missile in the game files) don't fly either.
  assert.equal(new Sim(data, { champion: "Senna", level: 11, combo: "AA", target: dummy }).attackTravel(), 0);
});

test("Jhin reloads after his 4th shot: the 5th waits P.dv.ReloadTime from when the 4th was fired", () => {
  const sim = new Sim(data, { champion: "Jhin", level: 11, combo: "AA*5", target: dummy });
  const steps = sim.run(parseCombo("AA*5")).timeline;
  assert.ok(Math.abs(steps[4].start - (steps[3].end + 2.5)) < 1e-6, `4th fired at ${steps[3].end}, 5th started at ${steps[4].start}`);
});

test("What kit buffs add to an attack is decided at launch: a cast while it flies empowers the next one (Vayne Q, Kog'Maw W)", () => {
  const vayne = simulate(data, { champion: "Vayne", level: 11, combo: "AA Q AA", target: dummy });
  const tumble = bySource(vayne, "Q").filter((e) => e.label === "Tumble");
  assert.equal(tumble.length, 1);
  assert.equal(tumble[0].castId, bySource(vayne, "AA")[1].castId);
  const kog = simulate(data, { champion: "KogMaw", level: 11, combo: "AA W AA", target: dummy });
  const [first, second] = bySource(kog, "AA");
  const barrage = kog.events.filter((e) => e.label === "Bio-Arcane Barrage");
  assert.ok(barrage.every((e) => e.castId !== first.castId) && barrage.some((e) => e.castId === second.castId));
});

test("On-attack effects trigger at launch (Lucian's double shot), on-hit ones as it hits (Spellblade, granted as a cast starts)", () => {
  // Each ability grants its own second shot, though the next cast comes while the first attack flies.
  const lucian = simulate(data, { champion: "Lucian", level: 11, combo: "Q AA W AA", target: dummy });
  assert.equal(lucian.events.filter((e) => e.label === "Lightslinger (2nd shot)").length, 2);
  // Sheen's Spellblade, granted by W while the attack flies, is used by that attack (on-hit, wiki).
  const ezreal = simulate(data, { champion: "Ezreal", level: 11, items: ["Sheen"], combo: "AA W", target: dummy });
  const blade = ezreal.events.find((e) => e.label === "Spellblade")!;
  assert.equal(blade.castId, bySource(ezreal, "AA")[0].castId);
});

const timelineOf = (champion: string, combo: string) => new Sim(data, { champion, level: 11, combo, target: dummy }).run(parseCombo(combo)).timeline;

test("An attack reset doesn't end an attack lockout: the attack an ability empowers waits like any other (Fizz Q W AA)", () => {
  // W is cast during Urchin Strike's dash, and its attack waits for the dash to end.
  const [, w, aa] = timelineOf("Fizz", "Q W AA");
  assert.ok(w.start < 1e-9);
  assert.ok(Math.abs(aa.start - 0.35) < 1e-9);
});

test("A cast lockout holds only the abilities it lists, not attacks (Fizz Q: E; Aurora R: all of them, after her leap)", () => {
  assert.ok(Math.abs(timelineOf("Fizz", "Q E")[1].start - 0.5) < 1e-9);
  assert.ok(timelineOf("Fizz", "Q W")[1].start < 1e-9);
  assert.ok(Math.abs(timelineOf("Aurora", "R Q")[1].start - 0.9) < 1e-9);
  assert.ok(Math.abs(timelineOf("Aurora", "R AA")[1].start - 0.4) < 1e-9);
});

test("The target stands at your attack range unless the distance option places it: missiles fly there, at most their range, and range gained later leaves it (Twitch R); a melee form's attacks don't fly (Nidalee's cougar)", () => {
  const lands = (champion: string, combo: string, options = {}) =>
    bySource(simulate(data, { champion, level: 11, combo, options, target: dummy }), "Q")[0].time;
  const ezreal = new Sim(data, { champion: "Ezreal", level: 11, combo: "Q", target: dummy });
  const speed = ezreal.evalExpr("Q.missileSpeed", { slot: "Q" });
  assert.equal(ezreal.distance, 550);
  assert.ok(Math.abs(lands("Ezreal", "Q", { distance: 1000 }) - lands("Ezreal", "Q") - 450 / speed) < 1e-9);
  // Jhin Q reaches 550: no further.
  assert.ok(Math.abs(lands("Jhin", "Q", { distance: 1000 }) - lands("Jhin", "Q")) < 1e-9);
  const flight = (combo: string, champion = "Twitch", options = {}) => {
    const r = simulate(data, { champion, level: 11, combo, options, target: dummy });
    return bySource(r, "AA")[0].time - r.timeline.find((s) => s.step === "AA")!.end;
  };
  assert.ok(flight("AA") > 0);
  assert.ok(Math.abs(flight("R AA") - flight("AA")) < 1e-9);
  // Out of attack range, attacks fly from it.
  assert.ok(Math.abs(flight("AA", "Jhin", { distance: 2000 }) - flight("AA", "Jhin")) < 1e-9);
  assert.ok(flight("AA", "Nidalee") > 0);
  assert.equal(flight("R AA", "Nidalee"), 0);
});

test("Kalista: Rend counts the spears that land during its cast; those still flying when it goes off are ripped out as they land", () => {
  const rend = (combo: string, distance?: number) =>
    bySource(simulate(data, { champion: "Kalista", level: 11, combo, ...(distance ? { options: { distance } } : {}), target: dummy }), "E");
  const sim = new Sim(data, { champion: "Kalista", level: 11, combo: [], target: dummy });
  const [one] = rend("AA E");
  assert.ok(Math.abs(one.raw - sim.evalExpr("E.calc.NormalDamage", { slot: "E" })) < 1e-9);
  // From 1100 units the second spear is still flying when Rend goes off: the same damage, part later.
  // From 1100 units Pierce is still flying when Rend goes off: the same damage, part later.
  const flying = rend("AA Q E", 1100);
  const total = (hits: ReturnType<typeof rend>) => hits.reduce((s, e) => s + e.raw, 0);
  assert.equal(flying.length, 2);
  assert.ok(flying[1].time > flying[0].time);
  assert.ok(Math.abs(total(flying) - total(rend("AA Q wait{1s} E", 1100))) < 1e-9);
  // From 600 units Pierce lands as Rend goes off (0.25s): in the target, counted once.
  assert.equal(rend("Q E", 600).length, 1);
  // Without spears it does nothing, slows neither: no Cheap Shot on the attack.
  const bare = simulate(data, { champion: "Kalista", level: 11, runes: ["Cheap Shot"], combo: "E AA", target: dummy });
  assert.deepEqual(
    bare.events.map((e) => e.label),
    ["Attack"],
  );
});

test("Vex R is two parts: the recast dashes to the target once the shadow lands", () => {
  const r = simulate(data, { champion: "Vex", level: 11, combo: "R R", target: dummy });
  const sim = new Sim(data, { champion: "Vex", level: 11, combo: [], target: dummy });
  const [surge, dash] = bySource(r, "R");
  assert.ok(Math.abs(r.timeline[1].start - surge.time) < 1e-9);
  assert.ok(Math.abs(dash.time - surge.time - sim.distance / 2200) < 1e-9);
  assert.equal(bySource(simulate(data, { champion: "Vex", level: 11, combo: "R", target: dummy }), "R").length, 1);
});

test("Xayah: Bladecaller recalls feathers still flying once they land (Q E), each after the last", () => {
  const r = simulate(data, { champion: "Xayah", level: 11, combo: "Q E", target: dummy });
  const [d1, d2] = bySource(r, "Q");
  const [f1, f2] = bySource(r, "E");
  assert.equal(bySource(r, "E").length, 2);
  assert.ok(f1.time > d1.time && f2.time > d2.time && f2.raw < f1.raw);
  // A Clean Cuts attack still flying counts too.
  assert.equal(bySource(simulate(data, { champion: "Xayah", level: 11, combo: "W AA AA E", target: dummy }), "E").length, 2);
});

test("Zed: Death Mark lands as R's dash ends, so a shuriken landing during the dash isn't stored; the recast only swaps", () => {
  const pop = (combo: string) => simulate(data, { champion: "Zed", level: 11, combo, target: dummy }).events.find((e) => e.label === "Death Mark (pop)")!;
  const base = new Sim(data, { champion: "Zed", level: 11, combo: [], target: dummy }).evalExpr("R.calc.RCalculatedDamage", { slot: "R" });
  assert.ok(Math.abs(pop("Q R").raw - base) < 1e-9);
  assert.ok(pop("R Q").raw > base);
  // The recast swaps with the Shadow: at once, and the mark keeps what it stored.
  const [, recast] = timelineOf("Zed", "R R Q");
  assert.ok(recast.end - recast.start < 1e-9);
  assert.ok(Math.abs(pop("R R Q").raw - pop("R Q").raw) < 1e-9);
});

test("Voltaic Cyclosword's Firmament lands before the attack or ability that fires it (wiki)", () => {
  const order = (combo: string) =>
    simulate(data, { champion: "Talon", level: 11, items: ["Voltaic Cyclosword"], combo, target: dummy })
      .events.slice(0, 2)
      .map((e) => e.source);
  assert.deepEqual(order("AA"), ["item:6699", "AA"]);
  assert.deepEqual(order("Q"), ["item:6699", "Q"]);
});

test("On-hit effects applied again (Dusk and Dawn, Guinsoo's Phantom Hit) take the buffs active as the attack lands: Yunara AA Q AA", () => {
  const r = simulate(data, { champion: "Yunara", level: 11, items: ["Dusk and Dawn"], combo: "AA Q AA", target: dummy });
  const first = bySource(r, "AA")[0].castId;
  // Q, cast while the first attack flies, isn't part of it, but Spellblade's second on-hit pass gets it.
  const active = r.events.filter((e) => e.label === "Cultivation of Spirit (active)");
  assert.equal(active.filter((e) => e.castId === first).length, 1);
  assert.ok(r.events.some((e) => e.label === "Spellblade" && e.castId === first));
});

test("A cast's hits landing together come first, then their on-hits and procs: Smolder Q, its Dragon Practice bonus, then Spellblade", () => {
  const at = (r: ReturnType<typeof simulate>, slot: string) => r.events.filter((e) => e.time === bySource(r, slot)[0].time).map((e) => e.label);
  const q = simulate(data, { champion: "Smolder", level: 11, items: ["Essence Reaver"], combo: "Q", target: dummy });
  assert.deepEqual(at(q, "Q"), ["Super Scorcher Breath", "Super Scorcher Breath (Dragon Practice)", "Spellblade"]);
  const w = simulate(data, { champion: "Smolder", level: 11, items: ["Luden's Echo"], combo: "W", target: dummy });
  assert.deepEqual(at(w, "W"), ["Achooo!", "Achooo! (explosion)", "Achooo! (Dragon Practice)", "Echo"]);
  // An empowered attack's parts (the attack's normal damage recorded out of the first) and its
  // items' on-hits land before what they set off.
  const nasus = simulate(data, { champion: "Nasus", level: 11, items: ["Luden's Echo", "Lich Bane"], combo: "Q AA", target: dummy });
  assert.deepEqual(at(nasus, "Q"), ["Siphoning Strike", "Attack", "Siphoning Strike (stacks)", "Spellblade", "Echo"]);
});

test('Hit labels name the hit on their own: an ability part is "Ability (part)", never a bare Execute or Bleed', () => {
  const bare = /^(Execute|Bleed|Burn|Poison|Venom|Curse|Spin|Lightning|Stored damage|Wake-up bonus|Crit bonus)( \(.*\))?$/;
  const bad = new Set<string>();
  for (const id of curatedChampionIds()) {
    const kit = getKit(data.champions[id]);
    const steps = Object.entries(kit.abilities).flatMap(([slot, a]) => [slot, ...Object.keys(a?.variants ?? {}).map((v) => `${slot}:${v}`)]);
    const options = Object.fromEntries((kit.options ?? []).map((o) => [o.key, o.max ?? o.default]));
    const r = simulate(data, {
      champion: id,
      level: 18,
      options,
      combo: `${steps.map((s) => `${s} AA`).join(" ")} AA AA`,
      target: { maxHp: 30000, armor: 50, mr: 50, hpPercent: 10 },
    });
    for (const e of r.events) {
      if (!/^[PQWER]$/.test(e.source)) continue;
      const base = e.sourceLabel.replace(/ \(.*\)$/, "");
      if (bare.test(e.label) || [e.sourceLabel, base].some((s) => e.label.startsWith(`${s} `) && !e.label.startsWith(`${s} (`)))
        bad.add(`${id}: ${e.sourceLabel} → ${e.label}`);
    }
  }
  assert.deepEqual([...bad], []);
});

test("An attack that is an ability (Zeri's right-click) arms Spellblade, is spell damage, and applies no on-hit or on-attack effects", () => {
  const zeri = (combo: string, items: string[]) => simulate(data, { champion: "Zeri", level: 11, items, combo, target: dummy });
  const blades = (r: ReturnType<typeof simulate>) => r.events.filter((e) => e.label === "Spellblade");
  // The attack arms Sheen and Burst Fire, which applies on-hit, uses it; Burst Fire doesn't arm it, and the attack doesn't use it.
  const armed = zeri("AA Q", ["Sheen"]);
  assert.deepEqual(
    blades(armed).map((e) => e.castId),
    [bySource(armed, "Q")[0].castId],
  );
  assert.equal(blades(zeri("Q Q", ["Sheen"])).length, 0);
  assert.equal(blades(zeri("W AA AA", ["Sheen"])).length, 0);
  // The attack counts as a cast as it hits, after the first round of the Burst Fire before it (Q AA),
  // which applies its on-hit effects; the next Burst Fire uses it. Its first round only.
  assert.equal(blades(zeri("Q AA", ["Sheen"])).length, 0);
  const next = zeri("Q AA Q", ["Sheen"]);
  const second = bySource(next, "Q").filter((e) => e.castId !== bySource(next, "Q")[0].castId);
  assert.deepEqual(
    blades(next).map((e) => [e.castId, e.time]),
    [[second[0].castId, second[0].time]],
  );
  // Spell effects (Liandry's burn), no on-hit (Blade of the Ruined King) or on-attack (Kraken Slayer's stacks) effects.
  const items = ["Liandry's Torment", "Blade of The Ruined King", "Kraken Slayer"];
  const aa = zeri("AA AA AA", items);
  assert.ok(bySource(aa, "AA").every((e) => e.flags.ability && e.flags.attack));
  assert.deepEqual([...new Set(aa.events.filter((e) => e.source.startsWith("item:")).map((e) => e.sourceLabel))], ["Liandry's Torment"]);
  // Burst Fire is basic damage: on-hit and on-attack effects, no spell effects.
  const q = zeri("Q Q Q", items);
  assert.deepEqual([...new Set(q.events.filter((e) => e.source.startsWith("item:")).map((e) => e.label))].sort(), ["Bring It Down", "Mist's Edge"]);
  // Its first round applies them: once a cast.
  assert.equal(q.events.filter((e) => e.label === "Mist's Edge").length, 3);
});

test("An ability whose cooldown is an attack timer (Zeri's Burst Fire): attack resets reset it, haste and Navori don't shorten it", () => {
  const run = (combo: string, items: string[] = []) => {
    const r = simulate(data, { champion: "Zeri", level: 11, items, combo, target: dummy });
    return { starts: r.timeline.map((t) => t.start), period: 1 / r.stats.attackSpeed };
  };
  // Spark Surge resets it: the next Burst Fire comes as the dash ends (it can't be cast during it).
  const reset = run("Q E Q");
  assert.ok(reset.starts[2] < reset.period - 0.2, `${reset.starts[2]} vs ${reset.period}`);
  for (const items of [["Navori Flickerblade"], ["Ionian Boots of Lucidity"]]) {
    const { starts, period } = run("Q Q", items);
    assert.ok(Math.abs(starts[1] - period) < 1e-6, `${items}: ${starts[1]} vs ${period}`);
  }
});

test("Zeri's Burst Fire takes her attack windup and blocks the attack after it; its rounds fire over it, the first landing before that attack, all of them closer in (Q AA can execute)", () => {
  const zeri = (options = {}) => simulate(data, { champion: "Zeri", level: 11, options, combo: "Q AA", target: { maxHp: 200, armor: 80, mr: 50 } });
  const r = zeri();
  const [q, aa] = r.timeline;
  const windup = aa.end - aa.start;
  assert.ok(Math.abs(q.end - q.start - windup) < 1e-9 && Math.abs(aa.start - q.end) < 1e-9);
  // 7 rounds, fired from the start of the cast to its end, each flying as long.
  const rounds = bySource(r, "Q");
  const flight = rounds[0].time - q.start;
  assert.equal(rounds.length, 7);
  assert.ok(Math.abs(rounds[6].time - q.end - flight) < 1e-9);
  assert.ok(rounds[0].time < bySource(r, "AA")[0].time);
  const near = zeri({ distance: 300 });
  assert.ok(bySource(near, "Q").every((e) => e.time < bySource(near, "AA")[0].time));
  assert.ok(near.events.some((e) => e.label === "Living Battery (execute)"));
});

test("Zeri's attack speed cap is 1.5, raised only by Overcharged's attack speed; 0.6 AD per 1% bonus attack speed past it", () => {
  const items = ["Berserker's Greaves", "Runaan's Hurricane", "Statikk Shiv", "Phantom Dancer", "Rapid Firecannon"];
  const zeri = (o: object = {}) => new Sim(data, { champion: "Zeri", level: 18, items, combo: [], ...o }).stats;
  const st = zeri();
  const itemAd = items.reduce((s, i) => s + (findItem(data, i).stats.ad ?? 0), 0);
  const past = st.bonusAttackSpeed - (1.5 - st.baseAttackSpeed) / st.attackSpeedRatio;
  assert.ok(past > 0.5);
  assert.equal(st.attackSpeed, 1.5);
  assert.ok(Math.abs(st.bonusAd - itemAd - 60 * past) < 1e-3, `${st.bonusAd} vs ${itemAd} + 60 × ${past}`);
  // Hail of Blades doesn't raise it (wiki).
  assert.equal(zeri({ runes: ["Hail of Blades"] }).attackSpeedCap, 1.5);
  // Overcharged raises it by its 30% (× her ratio), and doesn't change the AD: Burst Fire comes every 1 / 1.6875s.
  const r = simulate(data, { champion: "Zeri", level: 18, items, combo: "R Q Q", target: dummy });
  const [, q1, q2] = r.timeline;
  assert.ok(Math.abs(q2.start - q1.start - 1 / (1.5 + 0.3 * st.attackSpeedRatio)) < 1e-6, `${q2.start - q1.start}`);
  // Others keep the game's.
  assert.equal(new Sim(data, { champion: "Jinx", level: 18, items, combo: [] }).stats.attackSpeedCap, 3);
});

test("An execute's line shows in the results whether it's reached or not; settings.executes off, executes deal nothing and show none", () => {
  const zeri = (hp: number, executes?: boolean) =>
    simulate(data, {
      champion: "Zeri",
      level: 11,
      options: { distance: 300 },
      combo: "Q AA",
      target: { maxHp: hp, armor: 30, mr: 30 },
      settings: { executes },
    });
  const line = new Sim(data, { champion: "Zeri", level: 11, combo: [] }).evalExpr("Q.calc.PassiveExecuteThreshold", { slot: "Q" });
  for (const hp of [220, 2000]) {
    const r = zeri(hp);
    assert.deepEqual(
      r.executeLines.map((l) => [l.label, l.hp]),
      [["Living Battery (execute)", line]],
    );
    assert.equal(
      r.events.some((e) => e.flags.execute),
      hp === 220,
    );
  }
  const off = zeri(220, false);
  assert.equal(off.executeLines.length, 0);
  assert.ok(!off.events.some((e) => e.flags.execute) && !off.killed);
  // Pyke's R deals its other hit above the line, which shows all the same.
  const pyke = simulate(data, { champion: "Pyke", level: 11, combo: "R", target: { maxHp: 3000, armor: 30, mr: 30 } });
  assert.deepEqual(
    pyke.executeLines.map((l) => l.label),
    ["Death From Below (execute)"],
  );
  assert.ok(!pyke.events.some((e) => e.flags.execute));
});

test("Zeri's P is her fully charged attack: an attack in timing, a cast as it hits, no execute; her AAs are uncharged", () => {
  const zeri = (combo: string, o: object = {}) => simulate(data, { champion: "Zeri", level: 11, items: ["Sheen"], combo, target: dummy, ...o });
  // It waits for the attack timer and restarts it.
  const r = zeri("AA P AA");
  const [aa, p, aa2] = r.timeline;
  const period = 1 / r.stats.attackSpeed;
  assert.equal(p.step, "P");
  assert.ok(Math.abs(p.start - aa.start - period) < 1e-6 && Math.abs(aa2.start - p.start - period) < 1e-6);
  const max = new Sim(data, { champion: "Zeri", level: 11, combo: [], target: dummy }).evalExpr(
    "Q.calc.PassiveMaxDamage + Q.calc.PassiveMaxChargePercentHealth * target.maxHp",
    {
      slot: "Q",
    },
  );
  assert.equal(r.events.filter((e) => e.label === "Charged attack").length, 1);
  assert.ok(Math.abs(r.events.filter((e) => e.castId === bySource(r, "P")[0].castId).reduce((s, e) => s + e.raw, 0) - max) < 1e-6);
  // It arms Spellblade as it hits, for the Burst Fire after it.
  const pq = zeri("P Q");
  assert.equal(pq.events.find((e) => e.label === "Spellblade")?.castId, bySource(pq, "Q")[0].castId);
  // Below the execute line, it doesn't execute.
  assert.ok(!zeri("P", { target: { maxHp: 150, armor: 30, mr: 30 } }).events.some((e) => e.flags.execute));
});

test("Black Cleaver: a Carve stack from each of Burst Fire's rounds (in game)", () => {
  const r = simulate(data, { champion: "Zeri", level: 11, items: ["Black Cleaver"], combo: "Q", target: { maxHp: 5000, armor: 100, mr: 0 } });
  const dealt = bySource(r, "Q").map((e) => e.final!);
  assert.equal(dealt.length, 7);
  // Each round deals more with the stacks of those before it, up to 5.
  for (let k = 1; k <= 5; k++) assert.ok(dealt[k] > dealt[k - 1], `round ${k + 1}`);
  assert.ok(Math.abs(dealt[6] - dealt[5]) < 1e-9);
});

test("Burst Fire's first round lands before the attack after it, also at her attack speed cap at her range (no Spellblade from that attack, in game)", () => {
  const items = ["Sheen", "Berserker's Greaves", "Runaan's Hurricane", "Statikk Shiv", "Phantom Dancer", "Rapid Firecannon"];
  const zeri = (combo: string) => simulate(data, { champion: "Zeri", level: 18, items, combo, target: dummy });
  for (const combo of ["Q AA", "R Q AA"]) {
    const r = zeri(combo);
    assert.ok(bySource(r, "Q")[0].time < bySource(r, "AA").at(-1)!.time, combo);
  }
  assert.ok(!zeri("Q AA").events.some((e) => e.label === "Spellblade"));
});

test("Burst Fire's rounds: at most one a server tick (1/30s), and she can't attack until the last is fired (practice tool, 1.5 attack speed)", () => {
  const items = ["Berserker's Greaves", "Runaan's Hurricane", "Statikk Shiv", "Phantom Dancer", "Rapid Firecannon"];
  const r = simulate(data, { champion: "Zeri", level: 18, items, combo: "Q AA", target: dummy });
  assert.equal(r.stats.attackSpeed, 1.5);
  const times = bySource(r, "Q").map((e) => e.time);
  for (let k = 1; k < 7; k++) assert.ok(Math.abs(times[k] - times[k - 1] - 1 / 30) < 1e-9);
  // Over 0.2s, longer than her 0.104s cast time: the attack starts as the last round is fired.
  const [q, aa] = r.timeline;
  assert.ok(Math.abs(q.end - q.start - 0.2) < 1e-9 && Math.abs(aa.start - q.end) < 1e-9);
});
