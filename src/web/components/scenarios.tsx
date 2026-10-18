// The saved scenarios, in the top bar: a chip each, the one on screen pressed and a dot on one changed
// since it was saved. A click on another opens it as it was left (see scenarios.ts); on the one open,
// its menu: rename, revert its changes, delete. Save names what's on screen, a new scenario or, under a
// name taken, over that one; Ctrl+S saves the open one's changes over it. Compare shows the Compare
// card (compare.tsx).

import { useEffect, useLayoutEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";
import { DATA, championIcon } from "../data.ts";
import { Icon } from "./icons.tsx";
import { decodeSetup, encodeSetup, type UIState } from "../state.ts";
import {
  current,
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
  type Saved,
  type Setup,
  type Shelf,
} from "../scenarios.ts";

const STORAGE_KEY = "damagesim:scenarios";

export const setupOf = (s: UIState): Setup => ({ champion: s.champion, code: encodeSetup(DATA, s) });
export const stateOf = (s: Setup): UIState | null => decodeSetup(DATA, s.champion, s.code);

/** The saved scenarios and what's on screen, shared by the top bar and the Compare card. */
export interface Scenarios {
  shelf: Shelf;
  screen: Setup;
  comparing: boolean;
  setComparing: (on: boolean) => void;
  open: (name: string | null) => void;
  save: (name: string) => void;
  rename: (from: string, to: string) => void;
  revert: () => void;
  remove: (name: string) => void;
  discard: () => void;
}

export function useScenarios(state: UIState, setState: (s: UIState) => void): Scenarios {
  const screen = useMemo(() => setupOf(state), [state]);
  const [shelf, setShelf] = useState<Shelf>(() => {
    let stored: string | null = null;
    try {
      stored = localStorage.getItem(STORAGE_KEY);
    } catch {
      // storage unavailable: for the session only
    }
    return reconcile(readShelf(stored), screen);
  });
  const [comparing, setComparing] = useState(false);
  useEffect(() => setShelf((sh) => track(sh, screen)), [screen]);
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(shelf));
    } catch {
      // storage unavailable
    }
  }, [shelf]);
  /** A shelf, with what it puts on screen; one that doesn't load leaves the screen as it is. */
  const go = (next: { shelf: Shelf; screen: Setup | null }) => {
    const s = next.screen && stateOf(next.screen);
    if (next.screen && !s) return;
    setShelf(next.shelf);
    if (s) setState(s);
  };
  return {
    shelf,
    screen,
    comparing,
    setComparing,
    open: (name) => go(openScenario(shelf, name, screen)),
    save: (name) => setShelf(saveScenario(shelf, name, screen)),
    rename: (from, to) => setShelf(renameScenario(shelf, from, to)),
    revert: () => go(revertScenario(shelf)),
    remove: (name) => go(deleteScenario(shelf, name)),
    discard: () => setShelf(discardUnsaved(shelf)),
  };
}

/** A name for what's on screen: its champion and level, and its first item. */
function suggestedName(state: UIState) {
  const item = state.items.find((x) => x != null);
  return `${DATA.champions[state.champion].name} ${state.level}${item ? ` · ${DATA.items[item].name}` : ""}`;
}

/** A small panel under what opens it, inside the window, closed by Escape (back to what opened it) or a press outside it. */
function Popover({ label, onClose, children }: { label: string; onClose: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = ref.current!;
    const over = el.getBoundingClientRect().right - (document.documentElement.clientWidth - 8);
    if (over > 0) el.style.left = `${-over}px`;
  }, []);
  useEffect(() => {
    const close = (e: PointerEvent) => !ref.current?.parentElement?.contains(e.target as Node) && onClose();
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [onClose]);
  return (
    <div
      ref={ref}
      className="popover"
      role="dialog"
      aria-label={label}
      onKeyDown={(e) => {
        if (e.key !== "Escape") return;
        ref.current?.parentElement?.querySelector("button")?.focus();
        onClose();
      }}
    >
      {children}
    </div>
  );
}

/** A name typed, and what it does: the field starts with `initial`, selected. */
function NameForm({ initial, action, onSubmit }: { initial: string; action: (name: string) => string; onSubmit: (name: string) => void }) {
  const [name, setName] = useState(initial);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (name.trim()) onSubmit(name.trim());
  };
  return (
    <form className="row" style={{ flexWrap: "nowrap" }} onSubmit={submit}>
      <input type="text" aria-label="Scenario name" value={name} autoFocus onFocus={(e) => e.target.select()} onChange={(e) => setName(e.target.value)} />
      <button className="btn small primary" disabled={!name.trim()}>
        {action(name.trim())}
      </button>
    </form>
  );
}

function Chip({
  setup,
  name,
  pressed,
  edited,
  broken,
  title,
  onClick,
  children,
}: {
  setup: Setup;
  name: string;
  pressed: boolean;
  edited?: boolean;
  broken?: boolean;
  title: string;
  onClick: () => void;
  children?: ReactNode;
}) {
  return (
    <span className="scenario">
      <button
        className={`scenario-chip${broken ? " broken" : ""}${name ? "" : " unsaved"}`}
        aria-pressed={pressed}
        aria-label={`${name || "Unsaved"}${edited ? " (changed)" : ""}`}
        title={title}
        onClick={onClick}
      >
        <Icon src={championIcon(setup.champion)} label={DATA.champions[setup.champion]?.name ?? setup.champion} size="xs" />
        <span className="name">{name || "Unsaved"}</span>
        {edited && <span className="edited" aria-hidden />}
      </button>
      {children}
    </span>
  );
}

