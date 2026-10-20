// Rune pages: which runes a page holds together, and how picking a rune or a tree changes one.
//
// A page has a primary tree (a keystone and one rune from each of its three rows), a secondary tree
// (two runes from different rows, no keystone) and a stat shard from each of three rows, any of them
// left empty. Its picks are a set, kept sorted by id, so two pages alike are alike however they were
// made; which pick is the older, where that matters, is told by the order the caller remembers.
// Picking keeps a page whole the way the client does: a rune takes the place of the one in its row,
// and a secondary rune in a third row takes the place of the older of the two. A tree that leaves
// the page takes its picks with it; one that changes place keeps those that fit there.

import type { RuneData } from "./data-types.ts";
import type { GameData } from "./gamedata.ts";

export interface RunePage {
  primary: string;
  secondary: string;
  /** The runes picked in its two trees, by id, sorted. */
  picks: number[];
  /** One per shard row (offense, flex, defense), null for none. */
  shards: (number | null)[];
}

const runeById = (data: GameData, id: number) => data.runes.find((r) => r.id === id);

/** "a, b and c". */
const listJoin = (xs: string[], last = "and") => (xs.length > 1 ? `${xs.slice(0, -1).join(", ")} ${last} ${xs[xs.length - 1]}` : xs.join(""));

const byId = (a: number, b: number) => a - b;

/** The page's picks in a tree. */
export function treePicks(data: GameData, page: RunePage, tree: string): number[] {
  return page.picks.filter((id) => runeById(data, id)?.tree === tree);
}

/** The page as a scenario's runes: keystone, the primary tree's rows, the secondary picks, then the shards. */
export function pageRunes(data: GameData, page: RunePage): number[] {
  const rank = (id: number) => {
    const r = runeById(data, id);
    return r ? (r.tree === page.primary ? 0 : 10) + r.row : 99;
  };
  return [...page.picks].sort((a, b) => rank(a) - rank(b) || a - b).concat(page.shards.filter((x): x is number => x != null));
}

/**
 * Whether `id` can go on the page where it is: a rune of its primary tree, or of its secondary tree
 * but a keystone.
 */
function fits(data: GameData, page: RunePage, id: number): boolean {
  const r = runeById(data, id);
  return !!r && (r.tree === page.primary || (r.tree === page.secondary && r.row > 0));
}

/**
 * A page kept whole: two trees, the secondary the first other one in the client's order where the
 * two are the same; the picks the data knows that fit where they are as picking them in turn by id
 * leaves them (pickRune), one a row and two in the secondary tree; a shard in each row the row
 * offers, else none. What a code holds is settled so as it's read.
 */
export function settledPage(data: GameData, page: RunePage): RunePage {
  const secondary = page.secondary !== page.primary ? page.secondary : data.runePage.trees.find((t) => t.key !== page.primary)!.key;
  const shards = data.runePage.shards.map((row, i) => (page.shards[i] != null && row.options.includes(page.shards[i]!) ? page.shards[i] : null));
  const empty: RunePage = { primary: page.primary, secondary, picks: [], shards };
  return [...new Set(page.picks)].sort(byId).reduce((p, id) => pickRune(data, p, id), empty);
}

/** Of `ids`, the older by `order` (ids oldest first, one not there older than any), then the one in the earlier row. */
function oldest(data: GameData, ids: number[], order: number[]): number {
  const age = (id: number) => order.indexOf(id);
  return [...ids].sort((a, b) => age(a) - age(b) || runeById(data, a)!.row - runeById(data, b)!.row)[0];
}

/**
 * The page with `id` picked, or unpicked if it was. A pick takes the place of the one in its row; in
 * the secondary tree with two picks in other rows, of the older by `order` (see oldest). One that
 * can't go on the page (another tree's, a keystone in the secondary tree) leaves it as it is.
 */
export function pickRune(data: GameData, page: RunePage, id: number, order: number[] = []): RunePage {
  if (page.picks.includes(id)) return { ...page, picks: page.picks.filter((x) => x !== id) };
  if (!fits(data, page, id)) return page;
  const r = runeById(data, id)!;
  const same = treePicks(data, page, r.tree);
  const sameRow = same.find((x) => runeById(data, x)!.row === r.row);
  const out = sameRow ?? (r.tree === page.secondary && same.length >= 2 ? oldest(data, same, order) : null);
  return { ...page, picks: [...page.picks.filter((x) => x !== out), id].sort(byId) };
}

/** The page with `id` as the shard of row `i`, or none if it was. */
export function pickShard(page: RunePage, i: number, id: number): RunePage {
  return { ...page, shards: page.shards.map((x, j) => (j === i ? (x === id ? null : id) : x)) };
}

