// A champion's builds as tabs: the one on screen takes what changes there to its items, runes and
// combo, the rest is all of theirs; a new one is a copy of it, named with the lowest number free; tabs
// keep their order; and all of it is in the page's address.

import { test } from "node:test";
import assert from "node:assert/strict";
import { loadGameData } from "../src/node/load.ts";
import { DEFAULT_STATE, decodePage, decodeState, encodePage, encodeState, type UIState } from "../src/web/state.ts";
import { addTab, closeTab, moveTab, renameTab, selectTab, setOwnCombos, single, track, withBuild, type Page } from "../src/web/scenarios.ts";

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
  // The lowest number free.
  page = addTab(selectTab(closeTab(page, 1), 0));
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

test("a page's address: one build's is its scenario's; more, what they share and each build, the one on screen marked", () => {
  assert.equal(encodePage(data, s, single(s)), encodeState(data, s));
  assert.deepEqual(decodePage(data, encodeState(data, s)), { state: s, page: single(s) });

  let page = addTab(single(s));
  page = renameTab(track(addTab(page), { ...s, items: luden }), 2, "Burst. ~!*(1)");
  page = selectTab(page, 1);
  const on = withBuild(s, page, 1);
  const address = encodePage(data, on, page);
  assert.match(address, /^ahri\/#\w+~\.1~\*\.2~\w+\.Burst%2E%20%7E%21%2A%281%29$/);
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

  // Each its own combo: in each build, and in the address.
  const own = setOwnCombos(page, true, "Q W");
  const both = { ...own, builds: own.builds.map((b, i) => (i === 2 ? { ...b, combo: "R" } : b)) };
  const again = decodePage(data, encodePage(data, withBuild(on, both, 1), both))!;
  assert.deepEqual([again.page.ownCombos, again.page.builds.map((b) => b.combo), again.state.combo], [true, ["Q W", "Q W", "R"], "Q W"]);
});

test("what isn't a page's address holds none; a build in it that doesn't load is left out", () => {
  for (const bad of ["", "nobody/#~.1~.2", "ahri/#hello~.1~.2"]) assert.equal(decodePage(data, bad), null, bad);
  const back = decodePage(data, "ahri/#~hello.1~*.Two~.3")!;
  assert.deepEqual([back.page.builds.map((b) => b.name), back.page.active], [["Two", "Build 3"], 0]);
  // None left: the shared state alone.
  assert.deepEqual(decodePage(data, "ahri/#~hello.1!combos"), { state: DEFAULT_STATE, page: single(DEFAULT_STATE) });
});
