// Scenarios: tabs on a page, each a champion and its setup's code (see encodeSetup), all in the
// page's address with whether they're compared (see encodePage), so a link has them as they are. What's
// on screen is the active tab: a change on screen is that tab's, and a new tab starts as a copy of
// it. Nothing here reads the game data: the codes come and go as they are.

/** A champion and its setup's code: a scenario as a tab has it. */
export interface Setup {
  champion: string;
  code: string;
}

/** How the tabs are compared: not, each against its own target, or all against the one on screen's. */
export type Compare = "off" | "own" | "same";

export interface Page {
  tabs: Setup[];
  /** The tab on screen, by its place. */
  active: number;
  /** Off with one tab. */
  compare: Compare;
}

export const sameSetup = (a: Setup, b: Setup) => a.champion === b.champion && a.code === b.code;

const setup = ({ champion, code }: Setup): Setup => ({ champion, code });

/** A page of one tab. */
export const single = (screen: Setup): Page => ({ tabs: [setup(screen)], active: 0, compare: "off" });

/** The screen as it is now: the active tab's. */
export function track(page: Page, screen: Setup): Page {
  if (sameSetup(page.tabs[page.active], screen)) return page;
  return { ...page, tabs: page.tabs.map((t, i) => (i === page.active ? setup(screen) : t)) };
}

/** A copy of the active tab in a new tab after it, on screen. */
export const addTab = (page: Page): Page => ({
  ...page,
  tabs: [...page.tabs.slice(0, page.active + 1), page.tabs[page.active], ...page.tabs.slice(page.active + 1)],
  active: page.active + 1,
});

export const selectTab = (page: Page, i: number): Page => (i >= 0 && i < page.tabs.length ? { ...page, active: i } : page);

/** Without tab `i`, the last one kept. Closing the active one puts the next on screen, or the one before it where it was last. */
export function closeTab(page: Page, i: number): Page {
  if (page.tabs.length < 2 || i < 0 || i >= page.tabs.length) return page;
  const tabs = page.tabs.filter((_, k) => k !== i);
  return {
    tabs,
    active: i < page.active || (i === page.active && i === tabs.length) ? page.active - 1 : page.active,
    compare: tabs.length > 1 ? page.compare : "off",
  };
}

/** Each tab's label: its champion's name, numbered from its second tab on: "Ahri", "Ahri 2", "Zed". */
export function labels(tabs: Setup[], championName: (champion: string) => string): string[] {
  const seen = new Map<string, number>();
  return tabs.map((t) => {
    const n = (seen.get(t.champion) ?? 0) + 1;
    seen.set(t.champion, n);
    return n > 1 ? `${championName(t.champion)} ${n}` : championName(t.champion);
  });
}
