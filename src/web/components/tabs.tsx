// The builds, in the top bar: a tab each, the one on screen pressed, what changes on screen to the
// build its own (see tabs.ts), all in the page's address. + opens a copy of it in a new tab at
// the end, to change and to compare with it; a tab is dragged to another place, renamed by a
// double-click and closed by its × or, focused, by Delete, the focus then on the tab in its place.
// A build alone has its tab too, to name it.

import { useEffect, useMemo, useRef, useState, type Dispatch, type RefObject, type SetStateAction } from "react";
import { DATA } from "../data.ts";
import { resetState, settled, withQuestBoots, type UIState } from "../state.ts";
import { addTab, closeTab, moveTab, renameTab, selectTab, setOwnCombos, single, track, withBuild, type Page } from "../tabs.ts";
import { landInLines, useDragOrder } from "./drag.tsx";

/** The page's builds and what they share, for the top bar, the cards and the address. */
export interface Tabs {
  /** With the build on screen as it is now. */
  page: Page;
  /** Whether there's more than one build. */
  many: boolean;
  /** Set by a change Back should undo (Reset, a tab closed, another champion): the address it leaves gets a history entry of its own. */
  push: RefObject<boolean>;
  /** A page from an address, whose state the caller puts on screen with it (see App's follow). */
  load: (page: Page) => void;
  select: (i: number) => void;
  add: () => void;
  close: (i: number) => void;
  move: (from: number, to: number) => void;
  rename: (i: number, name: string) => void;
  setOwnCombos: (own: boolean) => void;
  /** The Result card comparing the builds, or the one on screen alone. */
  setCompare: (compare: boolean) => void;
  /** A fresh page of the champion: one build, no items, runes or combo (see resetState). */
  reset: () => void;
  /** Another champion's page: the state with the champion picked (see pickChampion) as its one build, with a history entry of its own, so Back returns to this page. */
  pick: (s: UIState) => void;
  /** The tier 3 boots setting on or off, every build's pair of boots its counterpart (withQuestBoots), and those excluded (settled). */
  setQuestBoots: (on: boolean) => void;
}

export function useTabs(state: UIState, setState: Dispatch<SetStateAction<UIState>>, initial: Page): Tabs {
  const [kept, setKept] = useState(initial);
  // The page is its champion's: another champion's state put on screen some other way than pick has a page of its own.
  let base = kept;
  if (kept.champion !== state.champion) {
    base = single(state);
    setKept(base);
  }
  const page = useMemo(() => track(base, state), [base, state]);
  const push = useRef(false);
  /** A page, its build on screen put there where it's another, its own combo with it where they had each
   *  theirs, settled with what they share: its count of items no more than the room exclusions since leave. */
  const show = (next: Page) => {
    setKept(next);
    if (next.builds[next.active].id !== page.builds[page.active].id)
      setState(settled(DATA, withBuild(state, { ...next, ownCombos: page.ownCombos }, next.active)));
  };
  return {
    page,
    many: page.builds.length > 1,
    push,
    load: setKept,
    select: (i) => show(selectTab(page, i)),
    add: () => setKept(addTab(page)),
    close: (i) => {
      push.current = true;
      show(closeTab(page, i));
    },
    move: (from, to) => setKept(moveTab(page, from, to)),
    rename: (i, name) => setKept(renameTab(page, i, name)),
    setOwnCombos: (own) => setKept(setOwnCombos(page, own, state.combo)),
    setCompare: (compare) => setKept({ ...page, compare }),
    reset: () => {
      push.current = true;
      const s = resetState(state);
      setKept(single(s));
      setState(s);
    },
    pick: (s) => {
      push.current = true;
      setKept(single(s));
      setState(s);
    },
    setQuestBoots: (on) => {
      setKept((k) => ({ ...k, builds: k.builds.map((b) => withQuestBoots(DATA, b, on)) }));
      setState((s) => settled(DATA, { ...s, settings: { ...s.settings, questBoots: on } }));
    },
  };
}

const Plus = () => (
  <svg viewBox="0 0 10 10" width="10" height="10" aria-hidden>
    <path d="M5 1v8M1 5h8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
  </svg>
);

/** A build's name, typed in place of its tab's: Enter or a click elsewhere keeps it, Escape doesn't. */
function NameField({ name, onDone }: { name: string; onDone: (name: string) => void }) {
  return (
    <input
      type="text"
      aria-label="Build name"
      defaultValue={name}
      size={Math.max(6, name.length)}
      autoFocus
      onFocus={(e) => e.target.select()}
      onBlur={(e) => onDone(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.currentTarget.blur();
        if (e.key === "Escape") {
          e.currentTarget.value = name;
          e.currentTarget.blur();
        }
      }}
    />
  );
}

export function BuildTabs({ tabs }: { tabs: Tabs }) {
  const { page } = tabs;
  const [renaming, setRenaming] = useState<number | null>(null);
  const order = useDragOrder({
    count: page.builds.length,
    arrange: (from, to) => {
      const at = page.builds.map((_, j) => j);
      at.splice(to, 0, ...at.splice(from, 1));
      return at;
    },
    landAt: landInLines,
    move: tabs.move,
  });
  // After Delete, the tab in the closed one's place focused, to go on.
  const refocus = useRef<number | null>(null);
  useEffect(() => {
    const i = refocus.current;
    refocus.current = null;
    if (i != null) order.box.current?.children[i]?.querySelector<HTMLElement>("button[aria-pressed]")?.focus();
  });
  return (
    <div className="build-tab-bar">
      <div ref={order.box} className="build-tabs" role="group" aria-label="Builds">
        {page.builds.map((b, i) => (
          <span key={b.id} className={`build-tab${i === page.active ? " active" : ""}${order.drag?.from === i ? " dragged" : ""}`} {...order.item(i)}>
            {renaming === b.id ? (
              <NameField
                name={b.name}
                onDone={(name) => {
                  tabs.rename(i, name);
                  setRenaming(null);
                }}
              />
            ) : (
              <button
                aria-pressed={i === page.active}
                title={`${i === page.active ? b.name : `Open ${b.name}`}; ${tabs.many ? "drag it to move it, " : ""}double-click to rename it`}
                onClick={() => tabs.select(i)}
                onDoubleClick={() => setRenaming(b.id)}
                onKeyDown={(e) => {
                  if ((e.key !== "Delete" && e.key !== "Backspace") || !tabs.many) return;
                  e.preventDefault();
                  refocus.current = Math.min(i, page.builds.length - 2);
                  tabs.close(i);
                }}
              >
                <span className="name">{b.name}</span>
              </button>
            )}
            {tabs.many && (
              <button className="build-tab-close" aria-label={`Close ${b.name}`} title={`Close ${b.name} (Back brings it back)`} onClick={() => tabs.close(i)}>
                ×
              </button>
            )}
          </span>
        ))}
        <button className="build-tab-add" aria-label="New build" title="Copy this build to a new tab" onClick={tabs.add}>
          <Plus />
        </button>
      </div>
    </div>
  );
}
