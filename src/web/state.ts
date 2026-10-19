// UI state ⇄ engine Scenario, plus the scenario's address, which is what a link to it is (the page's
// own address, so the address bar is how a scenario is shared): the champion in the path and the rest
// of the state as a code in the hash, with the page's builds after it where it has more than one.
// localStorage keeps the address too, for the app opened at its root, and each champion's page as you
// left it, for when it's picked again. It takes the game data as an argument, so Node reads them too.

import type { GameData } from "../engine/gamedata.ts";
import type { Scenario, SimSettings, TargetSpec } from "../engine/sim.ts";
import type { TargetPreset } from "../engine/presets.ts";
import { pageRunes, type RunePage } from "../engine/rune-page.ts";
import { fitCombo, formatCombo, parseCombo } from "../engine/combo.ts";
import { getKit } from "../kits/index.ts";
import { nameAt, single, withBuild, type Build, type Page } from "./tabs.ts";

/** Health, armor and magic resist. */
export interface TargetStats {
  hp: number;
  armor: number;
  mr: number;
}

/** Who you hit: a preset whose stats follow its level, a champion with items, or custom numbers. */
export type TargetMode = TargetPreset | "champion" | "custom";

export const TARGET_MODES: TargetMode[] = ["squishy", "bruiser", "tank", "champion", "custom"];

export interface TargetState {
  mode: TargetMode;
  /** Target level minus your level (presets and champions). */
  levelDiff: number;
  /**
   * A preset's items in place of its typical build for the target's level, per preset (absent =
   * the typical build). null = an item without health or resists, kept so the slots read as a build.
   */
  builds: Partial<Record<TargetPreset, (number | null)[]>>;
  champion: string;
  /** The champion's items. */
  items: number[];
  /** Custom numbers: total = base + bonus. */
  base: TargetStats;
  bonus: TargetStats;
  hpPercent: number;
  damageReduction: number;
}

export interface UIState {
  champion: string;
  level: number;
  /** null = default leveling. */
  ranks: { Q: number; W: number; E: number; R: number } | null;
  skillOrder: string;
  /** The build's six slots, and a seventh for boots (BOOTS_SLOT) once the bot lane role quest is done. */
  items: (number | null)[];
  runes: RunePage;
  options: Record<string, number>;
  combo: string;
  target: TargetState;
  /** The simulator's, and questBoots: whether the shop and Item value offer the mid lane role quest's tier 3 boots. */
  settings: Required<Pick<SimSettings, "finishDots" | "executes">> & { questBoots: boolean };
  /** Items left out of Item value's ranking. */
  excluded: number[];
  /** How many items Item value ranks for the build: 1, the next item (or one in place of a slot's), or the best sets of this many to buy together for its empty slots. */
  next: number;
}

/** How a card changes the state: from the state as it is. */
export type Set = (fn: (s: UIState) => UIState) => void;

export const DEFAULT_STATE: UIState = {
  champion: "Ahri",
  level: 11,
  ranks: null,
  skillOrder: "QWE",
  items: [6655, 3020, null, null, null, null],
  // Electrocute, Cheap Shot, Grisly Mementos, Ultimate Hunter; Absolute Focus, Scorch.
  runes: { primary: "Domination", secondary: "Sorcery", picks: [8112, 8126, 8140, 8106, 8233, 8237], held: [], shards: [5008, 5008, 5001] },
  options: {},
  combo: "E Q W R AA R",
  target: {
    mode: "squishy",
    levelDiff: 0,
    builds: {},
    champion: "Jinx",
    items: [3031],
    base: { hp: 1600, armor: 60, mr: 40 },
    bonus: { hp: 400, armor: 20, mr: 10 },
    hpPercent: 100,
    damageReduction: 0,
  },
  settings: { finishDots: true, executes: true, questBoots: false },
  excluded: [],
  next: 1,
};

/** A build's items from its slots, by id: where an item sits changes nothing (the engine takes them
 *  in this order), so a build moved around is the same scenario. */
