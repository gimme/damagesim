// The scenario's address: the champion in the path, the rest as a code in the hash. Every field comes
// back from it, what's left at the default takes no room, and a full build's code stays short.
// And the scenario it simulates, the same for a state that simulates alike.

import { test } from "node:test";
import assert from "node:assert/strict";
import { loadGameData } from "../src/node/load.ts";
import {
  DEFAULT_STATE,
  decodeSetup,
  decodeState,
  encodeSetup,
  encodeState,
  pickChampion,
  saveState,
  resetState,
  scenarioKey,
  toScenario,
  type UIState,
} from "../src/web/state.ts";
import { loadAllKits } from "../src/node/kits.ts";
import { simulate } from "../src/engine/sim.ts";

const data = loadGameData("16.20");
await loadAllKits();
const roundTrip = (s: UIState) => decodeState(data, encodeState(data, s));

/** Every field away from its default. */
const ALL: UIState = {
  champion: "MissFortune",
  level: 17,
  ranks: { Q: 5, W: 3, E: 1, R: 3 },
  skillOrder: "QEW",
  items: [3031, null, 3036, null, null, null],
  runes: { primary: "Precision", secondary: "Domination", picks: [8008, 9111, 9104, 8014, 8139, 8135], held: [8143], shards: [5005, 5008, 5011] },
  options: { stacks: 3, distance: 500.5, frac: 1 / 3, neg: -2 },
  combo: "Q:empowered{0.5s} AA*3 E W R{14} AA! ignite energize wait{1.5s} item:3152  ",
  target: {
    mode: "custom",
    levelDiff: -2,
    builds: { squishy: [3089, null], tank: [] },
    champion: "Malphite",
    items: [3075, 3143],
    base: { hp: 1500, armor: 70.25, mr: 32 },
    bonus: { hp: 0, armor: -5, mr: 1e9 },
    hpPercent: 37,
    damageReduction: 0.07,
  },
  settings: { finishDots: false, executes: false, questBoots: true },
  excluded: [3089, 4645],
};

test("every field comes back, numbers exactly", () => {
  assert.deepEqual(roundTrip(ALL), ALL);
  for (const key of Object.keys(DEFAULT_STATE) as (keyof UIState)[])
    assert.deepEqual(roundTrip({ ...DEFAULT_STATE, [key]: ALL[key] }), { ...DEFAULT_STATE, [key]: ALL[key] }, key);
});

test("the defaults: the champion's path, no hash", () => {
  assert.equal(encodeState(data, DEFAULT_STATE), "ahri/");
  assert.equal(encodeState(data, { ...DEFAULT_STATE, champion: "Zed" }), "zed/");
  assert.equal(encodeSetup(data, { ...DEFAULT_STATE, champion: "Zed" }), "");
  assert.deepEqual(decodeSetup(data, "Zed", ""), { ...DEFAULT_STATE, champion: "Zed" });
});

test("a full build's code: under 80 characters, letters and digits", () => {
  const full: UIState = {
    ...DEFAULT_STATE,
    champion: "Zed",
    level: 16,
    items: [3142, 3158, 6698, 6694, 3814, 6695],
    runes: { primary: "Domination", secondary: "Precision", picks: [8112, 8143, 8140, 8135, 9111, 8014], held: [], shards: [5008, 5008, 5011] },
    combo: "W E Q AA R E Q AA ignite",
    target: { ...DEFAULT_STATE.target, mode: "champion", champion: "Lux", items: [6655, 3020, 3157] },
  };
  const code = encodeSetup(data, full);
  assert.match(code, /^[0-9A-Za-z]+$/);
  assert.ok(code.length < 80, `${code.length} characters`);
  assert.equal(encodeState(data, full), `zed/#${code}`);
  assert.deepEqual(decodeState(data, `zed/#${code}`), full);
});

test("the bot lane role quest's boots slot comes back, empty or with boots; the tier 3 boots setting too, after the rest", () => {
  for (const items of [
    [6655, 3020, null, null, null, null, null],
    [3031, null, null, null, null, null, 3006],
    [null, null, null, null, null, null, null],
  ])
    assert.deepEqual(roundTrip({ ...DEFAULT_STATE, items })?.items, items);
  assert.equal(roundTrip({ ...DEFAULT_STATE, settings: { ...DEFAULT_STATE.settings, questBoots: true } })?.settings.questBoots, true);
  assert.equal(decodeSetup(data, "Zed", encodeSetup(data, { ...DEFAULT_STATE, items: [...DEFAULT_STATE.items, null, null] })), null);
});

test("the items Item value leaves out are the setup's: a champion picked for the first time keeps them, one picked again has its own, Reset clears them", () => {
  const ahri: UIState = { ...DEFAULT_STATE, excluded: [3089, 4645] };
  // Kept as the page keeps the one on screen, as it changes.
  saveState(ahri, encodeState(data, ahri));
  const zed = pickChampion(data, ahri, "Zed");
  assert.deepEqual(zed.excluded, [3089, 4645]);
  assert.deepEqual(pickChampion(data, { ...zed, excluded: [3157] }, "Ahri").excluded, [3089, 4645]);
  assert.deepEqual(resetState(ahri).excluded, []);
});

