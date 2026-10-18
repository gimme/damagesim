// The scenario code: every field of the state comes back from it, what's left at the default takes
// no room, and a full build fits in a chat message.

import { test } from "node:test";
import assert from "node:assert/strict";
import { loadGameData } from "../src/node/load.ts";
import { DEFAULT_STATE, decodeState, encodeState, type UIState } from "../src/web/state.ts";

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
  settings: { finishDots: false },
};

test("every field comes back, numbers exactly", () => {
  assert.deepEqual(roundTrip(ALL), ALL);
  for (const key of Object.keys(DEFAULT_STATE) as (keyof UIState)[])
    assert.deepEqual(roundTrip({ ...DEFAULT_STATE, [key]: ALL[key] }), { ...DEFAULT_STATE, [key]: ALL[key] }, key);
});

test("the default state is two characters; a full build under 100, letters and digits", () => {
  assert.equal(encodeState(data, DEFAULT_STATE).length, 2);
  const full: UIState = {
    ...DEFAULT_STATE,
    champion: "Zed",
    level: 16,
    items: [3142, 3158, 6698, 6694, 3814, 6695],
    runes: { primary: "Domination", secondary: "Precision", picks: [8112, 8143, 8140, 8135, 9111, 8014], held: [], shards: [5008, 5008, 5011] },
    combo: "W E Q AA R E Q AA ignite",
    target: { ...DEFAULT_STATE.target, mode: "champion", champion: "Lux", items: [6655, 3020, 3157] },
  };
  const code = encodeState(data, full);
  assert.match(code, /^[0-9A-Za-z]+$/);
  assert.ok(code.length < 100, `${code.length} characters`);
  assert.deepEqual(decodeState(data, code), full);
});

test("a hash or a link holds a code too", () => {
  const code = encodeState(data, { ...DEFAULT_STATE, champion: "Zed" });
  assert.equal(decodeState(data, "#" + code)?.champion, "Zed");
  assert.equal(decodeState(data, ` http://192.168.1.20:5173/#${code}\n`)?.champion, "Zed");
});

test("what isn't a code holds no state: other characters, cut short, run on, empty", () => {
  const code = encodeState(data, { ...DEFAULT_STATE, champion: "Zed", combo: "Q W E R" });
  for (const bad of ["", "#", "hello!", code.slice(0, -1), code.slice(0, -3), code + "0", code + "zz"]) assert.equal(decodeState(data, bad), null, bad);
});

test("an item or rune the patch hasn't is left out; a champion it hasn't, no state", () => {
  const s = decodeState(
    data,
    encodeState(data, { ...DEFAULT_STATE, items: [3142, 9999, 3020, null, null, null], target: { ...DEFAULT_STATE.target, items: [9999, 3075] } }),
  );
  assert.deepEqual(s?.items, [3142, null, 3020, null, null, null]);
  assert.deepEqual(s?.target.items, [3075]);
  assert.deepEqual(decodeState(data, encodeState(data, { ...DEFAULT_STATE, runes: { ...DEFAULT_STATE.runes, picks: [8112, 1234] } }))?.runes.picks, [8112]);
  const other = { ...data, championIndex: data.championIndex.filter((c) => c.id !== "Zed") };
  assert.equal(decodeState(other, encodeState(data, { ...DEFAULT_STATE, champion: "Zed" })), null);
});