export const buildItems = (slots: (number | null)[]): number[] => slots.filter((x): x is number => x != null).sort((a, b) => a - b);

export function toScenario(data: GameData, s: UIState): Scenario {
  return {
    champion: s.champion,
    level: s.level,
    ...(s.ranks ? { ranks: s.ranks } : {}),
    skillOrder: s.skillOrder,
    items: buildItems(s.items),
    runes: pageRunes(data, s.runes),
    options: s.options,
    combo: s.combo,
    target: toTargetSpec(s.target),
    settings: { finishDots: s.settings.finishDots, executes: s.settings.executes },
  };
}

/**
 * What a scenario simulates, as a string: two with the same simulate alike, so the page simulates
 * one only once. Its combo counts by its steps where it reads, so spacing doesn't count ("AA*2 " is
 * "2AA"). Nor does what toScenario leaves out: the tier 3 boots setting, a target's numbers for
 * the modes it isn't in, runes held over from a tree switch, the items Item value leaves out and how
 * many it ranks.
 */
export function scenarioKey(sc: Scenario): string {
  let combo: Scenario["combo"] = sc.combo;
  try {
    if (typeof combo === "string") combo = parseCombo(combo);
  } catch {
    // Not a combo yet: as typed.
  }
  return JSON.stringify({ ...sc, combo });
}

export function toTargetSpec(t: TargetState): TargetSpec {
  const hp = { hpPercent: t.hpPercent, damageReduction: t.damageReduction };
  if (t.mode === "champion") return { champion: t.champion, levelDiff: t.levelDiff, items: buildItems(t.items), ...hp };
  if (t.mode === "custom")
    return {
      maxHp: t.base.hp + t.bonus.hp,
      bonusHp: t.bonus.hp,
      armor: t.base.armor + t.bonus.armor,
      bonusArmor: t.bonus.armor,
      mr: t.base.mr + t.bonus.mr,
      bonusMr: t.bonus.mr,
      ...hp,
    };
  const build = t.builds[t.mode];
  return { preset: t.mode, levelDiff: t.levelDiff, ...(build ? { items: buildItems(build) } : {}), ...hp };
}

// A setup's code: the state but its champion. After a version byte, a varint whose bits say which
// fields differ from DEFAULT_STATE, then those fields in FIELDS' order: numbers as varints, items and
// runes by id, the target champion by key, the combo's usual steps a byte each; nothing at all where
// none differs. It's written in base 62, so it's letters and digits only. A change to the defaults
// changes what a code means; a change to the layout takes a new version, and a code of another
// version doesn't load.

const VERSION = 3;
const DIGITS = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";

interface Out {
  data: GameData;
  bytes: number[];
}
interface In {
  data: GameData;
  bytes: Uint8Array;
  at: number;
}
/** How a value is written into a code and read back; reading one that can't be, or past the end, throws. */
interface Codec<T> {
  put(o: Out, v: T): void;
  get(i: In): T;
}

const fail = (why: string): never => {
  throw new Error(why);
};

const byte = (i: In) => (i.at < i.bytes.length ? i.bytes[i.at++] : fail("the code ends early"));

/** A whole number from 0 up, 7 bits a byte. */
const uint: Codec<number> = {
  put: (o, n) => {
    if (!Number.isSafeInteger(n) || n < 0) fail(`${n} isn't a whole number from 0`);
    for (; n >= 128; n = Math.floor(n / 128)) o.bytes.push((n % 128) + 128);
    o.bytes.push(n);
  },
  get: (i) => {
    let n = 0;
    for (let f = 1; f < 2 ** 49; f *= 128) {
      const b = byte(i);
      n += (b % 128) * f;
      if (b < 128) return n;
    }
    return fail("a number too long");
  },
};

const zigzag = (n: number) => (n >= 0 ? 2 * n : -2 * n - 1);
const unzigzag = (z: number) => (z % 2 ? -(z + 1) / 2 : z / 2);

