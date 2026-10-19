// Core engine tests. Expected values are derived by hand from the 16.20 game data / wiki formulas.

import { test } from "node:test";
import assert from "node:assert/strict";
import { loadGameData } from "../src/node/load.ts";
import { loadAllKits } from "../src/node/kits.ts";
import { simulate, Sim, resolveRanks, type Scenario } from "../src/engine/sim.ts";
import { effectiveResist, resistMultiplier } from "../src/engine/damage.ts";
import { computeStats, emptyMods, levelStats } from "../src/engine/stats.ts";
import { statProgression, evalPart } from "../src/engine/calc.ts";
import { compile } from "../src/engine/expr.ts";
import { clampCombo, critMarking, fitCombo, formatCombo, markCrit, parseCombo, rollsCrits } from "../src/engine/combo.ts";
import { getKit } from "../src/kits/index.ts";
import { combineAmps } from "../src/engine/sim.ts";
import {
  componentCandidates,
  conflicts,
  defaultCandidates,
  isComponent,
  rankItems,
  rankItemSets,
  searchItemSets,
  upgradeRoom,
  type ItemSet,
} from "../src/engine/analysis.ts";
import { findItem } from "../src/engine/gamedata.ts";
import type { ItemData } from "../src/engine/data-types.ts";
import { formatNumber, itemText, renderTooltip, runeText } from "../src/engine/tooltip.ts";
import { NOT_LIVE_RUNES } from "../src/engine/runes.ts";
import { choosePrimary, chooseSecondary, pageRunes, pickRune, pickShard, settledPage, treePicks, type RunePage } from "../src/engine/rune-page.ts";
import { DEMO_STATE, toScenario } from "../src/web/state.ts";

const data = loadGameData("16.20");
await loadAllKits();
const near = (a: number, b: number, eps = 0.01) => assert.ok(Math.abs(a - b) <= eps, `expected ${b}, got ${a}`);
const dummy = { maxHp: 2000, armor: 0, mr: 0 };

test("resist multiplier for positive and negative resist", () => {
  near(resistMultiplier(100), 0.5);
  near(resistMultiplier(0), 1);
  near(resistMultiplier(-50), 2 - 100 / 150);
});

test("penetration order: flat reduction, % reduction, % pen, flat pen", () => {
  // 100 armor (60 base + 40 bonus), 10 flat reduction, 30% reduction, 35% pen, 18 lethality.
  // 100 → 90 → 63 → 40.95 → 22.95
  near(effectiveResist({ base: 60, bonus: 40 }, { flat: 10, percent: 0.3 }, { percent: 0.35, bonusPercent: 0, flat: 18 }), 22.95);
  // Penetration never takes armor below zero; reduction can.
  near(effectiveResist({ base: 20, bonus: 0 }, { flat: 0, percent: 0 }, { percent: 0, bonusPercent: 0, flat: 50 }), 0);
  near(effectiveResist({ base: 20, bonus: 0 }, { flat: 30, percent: 0.5 }, { percent: 0.4, bonusPercent: 0, flat: 10 }), -10);
  // Bonus-only percent penetration.
  near(effectiveResist({ base: 50, bonus: 50 }, { flat: 0, percent: 0 }, { percent: 0, bonusPercent: 0.5, flat: 0 }), 75);
});

test("stat growth curve", () => {
  near(statProgression(1), 0);
  near(statProgression(18), 1);
  // Level 11: n=10 → 10 × (0.7025 + 0.175) = 8.775 of 17
  near(statProgression(11) * 17, 8.775, 1e-9);
  const ahri = data.champions.Ahri;
  near(levelStats(ahri.stats, 11).ad, 53 + 3 * 8.775, 1e-6);
});

test("attack speed: base + bonus × ratio, capped at 3.0", () => {
  const jinx = data.champions.Jinx;
  const mods = emptyMods();
  mods.attackSpeed = 10; // absurd bonus
  const st = computeStats({ base: jinx.stats, level: 18, adaptiveDefault: "physical", ranged: true }, mods);
  near(st.attackSpeed, 3.0);
  const st0 = computeStats({ base: jinx.stats, level: 1, adaptiveDefault: "physical", ranged: true }, emptyMods());
  near(st0.attackSpeed, jinx.stats.attackSpeed, 1e-9);
});

test("adaptive force goes to the higher of bonus AD and AP, ties to champion type", () => {
  const ahri = data.champions.Ahri;
  const m = emptyMods();
  m.adaptive = 9;
  const st = computeStats({ base: ahri.stats, level: 1, adaptiveDefault: "magic", ranged: true }, m);
  near(st.ap, 9);
  m.ad = 10;
  const st2 = computeStats({ base: ahri.stats, level: 1, adaptiveDefault: "magic", ranged: true }, m);
  near(st2.bonusAd, 10 + 5.4);
});

test("adaptive force's choice counts what items' passives give but Manamune's and Staff of Flowing Water's (wiki, Adaptive_force)", () => {
  // Katarina on the page's default runes (two adaptive force shards), combo R, no items: no bonus AD or AP, her type, AP.
  const kat = toScenario(data, { ...DEMO_STATE, champion: "Katarina", items: [null, null, null, null, null, null], combo: "R" });
  const stats = (items: string[]) => simulate(data, { ...kat, items }).stats;
  assert.equal(stats([]).adaptiveType, "magic");
  // Sterak's Gage's 50% base AD (The Claws that Catch) counts: it turns AD, and the ranking's row says so.
  assert.equal(stats(["Sterak's Gage"]).adaptiveType, "physical");
  assert.equal(rankItems(data, kat, { candidates: ["Sterak's Gage"] }).items[0].adaptive, "physical");
  // Manamune's AD from 2% max mana (Awe) doesn't: with two Amplifying Tomes' 40 AP, its 35 AD counts, Awe's 10 more not,
  // and AP stays, where Sterak's 43 AD turn it.
  const tomes = { ...kat, items: ["Amplifying Tome", "Amplifying Tome"] };
  const mana = stats([...tomes.items, "Manamune"]);
  assert.equal(mana.adaptiveType, "magic");
  near(mana.bonusAd, 35 + 0.02 * 500);
  const rows = rankItems(data, tomes, { candidates: ["Manamune", "Sterak's Gage"] }).items;
  assert.deepEqual(
    ["Manamune", "Sterak's Gage"].map((item) => rows.find((r) => r.item === item)!.adaptive),
    [undefined, "physical"],
  );
  // Staff of Flowing Water's 40 AP from Rapids doesn't: its 35 AP is less than a B. F. Sword's 40 AD, though 75 is more.
  const rapids = simulate(data, { ...kat, items: ["Staff of Flowing Water", "B. F. Sword"], options: { "flowingWater.active": 1 } }).stats;
  assert.equal(rapids.adaptiveType, "physical");
});

test("adaptive force's choice and Rabadon's Deathcap: Magical Opus counts, of champion passives' AP too (the wiki's example)", () => {
  // Veigar at level 1 (52 AD) with two adaptive force shards (18 AP or 10.8 AD) and Phenomenal Evil's stacks (1 AP each).
  const veigar = (items: string[], stacks: number) =>
    new Sim(data, { champion: "Veigar", level: 1, items, runes: [5008, 5008], options: { stacks }, combo: [] }).stats;
  const at = (st: ReturnType<typeof veigar>, type: string, ad: number, ap: number) => {
    assert.equal(st.adaptiveType, type);
    near(st.ad, ad, 0.01);
    near(st.ap, ap, 0.01);
  };
  at(veigar([], 0), "magic", 52, 18);
  // Rabadon's 130 AP, 39 more from Magical Opus, which amplifies the shards' too: 23.4 AP.
  const cap = ["Rabadon's Deathcap"];
  at(veigar(cap, 0), "magic", 52, 192.4);
  // 4 B. F. Swords' 160 AD are more than Rabadon's 130 AP, but Magical Opus counts: 169 against 160, AP.
  const swords = [...cap, "B. F. Sword", "B. F. Sword", "B. F. Sword", "B. F. Sword"];
  at(veigar(swords, 0), "magic", 212, 192.4);
  // A Long Sword: 170 AD against 169, AD.
  at(veigar([...swords, "Long Sword"], 0), "physical", 232.8, 169);
  // 10 Phenomenal Evil AP don't count by themselves, Magical Opus' 3 of them do: 172 against 170, AP.
  at(veigar([...swords, "Long Sword"], 10), "magic", 222, 205.4);
  // A Long Sword alone and 20 stacks: 10 AD against no AP that counts, AD.
  at(veigar(["Long Sword"], 20), "physical", 72.8, 20);
});

test("breakpoint formulas (Ignite 16.20: 70 +20/level, +25/level from 6)", () => {
  const env = { level: 1 } as any;
  const ignite = data.summoners.SummonerDot.calcs.TooltipTrueDamageCalculation as any;
  const at = (level: number) => evalPart(ignite.parts[0], { ...env, level });
  near(at(1), 70);
  near(at(5), 150);
  near(at(6), 175);
  near(at(11), 300);
  near(at(18), 475);
});

