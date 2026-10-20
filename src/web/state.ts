// UI state ⇄ engine Scenario, plus the page's address, which is what a link to it is (the page's own
// address, so the address bar is how a scenario is shared): the champion in the path and the rest as
// codes in the hash, a build each and one for what the builds share. It takes the game data as an
// argument, so Node reads them too.

import type { GameData } from "../engine/gamedata.ts";
import type { Scenario, SimSettings, TargetSpec } from "../engine/sim.ts";
import type { TargetPreset } from "../engine/presets.ts";
import { pageRunes, settledPage, type RunePage } from "../engine/rune-page.ts";
import { fitCombo, formatCombo, parseCombo } from "../engine/combo.ts";
import { defaultCandidates, upgradeRoom } from "../engine/analysis.ts";
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

interface TargetCommon {
  hpPercent: number;
  damageReduction: number;
}

/** The target as it's set: what its mode takes, and nothing of the other modes'. */
export type TargetState =
  | ({
      mode: TargetPreset;
      /** Target level minus your level. */
      levelDiff: number;
      /**
       * Items in place of the typical build for the target's level (absent: the typical build).
       * null = an item without health or resists, kept so the slots read as a build.
       */
      build?: (number | null)[];
    } & TargetCommon)
  | ({ mode: "champion"; levelDiff: number; champion: string; items: number[] } & TargetCommon)
  | ({ mode: "custom"; base: TargetStats; bonus: TargetStats } & TargetCommon);

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
  settings: Required<Pick<SimSettings, "finishDots" | "executes">> & { questBoots: boolean; components: boolean };
  /** Items left out of Item value's ranking. */
  excluded: number[];
  /** How many items Item value ranks for the build: 1, the next item (or one in place of a slot's), or the best sets of this many to buy together for its empty slots and in place of its items to upgrade (room). */
  next: number;
  /** The build's item Item value ranks what could take the place of; null, the next item (for an empty slot, or in place of a full build's last). A count above one picks none: sets are for the empty slots and the items to upgrade. */
  replace: number | null;
}

/** How a card changes the state: from the state as it is. */
export type Set = (fn: (s: UIState) => UIState) => void;

/** What Reset leaves, and a code holds where it says nothing: no items, runes or combo, the rest plain. The empty address. */
export const RESET_STATE: UIState = {
  champion: "Ahri",
  level: 11,
  ranks: null,
  skillOrder: "QWE",
  items: [null, null, null, null, null, null],
  runes: { primary: "Precision", secondary: "Domination", picks: [], shards: [null, null, null] },
  options: {},
  combo: "",
  target: { mode: "squishy", levelDiff: 0, hpPercent: 100, damageReduction: 0 },
  settings: { finishDots: true, executes: true, questBoots: false, components: false },
  excluded: [],
  next: 1,
  replace: null,
};

/** The page a first visit shows, so there's something in action: Ahri with a build, a page of runes and a combo. A state like any other. */
export const DEMO_STATE: UIState = {
  ...RESET_STATE,
  items: [6655, 3020, null, null, null, null],
  // Electrocute, Cheap Shot, Grisly Mementos, Ultimate Hunter; Absolute Focus, Scorch.
  runes: { primary: "Domination", secondary: "Sorcery", picks: [8106, 8112, 8126, 8140, 8233, 8237], shards: [5008, 5008, 5001] },
  combo: "E Q W R AA R",
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
 * "2AA"). Nor does what toScenario leaves out: the tier 3 boots and components settings, the items
 * Item value leaves out, how many it ranks and the item it ranks in place of.
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
  return { preset: t.mode, levelDiff: t.levelDiff, ...(t.build ? { items: buildItems(t.build) } : {}), ...hp };
}

// A code is a run of tagged fields (see fields) in base 62, letters and digits only: a build's
// (its items, runes, Item value's count and pick, and its combo where each build has its own) or
// the page's shared part's (the champion, level, ranks, parameters, the combo they share, target,
// settings, the items Item value leaves out, and whether the Result card compares the builds). Every
// field is written, so a code says all it means; only the reset page writes none. A reader passes
// over a field it doesn't know and fills in one that isn't there, so a link outlives a change to the
// fields; a field's number is its for good, and one whose meaning changes takes a new number.

const DIGITS = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";