/** A whole number, negative too. */
const sint: Codec<number> = {
  put: (o, n) => uint.put(o, zigzag(n)),
  get: (i) => unzigzag(uint.get(i)),
};

/** Any number: one with up to 6 decimals as its digits and how many are decimals (0.2: 2 and 1), else the 8 bytes of a double. */
const num: Codec<number> = {
  put: (o, v) => {
    for (let e = 0; e < 7; e++) {
      const m = Math.round(v * 10 ** e);
      if (Math.abs(m) < 2 ** 40 && m / 10 ** e === v) return uint.put(o, zigzag(m) * 8 + e);
    }
    uint.put(o, 7);
    const b = new DataView(new ArrayBuffer(8));
    b.setFloat64(0, v);
    for (let k = 0; k < 8; k++) o.bytes.push(b.getUint8(k));
  },
  get: (i) => {
    const x = uint.get(i);
    if (x % 8 < 7) return unzigzag(Math.floor(x / 8)) / 10 ** (x % 8);
    const b = new DataView(new ArrayBuffer(8));
    for (let k = 0; k < 8; k++) b.setUint8(k, byte(i));
    return b.getFloat64(0);
  },
};

const bool: Codec<boolean> = {
  put: (o, b) => uint.put(o, b ? 1 : 0),
  get: (i) => uint.get(i) === 1,
};

/** Text, as its length and UTF-8. */
const str: Codec<string> = {
  put: (o, s) => {
    const b = new TextEncoder().encode(s);
    uint.put(o, b.length);
    o.bytes.push(...b);
  },
  get: (i) => {
    const n = uint.get(i);
    const end = i.at + n;
    if (end > i.bytes.length) fail("the code ends early");
    const s = new TextDecoder("utf-8", { fatal: true }).decode(i.bytes.subarray(i.at, end));
    i.at = end;
    return s;
  },
};

const list = <T>(c: Codec<T>): Codec<T[]> => ({
  put: (o, xs) => {
    uint.put(o, xs.length);
    for (const x of xs) c.put(o, x);
  },
  get: (i) => {
    const n = uint.get(i);
    // Each takes a byte at least: a longer list is a broken code, not one to make.
    if (n > i.bytes.length - i.at) fail("a list longer than the code");
    return Array.from({ length: n }, () => c.get(i));
  },
});

const record = <K extends string, V>(k: Codec<K>, v: Codec<V>): Codec<Partial<Record<K, V>>> => {
  const pairs = list<[K, V]>({ put: (o, [a, b]) => (k.put(o, a), v.put(o, b)), get: (i) => [k.get(i), v.get(i)] });
  return { put: (o, r) => pairs.put(o, Object.entries(r) as [K, V][]), get: (i) => Object.fromEntries(pairs.get(i)) as Partial<Record<K, V>> };
};

/** One of a few values, by its place among them. */
const oneOf = <T>(values: readonly T[]): Codec<T> => ({
  put: (o, v) => uint.put(o, values.indexOf(v)),
  get: (i) => values[uint.get(i)] ?? fail("not one of the values"),
});

/** A whole number from `min` to `max`. */
const within = (min: number, max: number): Codec<number> => ({
  put: uint.put,
  get: (i) => {
    const n = uint.get(i);
    return n >= min && n <= max ? n : fail(`${n} isn't from ${min} to ${max}`);
  },
});

/** A champion by its key (Ahri's is 103): the target's. */
const champion: Codec<string> = {
  put: (o, id) => uint.put(o, o.data.championIndex.find((c) => c.id === id)?.key ?? fail(`no champion ${id}`)),
  get: (i) => {
    const key = uint.get(i);
    return i.data.championIndex.find((c) => c.key === key)?.id ?? fail(`no champion with the key ${key}`);
  },
};

