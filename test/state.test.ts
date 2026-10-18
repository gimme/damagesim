// The scenario's address: the champion in the path, what the page shows of the rest in the hash, what
// differs from the defaults only, and every field comes back from it.

import { test } from "node:test";
import assert from "node:assert/strict";
import { loadGameData } from "../src/node/load.ts";
import { DEFAULT_STATE, decodeState, encodeState, type UIState } from "../src/web/state.ts";

const data = loadGameData("16.20");
const roundTrip = (s: UIState) => decodeState(data, encodeState(data, s));
const target = (t: Partial<UIState["target"]>): UIState => ({ ...DEFAULT_STATE, target: { ...DEFAULT_STATE.target, ...t } });

/** Every field the page shows away from its default, with custom numbers as the target. */
const ALL: UIState = {
  champion: "MissFortune",
  level: 17,
  ranks: { Q: 5, W: 3, E: 1, R: 3 },
  skillOrder: "QEW",
  items: [3031, null, 3036, null, null, null],
  runes: { primary: "Precision", secondary: "Domination", picks: [8008, 9111, 9104, 8014, 8139, 8135], held: [], shards: [5005, 5008, 5011] },
  options: { "ultimateHunter.stacks": 3, distance: 500.5, frac: 1 / 3, neg: -2 },
  combo: "Q:empowered{0.5s} AA*3 E W R{14} AA! ignite wait{1.5s} item:3152",
  target: {
    ...DEFAULT_STATE.target,
    mode: "custom",
    base: { hp: 1500, armor: 70.25, mr: 32 },
    bonus: { hp: 0, armor: -5, mr: 1e21 },
    hpPercent: 37,
    damageReduction: 0.07,
  },
  settings: { finishDots: false },
};

test("every field comes back, numbers exactly", () => {
  assert.deepEqual(roundTrip(ALL), ALL);
  for (const key of Object.keys(DEFAULT_STATE) as (keyof UIState)[])
    assert.deepEqual(roundTrip({ ...DEFAULT_STATE, [key]: ALL[key] }), { ...DEFAULT_STATE, [key]: ALL[key] }, key);
  for (const t of [
    target({ mode: "champion", champion: "Malphite", items: [3075, 3143], levelDiff: 2 }),
    target({ mode: "champion", items: [] }),
    target({ mode: "tank", levelDiff: -3, builds: { tank: [3075, null, 3143] } }),
    target({ mode: "bruiser", builds: { bruiser: [] } }),
  ])
    assert.deepEqual(roundTrip(t), t);
});

test("the defaults: the champion's path, no hash", () => {
  assert.equal(encodeState(data, DEFAULT_STATE), "ahri/");
  assert.equal(encodeState(data, { ...DEFAULT_STATE, champion: "Zed" }), "zed/");
});

test("a full build: what it is, by name and id, in under 200 characters", () => {
  const full: UIState = {
    ...DEFAULT_STATE,
    champion: "Zed",
    level: 16,
    items: [3142, 3158, 6698, 6694, 3814, 6695],
    runes: { primary: "Domination", secondary: "Precision", picks: [8112, 8143, 8140, 8135, 9111, 8014], held: [], shards: [5008, 5008, 5011] },
    combo: "W E Q AA R E Q AA ignite",
    target: { ...DEFAULT_STATE.target, mode: "champion", champion: "Lux", items: [6655, 3020, 3157] },
  };
  const address = encodeState(data, full);
  assert.equal(
    address,
    "zed/#lv=16&items=3142,3158,6698,6694,3814,6695&runes=domination,8112,8143,8140,8135,precision,9111,8014&shards=5008,5008,5011" +
      "&combo=W,E,Q,AA,R,E,Q,AA,ignite&vs=lux&vs.items=6655,3020,3157",
  );
  assert.ok(address.length < 200, `${address.length} characters`);
  assert.deepEqual(decodeState(data, address), full);
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
  for (const address of ["missfortune", "/MissFortune/", "miss-fortune#", " miss-fortune/#lv=11 "])
    assert.equal(decodeState(data, address)?.champion, "MissFortune", address);
  assert.equal(decodeState(data, "monkeyking/")?.champion, "MonkeyKing");
  assert.equal(decodeState(data, "nunu/")?.champion, "Nunu");
});

test("the combo as its steps, joined by commas; what the URL would change in a step escaped", () => {
  const address = encodeState(data, { ...DEFAULT_STATE, combo: "Q{out:1, back:0} > AA!,E  wait{1.5s} Q+bonus é&" });
  assert.equal(address, "ahri/#combo=Q{out:1;back:0},AA!,E,wait{1.5s},Q+bonus,%C3%A9%26");
  assert.equal(decodeState(data, address)?.combo, "Q{out:1;back:0} AA! E wait{1.5s} Q+bonus é&");
});

test("what the page doesn't show stays out: another target's numbers, the runes a tree remembers", () => {
  const hidden: UIState = {
    ...DEFAULT_STATE,
    runes: { ...DEFAULT_STATE.runes, held: [8143] },
    target: { ...DEFAULT_STATE.target, champion: "Malphite", items: [3075], base: { hp: 1, armor: 2, mr: 3 }, builds: { tank: [3075] } },
  };
  assert.equal(encodeState(data, hidden), "ahri/");
  assert.equal(encodeState(data, { ...hidden, target: { ...hidden.target, mode: "custom" } }), "ahri/#vs=custom&vs.hp=1+400&vs.armor=2+20&vs.mr=3+10");
});

test("what isn't a scenario's address holds none", () => {
  for (const bad of [
    "",
    "/",
    "#lv=16",
    "nobody/",
    "zed/extra/",
    "zed/#notacode!!",
    "zed/#lv=16&lv=17",
    "zed/#lv=21",
    "zed/#lv=sixteen",
    "zed/#items=1,2,3,4,5,6,7",
    "zed/#runes=8112",
    "zed/#runes=domination,8112",
    "zed/#runes=nowhere,precision",
    "zed/#shards=5008,5008",
    "zed/#order=QQE",
    "zed/#ranks=Q5,W3,E1",
    "zed/#vs=nobody",
    "zed/#vs=custom&vs.items=3031",
    "zed/#vs=custom&vs.lv=1",
    "zed/#vs.hp=1600+400",
    "zed/#finishDots=maybe",
    "zed/#someOption=many",
    "zed/#combo=%E0",
  ])
    assert.equal(decodeState(data, bad), null, bad);
});

test("an item or rune the patch hasn't is left out (an item slot empty), a shard the default one; a champion it hasn't, no state", () => {
  const s = decodeState(data, "ahri/#items=3142,9999,3020&runes=domination,8112,1234,8143,sorcery,8233&shards=5008,1,5001&vs=lux&vs.items=9999,3075");
  assert.deepEqual(s?.items, [3142, null, 3020, null, null, null]);
  assert.deepEqual(s?.runes.picks, [8112, 8143, 8233]);
  assert.deepEqual(s?.runes.shards, [5008, 5008, 5001]);
  assert.deepEqual(s?.target.items, [3075]);
  const other = { ...data, championIndex: data.championIndex.filter((c) => c.id !== "Zed") };
  assert.equal(decodeState(other, "zed/"), null);
});
