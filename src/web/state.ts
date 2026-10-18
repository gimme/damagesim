// UI state ⇄ engine Scenario, plus the scenario's address, which is what a link to it is (the page's
// own address, so the address bar is how a scenario is shared), and the state kept in localStorage
// across reloads. The address takes the game data as an argument, so Node (the UI test) reads them too.

import type { GameData } from "../engine/gamedata.ts";
import type { Scenario, SimSettings, TargetSpec } from "../engine/sim.ts";
import type { TargetPreset } from "../engine/presets.ts";
import { comboTokens } from "../engine/combo.ts";
import { pageRunes, treePicks, type RunePage } from "../engine/rune-page.ts";

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

// The scenario's address, after the app's own: the champion in the path, and in the hash what differs
// from the defaults, as key=value pairs joined by "&". Lists are joined by commas: items and runes by
// id (an empty item slot as nothing), each rune tree's name before its runes, the combo's steps as
// typed. Options (stacks, distances…) go by their own names.
//
//   zed/#lv=16&items=3142,3158,6698&runes=domination,8112,8143,8140,8135,precision,9111,8014&combo=W,E,Q,AA,R&vs=lux
//
// It holds what the page shows: what the page keeps and doesn't show (a target's numbers while another
// is the target, the runes a tree remembers off the page) is left out, and kept in storage instead. A
// change to the defaults changes what an address means.

/** A field the hash can hold. */
interface Field {
  key: string;
  /** The value as the hash has it, or null where the page doesn't show the field (a champion's items while a preset is the target). */
  write(data: GameData, s: UIState): string | null;
  /** The state with the value read into it; throws for one that can't be. */
  read(data: GameData, s: UIState, v: string): UIState;
}

const fail = (why: string): never => {
  throw new Error(why);
};