/** A rune tree by its place in the client's order. */
const tree: Codec<string> = {
  put: (o, key) =>
    uint.put(
      o,
      o.data.runePage.trees.findIndex((t) => t.key === key),
    ),
  get: (i) => i.data.runePage.trees[uint.get(i)]?.key ?? fail("no such rune tree"),
};

/** Stat shards, numbered from 5001: as the difference from 5000, a byte each. */
const shards: Codec<number[]> = {
  put: (o, xs) =>
    list(sint).put(
      o,
      xs.map((x) => x - 5000),
    ),
  get: (i) =>
    list(sint)
      .get(i)
      .map((x) => x + 5000),
};

/** The steps the shorthand has most, a byte each. */
const STEPS = ["P", "Q", "W", "E", "R", "AA", "AA!", "AA?", "ignite", "energize", "wait"];

/** A step: one of STEPS by its place, or after a byte past them, its text. */
const step: Codec<string> = {
  put: (o, t) => (STEPS.includes(t) ? uint.put(o, STEPS.indexOf(t)) : (uint.put(o, STEPS.length), str.put(o, t))),
  get: (i) => {
    const k = uint.get(i);
    return k < STEPS.length ? STEPS[k] : k === STEPS.length ? str.get(i) : fail("not a step");
  },
};

/** The combo as typed, by what's between single spaces. */
const combo: Codec<string> = {
  put: (o, s) => list(step).put(o, s.split(" ")),
  get: (i) => list(step).get(i).join(" "),
};

/** Item slots, 0 for an empty one; an item the data doesn't know (one since removed) reads as empty. */
const slots: Codec<(number | null)[]> = {
  put: (o, xs) =>
    list(uint).put(
      o,
      xs.map((x) => x ?? 0),
    ),
  get: (i) =>
    list(uint)
      .get(i)
      .map((id) => (i.data.items[id] ? id : null)),
};

/** The six slots, up to the last item; with the bot lane role quest's seventh, all seven, so it comes back empty too. */
const build: Codec<(number | null)[]> = {
  put: (o, xs) => slots.put(o, xs.length > DEFAULT_STATE.items.length ? xs : xs.slice(0, xs.findLastIndex((x) => x != null) + 1)),
  get: (i) => {
    const xs = slots.get(i);
    if (xs.length > DEFAULT_STATE.items.length + 1) fail("more than seven slots");
    return [...xs, ...Array<null>(Math.max(0, DEFAULT_STATE.items.length - xs.length)).fill(null)];
  },
};

/** Item or rune ids; one the data doesn't know is left out. */
const known = (has: (data: GameData, id: number) => boolean): Codec<number[]> => ({
  put: list(uint).put,
  get: (i) =>
    list(uint)
      .get(i)
      .filter((id) => has(i.data, id)),
});
const itemIds = known((data, id) => !!data.items[id]);
const runeIds = known((data, id) => data.runes.some((r) => r.id === id));

const stats: Codec<TargetStats> = {
  put: (o, s) => [s.hp, s.armor, s.mr].forEach((v) => num.put(o, v)),
  get: (i) => ({ hp: num.get(i), armor: num.get(i), mr: num.get(i) }),
};

/** Q, W, E and R, or nothing for the default leveling. */
const ranks: Codec<UIState["ranks"]> = {
  put: (o, r) => list(uint).put(o, r ? [r.Q, r.W, r.E, r.R] : []),
  get: (i) => {
    const r = list(uint).get(i);
    return r.length === 4 ? { Q: r[0], W: r[1], E: r[2], R: r[3] } : r.length ? fail("not four ranks") : null;
  },
};