interface Out {
  data: GameData;
  bytes: number[];
}
interface In {
  data: GameData;
  bytes: Uint8Array;
  at: number;
  end: number;
}
/**
 * How a value is written into a code and read back: as a varint (kind 0) or as a run of bytes (kind
 * 1), which a field or a list frames with its length (putValue). Reading one that can't be, or past
 * the end, throws.
 */
interface Codec<T> {
  kind: 0 | 1;
  put(o: Out, v: T): void;
  get(i: In): T;
}

const fail = (why: string): never => {
  throw new Error(why);
};

const byte = (i: In) => (i.at < i.end ? i.bytes[i.at++] : fail("the code ends early"));

/** A whole number from 0 up, 7 bits a byte. */
const uint: Codec<number> = {
  kind: 0,
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
  kind: 0,
  put: (o, n) => uint.put(o, zigzag(n)),
  get: (i) => unzigzag(uint.get(i)),
};

/**
 * A number as its digits, up to 44 bits of them, and how many are decimals (0.2: 2 and 1), to 6, the
 * rest rounded; one too large for them as its first digits, 7 and how many zeros follow (1e20: 1e13,
 * 7 and 7).
 */
const num: Codec<number> = {
  kind: 0,
  put: (o, v) => {
    if (!Number.isFinite(v)) fail(`${v} isn't a number`);
    const fit = (m: number) => Math.abs(m) < 2 ** 44;
    let e = 0;
    while (e < 6 && Math.round(v * 10 ** e) / 10 ** e !== v && fit(Math.round(v * 10 ** (e + 1)))) e++;
    if (fit(Math.round(v * 10 ** e))) return uint.put(o, zigzag(Math.round(v * 10 ** e)) * 8 + e);
    let zeros = 1;
    while (!fit(Math.round(v / 10 ** zeros))) zeros++;
    uint.put(o, zigzag(Math.round(v / 10 ** zeros)) * 8 + 7);
    uint.put(o, zeros);
  },
  get: (i) => {
    const x = uint.get(i);
    const m = unzigzag(Math.floor(x / 8));
    const v = x % 8 === 7 ? m * 10 ** uint.get(i) : m / 10 ** (x % 8);
    return Number.isFinite(v) ? v : fail("not a number");
  },
};

const bool: Codec<boolean> = {
  kind: 0,
  put: (o, b) => uint.put(o, b ? 1 : 0),
  get: (i) => uint.get(i) === 1,
};

/** Text, as UTF-8. */
const str: Codec<string> = {
  kind: 1,
  put: (o, s) => o.bytes.push(...new TextEncoder().encode(s)),
  get: (i) => {
    const s = new TextDecoder("utf-8", { fatal: true }).decode(i.bytes.subarray(i.at, i.end));
    i.at = i.end;
    return s;
  },
};

/** A value as a field or a list holds it: a run of bytes after its length. */
function putValue<T>(o: Out, c: Codec<T>, v: T): void {
  if (c.kind === 0) return c.put(o, v);
  const sub: Out = { data: o.data, bytes: [] };
  c.put(sub, v);
  uint.put(o, sub.bytes.length);
  o.bytes.push(...sub.bytes);
}

function getValue<T>(i: In, c: Codec<T>): T {
  if (c.kind === 0) return c.get(i);
  const n = uint.get(i);
  const end = i.at + n;
  if (end > i.end) fail("the code ends early");
  const sub: In = { ...i, end };
  const v = c.get(sub);
  if (sub.at !== end) fail("a value with bytes left over");
  i.at = end;
  return v;
}

/** Values one after another, to the end. */
const list = <T>(c: Codec<T>): Codec<T[]> => ({
  kind: 1,
  put: (o, xs) => xs.forEach((x) => putValue(o, c, x)),
  get: (i) => {
    const out: T[] = [];
    while (i.at < i.end) out.push(getValue(i, c));
    return out;
  },
});

const pair = <A, B>(a: Codec<A>, b: Codec<B>): Codec<[A, B]> => ({
  kind: 1,
  put: (o, [x, y]) => {
    putValue(o, a, x);
    putValue(o, b, y);
  },
  get: (i) => [getValue(i, a), getValue(i, b)],
});