test("expression language", () => {
  const r = (p: string[]) => ({ a: 2, b: 3, "calc.X": 10 })[p.join(".")] ?? 0;
  assert.equal(compile("a + b * 2")(r), 8);
  assert.equal(compile("(a + b) * 2")(r), 10);
  assert.equal(compile("a > 1 ? calc.X : 0")(r), 10);
  assert.equal(compile("min(a, b) + max(a, b) + clamp(10, 0, 4)")(r), 9);
  assert.equal(compile("2 ^ 3 ^ 2")(r), 512);
  assert.equal(compile("calc['X']")(r), 10);
});

test("combo shorthand round-trips", () => {
  const steps = parseCombo("E > Q, W R:dash AA*3 AA! ignite item:Hextech_Rocketbelt wait{1.5s} wait wait{1s} Q{out:1,back:0} Q+bonus");
  assert.equal(steps.filter((s) => s.type === "attack").length, 2);
  assert.equal(formatCombo(steps), "E Q W R:dash AA*3 AA! ignite item:Hextech_Rocketbelt wait{1.5s} wait wait{1s} Q{out:1,back:0} Q+bonus");
  assert.deepEqual(
    steps.filter((s) => s.type === "wait"),
    [{ type: "wait", seconds: 1.5 }, { type: "wait" }, { type: "wait", seconds: 1 }],
  );
  assert.throws(() => parseCombo("Q X"));
  assert.equal(formatCombo(parseCombo("Q! E? Q:tornado{a:1}!+bonus*2 AA*3?")), "Q! E? Q:tornado{a:1}!+bonus Q:tornado{a:1}!+bonus AA*3?");
  assert.deepEqual(parseCombo("E{0.5s} R{1.5s,zone:10}"), [
    { type: "ability", slot: "E", duration: 0.5 },
    { type: "ability", slot: "R", duration: 1.5, hits: { zone: 10 } },
  ]);
  assert.equal(formatCombo(parseCombo("E{0.5s}! R{1.5s,zone:10}")), "E{0.5s}! R{1.5s,zone:10}");
  assert.deepEqual(parseCombo("R{3}"), [{ type: "ability", slot: "R", count: 3 }]);
  assert.throws(() => parseCombo("E{a}"));
  for (const bad of ["AA*0", "0AA", "Q*0", "Q{out:2.5}", "Q{out:-1}"]) assert.throws(() => parseCombo(bad), Error, bad);
});

test("a champion switch drops the other champion's variants, durations, hit counts and crit marks", () => {
  const ahri = getKit(data.champions.Ahri);
  assert.equal(formatCombo(fitCombo(parseCombo("Q:tap{tick:3}! E{0.5s} W+bonus AA!+bounce R:Q2{3} ignite wait"), ahri)), "Q E W AA! R ignite wait");
  const smolder = getKit(data.champions.Smolder);
  assert.equal(formatCombo(fitCombo(parseCombo("E{0.5s} R:Center Q{burn:1}"), smolder)), "E{0.5s} R:center Q{burn:1}");
});

test("a step's number is clamped to what its cast allows at the build's ranks", () => {
  const steps = parseCombo("R{5} Q");
  const at = (r: number) => new Sim(data, { champion: "Xerath", level: 18, ranks: { Q: 5, W: 5, E: 5, R: r }, combo: [] });
  assert.equal(formatCombo(clampCombo(steps, (st) => at(1).castSetting(st))), "R{4} Q");
  const kept = clampCombo(steps, (st) => at(3).castSetting(st));
  assert.ok(
    kept.every((st, i) => st === steps[i]),
    "unchanged steps stay the same objects",
  );
  // A number the cast doesn't take is dropped: seconds on a count, a count on a cast that has none.
  assert.equal(formatCombo(clampCombo(parseCombo("R{2s} Q{3} W{1s}"), (st) => at(3).castSetting(st))), "R Q W");
});

test("a step that does nothing for the champion or build is skipped, and says why", () => {
  const ahri = { champion: "Ahri", level: 11, items: ["Luden's Echo"], target: dummy };
  const run = (combo: string, items = ahri.items) => simulate(data, { ...ahri, items, combo });
  // Ahri has no P step, and Hextech Gunblade isn't bought: the combo runs as without them.
  const plain = run("E Q W R AA");
  const r = run("E Q P W item:Hextech_Gunblade R AA");
  assert.equal(r.totalDamage, plain.totalDamage);
  assert.deepEqual(
    r.timeline.map((t) => t.step),
    plain.timeline.map((t) => t.step),
  );
  assert.deepEqual(r.warnings, ["Ahri has no P step; step skipped", "Hextech Gunblade isn't in the build; step skipped"]);
  // Bought, its active fires.
  const bought = run("E Q W item:Hextech_Gunblade R AA", [...ahri.items, "Hextech Gunblade"]);
  assert.deepEqual(bought.warnings, []);
  assert.ok(bought.bySource.some((s) => s.source === "item:3146" && s.damage > 0));
  const sim = (s: object) => new Sim(data, { ...ahri, combo: [], ...s });
  assert.equal(sim({}).skipReason({ type: "ability", slot: "Q" }), null);
  assert.equal(sim({ level: 1 }).skipReason({ type: "ability", slot: "W" }), "W is not learned at level 1 (rank 0)");
  assert.equal(sim({}).skipReason({ type: "item", item: "Luden's Echo" }), "Luden's Echo has no modeled active");
  // A passive with only a buff is a step: Kha'Zix's Unseen Threat.
  assert.equal(sim({ champion: "Khazix" }).skipReason({ type: "ability", slot: "P" }), null);
});

test("crit marks: the steps that roll crits, marked all at once", () => {
  const yasuo = getKit(data.champions.Yasuo);
  const steps = parseCombo("Q E AA R Q:tornado");
  assert.deepEqual(
    steps.map((s) => rollsCrits(s, yasuo)),
    [true, false, true, false, true],
  );
  assert.equal(critMarking(steps, yasuo), "expected");
  const marked = steps.map((s) => markCrit(s, yasuo, "always"));
  assert.equal(formatCombo(marked), "Q! E AA! R Q:tornado!");
  assert.equal(critMarking(marked, yasuo), "always");
  assert.equal(formatCombo(marked.map((s) => markCrit(s, yasuo, "expected"))), "Q E AA R Q:tornado");
  assert.equal(critMarking(parseCombo("Q! AA?"), yasuo), "mixed");
  assert.equal(critMarking(parseCombo("E R"), yasuo), null);
});

test("default skill ranks: R at 6/11/16, one point in each basic, then max order", () => {
  const r = resolveRanks(data.champions.Ahri, 11, undefined, "QWE");
  assert.deepEqual([r.Q, r.W, r.E, r.R], [5, 3, 1, 2]);
  const r1 = resolveRanks(data.champions.Ahri, 1, undefined);
  assert.equal(r1.Q + r1.W + r1.E + r1.R, 1);
});

test("Ahri Q matches the game formula (35/60/85/110/135 + 50% AP)", () => {
  const sim = new Sim(data, { champion: "Ahri", level: 11, items: ["Rabadon's Deathcap"], combo: [] });
  // Rabadon's: 130 AP × 1.3 = 169 AP
  near(sim.stats.ap, 169);
  near(sim.evalExpr("calc.TotalDamage", { slot: "Q", rank: 5 }), 135 + 0.5 * 169);
});

test("a combo against a true-dummy deals the sum of its hits", () => {
  const r = simulate(data, { champion: "Ahri", level: 11, combo: "Q", target: dummy });
  // Out (magic) + return (true) at rank 5 with 0 AP and 0 MR.
  near(r.totalDamage, 270);
});

test("Ignite: true damage in 5 ticks, not amplified", () => {
  const r = simulate(data, { champion: "Ahri", level: 11, runes: ["Coup de Grace"], combo: "ignite", target: { ...dummy, hpPercent: 30 } });
  near(r.totalDamage, 300);
  assert.equal(r.events.length, 5);
});

test("crit: 200% base, +30% with Infinity Edge, expected value unless marked", () => {
  const jinx = (combo: string) => simulate(data, { champion: "Jinx", level: 1, items: ["Infinity Edge"], combo, target: dummy });
  const crit = jinx("AA!");
  const ad = crit.stats.ad;
  near(crit.events[0].raw, ad * 2.3);
  near(jinx("AA").events[0].raw, ad * (1 + 0.25 * 1.3));
  near(jinx("AA?").events[0].raw, ad);
});