/** What a code can hold, each by its bit: the likelier to differ from the defaults first, so the bits take fewer bytes. */
const FIELDS: [path: string, codec: Codec<any>][] = [
  ["level", within(1, 20)],
  ["items", build],
  ["combo", combo],
  ["runes.primary", tree],
  ["runes.secondary", tree],
  ["runes.picks", runeIds],
  ["runes.shards", shards],
  ["target.mode", oneOf(TARGET_MODES)],
  ["target.champion", champion],
  ["target.items", itemIds],
  ["target.levelDiff", sint],
  ["target.builds", record(oneOf(TARGET_MODES), slots)],
  ["target.hpPercent", num],
  ["target.damageReduction", num],
  ["target.base", stats],
  ["target.bonus", stats],
  ["skillOrder", str],
  ["ranks", ranks],
  ["options", record(str, num)],
  ["runes.held", runeIds],
  ["settings.finishDots", bool],
  ["settings.executes", bool],
  ["settings.questBoots", bool],
  ["excluded", itemIds],
  ["next", within(1, DEFAULT_STATE.items.length + 1)],
];

const valueAt = (s: any, path: string) => path.split(".").reduce((x, k) => x[k], s);
const withValueAt = (s: any, [k, ...rest]: string[], v: unknown): any => ({ ...s, [k]: rest.length ? withValueAt(s[k], rest, v) : v });

function toBase62(bytes: number[]): string {
  let n = bytes.reduce((n, b) => n * 256n + BigInt(b), 0n);
  let s = "";
  for (; n > 0n; n /= 62n) s = DIGITS[Number(n % 62n)] + s;
  return s;
}

function fromBase62(code: string): Uint8Array | null {
  let n = 0n;
  for (const ch of code) {
    const d = DIGITS.indexOf(ch);
    if (d < 0) return null;
    n = n * 62n + BigInt(d);
  }
  const bytes: number[] = [];
  for (; n > 0n; n /= 256n) bytes.unshift(Number(n % 256n));
  return Uint8Array.from(bytes);
}

/** The code of a state's setup, all but its champion: "" if it's the default one. */
export function encodeSetup(data: GameData, s: UIState): string {
  const differs = FIELDS.map(([path]) => JSON.stringify(valueAt(s, path)) !== JSON.stringify(valueAt(DEFAULT_STATE, path)));
  if (!differs.includes(true)) return "";
  const o: Out = { data, bytes: [VERSION] };
  uint.put(
    o,
    differs.reduce((mask, d, bit) => mask + (d ? 2 ** bit : 0), 0),
  );
  FIELDS.forEach(([path, codec], bit) => differs[bit] && codec.put(o, valueAt(s, path)));
  return toBase62(o.bytes);
}

/** A champion with the setup in a code ("" for the default one), or null if the code holds none. */
export function decodeSetup(data: GameData, champion: string, code: string): UIState | null {
  if (!data.championIndex.some((c) => c.id === champion)) return null;
  if (code === "") return { ...DEFAULT_STATE, champion };
  try {
    const bytes = fromBase62(code);
    if (bytes?.[0] !== VERSION) return null;
    const i: In = { data, bytes, at: 1 };
    const mask = uint.get(i);
    if (mask >= 2 ** FIELDS.length) return null;
    let s: UIState = { ...DEFAULT_STATE, champion };
    FIELDS.forEach(([path, codec], bit) => {
      if (Math.floor(mask / 2 ** bit) % 2) s = withValueAt(s, path.split("."), codec.get(i));
    });
    return i.at === bytes.length ? s : null;
  } catch {
    return null;
  }
}

