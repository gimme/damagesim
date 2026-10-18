// The scenarios, in the top bar: tabs, the one on screen pressed, what changes on screen its own (see
// scenarios.ts), all in the page's address. + opens a copy of it in a new tab, to change and to
// compare with it; × closes one. Compare shows the Compare card (compare.tsx). With one tab, there's
// only "+ Scenario".

import { useEffect, useMemo, useRef, useState } from "react";
import { DATA, championIcon } from "../data.ts";
import { Icon } from "./icons.tsx";
import { decodeSetup, encodeSetup, type UIState } from "../state.ts";
import { addTab, closeTab, labels, sameSetup, selectTab, single, track, type Compare, type Page, type Setup } from "../scenarios.ts";

export const setupOf = (s: UIState): Setup => ({ champion: s.champion, code: encodeSetup(DATA, s) });
export const stateOf = (s: Setup): UIState | null => decodeSetup(DATA, s.champion, s.code);

const championName = (champion: string) => DATA.champions[champion]?.name ?? champion;

/** The page's tabs and what's on screen, shared by the top bar, the Compare card and the address. */
export interface Scenarios {
  /** With the tab on screen as it is now. */
  page: Page;
  /** Each tab's label, as page.tabs. */
  labels: string[];
  screen: Setup;
  comparing: boolean;
  /** Tabs from an address, their scenario on screen put there with them. */
  load: (page: Page) => void;
  select: (i: number) => void;
  add: () => void;
  close: (i: number) => void;
  compare: (how: Compare) => void;
}

export function useScenarios(state: UIState, setState: (s: UIState) => void, initial: Page | null): Scenarios {
  const screen = useMemo(() => setupOf(state), [state]);
  const [kept, setPage] = useState(() => initial ?? single(screen));
  const page = useMemo(() => track(kept, screen), [kept, screen]);
  const named = useMemo(() => labels(page.tabs, championName), [page.tabs]);
  /** Tabs, their active one put on screen. */
  const go = (next: Page) => {
    const tab = next.tabs[next.active];
    const s = sameSetup(tab, screen) ? null : stateOf(tab);
    setPage(next);
    if (s) setState(s);
  };
  return {
    page,
    labels: named,
    screen,
    comparing: page.compare !== "off",
    load: setPage,
    select: (i) => go(selectTab(page, i)),
    add: () => go(addTab(page)),
    close: (i) => go(closeTab(page, i)),
    compare: (how) => go({ ...page, compare: how }),
  };
}

export function ScenarioBar({ scenarios }: { scenarios: Scenarios }) {
  const { page, labels } = scenarios;
  // The tab on screen in view, where the tabs scroll.
  const strip = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = strip.current;
    const tab = el?.children[page.active] as HTMLElement | undefined;
    if (!el || !tab) return;
    const add = (el.lastElementChild as HTMLElement).offsetWidth;
    if (tab.offsetLeft < el.scrollLeft) el.scrollLeft = tab.offsetLeft;
    else if (tab.offsetLeft + tab.offsetWidth > el.scrollLeft + el.clientWidth - add) el.scrollLeft = tab.offsetLeft + tab.offsetWidth - el.clientWidth + add;
  }, [page.active, page.tabs.length]);
  const add = "A copy of this scenario in a new tab, to change and to compare with this one";
  if (page.tabs.length < 2)
    return (
      <div className="scenario-bar">
        <button className="btn small" title={add} onClick={scenarios.add}>
          + Scenario
        </button>
      </div>
    );
  return (
    <div className="scenario-bar">
      <div ref={strip} className="scenario-tabs" role="group" aria-label="Scenarios">
        {page.tabs.map((t, i) => (
          <span key={i} className={`scenario-tab${i === page.active ? " active" : ""}`}>
            <button aria-pressed={i === page.active} aria-label={labels[i]} onClick={() => scenarios.select(i)}>
              <Icon src={championIcon(t.champion)} label={championName(t.champion)} size="xs" />
              <span className="name">{labels[i]}</span>
            </button>
            <button className="scenario-close" aria-label={`Close ${labels[i]}`} title={`Close ${labels[i]}`} onClick={() => scenarios.close(i)}>
              ×
            </button>
          </span>
        ))}
        <button className="scenario-add" aria-label="New scenario" title={add} onClick={scenarios.add}>
          +
        </button>
      </div>
      <button
        className="btn small"
        aria-pressed={scenarios.comparing}
        title="This scenario beside the other tabs"
        onClick={() => scenarios.compare(scenarios.comparing ? "off" : "own")}
      >
        Compare
      </button>
    </div>
  );
}