const record = <V>(v: Codec<V>): Codec<Record<string, V>> => {
  const entries = list(pair(str, v));
  return { kind: 1, put: (o, r) => entries.put(o, Object.entries(r)), get: (i) => Object.fromEntries(entries.get(i)) };
};

/** One of a few values, by its place among them. */
const oneOf = <T>(values: readonly T[]): Codec<T> => ({
  kind: 0,
  put: (o, v) => uint.put(o, values.indexOf(v)),
  get: (i) => values[uint.get(i)] ?? fail("not one of the values"),
});

/** A whole number from `min` to `max`. */
const within = (min: number, max: number): Codec<number> => ({
  kind: 0,
  put: uint.put,
  get: (i) => {
    const n = uint.get(i);
    return n >= min && n <= max ? n : fail(`${n} isn't from ${min} to ${max}`);
  },
});

type Schema<T> = { [K in keyof T]-?: [tag: number, codec: Codec<any>] };

/**
 * A record as tagged fields: each its number, doubled, plus one for a run of bytes, then its value,
 * in the numbers' order; one left undefined isn't written. Read, a field that isn't there is `base`'s,
 * and a number the schema hasn't is passed over by its kind: so a field added later reads as before
 * it was, one taken away is skipped, and the address is written again with what the app knows.
 */
function fields<T extends object>(schema: Schema<T>, base: T): Codec<T> {
  const entries = (Object.entries(schema) as [keyof T & string, [number, Codec<any>]][]).sort((a, b) => a[1][0] - b[1][0]);
  return {
    kind: 1,
    put: (o, v) => {
      for (const [key, [n, c]] of entries) {
        const x = v[key];
        if (x === undefined) continue;
        uint.put(o, n * 2 + c.kind);
        putValue(o, c, x);
      }
    },
    get: (i) => {
      const v: any = { ...base };
      while (i.at < i.end) {
        const tag = uint.get(i);
        const n = Math.floor(tag / 2);
        const entry = entries.find(([, [m]]) => m === n);
        if (!entry) {
          if (tag % 2 === 0) uint.get(i);
          else {
            const skip = uint.get(i);
            if (i.at + skip > i.end) fail("the code ends early");
            i.at += skip;
          }
          continue;
        }
        const [key, [, c]] = entry;
        if (c.kind !== tag % 2) fail(`field ${n} of another kind`);
        v[key] = getValue(i, c);
      }
      return v as T;
    },
  };
}

/** A champion by its key (Ahri's is 103). */
const champion: Codec<string> = {
  kind: 0,
  put: (o, id) => uint.put(o, o.data.championIndex.find((c) => c.id === id)?.key ?? fail(`no champion ${id}`)),
  get: (i) => {
    const key = uint.get(i);
    return i.data.championIndex.find((c) => c.key === key)?.id ?? fail(`no champion with the key ${key}`);
  },
};

/** A rune tree by its place in the client's order. */
const tree: Codec<string> = {
  kind: 0,
  put: (o, key) =>
    uint.put(
      o,
      o.data.runePage.trees.findIndex((t) => t.key === key),
    ),
  get: (i) => i.data.runePage.trees[uint.get(i)]?.key ?? fail("no such rune tree"),
};

/** The steps the shorthand has most, a byte each. */
const STEPS = ["P", "Q", "W", "E", "R", "AA", "AA!", "AA?", "ignite", "energize", "wait"];

/** The combo as typed, by what's between single spaces: a step one of STEPS by its place, or after a byte past them, its text. */
const combo: Codec<string> = {
  kind: 1,
  put: (o, s) => {
    for (const t of s.split(" ")) {
      if (STEPS.includes(t)) uint.put(o, STEPS.indexOf(t));
      else {
        uint.put(o, STEPS.length);
        putValue(o, str, t);
      }
    }
  },
  get: (i) => {
    const steps: string[] = [];
    while (i.at < i.end) {
      const k = uint.get(i);
      steps.push(k < STEPS.length ? STEPS[k] : k === STEPS.length ? getValue(i, str) : fail("not a step"));
    }
    return steps.join(" ");
  },
};

