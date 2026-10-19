// A champion's builds as tabs: the one on screen takes what changes there to its items, runes and
// combo, the rest is all of theirs; a new one is a copy of it at the end, named with the lowest number
// free; tabs keep their order; and all of it is in the page's address, the first build's first as if
// it were alone.

import { test } from "node:test";
import assert from "node:assert/strict";
import { loadGameData } from "../src/node/load.ts";
import { DEFAULT_STATE, decodePage, decodeState, encodePage, encodeState, type UIState } from "../src/web/state.ts";
import { addTab, closeTab, moveTab, renameTab, selectTab, setOwnCombos, single, track, withBuild, type Page } from "../src/web/tabs.ts";

const data = loadGameData("16.20");

const s: UIState = { ...DEFAULT_STATE, level: 16 };
const luden: UIState["items"] = [6655, null, null, null, null, null];
const names = (p: Page) => p.builds.map((b, i) => `${b.name}${i === p.active ? " *" : ""}`);

test("builds: a new one copies the one on screen, what changes on screen is its own, the rest shared", () => {
  let page = addTab(single(s));
  assert.deepEqual(names(page), ["Build 1", "Build 2 *"]);
  assert.equal(page.builds[1].items, s.items);
  page = track(page, { ...s, items: luden, combo: "Q W" });
  assert.equal(track(page, { ...s, items: luden, combo: "Q W" }).builds[1].items, luden);
  assert.equal(page.builds[0].items, s.items);
  // Build 1 on screen with what's shared from the screen: the level, the combo.
  const at = { ...s, level: 9, items: luden, combo: "Q W" };
  assert.deepEqual(withBuild(at, page, 0), { ...at, items: s.items });
  // How many items Item value ranks is the build's too.
  const three = track(page, { ...at, next: 3 });
  assert.deepEqual([three.builds[0].next, three.builds[1].next, withBuild({ ...at, next: 3 }, three, 0).next], [1, 3, 1]);
  // Each its own combo, from the one on screen's.
  const own = setOwnCombos(page, true, "E Q");
  assert.deepEqual(
    own.builds.map((b) => b.combo),
    ["E Q", "E Q"],
  );
  assert.equal(withBuild(at, { ...own, builds: [{ ...own.builds[0], combo: "R" }, own.builds[1]] }, 0).combo, "R");
});

test("tabs: their names, closing, moving and renaming", () => {
  let page = addTab(addTab(single(s)));
  assert.deepEqual(names(page), ["Build 1", "Build 2", "Build 3 *"]);
  // At the end, the lowest number free.
  page = addTab(selectTab(closeTab(page, 1), 0));
  assert.deepEqual(names(page), ["Build 1", "Build 3", "Build 2 *"]);
  page = moveTab(page, 2, 1);
  assert.deepEqual(names(page), ["Build 1", "Build 2 *", "Build 3"]);

  assert.deepEqual(names(closeTab(page, 1)), ["Build 1", "Build 3 *"]);
  assert.deepEqual(names(closeTab(selectTab(page, 2), 2)), ["Build 1", "Build 2 *"]);
  assert.deepEqual(names(closeTab(page, 0)), ["Build 2 *", "Build 3"]);
  const one = closeTab(closeTab(setOwnCombos(page, true, ""), 0), 0);
  assert.deepEqual([names(one), one.ownCombos], [["Build 3 *"], false]);
  assert.equal(closeTab(one, 0), one);

  // Moved, the one on screen stays on screen.
  assert.deepEqual(names(moveTab(page, 2, 0)), ["Build 3", "Build 1", "Build 2 *"]);
  assert.deepEqual(names(moveTab(page, 1, 2)), ["Build 1", "Build 3", "Build 2 *"]);
  assert.deepEqual(names(renameTab(page, 0, "  Burst ")), ["Burst", "Build 2 *", "Build 3"]);
  assert.equal(renameTab(page, 0, " "), page);
});