/** A champion's name as a path: "zed", "miss-fortune", "kaisa", "nunu-willump". */
export function championSlug(data: GameData, champion: string): string {
  const name = data.championIndex.find((c) => c.id === champion)?.name ?? fail(`no champion ${champion}`);
  return name
    .toLowerCase()
    .replace(/['.]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

/** The champion a path names, by its name or its key in any case and with or without what's between words ("missfortune", "MonkeyKing"). */
function championBySlug(data: GameData, slug: string): string {
  const bare = (t: string) => t.toLowerCase().replace(/[^a-z0-9]/g, "");
  return data.championIndex.find((c) => bare(c.name) === bare(slug) || bare(c.id) === bare(slug))?.id ?? fail(`no champion ${slug}`);
}

/** The state's address after the app's own: its champion's path, then its setup's code as the hash if it isn't the default one ("zed/#5h2Kq…"). */
export function encodeState(data: GameData, s: UIState): string {
  const code = encodeSetup(data, s);
  return `${championSlug(data, s.champion)}/${code ? "#" + code : ""}`;
}

/** The state at an address after the app's own ("zed/#5h2Kq…", "/zed", "zed/"), or null if it isn't a scenario's. */
export function decodeState(data: GameData, address: string): UIState | null {
  try {
    const [, slug, hash = ""] = /^\/?([^/#]+)\/?(?:#(.*))?$/.exec(address.trim()) ?? fail("not a champion's path");
    return decodeSetup(data, championBySlug(data, decodeURIComponent(slug)), hash);
  } catch {
    return null;
  }
}

/** A build's name in an address: as a URI component, its spaces as "_", and escaped what the address's own parts are written with ("Build 2" is "Build_2"). */
const nameCode = (name: string) =>
  encodeURIComponent(name)
    .replace(/[.~!*'()_]/g, (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase())
    .replace(/%20/g, "_");
function nameOf(code: string): string | null {
  try {
    return decodeURIComponent(code.replace(/_/g, " ")).trim() || null;
  } catch {
    return null;
  }
}

/** The build fields of a state: what the address has of a build, and not of what its builds share. */
const ofBuild = (s: UIState, combo: boolean) => ({ items: s.items, runes: s.runes, next: s.next, ...(combo ? { combo: s.combo } : {}) });

/**
 * A page's address after the app's own: its first build's, with what they share, as if it were alone
 * (see encodeState), then each other build in its order, its code, the one on screen's after "*"
 * unless it's the first; then "!combos" where each has its own combo and "!folded" where the
 * comparison is folded away. A build's name follows its code (see nameCode) where it isn't the one
 * its place has by default (nameAt), and where a build after the first has no code, being the default
 * build: so no part is empty, and the address never ends in "~" or "*", which a link found in text
 * often loses. "ahri/#5h2Kq~*3fGh~9aB.Burst~.Build_4!combos".
 */
export function encodePage(data: GameData, s: UIState, page: Page): string {
  if (page.builds.length < 2) return encodeState(data, s);
  const builds = page.builds.map((b, i) => {
    const own = i === page.active ? s : withBuild(s, page, i);
    const code = i === 0 ? encodeSetup(data, own) : encodeSetup(data, { ...DEFAULT_STATE, champion: s.champion, ...ofBuild(own, page.ownCombos) });
    const named = b.name !== nameAt(i) || (i > 0 && !code);
    return `${i > 0 && i === page.active ? "*" : ""}${code}${named ? `.${nameCode(b.name)}` : ""}`;
  });
  const flags = `${page.ownCombos ? "!combos" : ""}${page.folded ? "!folded" : ""}`;
  return `${championSlug(data, s.champion)}/#${builds.join("~")}${flags}`;
}

/** The page at an address after the app's own, with its state on screen, or null if it isn't a page's; a build after the first that doesn't load is left out. */
export function decodePage(data: GameData, address: string): { state: UIState; page: Page } | null {
  try {
    const [, slug, hash = ""] = /^\/?([^/#]+)\/?(?:#(.*))?$/.exec(address.trim()) ?? fail("not a champion's path");
    const champion = championBySlug(data, decodeURIComponent(slug));
    const [list, ...flags] = hash.split("!");
    const [head, ...tabs] = list.split("~");
    const [, code, name] = /^([^.]*)(?:\.(.*))?$/.exec(head)!;
    const base = decodeSetup(data, champion, code);
    if (!base) return null;
    if (!tabs.length) return { state: base, page: single(base) };
    // A build without a name has its place's in the address, kept where one before it doesn't load.
    const builds: Build[] = [{ id: 1, name: (name && nameOf(name)) || nameAt(0), items: base.items, runes: base.runes, combo: base.combo, next: base.next }];
    let active = 0;
    tabs.forEach((tab, k) => {
      const [, on, own, name] = /^(\*?)([^.]*)(?:\.(.*))?$/.exec(tab) ?? [];
      const b = own != null ? decodeSetup(data, champion, own) : null;
      if (!b) return;
      if (on) active = builds.length;
      builds.push({ id: builds.length + 1, name: (name && nameOf(name)) || nameAt(k + 1), items: b.items, runes: b.runes, combo: b.combo, next: b.next });
    });
    const many = builds.length > 1;
    const page: Page = { champion, builds, active, ownCombos: many && flags.includes("combos"), folded: many && flags.includes("folded") };
    return { state: withBuild(base, page, active), page };
  } catch {
    return null;
  }
}

const STORAGE_KEY = "damagesim:state";

/** The page whose address was kept last (see saveState). */
export function loadSavedPage(data: GameData): { state: UIState; page: Page } | null {
  try {
    return decodePage(data, localStorage.getItem(STORAGE_KEY) ?? "");
  } catch {
    return null;
  }
}

/** Keeps the page's address after the app's own (see encodePage) for a reload, and for its champion, for when it's picked again (see pickChampion). */
export function saveState(s: UIState, address: string): void {
  const all = remembered();
  // Remembered first, so that where storage is unavailable it is for the session.
  const changed = all[s.champion] !== address;
  all[s.champion] = address;
  try {
    localStorage.setItem(STORAGE_KEY, address);
    if (changed) localStorage.setItem(MEMORY_KEY, JSON.stringify(all));
  } catch {
    // storage unavailable: remembered for the session
  }
}

const MEMORY_KEY = "damagesim:champions";

/** Each champion's page as you left it, its address by champion; in localStorage, for the session only where it's unavailable. */
let memory: Record<string, string> | null = null;

function remembered(): Record<string, string> {
  if (!memory) {
    try {
      const saved = JSON.parse(localStorage.getItem(MEMORY_KEY) ?? "{}");
      memory = saved && typeof saved === "object" && !Array.isArray(saved) ? saved : {};
    } catch {
      memory = {};
    }
  }
  return memory!;
}

/** Champion `id`'s page as you left it, if it had one. */
export function recallPage(data: GameData, id: string): { state: UIState; page: Page } | null {
  const address = remembered()[id];
  const back = typeof address === "string" ? decodePage(data, address) : null;
  return back?.state.champion === id ? back : null;
}

/**
 * The state with champion `id` picked: the one on screen `id`'s page had when you left it (see
 * recallPage); or, for a champion not had before, the one on screen with the combo as its kit takes
 * it (see fitCombo), default leveling and without the last champion's own parameters.
 */
export function pickChampion(data: GameData, s: UIState, id: string): UIState {
  if (id === s.champion) return s;
  const back = recallPage(data, id);
  if (back) return back.state;
  const own = new Set((getKit(data.champions[s.champion]).options ?? []).map((o) => o.key));
  const options = Object.fromEntries(Object.entries(s.options).filter(([k]) => !own.has(k)));
  return { ...s, champion: id, ranks: null, options, combo: fitShorthand(data, s.combo, id) };
}

/** A rune page with nothing picked, in a fresh page's trees. */
const EMPTY_PAGE: RunePage = { ...DEFAULT_STATE.runes, picks: [], held: [], shards: [] };

/** What Reset leaves, which its champion then remembers: it with no items, runes or combo, the rest as on a fresh page. */
export function resetState(s: UIState): UIState {
  return { ...DEFAULT_STATE, champion: s.champion, items: DEFAULT_STATE.items.map(() => null), runes: EMPTY_PAGE, combo: "" };
}

/** A combo's shorthand as `champion` takes it (see fitCombo); unchanged when it doesn't parse. */
function fitShorthand(data: GameData, combo: string, champion: string) {
  try {
    return formatCombo(fitCombo(parseCombo(combo), getKit(data.champions[champion])));
  } catch {
    return combo;
  }
}