test("crit marks hold for everything the step causes: casts, and follow-up attacks", () => {
  const sim = (champion: string, combo: string) =>
    simulate(data, { champion, level: 18, items: ["Infinity Edge", "Bloodthirster"], combo, target: { preset: "tank" } });
  const yasuo = (combo: string) => sim("Yasuo", combo).totalDamage;
  assert.ok(yasuo("Q!") > yasuo("Q") && yasuo("Q") > yasuo("Q?"));
  // Follow-up attacks crit with the attack that caused them.
  const followUpCrits = (champion: string, combo: string, source: string) => sim(champion, combo).events.find((e) => e.sourceLabel === source)!.flags.crit;
  for (const [champion, combo, source] of [
    ["Akshan", "AA", "Dirty Fighting"],
    ["Lucian", "Q AA", "Lightslinger"],
    ["MasterYi", "AA*4", "Double Strike"],
  ]) {
    assert.equal(followUpCrits(champion, `${combo}!`, source), true, champion);
    assert.equal(followUpCrits(champion, `${combo}?`, source), false, champion);
  }
});

test("lethality is flat armor penetration at all levels", () => {
  const r = simulate(data, { champion: "Ahri", level: 1, items: ["Serrated Dirk"], combo: "AA", target: { maxHp: 2000, armor: 50, mr: 0 } });
  near(r.target.effectiveArmor, 40);
});

test("damage-dealt amplifiers add; damage-taken modifiers multiply", () => {
  const amps = [
    { source: "a", value: 0.08, kind: "dealt" as const },
    { source: "b", value: 0.08, kind: "dealt" as const },
    { source: "c", value: 0.12, kind: "taken" as const },
  ];
  near(combineAmps(amps), 1.16 * 1.12, 1e-9);
});

test("Electrocute triggers on the third separate hit within 3s", () => {
  const r = simulate(data, { champion: "Ahri", level: 11, runes: ["Electrocute"], combo: "E Q W", target: dummy });
  const strike = r.events.filter((e) => e.source === "rune:8112");
  assert.equal(strike.length, 1);
  // 60 + 10 × level at level 11 with no bonus AD/AP.
  near(strike[0].raw, 170);
});

test("Liandry's burn: 2% max HP per second for 3s on ability damage", () => {
  const r = simulate(data, { champion: "Ahri", level: 11, items: ["Liandry's Torment"], combo: "E", target: { maxHp: 3000, armor: 0, mr: 0 } });
  const burns = r.events.filter((e) => e.source === "item:6653");
  assert.equal(burns.length, 6);
  near(burns[0].raw, 0.01 * 3000);
});

test("Spellblade: Sheen procs once per 1.5s on the attack after a cast", () => {
  const r = simulate(data, { champion: "Garen", level: 9, items: ["Sheen"], combo: "E AA AA", target: dummy });
  const procs = r.events.filter((e) => e.label === "Spellblade");
  assert.equal(procs.length, 1);
  near(procs[0].raw, r.stats.baseAd);
});

test("Black Cleaver shreds armor per physical hit (max 30%)", () => {
  const r = simulate(data, { champion: "Garen", level: 11, items: ["Black Cleaver"], combo: "AA*6", target: { maxHp: 5000, armor: 100, mr: 0 } });
  const last = r.events[r.events.length - 1];
  near(last.effectiveResist!, 70, 0.5);
});

test("Garen Q replaces the next attack (shown as the attack for its normal damage, Q for the rest); E hits 7 + bonus attack speed spins", () => {
  const r = simulate(data, { champion: "Garen", level: 11, combo: "Q AA", target: dummy });
  const hits = r.events.filter((e) => e.source === "Q" || e.source === "AA");
  assert.deepEqual(
    hits.map((e) => e.source),
    ["Q", "AA"],
  );
  assert.ok(hits[0].flags.empowered && !hits[1].flags.empowered);
  const sim = new Sim(data, { champion: "Garen", level: 11, combo: [] });
  near(hits[1].raw, r.stats.ad);
  near(hits[0].raw + hits[1].raw, sim.evalExpr("calc.TotalDamage", { slot: "Q" }));
  const e = simulate(data, { champion: "Garen", level: 11, combo: "E", target: dummy });
  assert.equal(e.events.length, 7 + Math.floor(e.stats.bonusAttackSpeed / 0.25));
});

test("Darius R scales with Hemorrhage stacks and caps at 200%", () => {
  const r = simulate(data, { champion: "Darius", level: 11, combo: "AA AA AA AA AA R", target: { maxHp: 9000, armor: 0, mr: 0 } });
  const rHit = r.events.find((e) => e.source === "R")!;
  const sim = new Sim(data, { champion: "Darius", level: 11, combo: [] });
  // 5 stacks → ×2 (the cap), and Noxian Might's bonus AD feeds the 75% bonus AD ratio.
  const might = sim.evalExpr("P.calc.NoxianMightBonusAD", { slot: "P" });
  near(rHit.raw, 2 * (sim.evalExpr("dv.RBaseDamage", { slot: "R" }) + 0.75 * might), 0.1);
});

test("Collector executes below 5% health", () => {
  const r = simulate(data, { champion: "Jinx", level: 18, items: ["The Collector"], combo: "AA?", target: { maxHp: 1000, hpPercent: 20, armor: 0, mr: 0 } });
  assert.ok(r.killed);
  assert.ok(r.events.some((e) => e.label === "Execute"));
});

test("Collector's execute counts 5% of max health once, also when the hit that took the target there killed", () => {
  const target = { maxHp: 1000, armor: 0, mr: 0 };
  const run = (hpPercent: number) =>
    simulate(data, { champion: "Jinx", level: 18, items: ["The Collector"], combo: "AA? AA?", target: { ...target, hpPercent } });
  for (const hpPercent of [8, 30]) {
    const execs = run(hpPercent).events.filter((e) => e.label === "Execute");
    assert.equal(execs.length, 1, `${hpPercent}%`);
    near(execs[0].final!, 50, 0.01);
  }
});

test("rank items per gold: sorted by damage gained per 1000 gold of the item", () => {
  const base = { champion: "Ahri", level: 11, items: ["Luden's Echo", "Sorcerer's Shoes"], combo: "E Q W R AA R", target: { preset: "squishy" as const } };
  const res = rankItems(data, base, { metric: "damagePerGold", limit: 200 });
  for (let i = 1; i < res.items.length; i++)
    assert.ok(res.items[i - 1].gainPerGold >= res.items[i].gainPerGold, `${res.items[i - 1].item} before ${res.items[i].item}`);
  const lich = res.items.find((x) => x.item === "Lich Bane")!;
  near(lich.gainPerGold, (lich.gain / lich.gold) * 1000, 0.2);
  // Lich Bane's own Spellblade hit is part of its gain; Rabadon's only raises your other damage.
  assert.ok(lich.itemDamage > 0 && lich.itemDamage < lich.gain);
  assert.equal(res.items.find((x) => x.item === "Rabadon's Deathcap")!.itemDamage, 0);
});

test("rank items: an item built from one of the build's takes its place, for the difference in gold", () => {
  const base = { champion: "Ahri", level: 11, items: ["Luden's Echo", "Boots"], combo: "E Q W R AA R", target: { preset: "squishy" as const } };
  const [shoes] = rankItems(data, base, { candidates: ["Sorcerer's Shoes"] }).items;
  assert.equal(shoes.gold, 1100 - 300);
  assert.deepEqual(shoes.replaces, [{ item: "Boots", id: 1001 }]);
  const upgraded = simulate(data, { ...base, items: ["Luden's Echo", "Sorcerer's Shoes"] }).totalDamage - simulate(data, base).totalDamage;
  near(shoes.gain, upgraded, 0.1);
  near(shoes.gainPerGold, (upgraded / 800) * 1000, 0.1);
  // A second pair isn't bought; the mid lane quest's upgrade to tier 3 is free, so isn't ranked.
  const shod = { ...base, items: ["Luden's Echo", "Sorcerer's Shoes"] };
  assert.deepEqual(
    rankItems(data, shod, { candidates: ["Berserker's Greaves", "Spellslinger's Shoes", "Rabadon's Deathcap"] }).items.map((x) => x.item),
    ["Rabadon's Deathcap"],
  );
  assert.equal(rankItems(data, shod, { candidates: ["Rabadon's Deathcap"] }).items[0].replaces, undefined);
});

test("rank items: components only when asked for, every one of them; sets and optimize keep to the legendaries and boots", () => {
  const base = { champion: "Talon", level: 6, items: [], runes: ["Electrocute"], combo: "W E Q AA R AA", target: { preset: "squishy" as const } };
  const names = (opts: { components?: boolean }) => rankItems(data, base, { ...opts, limit: Infinity }).items.map((r) => r.item);
  assert.ok(!names({}).some((n) => ["Serrated Dirk", "Long Sword"].includes(n)));
  assert.ok(["Serrated Dirk", "Long Sword", "Pickaxe", "Tiamat"].every((n) => names({ components: true }).includes(n)));
  // A component the build has, again: its stats stack. A legendary isn't bought twice.
  const sword = rankItems(data, { ...base, items: ["Long Sword"] }, { components: true, limit: Infinity }).items.find((r) => r.item === "Long Sword");
  assert.ok(sword && sword.gain > 0 && !sword.replaces);
  assert.ok(!rankItems(data, { ...base, items: ["Youmuu's Ghostblade"] }, { limit: Infinity }).items.some((r) => r.item === "Youmuu's Ghostblade"));
  // No candidates rank none; components are the default candidates', not with others.
  assert.deepEqual(rankItems(data, base, { candidates: [] }).items, []);
  assert.throws(() => rankItems(data, base, { candidates: ["Long Sword"], components: true }), /list the components among them/);
  // Bought, what's built from it takes its place, for the rest of its price.
  const youmuu = rankItems(data, { ...base, items: ["Serrated Dirk"] }, { limit: Infinity }).items.find((r) => r.item === "Youmuu's Ghostblade")!;
  assert.deepEqual(youmuu.replaces, [{ item: "Serrated Dirk", id: 3134 }]);
  assert.equal(youmuu.gold, 2800 - 1000);
  // Neither Boots, nor a potion, nor Seeker's Armguard spent (not sold); none among the legendaries and boots.
  const components = componentCandidates(data).map((i) => i.name);
  assert.ok(components.includes("Serrated Dirk") && components.includes("Dark Seal"));
  assert.ok(!components.some((n) => ["Boots", "Refillable Potion", "Shattered Armguard"].includes(n)));
  assert.ok(!defaultCandidates(data).some(isComponent));
});

