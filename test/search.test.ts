// Picker search ranking: which names a search puts first.

import { test } from "node:test";
import assert from "node:assert/strict";
import { search } from "../src/web/search.ts";

/** The names a search matches, best first. */
const ranked = (q: string, names: string[]) => search(names, (n) => n, q);

test('initials of the whole name come first, passing over words like "of"', () => {
  assert.deepEqual(ranked("ac", ["Actualizer", "Black Cleaver", "Ardent Censer"]), ["Ardent Censer", "Actualizer", "Black Cleaver"]);
  assert.deepEqual(ranked("ibl", ["Iceborn Gauntlet", "Imperial Mandate", "Ionian Boots of Lucidity"]), ["Ionian Boots of Lucidity", "Iceborn Gauntlet"]);
  assert.deepEqual(ranked("bork", ["Bastionbreaker", "Blade of The Ruined King"]), ["Blade of The Ruined King", "Bastionbreaker"]);
  assert.deepEqual(ranked("er", ["Actualizer", "Essence Reaver"]), ["Essence Reaver", "Actualizer"]);
});

test("a prefix of the name, then other initials, then a prefix of a later word, then other abbreviations", () => {
  assert.deepEqual(ranked("hor", ["Zhonya's Hourglass", "Nashor's Tooth", "Hollow Radiance", "Guardian's Horn", "Horizon Focus"]), [
    "Horizon Focus",
    "Guardian's Horn",
    "Hollow Radiance",
    "Nashor's Tooth",
    "Zhonya's Hourglass",
  ]);
  assert.deepEqual(ranked("co", ["The Collector", "Catalyst of Aeons", "Cosmic Drive"]), ["The Collector", "Cosmic Drive", "Catalyst of Aeons"]);
  assert.deepEqual(ranked("bl", ["Ionian Boots of Lucidity", "Black Cleaver"]), ["Black Cleaver", "Ionian Boots of Lucidity"]);
  assert.deepEqual(ranked("los", ["Locket of the Iron Solari", "Lost Chapter"]), ["Lost Chapter", "Locket of the Iron Solari"]);
  assert.deepEqual(ranked("edge", ["Endless Hunger", "Infinity Edge", "Edge of Night"]), ["Edge of Night", "Infinity Edge", "Endless Hunger"]);
});

test("letters inside a word, then letters with others between from a word start, then anywhere", () => {
  assert.deepEqual(ranked("dcap", ["Plated Steelcaps", "Rabadon's Deathcap"]), ["Rabadon's Deathcap", "Plated Steelcaps"]);
  assert.deepEqual(ranked("rfc", ["Horizon Focus", "Rapid Firecannon"]), ["Rapid Firecannon", "Horizon Focus"]);
  assert.deepEqual(ranked("sheen", []), []);
});