/** Item slots, 0 for an empty one; an item the data doesn't know (one since removed) reads as empty. */
const slots: Codec<(number | null)[]> = {
  kind: 1,
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

/** The six slots, or the bot lane role quest's seven. */
const build: Codec<(number | null)[]> = {
  kind: 1,
  put: slots.put,
  get: (i) => {
    const xs = slots.get(i);
    if (xs.length > RESET_STATE.items.length + 1) fail("more than seven slots");
    return [...xs, ...Array<null>(Math.max(0, RESET_STATE.items.length - xs.length)).fill(null)];
  },
};

/** Item or rune ids; one the data doesn't know is left out. */
const known = (has: (data: GameData, id: number) => boolean): Codec<number[]> => ({
  kind: 1,
  put: list(uint).put,
  get: (i) =>
    list(uint)
      .get(i)
      .filter((id) => has(i.data, id)),
});
const itemIds = known((data, id) => !!data.items[id]);
const runeIds = known((data, id) => data.runes.some((r) => r.id === id));

/** A shard per row, 0 for none. */
const shards: Codec<(number | null)[]> = {
  kind: 1,
  put: slots.put,
  get: (i) =>
    list(uint)
      .get(i)
      .map((id) => id || null),
};

/** A rune page, kept whole as it's read (see settledPage). */
const runes: Codec<RunePage> = (() => {
  const f = fields<RunePage>({ primary: [1, tree], secondary: [2, tree], picks: [3, runeIds], shards: [4, shards] }, RESET_STATE.runes);
  return { ...f, get: (i) => settledPage(i.data, f.get(i)) };
})();

const stats: Codec<TargetStats> = {
  kind: 1,
  put: (o, s) => [s.hp, s.armor, s.mr].forEach((v) => num.put(o, v)),
  get: (i) => ({ hp: num.get(i), armor: num.get(i), mr: num.get(i) }),
};

/** The target's fields, those of every mode, the ones its mode hasn't left undefined. */
type TargetFields = {
  mode: TargetMode;
  levelDiff?: number;
  build?: (number | null)[];
  champion?: string;
  items?: number[];
  base?: TargetStats;
  bonus?: TargetStats;
  hpPercent: number;
  damageReduction: number;
};

const target: Codec<TargetState> = (() => {
  const f = fields<TargetFields>(
    {
      mode: [1, oneOf(TARGET_MODES)],
      levelDiff: [2, sint],
      build: [3, slots],
      champion: [4, champion],
      items: [5, itemIds],
      base: [6, stats],
      bonus: [7, stats],
      hpPercent: [8, num],
      damageReduction: [9, num],
    },
    { mode: "squishy", hpPercent: 100, damageReduction: 0 },
  );
  const zero: TargetStats = { hp: 0, armor: 0, mr: 0 };
  return {
    kind: 1,
    put: (o, t) => f.put(o, t),
    get: (i) => {
      const t = f.get(i);
      const hp = { hpPercent: t.hpPercent, damageReduction: t.damageReduction };
      if (t.mode === "custom") return { mode: t.mode, base: t.base ?? zero, bonus: t.bonus ?? zero, ...hp };
      if (t.mode === "champion") return { mode: t.mode, levelDiff: t.levelDiff ?? 0, champion: t.champion ?? "Jinx", items: t.items ?? [], ...hp };
      return { mode: t.mode, levelDiff: t.levelDiff ?? 0, ...(t.build ? { build: t.build } : {}), ...hp };
    },
  };
})();

const settings = fields<UIState["settings"]>(
  { finishDots: [1, bool], executes: [2, bool], questBoots: [3, bool], components: [4, bool] },
  RESET_STATE.settings,
);

/** Q, W, E and R, or nothing for the default leveling. */
const ranks: Codec<UIState["ranks"]> = {
  kind: 1,
  put: (o, r) => list(uint).put(o, r ? [r.Q, r.W, r.E, r.R] : []),
  get: (i) => {
    const r = list(uint).get(i);
    return r.length === 4 ? { Q: r[0], W: r[1], E: r[2], R: r[3] } : r.length ? fail("not four ranks") : null;
  },
};

/** The item Item value ranks in place of, by id; 0 for none. One the data doesn't know is none, as is one the build hasn't (see settled). */
const pickedItem: Codec<number | null> = {
  kind: 0,
  put: (o, id) => uint.put(o, id ?? 0),
  get: (i) => {
    const id = uint.get(i);
    return id && i.data.items[id] ? id : null;
  },
};

/** What the page's builds share, as its code holds it. */
interface SharedPart {
  champion: string;
  level: number;
  skillOrder: string;
  ranks: UIState["ranks"];
  options: Record<string, number>;
  /** The combo, unless each build has its own. */
  combo: string | undefined;
  target: TargetState;
  settings: UIState["settings"];
  excluded: number[];
  compare: boolean;
}

const sharedPart = fields<SharedPart>(
  {
    champion: [1, champion],
    level: [2, within(1, 20)],
    skillOrder: [3, str],
    ranks: [4, ranks],
    options: [5, record(num)],
    combo: [6, combo],
    target: [7, target],
    settings: [8, settings],
    excluded: [9, itemIds],
    compare: [10, bool],
  },
  { ...RESET_STATE, champion: "", combo: undefined, compare: true },
);

/** A build, as its code holds it. */
interface BuildPart {
  items: (number | null)[];
  runes: RunePage;
  next: number;
  replace: number | null;
  /** Its own combo, where each build has one. */
  combo: string | undefined;
}

const buildPart = fields<BuildPart>(
  { items: [1, build], runes: [2, runes], next: [3, within(1, RESET_STATE.items.length + 1)], replace: [4, pickedItem], combo: [5, combo] },
  { items: RESET_STATE.items, runes: RESET_STATE.runes, next: 1, replace: null, combo: undefined },
);

// A code's bytes as one number in base 62. Its first byte is a tag, never 0, so none is lost in front.
function toBase62(bytes: number[]): string {
  let n = bytes.reduce((n, b) => n * 256n + BigInt(b), 0n);
  let s = "";
  for (; n > 0n; n /= 62n) s = DIGITS[Number(n % 62n)] + s;
  return s;
}

function fromBase62(code: string): Uint8Array {
  let n = 0n;
  for (const ch of code) {
    const d = DIGITS.indexOf(ch);
    if (d < 0) fail(`not a code: ${code}`);
    n = n * 62n + BigInt(d);
  }
  const bytes: number[] = [];
  for (; n > 0n; n /= 256n) bytes.unshift(Number(n % 256n));
  return Uint8Array.from(bytes);
}

function encodePart<T>(data: GameData, c: Codec<T>, v: T): string {
  const o: Out = { data, bytes: [] };
  c.put(o, v);
  return toBase62(o.bytes);
}

/** A part's value from its code; throws where it isn't one. An empty code is the base. */
function decodePart<T>(data: GameData, c: Codec<T>, code: string): T {
  const bytes = fromBase62(code);
  return c.get({ data, bytes, at: 0, end: bytes.length });
}

const isBoots = (data: GameData, id: number) => !!data.items[id]?.tags.includes("Boots");
/** The tier 3 boots, which the mid lane role quest upgrades a pair to. */
export const isQuestBoots = (data: GameData, id: number) => isBoots(data, id) && data.items[id].depth >= 3;

/** A pair of boots as the tier 3 boots setting has it: on, the tier 3 the mid lane role quest upgrades
 *  it to (Spellslinger's Shoes for Sorcerer's Shoes); off, the pair a tier 3 is upgraded from. */
function questBootsOf(data: GameData, id: number, on: boolean): number {
  const it = data.items[id];
  if (!it || !isBoots(data, id)) return id;
  const other = on ? it.depth === 2 && it.into.find((x) => isQuestBoots(data, x)) : isQuestBoots(data, id) && it.from.find((x) => isBoots(data, x));
  return other || id;
}

/** Whether the shop and Item value offer an item, with the tier 3 boots setting on or off: a pair of
 *  boots only of the tier it sets, as the mid lane role quest upgrades any pair for nothing. */
export const offered = (data: GameData, id: number, questBoots: boolean) => questBootsOf(data, id, questBoots) === id;

/** A build with its pair of boots of the tier the tier 3 boots setting has (Sorcerer's Shoes for
 *  Spellslinger's Shoes and back), Item value's item to rank in place of too where it's the pair. */
export function withQuestBoots<B extends { items: (number | null)[]; replace: number | null }>(data: GameData, b: B, on: boolean): B {
  const swap = (x: number | null) => (x == null ? x : questBootsOf(data, x, on));
  return b.items.some((x) => swap(x) !== x) ? { ...b, items: b.items.map(swap), replace: swap(b.replace) } : b;
}

/** What Item value's sets are of: the legendaries and the boots offered, but those excluded. */
export const setPool = (data: GameData, s: Pick<UIState, "settings" | "excluded">) =>
  defaultCandidates(data)
    .map((i) => i.id)
    .filter((id) => offered(data, id, s.settings.questBoots) && !s.excluded.includes(id));

/** How many items a set can be of, for a build: its empty slots, and as many of its items as a set of
 *  the pool can be bought in place of, as the shop buys them (upgradeRoom): a Serrated Dirk, Boots;
 *  two Long Swords, but of two Sheens none. */
export const room = (data: GameData, s: Pick<UIState, "items" | "settings" | "excluded">) =>
  s.items.filter((x) => x == null).length + upgradeRoom(data, s.items, setPool(data, s));

/**
 * A state as the page keeps it: the build's pair of boots, the item it ranks in place of and those
 * excluded of the tier the tier 3 boots setting has (withQuestBoots); Item value's count of items no
 * more than the build's room, to one at least; and the item it ranks in place of one of the build's,
 * with a count of one (sets are for the empty slots and the items to upgrade), else none, the next
 * item. What a code holds is settled as it's read, and what a change to the build's items, the
 * setting or the items excluded leaves (withItems in slots.ts).
 */
export function settled(data: GameData, s: UIState): UIState {
  const on = s.settings.questBoots;
  const { items, replace: picked } = withQuestBoots(data, s, on);
  const excluded = s.excluded.every((x) => offered(data, x, on)) ? s.excluded : [...new Set(s.excluded.map((x) => questBootsOf(data, x, on)))];
  const next = Math.max(1, Math.min(s.next, room(data, { items, settings: s.settings, excluded })));
  const replace = next === 1 && picked != null && items.includes(picked) ? picked : null;
  return items === s.items && excluded === s.excluded && next === s.next && replace === s.replace ? s : { ...s, items, excluded, next, replace };
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

/** A build's name in an address: as a URI component, its spaces as "_", and escaped what the address's own parts are written with ("Build 2" is "Build_2"). */
const nameCode = (name: string) =>
  encodeURIComponent(name)
    .replace(/[~*=+_'()]/g, (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase())
    .replace(/%20/g, "_");
function nameOf(code: string): string | null {
  try {
    return decodeURIComponent(code.replace(/_/g, " ")).trim() || null;
  } catch {
    return null;
  }
}

const sharedOf = (s: UIState, page: Page): SharedPart => ({
  champion: s.champion,
  level: s.level,
  skillOrder: s.skillOrder,
  ranks: s.ranks,
  options: s.options,
  combo: page.ownCombos ? undefined : s.combo,
  target: s.target,
  settings: s.settings,
  excluded: s.excluded,
  compare: page.compare,
});

const buildOf = (s: UIState, own: boolean): BuildPart => ({
  items: s.items,
  runes: s.runes,
  next: s.next,
  replace: s.replace,
  combo: own ? s.combo : undefined,
});

/**
 * A page's address after the app's own: its champion's path, then in the hash each build's code in
 * its order, the one on screen's after "*" unless it's the first, each after its name and "=" where
 * the name isn't its place's (nameAt), then "+" and the code of what they share. The reset page's is
 * the path alone. "ahri/#5h2Kq~*Burst=3fGh~9aB+Hm3N…".
 */
export function encodePage(data: GameData, s: UIState, page: Page): string {
  const slug = championSlug(data, s.champion);
  const codes = page.builds.map((b, i) => encodePart(data, buildPart, buildOf(i === page.active ? s : withBuild(s, page, i), page.ownCombos)));
  const shared = encodePart(data, sharedPart, sharedOf(s, page));
  if (codes.length === 1 && page.builds[0].name === nameAt(0)) {
    const reset = resetState(s);
    if (codes[0] === encodePart(data, buildPart, buildOf(reset, false)) && shared === encodePart(data, sharedPart, sharedOf(reset, single(reset))))
      return `${slug}/`;
  }
  const builds = page.builds.map((b, i) => `${i > 0 && i === page.active ? "*" : ""}${b.name === nameAt(i) ? "" : `${nameCode(b.name)}=`}${codes[i]}`);
  return `${slug}/#${builds.join("~")}+${shared}`;
}

/**
 * The page at an address after the app's own, with its state on screen, or null if it isn't a page's.
 * The path names the champion, else the shared part does; a part left out is the reset's, so a build's
 * code pasted alone opens at the reset setup; a build whose code doesn't load is left out.
 */
export function decodePage(data: GameData, address: string): { state: UIState; page: Page } | null {
  try {
    const [, slug, hash = ""] = /^\/?([^/#]*)\/?(?:#(.*))?$/.exec(address.trim()) ?? fail("not an address");
    const [list, ...rest] = hash.split("+");
    if (rest.length > 1) fail("more than one shared part");
    const shared = decodePart(data, sharedPart, rest[0] ?? "");
    const champion = slug ? championBySlug(data, decodeURIComponent(slug)) : shared.champion || fail("no champion");
    const parts: (BuildPart & { name: string })[] = [];
    let active = 0;
    (list ? list.split("~") : []).forEach((part, k) => {
      const [, on, name, code] = /^(\*?)(?:([^=]*)=)?(.*)$/.exec(part)!;
      let b: BuildPart;
      try {
        b = decodePart(data, buildPart, code);
      } catch {
        return;
      }
      if (on) active = parts.length;
      parts.push({ ...b, name: (name && nameOf(name)) || nameAt(k) });
    });
    if (list && !parts.length) fail("no build loads");
    if (!parts.length) parts.push({ ...buildOf(RESET_STATE, false), name: nameAt(0) });
    // Each its own combo where any build's code has one; a build alone with one, that one for the page.
    const ownCombos = parts.length > 1 && parts.some((b) => b.combo !== undefined);
    const combo = shared.combo ?? (parts.length === 1 ? parts[0].combo : undefined) ?? "";
    const { level, skillOrder, ranks, options, target, settings, excluded } = shared;
    const on = parts[active];
    const base = settled(data, {
      champion,
      level,
      skillOrder,
      ranks,
      options,
      combo,
      target,
      settings,
      excluded,
      items: on.items,
      runes: on.runes,
      next: on.next,
      replace: on.replace,
    });
    const builds: Build[] = parts.map((b, k) => {
      const own = settled(data, { ...base, items: b.items, runes: b.runes, next: b.next, replace: b.replace });
      return { id: k + 1, name: b.name, items: own.items, runes: b.runes, combo: ownCombos ? (b.combo ?? combo) : combo, next: own.next, replace: own.replace };
    });
    const page: Page = { champion, builds, active, ownCombos, compare: shared.compare };
    return { state: withBuild(base, page, active), page };
  } catch {
    return null;
  }
}

/** A state's address: its page's with it alone (see encodePage). */
export const encodeState = (data: GameData, s: UIState): string => encodePage(data, s, single(s));

/** The state on screen at an address (see decodePage), or null if it isn't a page's. */
export const decodeState = (data: GameData, address: string): UIState | null => decodePage(data, address)?.state ?? null;

/**
 * The state with champion `id` picked, the one on screen too: a fresh build of theirs with what the
 * page shares, the combo as their kit takes it (see fitCombo), default leveling and without the last
 * champion's own parameters.
 */
export function pickChampion(data: GameData, s: UIState, id: string): UIState {
  const own = new Set((getKit(data.champions[s.champion]).options ?? []).map((o) => o.key));
  const options = Object.fromEntries(Object.entries(s.options).filter(([k]) => !own.has(k)));
  return {
    ...s,
    champion: id,
    items: RESET_STATE.items,
    runes: RESET_STATE.runes,
    next: 1,
    replace: null,
    ranks: null,
    options,
    combo: fitShorthand(data, s.combo, id),
  };
}

/** What Reset leaves: the champion's reset state (RESET_STATE). */
export function resetState(s: UIState): UIState {
  return { ...RESET_STATE, champion: s.champion };
}

/** A combo's shorthand as `champion` takes it (see fitCombo); unchanged when it doesn't parse. */
function fitShorthand(data: GameData, combo: string, champion: string) {
  try {
    return formatCombo(fitCombo(parseCombo(combo), getKit(data.champions[champion])));
  } catch {
    return combo;
  }
}