test("rank items: what an item's hits proc is split from its own damage and its stats", () => {
  // W Q is two hits; Stormsurge's Squall is the third, so Electrocute strikes only with it.
  const base = {
    champion: "Smolder",
    level: 11,
    items: ["Essence Reaver", "Ionian Boots of Lucidity"],
    runes: ["Electrocute"],
    combo: "W Q",
    target: { preset: "squishy" as const },
  };
  assert.ok(!simulate(data, base).bySource.some((s) => s.label === "Electrocute"));
  const electrocute = simulate(data, { ...base, items: [...base.items, "Stormsurge"] }).bySource.find((s) => s.label === "Electrocute")!.damage;
  const res = rankItems(data, base, { candidates: ["Stormsurge", "Rabadon's Deathcap"] });
  const storm = res.items.find((x) => x.item === "Stormsurge")!;
  assert.deepEqual(
    storm.procs.map((p) => p.name),
    ["Electrocute"],
  );
  near(storm.procDamage, electrocute, 0.1);
  // The rest of the gain beyond Squall itself is its AP raising W and Q.
  assert.ok(storm.itemDamage > 0 && storm.baseDamage > 0);
  near(storm.baseDamage + storm.itemDamage + storm.procDamage + storm.lostDamage, storm.gain, 0.2);
  const cap = res.items.find((x) => x.item === "Rabadon's Deathcap")!;
  assert.equal(cap.procDamage, 0);
  assert.deepEqual(cap.procs, []);
  // With an attack after it, Electrocute strikes without Squall too: on Squall instead isn't a proc.
  const later = { ...base, combo: "W Q wait{2s} AA" };
  assert.ok(simulate(data, later).bySource.some((s) => s.label === "Electrocute"));
  assert.equal(rankItems(data, later, { candidates: ["Stormsurge"] }).items[0].procDamage, 0);
  // Any hit that lands only with the item counts: here Smolder's execute, in range only with its damage.
  const exec = { ...base, level: 9, items: ["Essence Reaver"], options: { stacks: 225 }, combo: "E Q AA Q" };
  const executes = (items: string[]) => simulate(data, { ...exec, items }).events.filter((e) => e.label === "Super Scorcher Breath (execute)");
  assert.equal(executes(exec.items).length, 0);
  const [execute] = executes([...exec.items, "Lord Dominik's Regards"]);
  const ldr = rankItems(data, exec, { candidates: ["Lord Dominik's Regards"] }).items[0];
  assert.deepEqual(
    ldr.procs.map((p) => [p.source, p.name]),
    [["Q", "Super Scorcher Breath (execute)"]],
  );
  near(ldr.procDamage, execute.final!, 0.1);
});

test("rank items: a part a stat adds to hits that land anyway is the item's base, not a proc", () => {
  // Katarina's knives deal an AD part only with bonus AD: with Infinity Edge, 15 more events but the same 15 knives.
  const kat = { champion: "Katarina", level: 11, runes: ["Electrocute", "Absolute Focus"], combo: "R", target: { preset: "squishy" as const } };
  const knivesAd = (items: string[]) => simulate(data, { ...kat, items }).events.filter((e) => e.label === "Death Lotus (knife, AD)").length;
  assert.deepEqual([knivesAd([]), knivesAd(["Infinity Edge"])], [0, 15]);
  const res = rankItems(data, kat, { candidates: ["Infinity Edge", "Rabadon's Deathcap"] });
  const ie = res.items.find((x) => x.item === "Infinity Edge")!;
  assert.deepEqual(ie.procs, []);
  assert.ok(ie.baseDamage > ie.gain);
  // Its AD turns the adaptive force AD, and Electrocute physical: less of it lands through the target's armor.
  assert.equal(ie.adaptive, "physical");
  assert.deepEqual(
    ie.lost.map((l) => [l.source, l.name]),
    [["rune:8112", "Electrocute"]],
  );
  const cap = res.items.find((x) => x.item === "Rabadon's Deathcap")!;
  assert.deepEqual([cap.lost, cap.adaptive, cap.baseDamage], [[], undefined, cap.gain]);
  // A hit applied twice is two: Dusk and Dawn's Spellblade applies Nashor's Tooth again, on the same attack.
  const gwen = { champion: "Gwen", level: 11, items: ["Nashor's Tooth"], combo: "Q AA E AA W R", target: { preset: "squishy" as const } };
  const dawn = rankItems(data, gwen, { candidates: ["Dusk and Dawn"] }).items[0];
  assert.ok(dawn.procs.some((p) => p.name === "Nashor's Tooth"));
});

test("rank items: a hit that lands only with the item is a proc with all its parts; hits only regrouped aren't", () => {
  // Dusk and Dawn applies Elise's Spider Form on-hits again, a hit of its own: its Spider Queen and three Spiderlings.
  const elise = { champion: "Elise", level: 11, combo: "R AA", target: { preset: "squishy" as const } };
  const spider = simulate(data, { ...elise, items: ["Dusk and Dawn"] }).events.filter((e) => e.sourceLabel === "Spider Form");
  const again = spider.filter((e) => e.hitId !== spider[0].hitId);
  assert.deepEqual(
    again.map((e) => e.label),
    ["Spider Queen", "Spiderling", "Spiderling", "Spiderling"],
  );
  const dealt = (label: string) => Math.round(again.filter((e) => e.label === label).reduce((sum, e) => sum + e.final!, 0) * 10) / 10;
  const dawn = rankItems(data, elise, { candidates: ["Dusk and Dawn"] }).items[0];
  assert.deepEqual(
    dawn.procs.map((p) => [p.name, p.damage]),
    [
      ["Spiderling", dealt("Spiderling")],
      ["Spider Queen", dealt("Spider Queen")],
    ],
  );
  // Tibbers' aura ticks and attacks land as one hit when at one moment: Terminus's attack speed moves one
  // apart, a hit more but no more of either.
  const annie = {
    champion: "Annie",
    level: 13,
    items: ["Kraken Slayer", "Infinity Edge", "Berserker's Greaves", "Phantom Dancer"],
    runes: ["Lethal Tempo", "Presence of Mind", "Legend: Alacrity", "Cut Down", 5005, 5008, 5001],
    combo: "AA Q AA W AA E AA R AA AA AA",
    target: { preset: "bruiser" as const, levelDiff: 1 },
  };
  const tibbers = (items: string[]) => {
    const events = simulate(data, { ...annie, items }).events.filter((e) => e.sourceLabel === "Summon: Tibbers");
    return [new Set(events.map((e) => e.hitId)).size, events.length];
  };
  assert.deepEqual(
    [tibbers(annie.items), tibbers([...annie.items, "Terminus"])],
    [
      [20, 21],
      [21, 21],
    ],
  );
  assert.deepEqual(rankItems(data, annie, { candidates: ["Terminus"] }).items[0].procs, []);
});

test("rank items: what an item takes away from your other damage is lost, and the parts add up to the gain", () => {
  // Rapid Firecannon's attack speed launches the attack before Achooo! lands: the attack fires the Energized
  // items, so Voltaic's Firmament lands with it, later, on less health, and its lethality misses Achooo!.
  const base = {
    champion: "Smolder",
    level: 15,
    items: ["Essence Reaver", "Voltaic Cyclosword", "Lord Dominik's Regards"],
    runes: ["Electrocute", "Cheap Shot"],
    options: { stacks: 225 },
    target: { preset: "squishy" as const },
  };
  const firmament = (combo: string, items: string[]) => simulate(data, { ...base, combo, items }).events.find((e) => e.label === "Firmament")!.time;
  const rfc = (combo: string) => rankItems(data, { ...base, combo }, { candidates: ["Rapid Firecannon"] }).items[0];
  const [waited, rushed] = [rfc("W wait Q AA"), rfc("W Q AA")];
  assert.deepEqual([waited.lost, waited.lostDamage], [[], 0]);
  assert.ok(firmament("W Q AA", [...base.items, "Rapid Firecannon"]) > firmament("W Q AA", base.items));
  // Achooo! and its explosion both deal less: a line named by what they share.
  assert.deepEqual(
    rushed.lost.map((l) => [l.source, l.name]),
    [
      ["item:6699", "Voltaic Cyclosword"],
      ["W", "Achooo!"],
    ],
  );
  const achooo = simulate(data, { ...base, combo: "W Q AA", items: [...base.items, "Rapid Firecannon"] }).events.filter((e) => e.source === "W");
  assert.ok(["Achooo!", "Achooo! (explosion)"].every((label) => achooo.some((e) => e.label === label)));
  assert.ok(rushed.lostDamage < -50);
  for (const x of [waited, rushed]) near(x.baseDamage + x.itemDamage + x.procDamage + x.lostDamage, x.gain, 0.2);
});

