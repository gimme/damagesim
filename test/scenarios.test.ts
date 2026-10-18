// Scenarios as tabs: the one on screen takes what changes there, a new one is a copy of it, closing one
// puts its neighbour on screen; and all of them, compared or not, are in the page's address.

import { test } from "node:test";
import assert from "node:assert/strict";
import { loadGameData } from "../src/node/load.ts";
import { DEFAULT_STATE, decodePage, decodeState, encodePage, encodeSetup, encodeState, type UIState } from "../src/web/state.ts";
import { addTab, closeTab, labels, selectTab, single, track, type Page, type Setup } from "../src/web/scenarios.ts";

const data = loadGameData("16.20");

const ahri: Setup = { champion: "Ahri", code: "" };
const ahri16: Setup = { champion: "Ahri", code: "2a" };
const zed: Setup = { champion: "Zed", code: "3b" };
const lux: Setup = { champion: "Lux", code: "" };

test("tabs: changes go to the one on screen, a new one copies it, closing one puts its neighbour on screen", () => {
  let page = addTab(single(ahri));
  assert.deepEqual(page, { tabs: [ahri, ahri], active: 1, compare: "off" });
  page = track(page, ahri16);
  assert.deepEqual(page.tabs, [ahri, ahri16]);
  assert.equal(track(page, ahri16), page);
  page = addTab(selectTab(page, 0));
  assert.deepEqual([page.tabs, page.active], [[ahri, ahri, ahri16], 1]);
  page = { ...track(page, zed), compare: "own" };

  assert.deepEqual(closeTab(page, 0), { tabs: [zed, ahri16], active: 0, compare: "own" });
  assert.deepEqual(closeTab(page, 1), { tabs: [ahri, ahri16], active: 1, compare: "own" });
  assert.deepEqual(closeTab(selectTab(page, 2), 2), { tabs: [ahri, zed], active: 1, compare: "own" });
  // One left: nothing to compare, and it stays.
  const one = closeTab(closeTab(page, 0), 0);
  assert.deepEqual(one, { tabs: [ahri16], active: 0, compare: "off" });
  assert.equal(closeTab(one, 0), one);
  assert.equal(selectTab(page, 3), page);
});

test("each tab's label: its champion's name, numbered from its second tab", () => {
  assert.deepEqual(
    labels([ahri, zed, ahri16, lux, ahri], (c) => c),
    ["Ahri", "Zed", "Ahri 2", "Lux", "Ahri 3"],
  );
});

test("a page's address: one tab's is its scenario's, the others around it and Compare after", () => {
  const s: UIState = { ...DEFAULT_STATE, champion: "Zed", level: 16 };
  const code = encodeSetup(data, s);
  const mf = encodeSetup(data, { ...DEFAULT_STATE, champion: "MissFortune", combo: "Q AA" });
  assert.equal(encodePage(data, s, single({ champion: "Zed", code })), encodeState(data, s));
  assert.equal(encodePage(data, s, { ...single({ champion: "Zed", code }), compare: "own" }), encodeState(data, s));

  const page: Page = { tabs: [ahri, { champion: "Zed", code: "stale" }, { champion: "MissFortune", code: mf }], active: 1, compare: "same" };
  const address = encodePage(data, s, page);
  assert.equal(address, `zed/#ahri-~${code}~miss-fortune-${mf}!compare-same-target`);
  const back = decodePage(data, address);
  assert.deepEqual(back, { state: s, page: { ...page, tabs: [ahri, { champion: "Zed", code }, page.tabs[2]] } });
  assert.deepEqual(decodePage(data, `zed/#ahri-~${code}!compare`)?.page.compare, "own");
  assert.deepEqual(decodePage(data, `zed/#ahri-~${code}!other`)?.page.compare, "off");
  // A scenario's own address is a page of one tab.
  assert.deepEqual(decodePage(data, encodeState(data, s)), { state: s, page: single({ champion: "Zed", code }) });
  assert.deepEqual(decodePage(data, "ahri/"), { state: DEFAULT_STATE, page: single(ahri) });
  // decodeState reads the one on screen.
  assert.deepEqual(decodeState(data, `zed/#${code}`), s);
});

test("what isn't a page's address holds none; a tab in it that doesn't load is left out", () => {
  const code = encodeSetup(data, { ...DEFAULT_STATE, level: 3 });
  for (const bad of ["", "nobody/#", `ahri/#${code}~${code}`, `ahri/#zed-~lux-`, `ahri/#${code.slice(0, -1)}~zed-`])
    assert.equal(decodePage(data, bad), null, bad);
  assert.deepEqual(decodePage(data, `ahri/#nobody-~${code}~zed-hello~lux-!compare`)?.page, {
    tabs: [{ champion: "Ahri", code }, lux],
    active: 0,
    compare: "own",
  });
  assert.deepEqual(decodePage(data, `ahri/#nobody-~${code}!compare`)?.page, single({ champion: "Ahri", code }));
});
