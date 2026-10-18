// Saved scenarios: switching between them loses nothing, saving goes over the name it's under, and the
// shelf a page opens to follows its address.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  EMPTY_SHELF,
  deleteScenario,
  discardUnsaved,
  freeName,
  openScenario,
  readShelf,
  reconcile,
  renameScenario,
  revertScenario,
  saveScenario,
  track,
  type Setup,
} from "../src/web/scenarios.ts";

const ahri: Setup = { champion: "Ahri", code: "" };
const ahri16: Setup = { champion: "Ahri", code: "2a" };
const zed: Setup = { champion: "Zed", code: "3b" };
const zedQ: Setup = { champion: "Zed", code: "4c" };
const lux: Setup = { champion: "Lux", code: "" };

test("saved, the screen's changes go to the open scenario, and none once it's back as saved", () => {
  let shelf = saveScenario(EMPTY_SHELF, "burst", ahri);
  assert.deepEqual(shelf, { saved: [{ name: "burst", ...ahri }], open: "burst", unsaved: null });
  shelf = track(shelf, ahri16);
  assert.deepEqual(shelf.saved[0], { name: "burst", ...ahri, edited: ahri16 });
  assert.equal(track(shelf, ahri16), shelf);
  assert.deepEqual(track(shelf, ahri).saved[0], { name: "burst", ...ahri });
});

test("switching keeps each scenario's changes, and the unsaved work", () => {
  let shelf = track(saveScenario(saveScenario(EMPTY_SHELF, "burst", ahri), "zed", zed), zedQ);
  let to = openScenario(shelf, "burst", zedQ);
  assert.deepEqual(to.screen, ahri);
  assert.deepEqual(to.shelf.saved[1], { name: "zed", ...zed, edited: zedQ });
  to = openScenario(to.shelf, "zed", ahri);
  assert.deepEqual(to.screen, zedQ);

  // Work on no saved scenario: kept while one is open, back on screen when it's opened.
  shelf = { ...to.shelf, open: null };
  to = openScenario(shelf, "burst", lux);
  assert.deepEqual([to.screen, to.shelf.open, to.shelf.unsaved], [ahri, "burst", lux]);
  to = openScenario(to.shelf, "zed", ahri);
  assert.deepEqual(to.shelf.unsaved, lux);
  to = openScenario(to.shelf, null, zedQ);
  assert.deepEqual([to.screen, to.shelf.open, to.shelf.unsaved], [lux, null, null]);

  // Not kept when a saved scenario has it as it is; dropped on request.
  assert.equal(openScenario(to.shelf, "burst", zedQ).shelf.unsaved, null);
  const kept = openScenario(to.shelf, "burst", lux).shelf;
  assert.equal(discardUnsaved(kept).unsaved, null);
  assert.deepEqual(openScenario(kept, "nothing", ahri), { shelf: kept, screen: ahri });
});

test("saving under a name: over the scenario that has it, or a new one, the open one's changes then its own no more", () => {
  const shelf = track(saveScenario(saveScenario(EMPTY_SHELF, "burst", ahri), "zed", zed), zedQ);
  const over = saveScenario(shelf, "zed", zedQ);
  assert.deepEqual(over.saved, [
    { name: "burst", ...ahri },
    { name: "zed", ...zedQ },
  ]);
  const asNew = saveScenario(shelf, "zed Q", zedQ);
  assert.deepEqual(asNew.saved, [
    { name: "burst", ...ahri },
    { name: "zed", ...zed },
    { name: "zed Q", ...zedQ },
  ]);
  assert.equal(asNew.open, "zed Q");
  assert.equal(freeName(asNew, "zed"), "zed 2");
  assert.equal(freeName(asNew, "lux"), "lux");
});

test("rename, revert, delete", () => {
  let shelf = track(saveScenario(saveScenario(EMPTY_SHELF, "burst", ahri), "zed", zed), zedQ);
  assert.equal(renameScenario(shelf, "zed", "burst"), shelf);
  shelf = renameScenario(shelf, "zed", "Zed");
  assert.deepEqual([shelf.open, shelf.saved[1].name], ["Zed", "Zed"]);
  const reverted = revertScenario(shelf);
  assert.deepEqual([reverted.screen, reverted.shelf.saved[1]], [zed, { name: "Zed", ...zed }]);

  // Deleting the open one: what's on screen stays, unsaved; or the unsaved work kept comes back.
  assert.deepEqual(deleteScenario(shelf, "burst"), { shelf: { ...shelf, saved: [shelf.saved[1]] }, screen: null });
  assert.deepEqual(deleteScenario(shelf, "Zed"), { shelf: { saved: [shelf.saved[0]], open: null, unsaved: null }, screen: null });
  assert.deepEqual(deleteScenario({ ...shelf, unsaved: lux }, "Zed").screen, lux);
});

test("a page's shelf: the one open before on a reload, one a link has as it is, else none", () => {
  const shelf = { ...track(saveScenario(saveScenario(EMPTY_SHELF, "burst", ahri), "zed", zed), zedQ), unsaved: lux };
  assert.equal(reconcile(shelf, zedQ), shelf);
  assert.deepEqual(reconcile(shelf, ahri), { ...shelf, open: "burst" });
  // Zed as saved isn't the scenario as it is now, with its changes: a link to it is unsaved work.
  assert.deepEqual(reconcile(shelf, zed), { ...shelf, open: null, unsaved: null });
  const none = { ...shelf, open: null, unsaved: null };
  assert.equal(reconcile(none, lux), none);
  assert.deepEqual(reconcile(none, zedQ), { ...none, open: "zed" });
});

test("a shelf as stored: what isn't one is left out", () => {
  assert.deepEqual(readShelf(null), EMPTY_SHELF);
  assert.deepEqual(readShelf("{"), EMPTY_SHELF);
  assert.deepEqual(readShelf('"text"'), EMPTY_SHELF);
  const shelf = { ...track(saveScenario(saveScenario(EMPTY_SHELF, "burst", ahri), "zed", zed), zedQ), unsaved: lux };
  assert.deepEqual(readShelf(JSON.stringify(shelf)), shelf);
  assert.deepEqual(
    readShelf(
      JSON.stringify({
        saved: [
          { name: "a", ...ahri },
          { name: "a", ...zed },
          { name: " ", ...zed },
          { name: "b", champion: 1, code: "" },
          { name: "c", ...lux, edited: 5 },
        ],
        open: "gone",
        unsaved: lux,
      }),
    ),
    {
      saved: [
        { name: "a", ...ahri },
        { name: "c", ...lux },
      ],
      open: null,
      unsaved: null,
    },
  );
});