test("rank items: a proc or lost line is named as its hits are called in the run its number comes from", () => {
  const labels = (sc: Scenario, source: string) => [
    ...new Set(
      simulate(data, sc)
        .events.filter((e) => e.source === source)
        .map((e) => e.label),
    ),
  ];
  // A proc, with the item: Sundered Sky crits Yunara's attack, so her passive's crit hit lands, which without it doesn't.
  const yunara: Scenario = { champion: "Yunara", level: 11, combo: "Q W E R AA AA", target: { maxHp: 2200, armor: 80, mr: 55 } };
  assert.ok(!labels(yunara, "P").includes("Vow of the First Lands (crit)"));
  assert.ok(labels({ ...yunara, items: ["Sundered Sky"] }, "P").includes("Vow of the First Lands (crit)"));
  assert.deepEqual(
    rankItems(data, yunara, { candidates: ["Sundered Sky"] }).items[0].procs.map((p) => [p.source, p.name]),
    [["P", "Vow of the First Lands (crit)"]],
  );
  // A hit that lands only without the item, as it's called without it: Lucian's second Lightslinger shot.
  const lucian: Scenario = {
    champion: "Lucian",
    level: 16,
    items: ["Luden's Echo", "Sorcerer's Shoes", "Rabadon's Deathcap", "Void Staff"],
    runes: ["Electrocute", "Cheap Shot", 5008, 5008, 5001],
    combo: "Q W E R AA",
    target: { maxHp: 2800, armor: 110, mr: 75, bonusHp: 900 },
  };
  assert.ok(!labels({ ...lucian, items: [...lucian.items!, "Lord Dominik's Regards"] }, "AA").includes("Lightslinger (2nd shot)"));
  const ldr = rankItems(data, lucian, { candidates: ["Lord Dominik's Regards"] }).items[0];
  assert.ok(ldr.lost.some((l) => l.source === "AA" && l.name === "Lightslinger (2nd shot)"));
  // Hits called several things there are named by what they share: Achooo! and its explosion (see the lost test).
});

test("rank items: a candidate's active in the combo is used with it, though the build hasn't the item", () => {
  const base = { champion: "Ahri", level: 11, items: ["Luden's Echo"], combo: "E Q W R AA R", target: { preset: "squishy" as const } };
  const gunblade = (combo: string) => rankItems(data, { ...base, combo }, { candidates: ["Hextech Gunblade"] }).items[0];
  const without = gunblade(base.combo);
  const used = gunblade(base.combo + " item:Hextech_Gunblade");
  assert.equal(without.itemDamage, 0);
  assert.deepEqual(
    used.itemHits.map((h) => h.name),
    ["Lightning Bolt"],
  );
  near(used.gain, without.gain + used.itemDamage, 0.2);
});

test("item sets: the best by damage and per gold of every set of the candidates", () => {
  const base = { champion: "Ahri", level: 11, items: ["Luden's Echo", "Sorcerer's Shoes"], combo: "E Q W R AA R", target: { preset: "squishy" as const } };
  const candidates = [
    "Rabadon's Deathcap",
    "Shadowflame",
    "Stormsurge",
    "Void Staff",
    "Lich Bane",
    "Zhonya's Hourglass",
    "Cosmic Drive",
    "Horizon Focus",
    "Blackfire Torch",
    "Liandry's Torment",
    "Morellonomicon",
  ];
  const res = rankItemSets(data, base, { size: 3, candidates });
  // Every set of three, simulated.
  const was = simulate(data, base).totalDamage;
  const every: { key: string; gain: number; perGold: number }[] = [];
  for (let i = 0; i < candidates.length; i++)
    for (let j = i + 1; j < candidates.length; j++)
      for (let k = j + 1; k < candidates.length; k++) {
        const set = [candidates[i], candidates[j], candidates[k]];
        const gain = simulate(data, { ...base, items: [...base.items, ...set] }).totalDamage - was;
        const gold = set.reduce((sum, q) => sum + findItem(data, q).gold.total, 0);
        every.push({ key: [...set].sort().join(" + "), gain, perGold: (gain / gold) * 1000 });
      }
  const keys = (xs: { key: string }[]) => xs.slice(0, 5).map((x) => x.key);
  const found = res.sets.map((s) => ({
    key: s.items
      .map((x) => x.item)
      .sort()
      .join(" + "),
    gain: s.gain,
    perGold: s.gainPerGold,
  }));
  for (const by of ["gain", "perGold"] as const)
    assert.deepEqual(keys([...found].sort((a, b) => b[by] - a[by])), keys(every.sort((a, b) => b[by] - a[by])), by);
  // Fewer simulations than the 165 sets of three, let alone the 231 builds with one to three more items.
  assert.ok(res.evaluated < 165, `${res.evaluated} simulations`);
  // Its numbers, as simulate has them.
  const top = res.sets[0];
  const gold = top.items.reduce((sum, x) => sum + data.items[x.id].gold.total, 0);
  assert.equal(top.gold, gold);
  near(top.gain, simulate(data, { ...base, items: [...base.items, ...top.items.map((x) => x.id)] }).totalDamage - was, 0.1);
  near(top.gainPerGold, (top.gain / gold) * 1000, 0.1);
});

test("item sets: an item that adds nothing alone, tried with the best sets until it adds to one: Stormsurge, short of its burst alone", () => {
  // With no combo, Singed's items deal some 215 in Stormsurge's 2.5s, short of the 25% of the target's
  // 925 HP that sets off its Squall; each of the other items that add damage takes them past it.
  const base = {
    champion: "Singed",
    level: 6,
    items: ["Sunfire Aegis", "Warmog's Armor", "Heartsteel", "Abyssal Mask"],
    combo: "",
    target: { maxHp: 925, armor: 0, mr: 0 },
  };
  const others = ["Winter's Approach", "Protoplasm Harness", "Titanic Hydra", "Riftmaker", "Liandry's Torment"];
  const candidates = ["Stormsurge", ...others, "Rabadon's Deathcap", "Boots of Swiftness"];
  assert.equal(rankItems(data, base, { candidates: ["Stormsurge"] }).items[0].gain, 0);
  for (const it of others) assert.equal(rankItems(data, { ...base, items: [...base.items, it] }, { candidates }).items[0].item, "Stormsurge", it);
  const names = (s: ItemSet) => s.items.map((x) => x.item);
  const key = (s: ItemSet) => names(s).sort().join(" + ");
  // The best pairs, both ways: Stormsurge with each of them.
  const pairs = rankItemSets(data, base, { size: 2, candidates }).sets;
  const withIt = new Set(others.map((it) => [it, "Stormsurge"].sort().join(" + ")));
  assert.deepEqual(new Set(pairs.slice(0, 5).map(key)), withIt);
  assert.deepEqual(
    new Set(
      [...pairs]
        .sort((a, b) => b.gainPerGold - a.gainPerGold)
        .slice(0, 5)
        .map(key),
    ),
    withIt,
  );
  const was = simulate(data, base).totalDamage;
  near(pairs[0].gain, simulate(data, { ...base, items: [...base.items, ...names(pairs[0])] }).totalDamage - was, 0.1);
  // Not with an item that adds nothing to the set it's tried with: the boots, or Rabadon's Deathcap,
  // whose only AP to multiply is Stormsurge's, for a Squall no pair of the two sets off.
  assert.ok(pairs.every((s) => !names(s).includes("Boots of Swiftness") && !names(s).includes("Rabadon's Deathcap")));
  // In seven slots, Rabadon's Deathcap adds to the best pair, Stormsurge's Squall: so it's tried with the others too.
  const threes = rankItemSets(data, base, { size: 3, candidates, fits: (b) => b.length <= 7 }).sets;
  assert.ok(names(threes[0]).includes("Stormsurge"));
  const deathcap = threes.find((s) => key(s) === "Liandry's Torment + Rabadon's Deathcap + Stormsurge")!;
  near(deathcap.gain, simulate(data, { ...base, items: [...base.items, ...names(deathcap)] }).totalDamage - was, 0.1);
  assert.ok(threes.some((s) => key(s) === "Rabadon's Deathcap + Stormsurge + Winter's Approach"));
  assert.ok(threes.every((s) => !names(s).includes("Boots of Swiftness")));
});

