// The page's address: the champion in the path, the rest as codes in the hash, a build's and what the
// builds share. Every field comes back from it, a code says all it means (only the reset page's
// address is the path alone), a field the app no longer knows is passed over, and what a code holds
// is settled as it's read. And the scenario it simulates, the same for a state that simulates alike.

import { test } from "node:test";
import assert from "node:assert/strict";
import { loadGameData } from "../src/node/load.ts";
import {
  DEMO_STATE,
  RESET_STATE,
  decodePage,
  decodeState,
  encodePage,
  encodeState,
  pickChampion,
  resetState,
  scenarioKey,
  toScenario,
  type UIState,
} from "../src/web/state.ts";
import { addTab, renameTab, selectTab, single, track, withBuild } from "../src/web/tabs.ts";
import { loadAllKits } from "../src/node/kits.ts";
import { simulate } from "../src/engine/sim.ts";
import { builtFrom, defaultCandidates } from "../src/engine/analysis.ts";
import { getKit } from "../src/kits/index.ts";

const data = loadGameData("16.20");
await loadAllKits();
const roundTrip = (s: UIState) => decodeState(data, encodeState(data, s));
/** The two codes in an address's hash: the builds' and the shared part's. */
const codes = (address: string) => address.split("#")[1].split("+");

/** Every field away from the reset state. */
const ALL: UIState = {
  champion: "MissFortune",
  level: 17,
  ranks: { Q: 5, W: 3, E: 1, R: 3 },
  skillOrder: "QEW",
  items: [3031, null, 3036, null, null, null],
  runes: { primary: "Precision", secondary: "Domination", picks: [8008, 8014, 8135, 8139, 9104, 9111], shards: [5005, null, 5011] },
  options: { stacks: 3, distance: 500.5, frac: 0.333333, neg: -2 },
  combo: "Q:empowered{0.5s} AA*3 E W R{14} AA! ignite energize wait{1.5s} item:3152  ",
  target: { mode: "custom", base: { hp: 1500, armor: 70.25, mr: 32 }, bonus: { hp: 0, armor: -5, mr: 1e9 }, hpPercent: 37, damageReduction: 0.07 },
  settings: { finishDots: false, executes: false, questBoots: true, components: true },
  excluded: [3089, 4645],
  next: 3,
  // Sorcerer's Shoes, no longer the build's: none (see settled).
  replace: 3020,
};

test("every field comes back, numbers exactly; the item to replace one the build hasn't aside", () => {
  assert.deepEqual(roundTrip(ALL), { ...ALL, replace: null });
  for (const key of Object.keys(RESET_STATE) as (keyof UIState)[])
    assert.deepEqual(roundTrip({ ...RESET_STATE, [key]: ALL[key] }), { ...RESET_STATE, [key]: key === "replace" ? null : ALL[key] }, key);
  assert.deepEqual(roundTrip(DEMO_STATE), DEMO_STATE);
});

test("a number too large for its digits comes back as its first digits; one with decimals, with as many as fit", () => {
  const options = { big: 1e20, huge: -1.5e300, long: 2 ** 60, decimals: 12345678901.123456 };
  const back = roundTrip({ ...RESET_STATE, options })!.options;
  assert.equal(back.big, 1e20);
  assert.equal(back.decimals, 12345678901.123);
  for (const key of ["huge", "long"] as const) assert.ok(Math.abs(back[key] / options[key] - 1) < 1e-12, key);
  const target: UIState["target"] = {
    mode: "custom",
    base: { hp: 1e14, armor: 0, mr: 0 },
    bonus: { hp: 0, armor: 0, mr: 0 },
    hpPercent: 100,
    damageReduction: 1e18,
  };
  assert.deepEqual(roundTrip({ ...RESET_STATE, target })!.target, target);
});