/** The page with `tree` as its primary tree; if that was the secondary tree, the two swap. */
export function choosePrimary(data: GameData, page: RunePage, tree: string, order: number[] = []): RunePage {
  if (tree === page.primary) return page;
  return arrange(data, page, tree, tree === page.secondary ? page.primary : page.secondary, order);
}

/** The page with `tree` as its secondary tree; if that was the primary tree, the two swap. */
export function chooseSecondary(data: GameData, page: RunePage, tree: string, order: number[] = []): RunePage {
  if (tree === page.secondary) return page;
  if (tree === page.primary) return choosePrimary(data, page, page.secondary, order);
  return arrange(data, page, page.primary, tree, order);
}

/**
 * The page with these trees. A tree that changes place keeps the picks that fit there: all as the
 * primary tree; as the secondary, no keystone and the newest two by `order` (see oldest). A tree
 * that leaves the page takes its picks with it; one that comes on starts empty.
 */
function arrange(data: GameData, page: RunePage, primary: string, secondary: string, order: number[]): RunePage {
  const treeOf = (id: number) => runeById(data, id)?.tree;
  let picks = page.picks.filter((id) => treeOf(id) === primary || treeOf(id) === secondary);
  let minors = picks.filter((id) => treeOf(id) === secondary && runeById(data, id)!.row > 0);
  while (minors.length > 2) {
    const out = oldest(data, minors, order);
    minors = minors.filter((id) => id !== out);
  }
  picks = picks.filter((id) => treeOf(id) === primary || minors.includes(id)).sort(byId);
  return { ...page, primary, secondary, picks };
}

/** Whether each shard can take its own row, among rows offering it. */
function shardsFit(shards: number[], rows: number[][]): boolean {
  if (!shards.length) return true;
  const [first, ...rest] = shards;
  return rows.some(
    (row, i) =>
      row.includes(first) &&
      shardsFit(
        rest,
        rows.filter((_, j) => j !== i),
      ),
  );
}

/** Problems in the primary tree's rows and the secondary tree's picks. */
function treeProblems(runes: RuneData[], primary: string, secondary?: string): string[] {
  const out: string[] = [];
  const rowClashes = (tree: string) => {
    for (const row of [1, 2, 3]) {
      const inRow = runes.filter((r) => r.tree === tree && r.row === row);
      if (inRow.length > 1) out.push(`${listJoin(inRow.map((r) => r.name))} share a row of ${tree}: a rune page takes one`);
    }
  };
  rowClashes(primary);
  if (secondary) {
    const picks = runes.filter((r) => r.tree === secondary);
    if (picks.length > 2) out.push(`${picks.length} runes from ${secondary}, the secondary tree (${listJoin(picks.map((r) => r.name))}): it gives two`);
    rowClashes(secondary);
  }
  return out;
}

/** What keeps a list of runes (a scenario's) off any rune page, as warnings; empty if a page holds them. */
export function runePageProblems(data: GameData, runes: RuneData[]): string[] {
  const out: string[] = [];
  const treeRunes = runes.filter((r) => r.tree !== "Shards");
  const unique = treeRunes.filter((r, i) => treeRunes.findIndex((x) => x.id === r.id) === i);
  for (const r of unique) if (treeRunes.filter((x) => x.id === r.id).length > 1) out.push(`${r.name} is listed twice`);
  const keystones = unique.filter((r) => r.row === 0);
  if (keystones.length > 1) out.push(`more than one keystone (${listJoin(keystones.map((k) => k.name))}): a rune page has one`);
  const trees = [...new Set(unique.map((r) => r.tree))];
  if (trees.length > 2) out.push(`runes from ${trees.length} trees (${listJoin(trees)}): a rune page has a primary and a secondary tree`);
  else if (trees.length) {
    // The primary tree is the keystone's; without one, the reading with fewer problems.
    const ks = keystones[0]?.tree;
    const readings = ks ? [[ks, ...trees.filter((t) => t !== ks)]] : [trees, [...trees].reverse()];
    out.push(...readings.map(([p, s]) => treeProblems(unique, p, s)).reduce((a, b) => (b.length < a.length ? b : a)));
  }
  const rows = data.runePage.shards;
  const shards = runes.filter((r) => r.tree === "Shards");
  const names = (ids: number[]) => ids.map((id) => runeById(data, id)?.name ?? String(id));
  if (shards.length > rows.length) out.push(`${shards.length} shards: a rune page has ${rows.length}, one from each row`);
  else if (
    !shardsFit(
      shards.filter((s) => rows.some((row) => row.options.includes(s.id))).map((s) => s.id),
      rows.map((row) => row.options),
    )
  )
    out.push(
      `no rune page has the shards ${listJoin(shards.map((s) => s.name))}: it takes one from each row (${rows.map((row) => `${row.label}: ${listJoin(names(row.options), "or")}`).join("; ")})`,
    );
  return out;
}