test("item sets: bought as the shop buys them, fitting the build's slots", () => {
  const base = { champion: "Ahri", level: 11, items: ["Luden's Echo", "Boots"], combo: "E Q W R AA R", target: { preset: "squishy" as const } };
  const candidates = ["Sorcerer's Shoes", "Berserker's Greaves", "Spellslinger's Shoes", "Rabadon's Deathcap", "Shadowflame", "Lich Bane", "Trinity Force"];
  const { sets } = rankItemSets(data, base, { size: 2, candidates });
  const names = (s: ItemSet) => s.items.map((x) => x.item);
  const shoes = sets.find((s) => names(s).includes("Sorcerer's Shoes") && names(s).includes("Rabadon's Deathcap"))!;
  // A pair of boots takes the place of the Boots, for the difference in gold.
  assert.deepEqual(shoes.replaces, [{ item: "Boots", id: 1001 }]);
  assert.equal(shoes.gold, 1100 - 300 + 3500);
  near(
    shoes.gain,
    simulate(data, { ...base, items: ["Luden's Echo", "Sorcerer's Shoes", "Rabadon's Deathcap"] }).totalDamage - simulate(data, base).totalDamage,
    0.1,
  );
  for (const s of sets) {
    const items = s.items.map((x) => data.items[x.id]);
    // One pair of boots, one Spellblade item (Lich Bane, Trinity Force).
    assert.ok(
      items.every((it, i) => !conflicts(items.slice(0, i), it)),
      names(s).join(" + "),
    );
    // Not a pair and its upgrade, which is bought for nothing.
    assert.ok(!(names(s).includes("Sorcerer's Shoes") && names(s).includes("Spellslinger's Shoes")));
  }
  assert.ok(sets.some((s) => s.items.every((x) => !data.items[x.id].tags.includes("Boots"))));
  // With a slot for boots and one for anything else, a set of two is a pair of boots and another item.
  const slots = (b: ItemData[]) => b.filter((it) => !it.tags.includes("Boots")).length <= 2;
  const fitted = rankItemSets(data, base, { size: 2, candidates, fits: slots }).sets;
  assert.ok(fitted.length > 0);
  for (const s of fitted) assert.equal(s.items.filter((x) => data.items[x.id].tags.includes("Boots")).length, 1, names(s).join(" + "));
});

test("item sets: of more items than the build's empty slots, as many bought in place of its components; of as many, with or without", () => {
  const base = { champion: "Talon", level: 13, runes: ["Electrocute"], combo: "W E Q AA R AA", target: { preset: "squishy" as const } };
  // Youmuu's Ghostblade and The Collector are built from a Serrated Dirk, the rest not.
  const candidates = ["Youmuu's Ghostblade", "The Collector", "Infinity Edge", "Lord Dominik's Regards", "Eclipse", "Serylda's Grudge"];
  const sets = (items: string[]) => rankItemSets(data, { ...base, items }, { size: 3, candidates }).sets;
  // 3 items and a Serrated Dirk: 3 more only with one in the Dirk's place.
  const full = sets(["Ionian Boots of Lucidity", "Voltaic Cyclosword", "Hubris", "Serrated Dirk"]);
  assert.ok(full.length > 0);
  for (const s of full) assert.deepEqual(s.replaces, [{ item: "Serrated Dirk", id: 3134 }]);
  // 2 items and the Dirk: 3 more, in place of it or, of none built from it, beside it.
  const roomy = sets(["Ionian Boots of Lucidity", "Voltaic Cyclosword", "Serrated Dirk"]);
  assert.ok(roomy.some((s) => s.replaces) && roomy.some((s) => !s.replaces));
  // How many of a build's items legendaries and boots can be bought in place of, for more gold: a
  // Serrated Dirk, a Long Sword, Boots; not Dark Seal (Mejai's Soulstealer isn't one), nor a pair of
  // boots (its tier 3 is free), nor a legendary.
  const room = (items: string[], candidates?: string[]) => upgradeRoom(data, [...items.map((q) => findItem(data, q).id), null], candidates);
  assert.deepEqual(
    ["Serrated Dirk", "Long Sword", "Boots", "Dark Seal", "Sorcerer's Shoes", "Luden's Echo"].map((q) => room([q])),
    [1, 1, 1, 0, 0, 0],
  );
  // Two Long Swords, two items; two Amplifying Tomes too, as Zhonya's Hourglass in place of both
  // leaves a slot. Two Sheens, none: a Spellblade item in place of one, the other's still there; nor a
  // Sheen beside a Trinity Force. One pair of boots.
  assert.equal(room(["Long Sword", "Long Sword"]), 2);
  assert.equal(room(["Amplifying Tome", "Amplifying Tome"], ["Zhonya's Hourglass"]), 2);
  assert.equal(room(["Sheen", "Sheen"]), 0);
  assert.equal(room(["Sheen", "Trinity Force"]), 0);
  assert.equal(room(["Sheen", "Tiamat", "Serrated Dirk"]), 3);
  assert.equal(room(["Boots", "Boots"]), 0);
  // Of the candidates given: the Dirk's room, with Youmuu's Ghostblade, none without.
  assert.equal(room(["Serrated Dirk"], ["Youmuu's Ghostblade"]), 1);
  assert.equal(room(["Serrated Dirk"], ["Infinity Edge"]), 0);
});

test("item sets: their gain split as an item's is, their own hits by item; a set of one as its item's row", () => {
  // Smolder's Rapid Firecannon takes away from Voltaic's Firmament and Achooo! (see rank items' lost test).
  const base = {
    champion: "Smolder",
    level: 15,
    items: ["Essence Reaver", "Voltaic Cyclosword", "Lord Dominik's Regards"],
    runes: ["Electrocute", "Cheap Shot"],
    options: { stacks: 225 },
    combo: "W Q AA",
    target: { preset: "squishy" as const },
  };
  const candidates = ["Rapid Firecannon", "Stormsurge", "Rabadon's Deathcap", "Infinity Edge"];
  const rows = rankItems(data, base, { candidates, limit: Infinity }).items;
  const ones = rankItemSets(data, base, { size: 1, candidates }).sets;
  assert.equal(ones.length, rows.length);
  for (const s of ones) {
    const { baseDamage, itemDamage, itemHits, procDamage, procs, lostDamage, lost, adaptive } = s;
    const row = rows.find((r) => r.id === s.items[0].id)!;
    assert.ok(itemHits.every((h) => h.source === `item:${row.id}`));
    assert.deepEqual(
      { baseDamage, itemDamage, itemHits: itemHits.map(({ name, damage }) => ({ name, damage })), procDamage, procs, lostDamage, lost, adaptive },
      {
        baseDamage: row.baseDamage,
        itemDamage: row.itemDamage,
        itemHits: row.itemHits,
        procDamage: row.procDamage,
        procs: row.procs,
        lostDamage: row.lostDamage,
        lost: row.lost,
        adaptive: row.adaptive,
      },
      row.item,
    );
  }
  assert.ok(ones.some((s) => s.lostDamage < -50));
  const pairs = rankItemSets(data, base, { size: 2, candidates }).sets;
  const both = pairs.find((s) => s.items.some((x) => x.item === "Stormsurge") && s.items.some((x) => x.item === "Rapid Firecannon"))!;
  // Each item's own hits, named by it: Stormsurge's Squall and Rapid Firecannon's Sharpshooter.
  assert.deepEqual(new Set(both.itemHits.map((h) => h.source)), new Set(["item:4646", "item:3094"]));
  for (const s of pairs) {
    const own = new Set(s.items.map((x) => `item:${x.id}`));
    assert.ok(s.itemHits.every((h) => own.has(h.source)));
    near(
      s.itemHits.reduce((sum, h) => sum + h.damage, 0),
      s.itemDamage,
      0.1 * s.itemHits.length + 0.6,
    );
    near(s.baseDamage + s.itemDamage + s.procDamage + s.lostDamage, s.gain, 0.3);
  }
});

test("item sets: a set's items in the order to buy them, each adding the most damage per gold to those before it", () => {
  const base = { champion: "Ahri", level: 11, items: ["Luden's Echo", "Sorcerer's Shoes"], combo: "E Q W R AA R", target: { preset: "squishy" as const } };
  const candidates = ["Rabadon's Deathcap", "Shadowflame", "Stormsurge", "Void Staff", "Lich Bane", "Cosmic Drive", "Blackfire Torch", "Liandry's Torment"];
  const { sets } = rankItemSets(data, base, { size: 3, candidates, limit: 5 });
  const total = (items: number[]) => simulate(data, { ...base, items: [...base.items, ...items] }).totalDamage;
  for (const s of sets) {
    // The greedy pass, from scratch.
    const order: number[] = [];
    const rest = s.items.map((x) => x.id);
    while (rest.length) {
      const was = total(order);
      const perGold = rest.map((id) => (total([...order, id]) - was) / data.items[id].gold.total);
      const k = perGold.indexOf(Math.max(...perGold));
      order.push(...rest.splice(k, 1));
    }
    assert.deepEqual(
      s.items.map((x) => x.id),
      order,
      s.items.map((x) => x.item).join(" → "),
    );
  }
  // Not the order the search found them in: Rabadon's Deathcap, best alone, multiplies the others' AP, so it's bought last.
  assert.ok(sets.some((s) => s.items.at(-1)!.item === "Rabadon's Deathcap"));
});