test("the reset page: the champion's path alone; anything else, a build's code and the shared part's after +", () => {
  assert.equal(encodeState(data, RESET_STATE), "ahri/");
  assert.equal(encodeState(data, { ...RESET_STATE, champion: "Zed" }), "zed/");
  assert.deepEqual(decodeState(data, "zed/"), { ...RESET_STATE, champion: "Zed" });
  assert.deepEqual(decodeState(data, "zed/#"), { ...RESET_STATE, champion: "Zed" });
  assert.match(encodeState(data, DEMO_STATE), /^ahri\/#[0-9A-Za-z]+\+[0-9A-Za-z]+$/);
  // A code says all it means: a level alone is as long as any, only the reset page's is empty.
  assert.ok(encodeState(data, { ...RESET_STATE, level: 16 }).length > 60);
  assert.deepEqual(decodePage(data, "zed/")!.page, single({ ...RESET_STATE, champion: "Zed" }));
});

test("a full build's address: letters and digits, a + between its codes, under 160 characters", () => {
  const full: UIState = {
    ...RESET_STATE,
    champion: "Zed",
    level: 16,
    items: [3142, 3158, 6698, 6694, 3814, 6695],
    runes: { primary: "Domination", secondary: "Precision", picks: [8014, 8112, 8135, 8140, 8143, 9111], shards: [5008, 5008, 5011] },
    combo: "W E Q AA R E Q AA ignite",
    target: { mode: "champion", levelDiff: 0, champion: "Lux", items: [3020, 3157, 6655], hpPercent: 100, damageReduction: 0 },
  };
  const address = encodeState(data, full);
  assert.match(address, /^zed\/#[0-9A-Za-z]+\+[0-9A-Za-z]+$/);
  assert.ok(address.length < 160, `${address.length} characters`);
  assert.deepEqual(decodeState(data, address), full);
  // As written today, pinned: a change to the fields' numbers, their codecs or the reset state would
  // read it otherwise, and so every link shared so far. A field added is read as before it was.
  const pinned =
    "zed/#KUUsr0LyiCwpZ0LGeKm2rp7VznncUS4BNPzIR7x7vlaJPj8ngKaiqbmXgvy7c+8zjiZGbw1YRLOkHfgLSRgnxpvyxKm29GVePwscejLXpJJ7OEe89DItXPqX9Rg7lp4GxyX5yLMqnXRBmT";
  assert.equal(address, pinned);
});

test("a field a code has that the app doesn't know is passed over; one the code hasn't is the reset's", () => {
  const DIGITS = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
  const bytesOf = (code: string) => {
    let n = 0n;
    for (const ch of code) n = n * 62n + BigInt(DIGITS.indexOf(ch));
    const bytes: number[] = [];
    for (; n > 0n; n /= 256n) bytes.unshift(Number(n % 256n));
    return bytes;
  };
  const codeOf = (bytes: number[]) => {
    let n = bytes.reduce((n, b) => n * 256n + BigInt(b), 0n);
    let s = "";
    for (; n > 0n; n /= 62n) s = DIGITS[Number(n % 62n)] + s;
    return s;
  };
  const s: UIState = { ...RESET_STATE, champion: "Zed", level: 16, items: [3142, null, null, null, null, null] };
  const [build, shared] = codes(encodeState(data, s));
  // Field 60 as a number and field 61 as two bytes, in the shared part and in the build's.
  const extra = [120, 5, 123, 2, 9, 9];
  assert.deepEqual(decodeState(data, `zed/#${codeOf([...bytesOf(build), ...extra])}+${codeOf([...bytesOf(shared), ...extra])}`), s);
  // The shared part's level alone: the rest the reset's. A build's items alone, likewise.
  assert.deepEqual(decodeState(data, `zed/#+${codeOf([4, 16])}`), { ...RESET_STATE, champion: "Zed", level: 16 });
  assert.deepEqual(decodeState(data, `zed/#${codeOf([3, 2, 198, 24])}`), { ...RESET_STATE, champion: "Zed", items: [3142, null, null, null, null, null] });
});

test("a build's code alone opens at the reset setup, the shared part's alone with the reset build; the champion is in the code too, so a code at the root finds its page, but the path wins", () => {
  const s: UIState = {
    ...RESET_STATE,
    champion: "Zed",
    level: 16,
    items: [3142, null, null, null, null, null],
    target: { mode: "tank", levelDiff: 0, hpPercent: 100, damageReduction: 0 },
  };
  const [build, shared] = codes(encodeState(data, s));
  assert.deepEqual(decodeState(data, `zed/#${build}`), { ...RESET_STATE, champion: "Zed", items: s.items });
  assert.deepEqual(decodeState(data, `zed/#+${shared}`), { ...s, items: RESET_STATE.items });
  assert.deepEqual(decodeState(data, `#${build}+${shared}`), s);
  assert.deepEqual(decodeState(data, `/#${build}+${shared}`), s);
  assert.deepEqual(decodeState(data, `talon/#${build}+${shared}`), { ...s, champion: "Talon" });
  // A build's code alone at the root names no champion.
  assert.equal(decodeState(data, `#${build}`), null);
});

test("the bot lane role quest's boots slot comes back, empty or with boots; the tier 3 boots and components settings too", () => {
  for (const items of [
    [6655, 3020, null, null, null, null, null],
    [3031, null, null, null, null, null, 3006],
    [null, null, null, null, null, null, null],
  ])
    assert.deepEqual(roundTrip({ ...DEMO_STATE, items })?.items, items);
  assert.equal(roundTrip({ ...DEMO_STATE, settings: { ...DEMO_STATE.settings, questBoots: true } })?.settings.questBoots, true);
  assert.equal(roundTrip({ ...DEMO_STATE, settings: { ...DEMO_STATE.settings, components: true } })?.settings.components, true);
  assert.equal(decodeState(data, encodeState(data, { ...DEMO_STATE, items: [...DEMO_STATE.items, null, null] })), null);
});

test("a champion picked, the one on screen too: a fresh build of theirs with what the page shares, the combo as their kit takes it, without the last champion's own parameters; Reset, the reset state", () => {
  // A champion with a parameter of their kit's own, and one that isn't any champion's.
  const champion = Object.keys(data.champions).find((id) => id !== "Zed" && getKit(data.champions[id]).options?.length)!;
  const own = getKit(data.champions[champion]).options![0].key;
  const ahri: UIState = {
    ...DEMO_STATE,
    champion,
    level: 16,
    excluded: [3089, 4645],
    next: 1,
    replace: 6655,
    options: { [own]: 2, stacks: 3 },
    target: { mode: "tank", levelDiff: 0, hpPercent: 100, damageReduction: 0 },
  };
  const zed = pickChampion(data, ahri, "Zed");
  assert.deepEqual(zed, {
    ...ahri,
    champion: "Zed",
    items: RESET_STATE.items,
    runes: RESET_STATE.runes,
    next: 1,
    replace: null,
    ranks: null,
    options: { stacks: 3 },
    combo: zed.combo,
  });
  assert.deepEqual(pickChampion(data, ahri, champion), { ...zed, champion, combo: ahri.combo });
  assert.deepEqual(resetState(zed), { ...RESET_STATE, champion: "Zed" });
});

test("what a code holds is settled as it's read: the boots of the tier the setting has, the count no more than the empty slots and the items to upgrade, the item to replace one of the build's, with a count of one", () => {
  assert.equal(roundTrip({ ...DEMO_STATE, items: [6655, 3020, 3089, 3135, null, null], next: 4 })?.next, 2);
  assert.equal(roundTrip({ ...DEMO_STATE, items: [6655, 3020, 3089, 3135, 3157, 4645], next: 3 })?.next, 1);
  // A Serrated Dirk and Boots can be bought in place of; Dark Seal can't, by a legendary.
  assert.equal(roundTrip({ ...DEMO_STATE, items: [6655, 3020, 3089, 3134, null, null], next: 4 })?.next, 3);
  assert.equal(roundTrip({ ...DEMO_STATE, items: [6655, 1001, 3089, 3134, null, null], next: 6 })?.next, 4);
  assert.equal(roundTrip({ ...DEMO_STATE, items: [6655, 3020, 3089, 1082, null, null], next: 4 })?.next, 2);
  // Two Long Swords, two; two Sheens none, a Spellblade item in place of one leaving the other.
  assert.equal(roundTrip({ ...DEMO_STATE, items: [6655, 3020, 1036, 1036, 3089, null], next: 4 })?.next, 3);
  assert.equal(roundTrip({ ...DEMO_STATE, items: [6655, 3020, 3057, 3057, 3089, null], next: 4 })?.next, 1);
  // Nor the Dirk with every item built from it excluded.
  const fromDirk = defaultCandidates(data)
    .filter((i) => builtFrom(data, [3134], i.id).length)
    .map((i) => i.id);
  assert.equal(roundTrip({ ...DEMO_STATE, items: [6655, 3020, 3089, 3134, null, null], next: 3, excluded: fromDirk })?.next, 2);
  // With the tier 3 boots setting, the build's pair is the tier 3, the item to replace and those
  // excluded too; without, the pair a tier 3 is upgraded from.
  const shod = roundTrip({ ...DEMO_STATE, settings: { ...DEMO_STATE.settings, questBoots: true }, replace: 3020, excluded: [3020, 3006, 3175] });
  assert.deepEqual([shod?.items, shod?.replace, shod?.excluded], [[6655, 3175, null, null, null, null], 3175, [3175, 3172]]);
  const bare = roundTrip({ ...DEMO_STATE, items: [6655, 3175, null, null, null, null], excluded: [3172, 3089] });
  assert.deepEqual([bare?.items, bare?.excluded], [DEMO_STATE.items, [3006, 3089]]);
  assert.equal(roundTrip({ ...DEMO_STATE, replace: 3020 })?.replace, 3020);
  assert.equal(roundTrip({ ...DEMO_STATE, replace: 3089 })?.replace, null);
  assert.equal(roundTrip({ ...DEMO_STATE, next: 2, replace: 3020 })?.replace, null);
  assert.equal(roundTrip({ ...DEMO_STATE, replace: 9999 })?.replace, null);
});

test("a rune page is kept whole as it's read: picks sorted, a pick of a third tree or a keystone in the secondary tree left out, one a row and two in the secondary tree, a shard not of its row none", () => {
  const page = (runes: UIState["runes"]) => roundTrip({ ...RESET_STATE, runes })?.runes;
  // Electrocute and Cheap Shot in Domination, Conqueror and Triumph in Precision, Scorch in Sorcery.
  assert.deepEqual(page({ primary: "Domination", secondary: "Precision", picks: [8126, 8112, 9111, 8010, 8237], shards: [5008, 5008, 5001] }), {
    primary: "Domination",
    secondary: "Precision",
    picks: [8112, 8126, 9111],
    shards: [5008, 5008, 5001],
  });
  // Cheap Shot and Taste of Blood share a row; Manaflow Band, Absolute Focus and Scorch are three in Sorcery.
  assert.deepEqual(
    page({ primary: "Domination", secondary: "Sorcery", picks: [8126, 8139, 8226, 8233, 8237], shards: [null, null, null] })?.picks,
    [8139, 8233, 8237],
  );
  // Health Scaling is a defense shard only; Adaptive Force offense or flex.
  assert.deepEqual(page({ ...RESET_STATE.runes, shards: [5001, 5001, 5008] })?.shards, [null, 5001, null]);
  assert.deepEqual(page({ ...RESET_STATE.runes, shards: [5008, 5008, 5008] })?.shards, [5008, 5008, null]);
});

test("the target: what its mode takes, and nothing of the other modes'", () => {
  const target = (t: UIState["target"]) => roundTrip({ ...RESET_STATE, target: t })?.target;
  const squishy = { mode: "squishy" as const, levelDiff: -2, hpPercent: 50, damageReduction: 0.1 };
  assert.deepEqual(target(squishy), squishy);
  assert.deepEqual(target({ ...squishy, build: [3089, null] }), { ...squishy, build: [3089, null] });
  assert.deepEqual(target({ ...squishy, build: [] }), { ...squishy, build: [] });
  const champion = { mode: "champion" as const, levelDiff: 1, champion: "Malphite", items: [3075, 3143], hpPercent: 100, damageReduction: 0 };
  assert.deepEqual(target(champion), champion);
  assert.deepEqual(target({ ...champion, items: [] }), { ...champion, items: [] });
  const custom = {
    mode: "custom" as const,
    base: { hp: 1500, armor: 70.25, mr: 32 },
    bonus: { hp: 0, armor: -5, mr: 1e9 },
    hpPercent: 37,
    damageReduction: 0.07,
  };
  assert.deepEqual(target(custom), custom);
});

test("a champion's path: its name in lowercase, words joined by hyphens; read in any case, by name or key", () => {
  const path = (champion: string) => encodeState(data, { ...RESET_STATE, champion });
  assert.deepEqual(["MissFortune", "Kaisa", "DrMundo", "Nunu", "MonkeyKing", "JarvanIV"].map(path), [
    "miss-fortune/",
    "kaisa/",
    "dr-mundo/",
    "nunu-willump/",
    "wukong/",
    "jarvan-iv/",
  ]);
  const hash = encodeState(data, { ...RESET_STATE, level: 3 }).split("#")[1];
  for (const address of ["missfortune", "/MissFortune/", "miss-fortune#", ` miss-fortune/#${hash} `])
    assert.equal(decodeState(data, address)?.champion, "MissFortune", address);
  assert.equal(decodeState(data, `MissFortune#${hash}`)?.level, 3);
  assert.equal(decodeState(data, "monkeyking/")?.champion, "MonkeyKing");
  assert.equal(decodeState(data, "nunu/")?.champion, "Nunu");
});

test("what isn't a page's address holds none: no champion anywhere, a hash that isn't a code, a code cut short or run on", () => {
  const address = encodeState(data, { ...RESET_STATE, combo: "Q W E R", champion: "Zed" });
  const [build, shared] = codes(address);
  for (const bad of [
    "",
    "/",
    "nobody/",
    `nobody/#${build}+${shared}`,
    "zed/extra/",
    "zed/#hello!",
    `zed/#${build}+${shared}+${shared}`,
    `zed/#${build}+hello!`,
  ])
    assert.equal(decodeState(data, bad), null, bad);
  for (const bad of [`zed/#${build.slice(0, -1)}+${shared}`, `zed/#${build}+${shared.slice(0, -3)}`, `zed/#${build}+${shared}0`, `zed/#${build}+${shared}zz`])
    assert.equal(decodeState(data, bad), null, bad);
});

test("the combo's usual steps take a byte each, energize too; others their text", () => {
  const length = (combo: string) => encodeState(data, { ...RESET_STATE, combo }).length;
  assert.ok(length("Q energize AA") < length("Q energise AA"));
  assert.equal(roundTrip({ ...RESET_STATE, combo: "Q energize AA energise" })?.combo, "Q energize AA energise");
});

test("an item or rune the patch hasn't is left out; a target champion it hasn't, no state", () => {
  const s = decodeState(
    data,
    encodeState(data, {
      ...DEMO_STATE,
      items: [3142, 9999, 3020, null, null, null],
      target: { mode: "champion", levelDiff: 0, champion: "Lux", items: [9999, 3075], hpPercent: 100, damageReduction: 0 },
    }),
  );
  assert.deepEqual(s?.items, [3142, null, 3020, null, null, null]);
  assert.deepEqual(s?.target, { mode: "champion", levelDiff: 0, champion: "Lux", items: [3075], hpPercent: 100, damageReduction: 0 });
  assert.deepEqual(roundTrip({ ...DEMO_STATE, runes: { ...DEMO_STATE.runes, picks: [8112, 1234] } })?.runes.picks, [8112]);
  const other = { ...data, championIndex: data.championIndex.filter((c) => c.id !== "Lux") };
  assert.equal(
    decodeState(
      other,
      encodeState(data, { ...DEMO_STATE, target: { mode: "champion", levelDiff: 0, champion: "Lux", items: [], hpPercent: 100, damageReduction: 0 } }),
    ),
    null,
  );
});

test("builds' names: after = where a name isn't its place's, escaped what the address is written with; * on the one on screen unless it's the first", () => {
  const s: UIState = { ...DEMO_STATE, level: 16 };
  let page = addTab(single(s));
  page = renameTab(track(addTab(page), { ...s, items: [6655, null, null, null, null, null] }), 2, "Burst. ~!*(1)=+");
  page = selectTab(page, 1);
  const on = withBuild(s, page, 1);
  const address = encodePage(data, on, page);
  assert.match(address, /^ahri\/#\w+~\*\w+~Burst\._%7E!%2A%281%29%3D%2B=\w+\+\w+$/);
  const back = decodePage(data, address)!;
  assert.deepEqual(back.state, on);
  assert.deepEqual(
    back.page.builds.map((b) => b.name),
    ["Build 1", "Build 2", "Burst. ~!*(1)=+"],
  );
  assert.equal(back.page.active, 1);
  assert.match(encodePage(data, withBuild(s, page, 0), selectTab(page, 0)), /^ahri\/#\w+~\w+~Burst/);
  assert.match(encodePage(data, on, renameTab(page, 0, "Main")), /^ahri\/#Main=\w+~\*\w+~/);
  // A build alone, named: its name in the address too.
  const named = renameTab(single(s), 0, "Poke");
  assert.match(encodeState(data, s), /^ahri\/#\w+\+\w+$/);
  assert.match(encodePage(data, s, named), /^ahri\/#Poke=\w+\+\w+$/);
  assert.equal(decodePage(data, encodePage(data, s, named))!.page.builds[0].name, "Poke");
  // Named, the reset build has an address too.
  assert.match(encodePage(data, RESET_STATE, renameTab(single(RESET_STATE), 0, "Poke")), /^ahri\/#Poke=\w+\+\w+$/);
  const underscored = renameTab(page, 1, "Burst_poke now");
  assert.match(encodePage(data, on, underscored), /~\*Burst%5Fpoke_now=\w+~/);
  assert.equal(decodePage(data, encodePage(data, on, underscored))!.page.builds[1].name, "Burst_poke now");
});

test("a state simulates alike, as one scenario simulated once, with its items in other slots, its combo spaced otherwise, the tier 3 boots and components settings, items Item value leaves out, how many it ranks or the item it ranks in place of; not at another target health", () => {
  const key = (s: UIState) => scenarioKey(toScenario(data, s));
  const base: UIState = { ...DEMO_STATE, items: [6655, 3020, 3089, null, 4645, null], combo: "E Q W R AA*2 R" };
  const alike: UIState[] = [
    { ...base, items: [null, 3089, 6655, 4645, 3020, null] },
    { ...base, combo: " E  Q,W R 2AA R " },
    { ...base, settings: { ...base.settings, questBoots: true } },
    { ...base, settings: { ...base.settings, components: true } },
    { ...base, excluded: [3089] },
    { ...base, next: 3 },
    { ...base, replace: 3089 },
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
