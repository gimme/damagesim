// A champion's builds as tabs: the one on screen takes what changes there to its items, runes and
// combo, the rest is all of theirs; a new one is a copy of it at the end, named with the lowest number
// free; tabs keep their order; and all of it is in the page's address, each build's code in its order
// and the shared part's after them.

import { test } from "node:test";
import assert from "node:assert/strict";
import { loadGameData } from "../src/node/load.ts";
import { DEMO_STATE, decodePage, decodeState, encodePage, encodeState, type UIState } from "../src/web/state.ts";
import { addTab, closeTab, moveTab, renameTab, selectTab, setOwnCombos, single, track, withBuild, type Page } from "../src/web/tabs.ts";

const data = loadGameData("16.20");

const s: UIState = { ...DEMO_STATE, level: 16 };
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
  // How many items Item value ranks, and the item it ranks in place of, are the build's too.
  const three = track(page, { ...at, next: 3 });
  assert.deepEqual([three.builds[0].next, three.builds[1].next, withBuild({ ...at, next: 3 }, three, 0).next], [1, 3, 1]);
  const picked = track(page, { ...at, replace: 6655 });
  assert.deepEqual([picked.builds[0].replace, picked.builds[1].replace, withBuild({ ...at, replace: 6655 }, picked, 0).replace], [null, 6655, null]);
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

test("a page's address: one build's is its scenario's; more, each build's code in its order, the one on screen marked, then what they share", () => {
  assert.equal(encodePage(data, s, single(s)), encodeState(data, s));
  assert.deepEqual(decodePage(data, encodeState(data, s)), { state: s, page: single(s) });

  let page = addTab(single(s));
  page = track(addTab(page), { ...s, items: luden });
  page = selectTab(page, 1);
  const on = withBuild(s, page, 1);
  const address = encodePage(data, on, page);
  assert.match(address, /^ahri\/#\w+~\*\w+~\w+\+\w+$/);
  // The shared part is the state's: the same whichever build is on screen; a build's code is the build's.
  const [builds, shared] = address.split("#")[1].split("+");
  assert.equal(shared, encodeState(data, withBuild(s, page, 0)).split("+")[1]);
  assert.equal(
    builds.split("~")[0],
    encodeState(data, withBuild(s, page, 0))
      .split("#")[1]
      .split("+")[0],
  );
  assert.equal(
    builds.split("~")[2],
    encodeState(data, { ...s, items: luden })
      .split("#")[1]
      .split("+")[0],
  );
  const back = decodePage(data, address)!;
  assert.deepEqual(back.state, on);
  assert.deepEqual(
    back.page.builds.map((b) => [b.name, b.items]),
    [
      ["Build 1", s.items],
      ["Build 2", s.items],
      ["Build 3", luden],
    ],
  );
  assert.equal(back.page.active, 1);
  // decodeState reads the state on screen.
  assert.deepEqual(decodeState(data, address), on);
  // How many items Item value ranks, and the item it ranks in place of: in each build's code.
  const ranked = track(page, { ...on, next: 3 });
  assert.deepEqual(
    decodePage(data, encodePage(data, { ...on, next: 3 }, ranked))!.page.builds.map((b) => b.next),
    [1, 3, 1],
  );
  const picked = track(page, { ...on, replace: 3020 });
  assert.deepEqual(
    decodePage(data, encodePage(data, { ...on, replace: 3020 }, picked))!.page.builds.map((b) => b.replace),
    [null, 3020, null],
  );

  // Each its own combo: in each build's code, and so read from the address; else in the shared part.
  const own = setOwnCombos(page, true, "Q W");
  const both = { ...own, builds: own.builds.map((b, i) => (i === 2 ? { ...b, combo: "R" } : b)) };
  const ownAddress = encodePage(data, withBuild(on, both, 1), both);
  const again = decodePage(data, ownAddress)!;
  assert.deepEqual([again.page.ownCombos, again.page.builds.map((b) => b.combo), again.state.combo], [true, ["Q W", "Q W", "R"], "Q W"]);
  assert.deepEqual([back.page.ownCombos, back.page.builds.map((b) => b.combo)], [false, [s.combo, s.combo, s.combo]]);
  // A build's own combo is in its code, so its code alone opens with it.
  const third = ownAddress.split("#")[1].split("+")[0].split("~")[2];
  assert.equal(decodeState(data, `ahri/#${third}`)!.combo, "R");
  // Whether the Result card compares them: in the shared part.
  const alone = encodePage(data, withBuild(on, both, 1), { ...both, compare: false });
  assert.equal(decodePage(data, alone)!.page.compare, false);
  assert.equal(again.page.compare, true);
  assert.equal(decodePage(data, encodePage(data, s, { ...single(s), compare: false }))!.page.compare, false);
});

test("each build's boots of the tier the tier 3 boots setting has, which the first build's code holds; and its count settled with what they share", () => {
  const shoes = [6655, 3020, null, null, null, null];
  const slinger = [6655, 3175, null, null, null, null];
  const on: UIState = { ...s, settings: { ...s.settings, questBoots: true }, items: slinger };
  // The second build's code is the setup's without what's shared, the setting off: its tier 3 comes back as it was.
  const page = addTab(single(on));
  assert.deepEqual(
    decodePage(data, encodePage(data, on, page))!.page.builds.map((b) => b.items),
    [slinger, slinger],
  );
  // A pair of the other tier in it is the setting's.
  const bare = track(page, { ...on, items: shoes });
  assert.deepEqual(
    decodePage(data, encodePage(data, { ...on, items: shoes }, bare))!.page.builds.map((b) => b.items),
    [slinger, slinger],
  );
  // A count no more than the build's room with the items excluded: of a Serrated Dirk with every item
  // built from it excluded, the empty slots alone.
  const dirk = [6655, 3175, 3089, 3134, null, null];
  const excluded = { ...on, excluded: [2520, 3142, 3179, 3814, 6676, 6695, 6697] };
  const ranked = track(addTab(single(excluded)), { ...excluded, items: dirk, next: 3 });
  const back = decodePage(data, encodePage(data, { ...excluded, items: dirk, next: 3 }, ranked))!;
  assert.deepEqual([back.page.builds.map((b) => b.next), back.state.next], [[1, 2], 2]);
});

test("what isn't a page's address holds none; a build in it that doesn't load is left out", () => {
  const [build, shared] = encodeState(data, s).split("#")[1].split("+");
  for (const bad of ["", "nobody/#~.1~.2", "ahri/#hello~.1~.2", `ahri/#hello!+${shared}`]) assert.equal(decodePage(data, bad), null, bad);
  const back = decodePage(data, `ahri/#${build}~hello!~*Two=${build}~Build_3=~${build}+${shared}`)!;
  // A build without a name (the address cut, or written by hand): named by its place in it; an empty code, the reset build.
  assert.deepEqual([back.page.builds.map((b) => b.name), back.page.active], [["Build 1", "Two", "Build 3", "Build 5"], 1]);
  assert.deepEqual(back.page.builds[2].items, [null, null, null, null, null, null]);
  // No build's code at all: the reset build with what's shared.
  assert.deepEqual(
    decodePage(data, `ahri/#+${shared}`)!.page.builds.map((b) => b.items),
    [[null, null, null, null, null, null]],
  );
});