test("item sets: progress, one simulation at a time, its total a guess near the end's", () => {
  const base = { champion: "Jinx", level: 13, items: ["Infinity Edge"], combo: "AA AA AA W AA AA", target: { preset: "bruiser" as const } };
  const search = searchItemSets(data, base, { size: 2, limit: 5 });
  let step = search.next();
  const steps: { done: number; total: number }[] = [];
  while (!step.done) {
    const { done: now, total } = step.value;
    assert.equal(now, steps.length + 1);
    assert.ok(total >= now, `${now} of ${total}`);
    steps.push(step.value);
    step = search.next();
  }
  const res = step.value;
  const done = steps.length;
  assert.equal(res.evaluated, done);
  // A quarter, half and three quarters of the way, it says about so (0.23, 0.45, 0.68, where a bound on the total said 0.11, 0.21, 0.32).
  for (const part of [0.25, 0.5, 0.75]) {
    const at = steps.find((s) => s.done >= part * done)!;
    near(at.done / at.total, part, 0.15);
  }
  // The 5 best by damage and the 5 best per gold, by damage.
  assert.ok(res.sets.length >= 5 && res.sets.length <= 10);
  assert.ok(res.sets.every((s, i) => i === 0 || res.sets[i - 1].gain >= s.gain));
  assert.equal(
    new Set(
      res.sets.map((s) =>
        s.items
          .map((x) => x.id)
          .sort()
          .join(),
      ),
    ).size,
    res.sets.length,
  );
});

