// The scenario's address: the champion in the path, the rest as a code in the hash. Every field comes
// back from it, what's left at the default takes no room, and a full build's code stays short.

import { test } from "node:test";
import assert from "node:assert/strict";
import { loadGameData } from "../src/node/load.ts";
import { DEFAULT_STATE, decodeSetup, decodeState, encodeSetup, encodeState, type UIState } from "../src/web/state.ts";

const data = loadGameData("16.20");
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
  combo: "Q:empowered{0.5s} AA*3 E W R{14} AA! ignite wait{1.5s} item:3152  ",
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
  settings: { finishDots: false, executes: false },
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

test("what isn't a scenario's address holds none: no champion's path, a hash that isn't a code, cut short, run on", () => {
  const code = encodeSetup(data, { ...DEFAULT_STATE, combo: "Q W E R" });
  for (const bad of ["", "/", `#${code}`, "nobody/", `nobody/#${code}`, "zed/extra/", "zed/#hello!", `zed/#${code.slice(0, -1)}`, `zed/#${code.slice(0, -3)}`])
    assert.equal(decodeState(data, bad), null, bad);
  for (const bad of ["hello!", code + "0", code + "zz", "48"]) assert.equal(decodeSetup(data, "Zed", bad), null, bad);
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
