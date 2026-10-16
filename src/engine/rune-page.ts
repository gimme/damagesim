// Rune pages: which runes a page holds together, and how picking a rune or a tree changes one.
//
// A page has a primary tree (a keystone and one rune from each of its three rows), a secondary tree
// (two runes from different rows, no keystone) and a stat shard from each of three rows. Picking
// keeps a page whole the way the client does: a rune takes the place of the one in its row, and a
// secondary rune in a third row takes the place of the older of the two. A tree that changes place
// starts empty.

import type { RuneData } from './data-types.ts';
import type { GameData } from './gamedata.ts';

export interface RunePage {
  primary: string;
  secondary: string;
  /** Runes from the two trees, oldest pick first. */
  picks: number[];
  /** One per shard row: offense, flex, defense. */
  shards: number[];
}

const runeById = (data: GameData, id: number) => data.runes.find((r) => r.id === id);

/** "a, b and c". */
const listJoin = (xs: string[], last = 'and') => (xs.length > 1 ? `${xs.slice(0, -1).join(', ')} ${last} ${xs[xs.length - 1]}` : xs.join(''));

/** The page's picks in a tree, oldest first. */
export function treePicks(data: GameData, page: RunePage, tree: string): number[] {
  return page.picks.filter((id) => runeById(data, id)?.tree === tree);
}

/** The page as a scenario's runes: keystone, the primary tree's rows, the secondary picks, then the shards. */
export function pageRunes(data: GameData, page: RunePage): number[] {
  const rank = (id: number) => {
    const r = runeById(data, id);
    return r ? (r.tree === page.primary ? 0 : 10) + r.row : 99;
  };
  return [...page.picks].sort((a, b) => rank(a) - rank(b)).concat(page.shards);
}

/**
 * The pick that picking `id` takes the place of: the one in its row, or in the secondary tree the
 * older of two; null if none; undefined if `id` can't go on the page (another tree's, or a keystone
 * in the secondary tree).
 */
function replacedBy(data: GameData, page: RunePage, id: number): number | null | undefined {
  const r = runeById(data, id);
  if (!r || (r.tree !== page.primary && r.tree !== page.secondary) || (r.tree === page.secondary && r.row === 0)) return undefined;
  const same = treePicks(data, page, r.tree).map((x) => runeById(data, x)!);
  const sameRow = same.find((x) => x.row === r.row);
  if (sameRow) return sameRow.id;
  if (r.tree === page.secondary && same.length >= 2) return same[0].id;
  return null;
}

/** The page with `id` picked, or unpicked if it was. */
export function pickRune(data: GameData, page: RunePage, id: number): RunePage {
  if (page.picks.includes(id)) return { ...page, picks: page.picks.filter((x) => x !== id) };
  const out = replacedBy(data, page, id);
  if (out === undefined) return page;
  return { ...page, picks: [...page.picks.filter((x) => x !== out), id] };
}

/** The page with `tree` as its primary tree; if that was the secondary tree, the two swap. */
export function choosePrimary(data: GameData, page: RunePage, tree: string): RunePage {
  if (tree === page.primary) return page;
  return arrange(data, page, tree, tree === page.secondary ? page.primary : page.secondary);
}

/** The page with `tree` as its secondary tree; if that was the primary tree, the two swap. */
export function chooseSecondary(data: GameData, page: RunePage, tree: string): RunePage {
  if (tree === page.secondary) return page;
  if (tree === page.primary) return choosePrimary(data, page, page.secondary);
  return arrange(data, page, page.primary, tree);
}

/** The page with these trees: one that keeps its place keeps its picks, one that changes place starts empty. */
function arrange(data: GameData, page: RunePage, primary: string, secondary: string): RunePage {
  const kept = (id: number) => {
    const tree = runeById(data, id)?.tree;
    return (tree === primary && tree === page.primary) || (tree === secondary && tree === page.secondary);
  };
  return { ...page, primary, secondary, picks: page.picks.filter(kept) };
}

/** Whether each shard can take its own row, among rows offering it. */
function shardsFit(shards: number[], rows: number[][]): boolean {
  if (!shards.length) return true;
  const [first, ...rest] = shards;
  return rows.some((row, i) => row.includes(first) && shardsFit(rest, rows.filter((_, j) => j !== i)));
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
  const treeRunes = runes.filter((r) => r.tree !== 'Shards');
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
  const shards = runes.filter((r) => r.tree === 'Shards');
  const names = (ids: number[]) => ids.map((id) => runeById(data, id)?.name ?? String(id));
  if (shards.length > rows.length) out.push(`${shards.length} shards: a rune page has ${rows.length}, one from each row`);
  else if (!shardsFit(shards.filter((s) => rows.some((row) => row.options.includes(s.id))).map((s) => s.id), rows.map((row) => row.options)))
    out.push(`no rune page has the shards ${listJoin(shards.map((s) => s.name))}: it takes one from each row (${rows.map((row) => `${row.label}: ${listJoin(names(row.options), 'or')}`).join('; ')})`);
  return out;
}