test("a setup's code holds no champion: another champion takes it as it is", () => {
  const code = encodeSetup(data, { ...DEFAULT_STATE, champion: "Zed", level: 16, items: [3142, null, null, null, null, null] });
  assert.deepEqual(decodeSetup(data, "Talon", code), { ...DEFAULT_STATE, champion: "Talon", level: 16, items: [3142, null, null, null, null, null] });
  assert.equal(decodeSetup(data, "Nobody", code), null);
});

test("a champion's path: its name in lowercase, words joined by hyphens; read in any case, by name or key", () => {
  const path = (champion: string) => encodeState(data, { ...DEFAULT_STATE, champion });
  assert.deepEqual(["MissFortune", "Kaisa", "DrMundo", "Nunu", "MonkeyKing", "JarvanIV"].map(path), [
    "miss-fortune/",
    "kaisa/",
    "dr-mundo/",
    "nunu-willump/",
    "wukong/",
    "jarvan-iv/",
  ]);
  const code = encodeSetup(data, { ...DEFAULT_STATE, level: 3 });
  for (const address of ["missfortune", "/MissFortune/", "miss-fortune#", ` miss-fortune/#${code} `])
    assert.equal(decodeState(data, address)?.champion, "MissFortune", address);
  assert.equal(decodeState(data, `MissFortune#${code}`)?.level, 3);
  assert.equal(decodeState(data, "monkeyking/")?.champion, "MonkeyKing");
  assert.equal(decodeState(data, "nunu/")?.champion, "Nunu");
});

test("what isn't a scenario's address holds none: no champion's path, a hash that isn't a code, cut short, run on, of another version", () => {
  const code = encodeSetup(data, { ...DEFAULT_STATE, combo: "Q W E R" });
  for (const bad of ["", "/", `#${code}`, "nobody/", `nobody/#${code}`, "zed/extra/", "zed/#hello!", `zed/#${code.slice(0, -1)}`, `zed/#${code.slice(0, -3)}`])
    assert.equal(decodeState(data, bad), null, bad);
  for (const bad of ["hello!", code + "0", code + "zz", "48"]) assert.equal(decodeSetup(data, "Zed", bad), null, bad);
  // Version 2's, before the energize step: Zed at 16 with two items.
  assert.equal(decodeSetup(data, "Zed", "HFSIMq2SEcbzjWQd8a"), null);
});

test("the combo's usual steps take a byte each, energize too; others their text", () => {
  const length = (combo: string) => encodeSetup(data, { ...DEFAULT_STATE, combo }).length;
  assert.ok(length("Q energize AA") < length("Q energise AA"));
  assert.equal(roundTrip({ ...DEFAULT_STATE, combo: "Q energize AA energise" })?.combo, "Q energize AA energise");
});

test("an item or rune the patch hasn't is left out; a target champion it hasn't, no state", () => {
  const s = decodeState(
    data,
    encodeState(data, { ...DEFAULT_STATE, items: [3142, 9999, 3020, null, null, null], target: { ...DEFAULT_STATE.target, items: [9999, 3075] } }),
  );
  assert.deepEqual(s?.items, [3142, null, 3020, null, null, null]);
  assert.deepEqual(s?.target.items, [3075]);
  assert.deepEqual(roundTrip({ ...DEFAULT_STATE, runes: { ...DEFAULT_STATE.runes, picks: [8112, 1234] } })?.runes.picks, [8112]);
  const other = { ...data, championIndex: data.championIndex.filter((c) => c.id !== "Lux") };
  assert.equal(decodeState(other, encodeState(data, { ...DEFAULT_STATE, target: { ...DEFAULT_STATE.target, champion: "Lux" } })), null);
});

test("a state simulates alike, as one scenario simulated once, with its items in other slots, its combo spaced otherwise, the tier 3 boots setting, a target mode's numbers it isn't in, runes held over or items Item value leaves out; not at another target health", () => {
  const key = (s: UIState) => scenarioKey(toScenario(data, s));
  const base: UIState = { ...DEFAULT_STATE, items: [6655, 3020, 3089, null, 4645, null], combo: "E Q W R AA*2 R" };
  const alike: UIState[] = [
    { ...base, items: [null, 3089, 6655, 4645, 3020, null] },
    { ...base, combo: " E  Q,W R 2AA R " },
    { ...base, settings: { ...base.settings, questBoots: true } },
    { ...base, target: { ...base.target, base: { hp: 1, armor: 1, mr: 1 }, champion: "Malphite" } },
    { ...base, runes: { ...base.runes, held: [8143] } },
    { ...base, excluded: [3089] },
  ];
  const result = simulate(data, toScenario(data, base));
  for (const s of alike) {
    assert.equal(key(s), key(base));
    assert.deepEqual(simulate(data, toScenario(data, s)), result);
  }
  // Its health is the target's in every hit: what each leaves, whether it dies.
  for (const s of [
    { ...base, target: { ...base.target, hpPercent: 50 } },
    { ...base, combo: "E Q W R AA R" },
    { ...base, items: [6655, 3020, 3089] },
  ])
    assert.notEqual(key(s), key(base));
});
