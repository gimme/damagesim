// UI state ⇄ engine Scenario, plus the scenario's address, which is what a link to it is (the page's
// own address, so the address bar is how a scenario is shared): the champion in the path and the rest
// of the state as a code in the hash. localStorage keeps the address for a reload where the page can't
// write its own (the artifact frame). It takes the game data as an argument, so Node reads them too.

import type { GameData } from "../engine/gamedata.ts";
import type { Scenario, SimSettings, TargetSpec } from "../engine/sim.ts";
import type { TargetPreset } from "../engine/presets.ts";
import { pageRunes, type RunePage } from "../engine/rune-page.ts";

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
  items: (number | null)[];
  runes: RunePage;
  options: Record<string, number>;
  combo: string;
  target: TargetState;
  settings: Required<Pick<SimSettings, "finishDots" | "executes">>;
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
  settings: { finishDots: true, executes: true },
};

export function toScenario(data: GameData, s: UIState): Scenario {
  return {
    champion: s.champion,
    level: s.level,
    ...(s.ranks ? { ranks: s.ranks } : {}),
    skillOrder: s.skillOrder,
    items: s.items.filter((x): x is number => x != null),
    runes: pageRunes(data, s.runes),
    options: s.options,
    combo: s.combo,
    target: toTargetSpec(s.target),
    settings: s.settings,
  };
}

export function toTargetSpec(t: TargetState): TargetSpec {
  const hp = { hpPercent: t.hpPercent, damageReduction: t.damageReduction };
  if (t.mode === "champion") return { champion: t.champion, levelDiff: t.levelDiff, items: t.items, ...hp };
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
  return { preset: t.mode, levelDiff: t.levelDiff, ...(build ? { items: build.filter((x): x is number => x != null) } : {}), ...hp };
}

// A setup's code: the state but its champion. After a version byte, a varint whose bits say which
// fields differ from DEFAULT_STATE, then those fields in FIELDS' order: numbers as varints, items and
// runes by id, the target champion by key, the combo's usual steps a byte each; nothing at all where
// none differs. It's written in base 62, so it's letters and digits only. A change to the defaults
// changes what a code means; a change to the layout takes a new version, and a code of another
// version doesn't load.

const VERSION = 2;
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
const STEPS = ["P", "Q", "W", "E", "R", "AA", "AA!", "AA?", "ignite", "wait"];

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

/** The six slots, up to the last item. */
const build: Codec<(number | null)[]> = {
  put: (o, xs) => slots.put(o, xs.slice(0, xs.findLastIndex((x) => x != null) + 1)),
  get: (i) => {
    const xs = slots.get(i);
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

const STORAGE_KEY = "damagesim:state";

export function loadSavedState(data: GameData): UIState | null {
  try {
    return decodeState(data, localStorage.getItem(STORAGE_KEY) ?? "");
  } catch {
    return null;
  }
}

export function saveState(data: GameData, s: UIState): void {
  try {
    localStorage.setItem(STORAGE_KEY, encodeState(data, s));
  } catch {
    // storage unavailable
  }
}