test("item hover text: numbers for the attacker from the template the shop text is generated from", () => {
  const sim = new Sim(data, { champion: "Ahri", level: 11, items: ["Luden's Echo"], combo: [] });
  const luden = data.items[6655];
  const live = itemText(luden, sim);
  assert.ok(live.live);
  assert.deepEqual(live.stats, ["<attention> 100</attention> Ability Power", "<attention> 600</attention> Mana", "<attention> 10</attention> Ability Haste"]);
  assert.ok(live.body.includes(`${formatNumber(sim.evalDataCalc(luden.calcs, luden.dataValues, "Damage"))} bonus magic damage`), live.body);
  // Without a simulator: the shop text, which leaves the damage blank.
  const shop = itemText(luden);
  assert.ok(!shop.live && shop.body.includes("Damaging Abilities fire 6 Echoes"));
  // Ravenous Hydra's own tooltip string leaves out its active; the template has it.
  const hydra = data.items[3074];
  const hydraText = itemText(hydra, sim).body;
  const crescent = formatNumber(sim.evalDataCalc(hydra.calcs, hydra.dataValues, "PrimaryDamage"));
  assert.ok(hydraText.includes(`<active>Ravenous Crescent</active> (10s)<br>Deal <physicalDamage>${crescent} physical damage`), hydraText);
  // Melee/ranged values take the champion's side: Serpent's Fang's split, Voltaic Cyclosword's,
  // Black Cleaver's include, Celestial Opposition's pair written out.
  const caitlyn = new Sim(data, { champion: "Caitlyn", level: 11, combo: [] });
  const darius = new Sim(data, { champion: "Darius", level: 11, combo: [] });
  const body = (id: number, s: Sim) => itemText(data.items[id], s).body.replace(/<[^>]+>/g, "");
  assert.ok(body(6695, darius).includes("reduces Shields they gain by 50% for 3 seconds"));
  assert.ok(body(6695, caitlyn).includes("reduces Shields they gain by 35% for 3 seconds"));
  assert.ok(body(6699, darius).includes("deals 9% target's Current Health as bonus physical damage and grants you 15 Lethality"));
  assert.ok(body(6699, caitlyn).includes("deals 7% target's Current Health as bonus physical damage and grants you 12 Lethality"));
  assert.ok(body(3071, darius).includes("grants 20 Move Speed") && body(3071, caitlyn).includes("grants 10 Move Speed"));
  assert.ok(body(3869, darius).includes("damage by 35% for") && body(3869, caitlyn).includes("damage by 25% for"));
  for (const item of Object.values(data.items).filter((i) => i.inStore && !i.requiredChampion)) {
    for (const s of [sim, caitlyn]) {
      const t = itemText(item, s);
      // Every item with passive or active text gets numbers.
      assert.ok(t.live || !item.tooltip, `${item.name} falls back to the shop text`);
      for (const line of [...t.stats, t.body]) assert.ok(!/%i:|\{\{|@|^<br>|<br>$/.test(line), `${item.name}: ${line}`);
    }
  }
});

test("rune hover text: the in-game tooltip with numbers for the attacker, else the description", () => {
  const ahri = new Sim(data, { champion: "Ahri", level: 11, items: ["Luden's Echo"], combo: [] });
  const darius = new Sim(data, { champion: "Darius", level: 11, items: ["Black Cleaver"], combo: [] });
  const rune = (id: number) => data.runes.find((r) => r.id === id)!;
  const electrocute = rune(8112);
  const live = runeText(electrocute, ahri);
  assert.ok(live.live);
  assert.ok(
    live.body.includes(`<magicDamage>${formatNumber(ahri.evalDataCalc(electrocute.calcs, electrocute.values, "TotalDamage"))}</magicDamage>`),
    live.body,
  );
  // The stats the rune tracks in game are left out.
  assert.ok(!/Total Damage Dealt/i.test(live.body), live.body);
  assert.ok(runeText(electrocute, darius).body.includes("<physicalDamage>adaptive damage</physicalDamage>"));
  // Without a simulator: the description, with ranges and ratios.
  const desc = runeText(electrocute);
  assert.ok(!desc.live && desc.body.includes("Damage: 70 - 240 (+0.1 bonus AD, +0.05 AP) damage."), desc.body);
  // Numbers the game's script sets in play come from the simulator's model of the rune: Press the
  // Attack's damage at your level, Dark Harvest's with its souls.
  const pta = simulate(data, { champion: "Ahri", level: 11, runes: ["Press the Attack"], combo: "AA AA AA", target: dummy });
  const ptaText = runeText(rune(8005), ahri);
  assert.ok(
    ptaText.live &&
      ptaText.body.includes(
        `deals <scaleLevel>${formatNumber(pta.events.find((e) => e.source === "rune:8005")!.raw)}</scaleLevel> bonus <magicDamage>adaptive damage</magicDamage>`,
      ),
    ptaText.body,
  );
  assert.ok(ptaText.body.includes("3-Hit Cooldown: 6s") && !/Bonus Damage Dealt/.test(ptaText.body), ptaText.body);
  assert.ok(runeText(rune(8005)).body.includes("40 - 160 bonus <attention>adaptive damage</attention>"));
  const souls = { champion: "Ahri", level: 11, items: ["Luden's Echo"], runes: ["Dark Harvest"], options: { "darkHarvest.souls": 10 } };
  const harvest = simulate(data, { ...souls, combo: "Q", target: { ...dummy, hpPercent: 30 } }).events.find((e) => e.source === "rune:8128")!;
  const dh = runeText(rune(8128), new Sim(data, { ...souls, combo: [] }));
  assert.ok(dh.body.includes(`deals <magicDamage>${formatNumber(harvest.raw)} magic damage</magicDamage>`), dh.body);
  assert.ok(dh.body.includes("Souls harvested: <font color='#fc314e'>10</font>") && !/Total damage dealt/i.test(dh.body), dh.body);
  assert.equal(runeText(rune(5008), darius).body, "<scaleAD>+5.4 Attack Damage</scaleAD>");
  // Adaptive Force: colored by what it gives at the attacker's stats.
  assert.match(runeText(rune(8233), ahri).body, /<magicDamage>[\d.]+ Adaptive Force<\/magicDamage>/);
  assert.match(runeText(rune(8233), darius).body, /<physicalDamage>[\d.]+ Adaptive Force<\/physicalDamage>/);
  // Melee/ranged splits take the attacker's side; the ranged share is a modified percentage.
  assert.ok(runeText(rune(8369), ahri).body.includes("<gold>35%</gold> of that damage"));
  assert.ok(runeText(rune(8369), darius).body.includes("<gold>50%</gold> of that damage"));
  assert.ok(runeText(rune(9923), darius).body.includes("gain 90% Attack Speed"));
  // Hashed values get the names the text uses: Jack of All Trades' Adaptive5 and Adaptive10.
  assert.ok(runeText(rune(8316), ahri).body.includes("Gain 8 or 20 bonus <magicDamage>Adaptive Force</magicDamage>"));
  for (const r of data.runes.filter((r) => !NOT_LIVE_RUNES.has(r.id))) {
    for (const sim of [ahri, darius]) {
      const t = runeText(r, sim);
      assert.ok(t.body && !/%i:|\{\{|@|…|^<br>|<br>$|\(\s*\)|\[|\|\|/.test(t.body), `${r.name}: ${t.body}`);
    }
  }
});

test("rune pages: a pick takes its row; the secondary tree gives two, the older going first; the picks a set, sorted", () => {
  const id = (name: string) => data.runes.find((r) => r.name === name)!.id;
  const ids = (...names: string[]) => names.map(id).sort((a, b) => a - b);
  const ahri: RunePage = {
    primary: "Domination",
    secondary: "Sorcery",
    picks: ids("Electrocute", "Cheap Shot", "Grisly Mementos", "Ultimate Hunter", "Absolute Focus", "Scorch"),
    shards: [5008, 5008, 5001],
  };
  // A keystone or a primary rune takes the place of the one in its row.
  assert.deepEqual(
    pickRune(data, ahri, id("Dark Harvest")).picks,
    ids("Dark Harvest", "Cheap Shot", "Grisly Mementos", "Ultimate Hunter", "Absolute Focus", "Scorch"),
  );
  assert.deepEqual(
    treePicks(data, pickRune(data, ahri, id("Sudden Impact")), "Domination"),
    ids("Electrocute", "Sudden Impact", "Grisly Mementos", "Ultimate Hunter"),
  );
  // A secondary rune in its picks' rows replaces that one; in the third row the older pick, by the
  // order given (Absolute Focus before Scorch), else the one in the earlier row.
  assert.deepEqual(treePicks(data, pickRune(data, ahri, id("Celerity")), "Sorcery"), ids("Scorch", "Celerity"));
  assert.deepEqual(treePicks(data, pickRune(data, ahri, id("Manaflow Band"), [id("Absolute Focus"), id("Scorch")]), "Sorcery"), ids("Scorch", "Manaflow Band"));
  assert.deepEqual(
    treePicks(data, pickRune(data, ahri, id("Manaflow Band"), [id("Scorch"), id("Absolute Focus")]), "Sorcery"),
    ids("Absolute Focus", "Manaflow Band"),
  );
  assert.deepEqual(treePicks(data, pickRune(data, ahri, id("Manaflow Band")), "Sorcery"), ids("Scorch", "Manaflow Band"));
  // No keystone in the secondary tree, nothing from a third tree; picking a pick unpicks it.
  assert.equal(pickRune(data, ahri, id("Arcane Comet")), ahri);
  assert.equal(pickRune(data, ahri, id("Conqueror")), ahri);
  assert.deepEqual(pickRune(data, ahri, id("Scorch")).picks, ids("Electrocute", "Cheap Shot", "Grisly Mementos", "Ultimate Hunter", "Absolute Focus"));
  // A shard takes its row, or leaves it empty picked again.
  assert.deepEqual(pickShard(ahri, 1, 5005).shards, [5008, 5005, 5001]);
  assert.deepEqual(pickShard(ahri, 2, 5001).shards, [5008, 5008, null]);
  // As a scenario: keystone, primary rows, secondary rows, the shards there are, whatever the order picked.
  assert.deepEqual(pageRunes(data, pickRune(data, pickRune(data, ahri, id("Cheap Shot")), id("Cheap Shot"))), [
    ...["Electrocute", "Cheap Shot", "Grisly Mementos", "Ultimate Hunter", "Absolute Focus", "Scorch"].map(id),
    5008,
    5008,
    5001,
  ]);
  assert.deepEqual(pageRunes(data, pickShard(ahri, 0, 5008)), [
    ...["Electrocute", "Cheap Shot", "Grisly Mementos", "Ultimate Hunter", "Absolute Focus", "Scorch"].map(id),
    5008,
    5001,
  ]);
  // Settled: sorted, nothing of a third tree or a keystone in the secondary tree, a shard of its row.
  assert.deepEqual(settledPage(data, { ...ahri, picks: [id("Scorch"), id("Arcane Comet"), id("Conqueror"), id("Electrocute")], shards: [5001, 5008, 5008] }), {
    ...ahri,
    picks: ids("Electrocute", "Scorch"),
    shards: [null, 5008, null],
  });
});

test("rune pages: a tree that changes place keeps the picks that fit there, one that leaves takes its picks, one that comes on starts empty", () => {
  const id = (name: string) => data.runes.find((r) => r.name === name)!.id;
  const ids = (...names: string[]) => names.map(id).sort((a, b) => a - b);
  const ahri: RunePage = {
    primary: "Domination",
    secondary: "Sorcery",
    picks: ids("Electrocute", "Cheap Shot", "Grisly Mementos", "Ultimate Hunter", "Absolute Focus", "Scorch"),
    shards: [5008, 5008, 5001],
  };
  const shown = (page: RunePage, tree: string) => treePicks(data, page, tree);
  const order = (...names: string[]) => names.map(id);
  // Taking the secondary tree as primary swaps the two: the new primary keeps its two, the new
  // secondary its newest two minors by the order given, the one in the earlier row counting as the
  // older where it says nothing; the keystone goes.
  const swapped = choosePrimary(data, ahri, "Sorcery", order("Cheap Shot", "Grisly Mementos", "Ultimate Hunter"));
  assert.deepEqual([swapped.primary, swapped.secondary], ["Sorcery", "Domination"]);
  assert.deepEqual(swapped.picks, ids("Absolute Focus", "Scorch", "Grisly Mementos", "Ultimate Hunter"));
  assert.deepEqual(chooseSecondary(data, ahri, "Domination", order("Cheap Shot", "Grisly Mementos", "Ultimate Hunter")), swapped);
  assert.deepEqual(choosePrimary(data, ahri, "Sorcery").picks, ids("Absolute Focus", "Scorch", "Grisly Mementos", "Ultimate Hunter"));
  assert.deepEqual(
    choosePrimary(data, ahri, "Sorcery", order("Grisly Mementos", "Cheap Shot", "Ultimate Hunter")).picks,
    ids("Absolute Focus", "Scorch", "Cheap Shot", "Ultimate Hunter"),
  );
  // Swapped back: what's left fits the primary tree as it is.
  assert.deepEqual(shown(choosePrimary(data, swapped, "Domination"), "Domination"), ids("Grisly Mementos", "Ultimate Hunter"));
  // A tree taken off the page takes its picks; a new tree starts empty; the one that stays is left alone.
  const precision = choosePrimary(data, ahri, "Precision");
  assert.deepEqual([precision.primary, precision.secondary, precision.picks], ["Precision", "Sorcery", ids("Absolute Focus", "Scorch")]);
  assert.deepEqual(chooseSecondary(data, ahri, "Precision").picks, ids("Electrocute", "Cheap Shot", "Grisly Mementos", "Ultimate Hunter"));
  assert.equal(choosePrimary(data, ahri, "Domination"), ahri);
  assert.equal(chooseSecondary(data, ahri, "Sorcery"), ahri);
});

test("rune pages: the simulator warns about runes no page holds together", () => {
  const warnings = (runes: (string | number)[]) => simulate(data, { champion: "Ahri", level: 11, runes, combo: "Q", target: dummy }).warnings;
  assert.deepEqual(warnings(["Electrocute", "Cheap Shot", "Grisly Mementos", "Ultimate Hunter", "Absolute Focus", "Scorch", 5008, 5008, 5001]), []);
  assert.deepEqual(warnings(["Electrocute", "Cheap Shot", "Sudden Impact"]), ["Cheap Shot and Sudden Impact share a row of Domination: a rune page takes one"]);
  assert.deepEqual(warnings(["Electrocute", "Arcane Comet"]), ["more than one keystone (Electrocute and Arcane Comet): a rune page has one"]);
  assert.match(warnings(["Electrocute", "Manaflow Band", "Transcendence", "Scorch"])[0], /^3 runes from Sorcery, the secondary tree/);
  assert.match(warnings(["Electrocute", "Triumph", "Scorch"])[0], /^runes from 3 trees/);
  // Without a keystone, either tree can be the primary one.
  assert.deepEqual(warnings(["Absolute Focus", "Scorch", "Cheap Shot", "Grisly Mementos", "Ultimate Hunter"]), []);
  // Shards: one from each row, in any order. Adaptive Force is offense or flex, not defense.
  assert.deepEqual(warnings([5011, 5008, 5001]), []);
  assert.match(warnings([5008, 5008, 5008])[0], /^no rune page has the shards Adaptive Force, Adaptive Force and Adaptive Force/);
  assert.equal(warnings([5005, 5008, 5005]).length, 1);
  assert.match(warnings([5008, 5008, 5001, 5011])[0], /^4 shards/);
});

test("a modified calculation shows in the format of the one it modifies", () => {
  const sim = new Sim(data, { champion: "Jax", level: 11, items: [], combo: [] });
  const passive = sim.champ.abilities.flatMap((a) => a.spells).find((s) => s.scriptName === "JaxPassive")!;
  assert.match(renderTooltip(sim, "P", passive), /\(max \d+(\.\d+)?% Attack Speed\)/);
});
