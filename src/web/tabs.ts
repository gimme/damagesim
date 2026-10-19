// Tabs: a champion's builds, a tab each, on one page with what they share: the champion, its
// level, ranks and parameters, the target and the settings. A build is its items and runes, and its
// combo where the page's builds have each their own (ownCombos); otherwise they share one. What's on
// screen is the active build with what's shared: a change on screen to the build is its own, one to
// the rest is all of theirs. All of it is in the page's address (see encodePage). Nothing here reads
// the game data.

import type { RunePage } from "../engine/rune-page.ts";
import type { UIState } from "./state.ts";

/** What a tab has of its own. */
export interface Build {
  /** Its own for the page's life: its key as tabs move. */
  id: number;
  name: string;
  items: (number | null)[];
  runes: RunePage;
  /** Its combo, while the builds have each their own. */
  combo: string;
}

export interface Page {
  champion: string;
  /** In their order, which the active one doesn't change. */
  builds: Build[];
  /** The build on screen, by its place. */
  active: number;
  /** Whether each build has its own combo; false: the one on screen is all of theirs. */
  ownCombos: boolean;
  /** Whether the Result card has the one on screen alone, the comparison folded away. */
  folded: boolean;
}

/** The name a build in place i has by default ("Build 1" the first's): the one a page gives a new build, the lowest such not taken. */
export const nameAt = (i: number) => `Build ${i + 1}`;

function freeName(builds: Build[]): string {
  const taken = new Set(builds.map((b) => b.name));
  let i = 0;
  while (taken.has(nameAt(i))) i++;
  return nameAt(i);
}

const buildOf = (s: UIState, id: number, name: string): Build => ({ id, name, items: s.items, runes: s.runes, combo: s.combo });

/** A page of one build: the state's. */
export const single = (s: UIState): Page => ({ champion: s.champion, builds: [buildOf(s, 1, nameAt(0))], active: 0, ownCombos: false, folded: false });

/** The screen as it is now: the active build's items, runes and combo. */
export function track(page: Page, s: UIState): Page {
  const b = page.builds[page.active];
  if (b.items === s.items && b.runes === s.runes && b.combo === s.combo) return page;
  return { ...page, builds: page.builds.map((x, i) => (i === page.active ? { ...x, items: s.items, runes: s.runes, combo: s.combo } : x)) };
}

/** The state with build i on screen, with what's shared from `s`. */
export function withBuild(s: UIState, page: Page, i: number): UIState {
  const b = page.builds[i];
  return { ...s, items: b.items, runes: b.runes, combo: page.ownCombos ? b.combo : s.combo };
}

/** A copy of the active build in a new tab at the end, on screen. */
export function addTab(page: Page): Page {
  const b = { ...page.builds[page.active], id: Math.max(...page.builds.map((x) => x.id)) + 1, name: freeName(page.builds) };
  return { ...page, builds: [...page.builds, b], active: page.builds.length };
}

export const selectTab = (page: Page, i: number): Page => (i >= 0 && i < page.builds.length ? { ...page, active: i } : page);

/** Without tab `i`, the last one kept. Closing the active one puts the next on screen, or the one before it where it was last. */
export function closeTab(page: Page, i: number): Page {
  if (page.builds.length < 2 || i < 0 || i >= page.builds.length) return page;
  const builds = page.builds.filter((_, k) => k !== i);
  const active = i < page.active || (i === page.active && i === builds.length) ? page.active - 1 : page.active;
  return { ...page, builds, active, ownCombos: builds.length > 1 && page.ownCombos };
}

/** Tab `from` moved to `to`, the one on screen still on screen. */
export function moveTab(page: Page, from: number, to: number): Page {
  const builds = [...page.builds];
  const [b] = builds.splice(from, 1);
  builds.splice(to, 0, b);
  return { ...page, builds, active: builds.indexOf(page.builds[page.active]) };
}

/** Tab i named `name`, unless it's blank. */
export function renameTab(page: Page, i: number, name: string): Page {
  const named = name.trim();
  if (!named || named === page.builds[i]?.name) return page;
  return { ...page, builds: page.builds.map((b, k) => (k === i ? { ...b, name: named } : b)) };
}

/** Each build its own combo, from the one on screen's (`combo`), or all theirs the one on screen's. */
export function setOwnCombos(page: Page, own: boolean, combo: string): Page {
  if (own === page.ownCombos) return page;
  return { ...page, ownCombos: own, builds: own ? page.builds.map((b) => ({ ...b, combo })) : page.builds };
}