/** A value with what would end it or change in a URL escaped: a separator, "%", a space, a non-ASCII letter. */
const esc = (t: string) => t.replace(/[^\w\-.~!$'()*+;:@/?{}]/gu, encodeURIComponent);

/** A list's values, unescaped; none in an empty one. */
const split = (v: string) => (v === "" ? [] : v.split(",").map(decodeURIComponent));

const number = (t: string) => (/^-?\d+(\.\d+)?(e[+-]?\d+)?$/.test(t) ? Number(t) : fail(`${t} isn't a number`));

/** A whole number from `min` to `max`; a sign of its own, + too. */
const whole = (t: string, min: number, max: number) => {
  const n = /^[+-]?\d+$/.test(t) ? Number(t) : NaN;
  return n >= min && n <= max ? n : fail(`${t} isn't a whole number from ${min} to ${max}`);
};

const id = (t: string) => whole(t, 1, Number.MAX_SAFE_INTEGER);

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

/** Item slots up to the last item, an empty one as nothing. */
const writeSlots = (xs: (number | null)[]) => xs.slice(0, xs.findLastIndex((x) => x != null) + 1).join(",");

/** Item slots; an item the data doesn't know (one since removed) reads as an empty slot. */
const readSlots = (data: GameData, v: string) => split(v).map((t) => (t === "" ? null : data.items[id(t)] ? id(t) : null));

/** Items; one the data doesn't know is left out. */
const readItems = (data: GameData, v: string) => split(v).flatMap((t) => (data.items[id(t)] ? [id(t)] : []));

const target = (s: UIState, t: Partial<TargetState>): UIState => ({ ...s, target: { ...s.target, ...t } });

/** A custom target's stat as its base and bonus: "1600+400", "60-5". */
const stat = (key: keyof TargetStats): Field => ({
  key: `vs.${key}`,
  write: (_, s) => (s.target.mode === "custom" ? `${s.target.base[key]}${s.target.bonus[key] < 0 ? "" : "+"}${s.target.bonus[key]}` : null),
  read: (_, s, v) => {
    const m = /^(-?[\d.]+(?:e[+-]?\d+)?)([+-][\d.]+(?:e[+-]?\d+)?)$/.exec(v);
    if (!m || s.target.mode !== "custom") fail(`${v} isn't a custom target's base and bonus`);
    return target(s, { base: { ...s.target.base, [key]: number(m![1]) }, bonus: { ...s.target.bonus, [key]: number(m![2].replace(/^\+/, "")) } });
  },
});

/** What the hash can hold besides options, in its order; a field read after those it depends on (a target's items after the target). */
const FIELDS: Field[] = [
  {
    key: "lv",
    write: (_, s) => String(s.level),
    read: (_, s, v) => ({ ...s, level: whole(v, 1, 20) }),
  },
  {
    key: "items",
    write: (_, s) => writeSlots(s.items),
    read: (data, s, v) => {
      const xs = readSlots(data, v);
      return xs.length > 6 ? fail("more than six items") : { ...s, items: [...xs, ...Array<null>(6 - xs.length).fill(null)] };
    },
  },
  {
    key: "runes",
    write: (data, s) => [s.runes.primary, s.runes.secondary].flatMap((tree) => [tree.toLowerCase(), ...treePicks(data, s.runes, tree).map(String)]).join(","),
    read: (data, s, v) => {
      const trees: { key: string; picks: number[] }[] = [];
      for (const t of split(v)) {
        if (/^\d+$/.test(t)) {
          const tree = trees.at(-1) ?? fail("a rune before its tree");
          // A rune the data doesn't know, or not of that tree, is left out.
          if (data.runes.find((r) => r.id === id(t))?.tree === tree.key) tree.picks.push(id(t));
        } else trees.push({ key: data.runePage.trees.find((tr) => tr.key.toLowerCase() === t.toLowerCase())?.key ?? fail(`no rune tree ${t}`), picks: [] });
      }
      if (trees.length !== 2 || trees[0].key === trees[1].key) fail("not two rune trees");
      return { ...s, runes: { ...s.runes, primary: trees[0].key, secondary: trees[1].key, picks: trees.flatMap((t) => t.picks) } };
    },
  },
  {
    key: "shards",
    write: (_, s) => s.runes.shards.join(","),
    read: (data, s, v) => {
      const xs = split(v).map(id);
      if (xs.length !== 3) fail("not three shards");
      // A shard the data doesn't know is the default one in its row.
      const shards = xs.map((x, row) => (data.runes.some((r) => r.id === x && r.tree === "Shards") ? x : DEFAULT_STATE.runes.shards[row]));
      return { ...s, runes: { ...s.runes, shards } };
    },
  },
  {
    key: "combo",
    write: (_, s) => comboTokens(s.combo).map(esc).join(","),
    read: (_, s, v) => ({ ...s, combo: split(v).join(" ") }),
  },
  {
    key: "order",
    write: (_, s) => s.skillOrder,
    read: (_, s, v) => (/^(?!.*(.).*\1)[QWE]{3}$/.test(v) ? { ...s, skillOrder: v } : fail(`${v} isn't an order of Q, W and E`)),
  },
  {
    key: "ranks",
    write: (_, s) => (s.ranks ? (["Q", "W", "E", "R"] as const).map((k) => k + s.ranks![k]).join(",") : null),
    read: (_, s, v) => {
      const ranks = Object.fromEntries(split(v).map((t) => [t[0], whole(t.slice(1), 0, 6)]));
      return Object.keys(ranks).sort().join("") === "EQRW" && split(v).length === 4
        ? { ...s, ranks: ranks as NonNullable<UIState["ranks"]> }
        : fail(`${v} isn't a rank for each of Q, W, E and R`);
    },
  },
  {
    key: "vs",
    write: (data, s) => (s.target.mode === "champion" ? championSlug(data, s.target.champion) : s.target.mode),
    read: (data, s, v) =>
      TARGET_MODES.includes(v as TargetMode) ? target(s, { mode: v as TargetMode }) : target(s, { mode: "champion", champion: championBySlug(data, v) }),
  },
  {
    key: "vs.lv",
    write: (_, s) => (s.target.mode === "custom" ? null : (s.target.levelDiff > 0 ? "+" : "") + s.target.levelDiff),
    read: (_, s, v) => (s.target.mode === "custom" ? fail("a custom target has no level") : target(s, { levelDiff: whole(v, -19, 19) })),
  },
  {
    key: "vs.items",
    write: (_, s) => {
      const t = s.target;
      if (t.mode === "champion") return t.items.join(",");
      return t.mode === "custom" || !t.builds[t.mode] ? null : writeSlots(t.builds[t.mode]!);
    },
    read: (data, s, v) => {
      const t = s.target;
      if (t.mode === "champion") return target(s, { items: readItems(data, v) });
      return t.mode === "custom" ? fail("a custom target has no items") : target(s, { builds: { ...t.builds, [t.mode]: readSlots(data, v) } });
    },
  },
  stat("hp"),
  stat("armor"),
  stat("mr"),
  {
    key: "vs.hpPercent",
    write: (_, s) => String(s.target.hpPercent),
    read: (_, s, v) => target(s, { hpPercent: number(v) }),
  },
  {
    key: "vs.damageReduction",
    write: (_, s) => String(s.target.damageReduction),
    read: (_, s, v) => target(s, { damageReduction: number(v) }),
  },
  {
    key: "finishDots",
    write: (_, s) => (s.settings.finishDots ? "on" : "off"),
    read: (_, s, v) => (v === "on" || v === "off" ? { ...s, settings: { ...s.settings, finishDots: v === "on" } } : fail(`${v} isn't on or off`)),
  },
];

/** The state's address: its champion's path, then a hash if anything differs from the defaults ("zed/#lv=16&vs=tank"). */
export function encodeState(data: GameData, s: UIState): string {
  const parts: string[] = [];
  // Each field against the state read so far, as the address is read: a target's items against those of the target before them.
  let read: UIState = { ...DEFAULT_STATE, champion: s.champion };
  for (const f of FIELDS) {
    const v = f.write(data, s);
    if (v === null || v === f.write(data, read)) continue;
    parts.push(`${f.key}=${v}`);
    read = f.read(data, read, v);
  }
  for (const [k, v] of Object.entries(s.options)) parts.push(`${esc(k)}=${v}`);
  return `${championSlug(data, s.champion)}/${parts.length ? "#" + parts.join("&") : ""}`;
}

/** The state at an address (or its path after the app's, its hash with it): "zed/#lv=16", "/zed", "zed/"; null if it isn't one. */
export function decodeState(data: GameData, address: string): UIState | null {
  try {
    const [, slug, hash = ""] = /^\/?([^/#]+)\/?(?:#(.*))?$/.exec(address.trim()) ?? fail("not a champion's path");
    const values = new Map<string, string>();
    for (const part of hash.split("&").filter(Boolean)) {
      const at = part.indexOf("=");
      const key = at < 0 ? fail(`${part} has no value`) : decodeURIComponent(part.slice(0, at));
      if (values.has(key)) fail(`${key} twice`);
      values.set(key, part.slice(at + 1));
    }
    let s: UIState = { ...DEFAULT_STATE, champion: championBySlug(data, decodeURIComponent(slug)) };
    for (const f of FIELDS) {
      const v = values.get(f.key);
      if (v === undefined) continue;
      s = f.read(data, s, v);
      values.delete(f.key);
    }
    // The rest are options.
    for (const [k, v] of values) s = { ...s, options: { ...s.options, [k]: number(v) } };
    return s;
  } catch {
    return null;
  }
}

const STORAGE_KEY = "damagesim:state";

/**
 * The state as the page left it, what the address leaves out too, or null. One saved by another
 * version of the page is filled in from the defaults; one whose address reads back otherwise (an
 * item since removed) is what its address holds.
 */
export function loadSavedState(data: GameData): UIState | null {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null");
    if (typeof saved !== "object" || !saved) return null;
    const s: UIState = {
      ...DEFAULT_STATE,
      ...saved,
      runes: { ...DEFAULT_STATE.runes, ...saved.runes },
      target: { ...DEFAULT_STATE.target, ...saved.target },
      settings: { ...DEFAULT_STATE.settings, ...saved.settings },
    };
    const address = encodeState(data, s);
    const read = decodeState(data, address);
    return read && encodeState(data, read) === address ? s : read;
  } catch {
    return null;
  }
}

export function saveState(s: UIState): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
  } catch {
    // storage unavailable
  }
}