test("a page's address: one build's is its scenario's; more, the first's as if alone, then each other build, the one on screen marked", () => {
  assert.equal(encodePage(data, s, single(s)), encodeState(data, s));
  assert.deepEqual(decodePage(data, encodeState(data, s)), { state: s, page: single(s) });

  let page = addTab(single(s));
  page = renameTab(track(addTab(page), { ...s, items: luden }), 2, "Burst. ~!*(1)");
  page = selectTab(page, 1);
  const on = withBuild(s, page, 1);
  const address = encodePage(data, on, page);
  // Names as written, spaces as "_", and what the address is written with escaped.
  assert.match(address, /^ahri\/#\w+~\*\.Build_2~\w+\.Burst%2E_%7E%21%2A%281%29$/);
  assert.equal(address.split("~")[0], encodeState(data, withBuild(s, page, 0)));
  // The first on screen: no mark; renamed, its name after its code.
  assert.match(encodePage(data, withBuild(s, page, 0), selectTab(page, 0)), /^ahri\/#\w+~\.Build_2~\w+\.Burst[^*]*$/);
  assert.match(encodePage(data, on, renameTab(page, 0, "Main")), /^ahri\/#\w+\.Main~\*\.Build_2~/);
  // A name its place has by default: left out where the build has a code; written where it hasn't,
  // so no part is empty; and written in another place.
  const coded = track(page, { ...on, items: luden });
  assert.match(encodePage(data, { ...on, items: luden }, coded), /^ahri\/#\w+~\*\w+~\w+\.Burst/);
  assert.deepEqual(
    decodePage(data, encodePage(data, { ...on, items: luden }, coded))!.page.builds.map((b) => b.name),
    ["Build 1", "Build 2", "Burst. ~!*(1)"],
  );
  const moved = moveTab(coded, 1, 0);
  assert.match(encodePage(data, { ...on, items: luden }, moved), /^ahri\/#\w+\.Build_2~\w*\.Build_1~/);
  const underscored = renameTab(page, 1, "Burst_poke now");
  assert.match(encodePage(data, on, underscored), /~\*\.Burst%5Fpoke_now~/);
  assert.equal(decodePage(data, encodePage(data, on, underscored))!.page.builds[1].name, "Burst_poke now");
  const back = decodePage(data, address)!;
  assert.deepEqual(back.state, on);
  assert.deepEqual(
    back.page.builds.map((b) => [b.name, b.items]),
    [
      ["Build 1", s.items],
      ["Build 2", s.items],
      ["Burst. ~!*(1)", luden],
    ],
  );
  assert.equal(back.page.active, 1);
  // decodeState reads a scenario's address only.
  assert.equal(decodeState(data, address), null);
  // How many items Item value ranks: in each build's code.
  const ranked = track(page, { ...on, next: 3 });
  assert.deepEqual(
    decodePage(data, encodePage(data, { ...on, next: 3 }, ranked))!.page.builds.map((b) => b.next),
    [1, 3, 1],
  );

  // Each its own combo: in each build, and in the address.
  const own = setOwnCombos(page, true, "Q W");
  const both = { ...own, builds: own.builds.map((b, i) => (i === 2 ? { ...b, combo: "R" } : b)) };
  const again = decodePage(data, encodePage(data, withBuild(on, both, 1), both))!;
  assert.deepEqual([again.page.ownCombos, again.page.builds.map((b) => b.combo), again.state.combo], [true, ["Q W", "Q W", "R"], "Q W"]);
  // Folded: in the address too.
  const folded = encodePage(data, withBuild(on, both, 1), { ...both, folded: true });
  assert.match(folded, /!combos!folded$/);
  assert.equal(decodePage(data, folded)!.page.folded, true);
  assert.equal(decodePage(data, encodePage(data, s, { ...single(s), folded: true }))!.page.folded, false);
});

test("the builds' codes are the setup's, version 3: energize a byte from its table, in the shared combo or a build's own; version 2's don't load", () => {
  const zed: UIState = { ...DEFAULT_STATE, champion: "Zed", combo: "AA energize AA" };
  const part = (address: string, n: number) => address.split("#")[1].split(/[~!]/)[n].replace(/^\*/, "").split(".")[0];
  // Shared: in the first build's code, with what they share, a byte as ignite is.
  const page = addTab(single(zed));
  const shared = encodePage(data, zed, page);
  assert.equal(decodePage(data, shared)!.state.combo, "AA energize AA");
  assert.equal(part(shared, 0).length, part(encodePage(data, { ...zed, combo: "AA ignite AA" }, page), 0).length);
  assert.ok(part(shared, 0).length < part(encodePage(data, { ...zed, combo: "AA energise AA" }, page), 0).length);
  // A build's own: in its code.
  const own = setOwnCombos(page, true, "R energize AA");
  const address = encodePage(data, { ...zed, combo: "R energize AA" }, own);
  assert.deepEqual(
    decodePage(data, address)!.page.builds.map((b) => b.combo),
    ["R energize AA", "R energize AA"],
  );
  assert.ok(part(address, 1).length < part(encodePage(data, { ...zed, combo: "R energise AA" }, setOwnCombos(page, true, "R energise AA")), 1).length);
  // Version 2's, before the energize step (Zed at 16 with two items): as what they share, no page; as a build, left out.
  assert.equal(decodePage(data, "zed/#HFSIMq2SEcbzjWQd8a~*.1~.2"), null);
  assert.deepEqual(decodePage(data, "zed/#~HFSIMq2SEcbzjWQd8a.2")!.page.builds.length, 1);
});

test("what isn't a page's address holds none; a build in it that doesn't load is left out", () => {
  for (const bad of ["", "nobody/#~.1~.2", "ahri/#hello~.1~.2"]) assert.equal(decodePage(data, bad), null, bad);
  const back = decodePage(data, "ahri/#~hello.Build_2~*.Two~.Build_3~")!;
  // A build without a name (the address cut, or written by hand): named by its place in it.
  assert.deepEqual([back.page.builds.map((b) => b.name), back.page.active], [["Build 1", "Two", "Build 3", "Build 5"], 1]);
  // None left: the shared state alone.
  assert.deepEqual(decodePage(data, "ahri/#~hello.Build_2!combos"), { state: DEFAULT_STATE, page: single(DEFAULT_STATE) });
});
