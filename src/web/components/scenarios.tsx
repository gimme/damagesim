// The builds, in the top bar: a tab each, the one on screen pressed, what changes on screen to the
// build its own (see scenarios.ts), all in the page's address. + opens a copy of it in a new tab, to
// change and to compare with it; a tab is dragged to another place, renamed by a double-click and
// closed by its ×. With one build, there's only "+ Build".

import { useMemo, useRef, useState, type MutableRefObject } from "react";
import { DATA } from "../data.ts";
import { encodeSetup, recallPage, resetState, type UIState } from "../state.ts";
import { addTab, closeTab, moveTab, renameTab, selectTab, setOwnCombos, single, track, withBuild, type Page } from "../scenarios.ts";
import { landInLines, useDragOrder } from "./drag.tsx";

/** The page's builds and what they share, for the top bar, the cards and the address. */
export interface Scenarios {
  /** With the build on screen as it is now. */
  page: Page;
  /** Whether there's more than one build. */
  many: boolean;
  /** Set by a change Back should undo (Reset, a tab closed): the address it leaves gets a history entry of its own. */
  push: MutableRefObject<boolean>;
  /** A page from an address, its state put on screen with it. */
  load: (page: Page) => void;
  select: (i: number) => void;
  add: () => void;
  close: (i: number) => void;
  move: (from: number, to: number) => void;
  rename: (i: number, name: string) => void;
  setOwnCombos: (own: boolean) => void;
  /** The comparison folded away in the Result card, or back. */
  setFolded: (folded: boolean) => void;
  /** A fresh page of the champion: one build, no items, runes or combo (see resetState). */
  reset: () => void;
}

export function useScenarios(state: UIState, setState: (s: UIState) => void, initial: Page | null): Scenarios {
  const [kept, setKept] = useState(() => initial ?? single(state));
  // Another champion picked: its page as you left it, as pickChampion put its build on screen, or
  // that build alone.
  let base = kept;
  if (kept.champion !== state.champion) {
    const back = recallPage(DATA, state.champion);
    base = back && encodeSetup(DATA, back.state) === encodeSetup(DATA, state) ? back.page : single(state);
    setKept(base);
  }
  const page = useMemo(() => track(base, state), [base, state]);
  const push = useRef(false);
  /** A page, its build on screen put there where it's another, its own combo with it where they had each theirs. */
  const show = (next: Page) => {
    setKept(next);
    if (next.builds[next.active].id !== page.builds[page.active].id) setState(withBuild(state, { ...next, ownCombos: page.ownCombos }, next.active));
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
    setFolded: (folded) => setKept({ ...page, folded }),
    reset: () => {
      push.current = true;
      const s = resetState(state);
      setKept(single(s));
      setState(s);
    },
  };
}

const Plus = () => (
  <svg viewBox="0 0 10 10" width="10" height="10" aria-hidden>
    <path d="M5 1v8M1 5h8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
  </svg>
);

/** A build's name, typed in place of its tab's: Enter or a click elsewhere keeps it, Escape doesn't. */
function NameField({ name, onDone }: { name: string; onDone: (name: string | null) => void }) {
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

export function ScenarioBar({ scenarios }: { scenarios: Scenarios }) {
  const { page } = scenarios;
  const [renaming, setRenaming] = useState<number | null>(null);
  const order = useDragOrder({
    count: page.builds.length,
    arrange: (from, to) => {
      const at = page.builds.map((_, j) => j);
      at.splice(to, 0, ...at.splice(from, 1));
      return at;
    },
    landAt: landInLines,
    move: scenarios.move,
  });
  const add = "Copy this build to a new tab";
  if (!scenarios.many)
    return (
      <div className="scenario-bar">
        <button className="btn small scenario-first" title={add} onClick={scenarios.add}>
          <Plus /> Build
        </button>
      </div>
    );
  return (
    <div className="scenario-bar">
      <div ref={order.box} className="scenario-tabs" role="group" aria-label="Builds">
        {page.builds.map((b, i) => (
          <span key={b.id} className={`scenario-tab${i === page.active ? " active" : ""}${order.drag?.from === i ? " dragged" : ""}`} {...order.item(i)}>
            {renaming === b.id ? (
              <NameField
                name={b.name}
                onDone={(name) => {
                  if (name != null) scenarios.rename(i, name);
                  setRenaming(null);
                }}
              />
            ) : (
              <button
                aria-pressed={i === page.active}
                title={`${i === page.active ? b.name : `Open ${b.name}`}; drag it to move it, double-click to rename it`}
                onClick={() => scenarios.select(i)}
                onDoubleClick={() => setRenaming(b.id)}
              >
                {/* Its bold name's width, so a tab is as wide on screen or not */}
                <span className="name" data-name={b.name}>
                  <span>{b.name}</span>
                </span>
              </button>
            )}
            <button
              className="scenario-close"
              aria-label={`Close ${b.name}`}
              title={`Close ${b.name} (Back brings it back)`}
              onClick={() => scenarios.close(i)}
            >
              ×
            </button>
          </span>
        ))}
        <button className="scenario-add" aria-label="New build" title={add} onClick={scenarios.add}>
          <Plus />
        </button>
      </div>
    </div>
  );
}
