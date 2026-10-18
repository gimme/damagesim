// Saved scenarios: named setups to come back to and to compare, each its champion and its setup's
// code (see encodeSetup), kept in localStorage. Switching between them loses nothing: the one open
// keeps its changes until they're saved over it or reverted, and they stay with it while another is
// open; work that isn't saved, left for a saved scenario, is kept as the unsaved one. Each change on
// screen goes to the champion's memory as before (see pickChampion), so opening a scenario is as
// opening its link. Nothing here reads the game data: the codes come and go as they are.

/** A champion and its setup's code: a scenario as it's kept. */
export interface Setup {
  champion: string;
  code: string;
}

export interface Saved extends Setup {
  name: string;
  /** Its changes since it was saved, while it has any. */
  edited?: Setup;
}

export interface Shelf {
  saved: Saved[];
  /** The saved scenario on screen, by name; null when it's the unsaved one. */
  open: string | null;
  /** The work that isn't saved, while a saved scenario is open in its place. */
  unsaved: Setup | null;
}

export const EMPTY_SHELF: Shelf = { saved: [], open: null, unsaved: null };

export const sameSetup = (a: Setup | null | undefined, b: Setup | null | undefined) => !!a && !!b && a.champion === b.champion && a.code === b.code;

const setup = ({ champion, code }: Setup): Setup => ({ champion, code });

/** A saved scenario as it is now: with its changes. */
export const current = (s: Saved): Setup => s.edited ?? setup(s);

/** The screen changed: into the open scenario's changes, none when it's back as saved. */
export function track(shelf: Shelf, screen: Setup): Shelf {
  const open = shelf.saved.find((s) => s.name === shelf.open);
  if (!open || sameSetup(current(open), screen)) return shelf;
  const { edited: _, ...was } = open;
  const next: Saved = sameSetup(open, screen) ? was : { ...was, edited: setup(screen) };
  return { ...shelf, saved: shelf.saved.map((s) => (s === open ? next : s)) };
}

/**
 * The shelf with `name` open (null: the unsaved one), and what goes on screen. Unsaved work left for
 * a saved scenario is kept, unless a saved one has it as it is.
 */
export function openScenario(shelf: Shelf, name: string | null, screen: Setup): { shelf: Shelf; screen: Setup } {
  if (name === shelf.open) return { shelf, screen };
  const kept = shelf.open === null && !shelf.saved.some((s) => sameSetup(current(s), screen)) ? setup(screen) : shelf.unsaved;
  if (name === null) return shelf.unsaved ? { shelf: { ...shelf, open: null, unsaved: null }, screen: shelf.unsaved } : { shelf, screen };
  const to = shelf.saved.find((s) => s.name === name);
  if (!to) return { shelf, screen };
  return { shelf: { ...shelf, open: name, unsaved: kept }, screen: current(to) };
}

/**
 * The screen saved as `name`, over the scenario of that name if there is one, and open. The open
 * scenario's changes, saved under another name, are no longer its own.
 */
export function saveScenario(shelf: Shelf, name: string, screen: Setup): Shelf {
  const saved = shelf.saved.map((s): Saved => {
    if (s.name === name) return { name, ...setup(screen) };
    const { edited: _, ...was } = s;
    return s.name === shelf.open ? was : s;
  });
  return { ...shelf, saved: saved.some((s) => s.name === name) ? saved : [...saved, { name, ...setup(screen) }], open: name };
}

export function renameScenario(shelf: Shelf, from: string, to: string): Shelf {
  if (from === to || shelf.saved.some((s) => s.name === to)) return shelf;
  return { ...shelf, saved: shelf.saved.map((s) => (s.name === from ? { ...s, name: to } : s)), open: shelf.open === from ? to : shelf.open };
}

/** The open scenario as saved, its changes gone. */
export function revertScenario(shelf: Shelf): { shelf: Shelf; screen: Setup | null } {
  const open = shelf.saved.find((s) => s.name === shelf.open);
  if (!open) return { shelf, screen: null };
  const { edited: _, ...was } = open;
  return { shelf: { ...shelf, saved: shelf.saved.map((s) => (s === open ? was : s)) }, screen: setup(was) };
}

/**
 * The shelf without `name`. Deleting the open one leaves what's on screen as the unsaved work, or
 * where there's unsaved work kept, opens it.
 */
export function deleteScenario(shelf: Shelf, name: string): { shelf: Shelf; screen: Setup | null } {
  const saved = shelf.saved.filter((s) => s.name !== name);
  if (shelf.open !== name) return { shelf: { ...shelf, saved }, screen: null };
  return { shelf: { saved, open: null, unsaved: null }, screen: shelf.unsaved };
}

/** The unsaved work kept, dropped. */
export const discardUnsaved = (shelf: Shelf): Shelf => (shelf.open === null ? shelf : { ...shelf, unsaved: null });

/**
 * The shelf for a page that opens at `screen`: the scenario open before if it's still as on screen (a
 * reload), else one that is; none for a link to something else, which is then the unsaved work.
 */
export function reconcile(shelf: Shelf, screen: Setup): Shelf {
  const open = shelf.saved.find((s) => s.name === shelf.open);
  if (open && sameSetup(current(open), screen)) return shelf;
  const now = shelf.saved.find((s) => sameSetup(current(s), screen));
  if (now) return { ...shelf, open: now.name, unsaved: open ? shelf.unsaved : null };
  return open ? { ...shelf, open: null, unsaved: null } : shelf;
}

/** A name for the screen's setup not yet taken: `base`, or `base 2`, `base 3`… */
export function freeName(shelf: Shelf, base: string): string {
  const taken = new Set(shelf.saved.map((s) => s.name));
  for (let n = 1; ; n++) if (!taken.has(n === 1 ? base : `${base} ${n}`)) return n === 1 ? base : `${base} ${n}`;
}

const isSetup = (x: any): boolean => !!x && typeof x.champion === "string" && typeof x.code === "string";

/** A shelf as stored, or the empty one where it isn't one. */
export function readShelf(text: string | null): Shelf {
  try {
    const x = JSON.parse(text ?? "null");
    const saved: Saved[] = [];
    for (const s of Array.isArray(x?.saved) ? x.saved : [])
      if (isSetup(s) && typeof s.name === "string" && s.name.trim() && !saved.some((t) => t.name === s.name))
        saved.push({ name: s.name, ...setup(s), ...(isSetup(s.edited) ? { edited: setup(s.edited) } : {}) });
    const open = saved.some((s) => s.name === x?.open) ? (x.open as string) : null;
    return { saved, open, unsaved: open !== null && isSetup(x?.unsaved) ? setup(x.unsaved) : null };
  } catch {
    return EMPTY_SHELF;
  }
}