/** The open scenario's menu: its name to change, its changes to revert, and it to delete, at a second press. */
function ScenarioMenu({ s, loads, scenarios, onClose }: { s: Saved; loads: boolean; scenarios: Scenarios; onClose: () => void }) {
  const [deleting, setDeleting] = useState(false);
  const taken = (n: string) => n !== s.name && scenarios.shelf.saved.some((x) => x.name === n);
  return (
    <Popover label={s.name} onClose={onClose}>
      {!loads && <div className="notice warn small">This scenario doesn't load in this version.</div>}
      <NameForm
        initial={s.name}
        action={(n) => (taken(n) ? "Name taken" : "Rename")}
        onSubmit={(n) => {
          if (taken(n)) return;
          scenarios.rename(s.name, n);
          onClose();
        }}
      />
      <div className="row">
        {s.edited && (
          <button
            className="btn small"
            onClick={() => {
              scenarios.revert();
              onClose();
            }}
          >
            Revert changes
          </button>
        )}
        <button className="btn small danger" onClick={() => (deleting ? (scenarios.remove(s.name), onClose()) : setDeleting(true))}>
          {deleting ? `Delete ${s.name}?` : "Delete"}
        </button>
      </div>
    </Popover>
  );
}

export function ScenarioBar({ scenarios, state }: { scenarios: Scenarios; state: UIState }) {
  const { shelf } = scenarios;
  const [menu, setMenu] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const open = shelf.saved.find((s) => s.name === shelf.open);
  const loads = useMemo(() => new Map(shelf.saved.map((s) => [s.name, !!stateOf(current(s))])), [shelf.saved]);
  const others = shelf.saved.length - (open ? 1 : 0) + (shelf.unsaved ? 1 : 0);
  // Ctrl+S (⌘S): the open scenario's changes saved over it, or what's on screen named.
  const saveKey = useRef(() => {});
  saveKey.current = () => (open?.edited ? scenarios.save(open.name) : setSaving(true));
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() !== "s" || !(e.ctrlKey || e.metaKey) || e.altKey || e.shiftKey) return;
      e.preventDefault();
      saveKey.current();
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, []);
  return (
    <div className="scenario-bar" role="group" aria-label="Saved scenarios">
      {((!open && shelf.saved.length > 0) || shelf.unsaved) && (
        <Chip
          setup={shelf.unsaved ?? scenarios.screen}
          name=""
          pressed={!open}
          title={open ? "Your work that isn't saved: open it" : "What's on screen isn't saved: name it"}
          onClick={() => (open ? scenarios.open(null) : setSaving(true))}
        >
          {open && (
            <button className="scenario-discard" aria-label="Discard unsaved work" title="Discard the work that isn't saved" onClick={scenarios.discard}>
              ×
            </button>
          )}
        </Chip>
      )}
      {shelf.saved.map((s) => (
        <Chip
          key={s.name}
          setup={current(s)}
          name={s.name}
          pressed={s === open}
          edited={!!s.edited}
          broken={!loads.get(s.name)}
          title={
            !loads.get(s.name)
              ? "Doesn't load in this version"
              : s === open
                ? `${s.name}${s.edited ? ", changed since it was saved" : ""}: rename, revert or delete it`
                : `Open ${s.name}${s.edited ? ", with its changes" : ""}`
          }
          onClick={() => (s === open || !loads.get(s.name) ? setMenu(menu === s.name ? null : s.name) : scenarios.open(s.name))}
        >
          {menu === s.name && <ScenarioMenu s={s} loads={!!loads.get(s.name)} scenarios={scenarios} onClose={() => setMenu(null)} />}
        </Chip>
      ))}
      <span className="scenario">
        <button
          className="btn small"
          aria-expanded={saving}
          title={open?.edited ? `Save the changes over ${open.name}, or as a new scenario (Ctrl+S saves over)` : "Save what's on screen as a scenario (Ctrl+S)"}
          onClick={() => setSaving(!saving)}
        >
          Save
        </button>
        {saving && (
          <Popover label="Save scenario" onClose={() => setSaving(false)}>
            <NameForm
              initial={open?.edited ? open.name : freeName(shelf, suggestedName(state))}
              action={(n) => (shelf.saved.some((s) => s.name === n) ? "Save over" : "Save")}
              onSubmit={(n) => {
                scenarios.save(n);
                setSaving(false);
              }}
            />
          </Popover>
        )}
      </span>
      {shelf.saved.length > 0 && (
        <button
          className="btn small"
          aria-pressed={scenarios.comparing}
          disabled={!others && !scenarios.comparing}
          title={others ? "Compare what's on screen with the other scenarios" : "Save another scenario to compare with"}
          onClick={() => scenarios.setComparing(!scenarios.comparing)}
        >
          Compare
        </button>
      )}
    </div>
  );
}
