// Compare item and rune effects with the League wiki: which effects deal damage and of what type,
// whether it is on-hit, whether it triggers spell effects (counts as ability damage), cooldowns,
// and item stats. The game files hold the numbers; this checks the behaviour items.ts and runes.ts
// encode by hand.
//
// Sources (data/raw/wiki/pages.json, downloaded by scripts/fetch-wiki.ts):
//   * "Module:ItemData/data": every item's stats, passive/active descriptions and active cooldowns;
//   * "Template:Rune data <Rune>": description and cooldown;
//   * the item and rune articles' notes: "deals proc damage, and thus will not trigger spell effects".
//
// The simulator side is observed, not read from the code: every item and rune runs a set of probe
// combos, and its contribution is the difference from the same combo without its effect (a stats-only
// copy of the item, or no rune): the damage instances it deals, the hits it amplifies, and changes to
// total damage, combo duration and stats. Each sim hit is matched to the wiki effect of the same name.
//
// Usage: node scripts/audit-items.ts [Name ...] [--items | --runes] [--all]
//   --all     also print entries without findings

import { existsSync, readFileSync } from "node:fs";
import { loadGameData } from "../src/node/load.ts";
import { loadAllKits } from "../src/node/kits.ts";
import { listItems, listRunes } from "../src/engine/describe.ts";
import { Sim, simulate, type Scenario, type SimResult, type TargetSpec } from "../src/engine/sim.ts";
import type { DamageInstance, Effect } from "../src/engine/effects.ts";
import type { ItemData } from "../src/engine/data-types.ts";

import { WIKI_CACHE } from "./fetch-wiki.ts";

const args = process.argv.slice(2);
const showAll = args.includes("--all");
const only = args.includes("--items") ? "items" : args.includes("--runes") ? "runes" : null;
const wanted = args.filter((a) => !a.startsWith("--")).map((a) => a.toLowerCase());

/** Findings checked by hand. Key: "<name> <CHECK>". */
const REVIEWED: Record<string, string> = {
  "Fiendhunter Bolts ON-HIT": "the true damage is part of the empowered attack, added with its on-hit extras",
  "Fiendhunter Bolts COOLDOWN": "the cooldown starts per ultimate cast; one activation empowers 3 attacks",
  "Muramana ON-HIT": "Shock's ability part (max-mana damage on champion-ability hits) is not on-hit",
  "Runaan's Hurricane UNMODELED": "the bolts only hit other enemies",
  "Rylai's Crystal Scepter NO EFFECT": "slow only",
  "Serylda's Grudge NO EFFECT": "the armor penetration is an item stat; the passive only slows",
  "The Collector TYPE": "the execute is dealt as true damage for the remaining health",
  "Taste of Blood NO EFFECT": "healing",
  "Glacial Augment NO EFFECT": "slow zones; no damage dealt",
  "Unsealed Spellbook NO EFFECT": "summoner spell swaps",
  "Cosmic Insight NO EFFECT": "summoner spell and item haste; no probe waits on those cooldowns",
  "Fleet Footwork NO EFFECT": "healing and move speed",
  "Guardian NO EFFECT": "shields",
  "Demolish NO EFFECT": "turret damage",
  "Shield Bash NO EFFECT": "needs shields, which are not modeled",
  "Stormraider's Surge NO EFFECT": "move speed",
};

// ---------------------------------------------------------------- wiki text

/** Expand wiki templates and links to their visible text. */
function plain(s: string): string {
  let prev = "";
  while (prev !== s) {
    prev = s;
    s = s.replace(/\{\{([^{}|]+)((?:\|[^{}]*)?)\}\}/g, (_, name: string, rest: string) => {
      const params = rest
        .split("|")
        .slice(1)
        .filter((p) => !/^\s*[a-z_0-9]+\s*=/i.test(p));
      const n = name.trim().toLowerCase();
      if (!params.length) return n === "sbc" ? "" : name;
      // {{tip|keyword|display}}: the display text is last.
      if (/^(tip|sti|stil|tips)$/.test(n)) return params[params.length - 1];
      // {{ft|short text|long text}} sits between words without spaces.
      if (n === "ft") return ` ${params[0]} `;
      // {{rd|melee|ranged}}
      if (n === "rd") return params.length > 1 ? `${params[0]} (ranged ${params[1]})` : params[0];
      // {{as|text|physical damage}}: the second parameter is the stat the text is colored as.
      if (n === "as" && params[1] && /\b(physical|magic|true) damage\b/.test(params[1]) && !params[0].includes(params[1])) return `${params[0]} (${params[1]})`;
      return params[0];
    });
  }
  return s
    .replace(/\[\[(?:[^\]|]*\|)?([^\]]*)\]\]/g, "$1")
    .replace(/'''|''/g, "")
    .replace(/<br\s*\/?>|<\/?li>|<\/?ul>/gi, " ")
    .replace(/<[^>]+>/g, "");
}

type DamageType = "physical" | "magic" | "true";

interface WikiEffect {
  name: string;
  text: string;
  active: boolean;
  cooldowns: number[];
  /** Damage types the description says this effect deals. */
  types: Set<DamageType>;
  onHit: boolean;
  /** The description mentions amplifying damage. */
  amplifies: boolean;
}

interface WikiEntry {
  effects: WikiEffect[];
  /** Damage categories from the article notes: proc, spell, basic… */
  categories: Set<string>;
  stats?: Record<string, number>;
}

const sentences = (t: string) => t.split(/(?<=[.!?])\s+/);
const DEALS = /\b(deal|deals|dealt|dealing|burn|burns|burning|struck|explod\w*|unleash\w*|fires?)\b/i;
const AMPLIFIES =
  /\b(increased damage|deal \d+(\.\d+)?% (?:bonus|increased|more) damage|take \d+(\.\d+)?% (?:increased|more|bonus)|damage (?:dealt )?is increased|damage amplif)/i;

function wikiEffect(name: string, text: string, active: boolean, cd?: number): WikiEffect {
  const types = new Set<DamageType>();
  let onHit = false;
  const cooldowns = cd !== undefined ? [cd] : [];
  for (const m of text.matchAll(/\(?(\d+(?:\.\d+)?)(?: to \d+(?:\.\d+)?)?[- ]second cooldown/gi)) cooldowns.push(Number(m[1]));
  for (const raw of sentences(text)) {
    // Trigger phrases ("Dealing physical damage to a champion applies…") name the damage that
    // triggers the effect, not damage it deals ("…, dealing them 20 magic damage").
    const s = raw.replace(/(?:^|\b(?:after|when|upon|while|on)\s+)dealing\b.*?(?=\bto\b|\bwith\b|\bdeals?\b|,|\.\s|$)/gi, "");
    // Damage the holder takes or reflects onto attackers isn't dealt in a one-way combo.
    if (/\b(you take|receiv\w*|damage taken|taking|less damage|redirect\w*|to the attacker|attackers?)\b/i.test(s)) continue;
    const dealt = DEALS.test(s) || /\bon-hit\b/i.test(s) || /\b(them|enemies|champions?|targets?)\b[^.,]{0,20}\btakes?\b/i.test(s);
    if (!dealt) continue;
    for (const m of s.matchAll(/\b(physical|magic|true|adaptive)\s+damage\b/gi)) {
      const t = m[1].toLowerCase();
      if (t === "adaptive") types.add("physical").add("magic");
      else types.add(t as DamageType);
    }
    if (/\bon-hit\b/i.test(s) && /\bdamage\b/i.test(s)) onHit = true;
  }
  return { name, text, active, cooldowns, types, onHit, amplifies: AMPLIFIES.test(text) };
}

function noteCategories(notes: string): Set<string> {
  const categories = new Set<string>();
  for (const bullet of notes.split(/\n\*+/)) {
    const b = plain(bullet);
    for (const m of b.matchAll(/\b(?:deals?|dealt as|is|counts as)\s+(proc|spell|basic|ability|area|persistent|pet|reactive|default|indirect|raw) damage/gi))
      categories.add(m[1].toLowerCase());
    if (/will not trigger spell effects|does not trigger spell effects/i.test(b)) categories.add("no spell effects");
    else if (/\bwill trigger spell effects/i.test(b)) categories.add("spell effects");
  }
  return categories;
}

if (!existsSync(WIKI_CACHE)) {
  console.error("No wiki cache: run node scripts/fetch-wiki.ts first.");
  process.exit(1);
}
const pages: Record<string, { content: string }> = JSON.parse(readFileSync(WIKI_CACHE, "utf8")).pages;
const pageIndex = new Map(Object.keys(pages).map((t) => [t.toLowerCase(), t]));
const page = (title: string) => pages[pageIndex.get(title.toLowerCase()) ?? ""]?.content;

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** A Lua table value: the text between `["key"] = {` and its closing brace (key matched case-insensitively). */
function luaTable(src: string, key: string): string | undefined {
  const start = src.search(new RegExp(`\\["${escapeRe(key)}"\\]\\s*=\\s*\\{`, "i"));
  if (start < 0) return;
  let depth = 0;
  for (let i = src.indexOf("{", start); i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}" && --depth === 0) return src.slice(src.indexOf("{", start) + 1, i);
  }
}
const luaString = (src: string, key: string) => src.match(new RegExp(`\\["${escapeRe(key)}"\\]\\s*=\\s*"((?:[^"\\\\]|\\\\.)*)"`))?.[1]?.replace(/\\"/g, '"');

// Wiki stat keys → item stat keys (value scale: percent stats are fractions in our data).
const WIKI_STATS: Record<string, [string, number]> = {
  ad: ["ad", 1],
  ap: ["ap", 1],
  ah: ["abilityHaste", 1],
  armor: ["armor", 1],
  mr: ["mr", 1],
  hp: ["hp", 1],
  mana: ["mana", 1],
  lethality: ["lethality", 1],
  msflat: ["msFlat", 1],
  ms: ["msPercent", 100],
  as: ["attackSpeed", 100],
  crit: ["critChance", 100],
  critdamage: ["critDamage", 100],
  armpen: ["armorPenPercent", 100],
  mpen: ["magicPenPercent", 100],
  mpenflat: ["magicPenFlat", 1],
  lifesteal: ["lifeSteal", 100],
  omnivamp: ["omnivamp", 100],
  hsp: ["healShieldPower", 100],
  hp5: ["baseHpRegen", 100],
  mp5: ["baseMpRegen", 100],
  hp5flat: ["hpRegen", 1],
  mp5flat: ["mpRegen", 1],
  tenacity: ["tenacity", 100],
  slowresist: ["slowResist", 100],
};
const PERCENT_STATS = new Set(
  Object.values(WIKI_STATS)
    .filter(([, scale]) => scale === 100)
    .map(([k]) => k),
);

const ITEM_MODULE = page("Module:ItemData/data") ?? "";

function wikiItem(item: ItemData): WikiEntry | null {
  const src = luaTable(ITEM_MODULE, item.name);
  if (!src) return null;
  // Upgraded items refer to their base item's fields: ["pass"] = "=>Manamune".
  const ref = (table: string, key: string): string | undefined => {
    const r = luaString(table, key)?.match(/^=>(.+)$/)?.[1];
    return r ? luaTable(ITEM_MODULE, r) : undefined;
  };
  const effTable = luaTable(src, "effects") ?? "";
  const effects: WikiEffect[] = [];
  for (const key of ["pass", "pass2", "pass3", "pass4", "act", "act2"]) {
    const t = luaTable(effTable, key) ?? (ref(effTable, key) && luaTable(luaTable(ref(effTable, key)!, "effects") ?? "", key));
    if (!t) continue;
    const text = ["description", "description2", "description3"]
      .map((k) => luaString(t, k))
      .filter(Boolean)
      .join(" ");
    const cd = luaString(t, "cd") ?? t.match(/\["cd"\]\s*=\s*([\d.]+)/)?.[1];
    effects.push(wikiEffect(plain(luaString(t, "name") ?? key), plain(text), key.startsWith("act"), cd && /^[\d.]+$/.test(cd) ? Number(cd) : undefined));
  }
  const stats: Record<string, number> = {};
  const statTable = luaTable(src, "stats") ?? "";
  for (const m of statTable.matchAll(/\["([a-z0-9]+)"\]\s*=\s*("=>[^"]+"|"?[\d.]+"?)/g)) {
    const v = m[2].startsWith('"=>')
      ? luaTable(ITEM_MODULE, m[2].slice(3, -1)) &&
        luaTable(luaTable(ITEM_MODULE, m[2].slice(3, -1))!, "stats")?.match(new RegExp(`\\["${m[1]}"\\]\\s*=\\s*"?([\\d.]+)`))?.[1]
      : m[2].replace(/"/g, "");
    if (v) stats[m[1]] = Number(v);
  }
  const article = page(item.name) ?? "";
  const notes = article.match(/\|notes\s*=([\s\S]*?)(?=\n\|[a-z]+\s*=|\n\}\})/)?.[1] ?? "";
  return { effects, categories: noteCategories(notes), stats };
}

function wikiRune(name: string): WikiEntry | null {
  const src = page(`Template:Rune data ${name}`);
  if (!src) return null;
  const field = (k: string) => src.match(new RegExp(`^\\|${k}\\s*=([\\s\\S]*?)(?=^\\|[a-z ]+\\d*\\s*=|^\\}\\})`, "m"))?.[1]?.trim();
  const text = ["description", "description2", "description3", "description4"]
    .map(field)
    .filter(Boolean)
    .map((t) => plain(t!))
    .join(" ");
  const cd = field("cooldown")?.match(/^[\d.]+/)?.[0];
  // The article's "== Notes ==" section, up to the next level-2 heading.
  const rest = (page(name) ?? "").split(/==\s*Notes\s*==/)[1] ?? "";
  const end = rest.search(/\n==[^=]/);
  return { effects: [wikiEffect(name, text, false, cd ? Number(cd) : undefined)], categories: noteCategories(end < 0 ? rest : rest.slice(0, end)) };
}

// ---------------------------------------------------------------- simulator observations

const data = loadGameData();
await loadAllKits();

interface Probe {
  key: string;
  champion: string;
  combo: string;
  target: TargetSpec;
  options?: Record<string, number>;
}
const tank: TargetSpec = { preset: "tank" };
const PROBES: Probe[] = [
  { key: "melee-aa", champion: "Garen", combo: "AA*8", target: tank },
  { key: "ranged-aa", champion: "Jinx", combo: "AA*8", target: tank },
  { key: "abilities", champion: "Ahri", combo: "E Q W R wait{2s} R", target: tank },
  { key: "mixed-melee", champion: "Jax", combo: "Q AA W AA E AA R AA AA AA", target: tank },
  { key: "mixed-ranged", champion: "Ezreal", combo: "Q AA W AA E AA R AA Q AA", target: tank },
  { key: "sustained", champion: "Jax", combo: "AA*3 wait{3s} Q AA W AA E AA AA AA", target: tank },
  // Recasts wait for cooldowns (haste, cooldown refunds).
  { key: "cooldowns", champion: "Ezreal", combo: "Q AA Q AA Q AA Q", target: tank },
  // Below-half-health target (Dark Harvest, Coup de Grace, Shadowflame…) and attacker (Last Stand).
  { key: "low-hp", champion: "Ahri", combo: "E Q W R AA AA", target: { preset: "squishy", hpPercent: 45 }, options: { "self.hpPercent": 30 } },
  { key: "execute", champion: "Garen", combo: "AA*12", target: { preset: "squishy", hpPercent: 20 } },
];

interface Obs {
  probe: string;
  /** Damage instances the item/rune dealt. */
  hits: DamageInstance[];
  /** Other instances it amplified. */
  amped: number;
  /** Total damage minus the baseline's. */
  delta: number;
  /** Combo duration minus the baseline's (haste, attack speed). */
  dt: number;
  /** Stats that differ from the baseline. */
  stats: Record<string, number>;
}

const isSpell = (i: DamageInstance) => (i.flags.ability && !i.flags.proc) || i.flags.pet;
const affects = (o: Obs) => o.hits.length > 0 || o.amped > 0 || Math.abs(o.delta) >= 0.5 || Math.abs(o.dt) >= 0.01 || Object.keys(o.stats).length > 0;

function statDiff(a: SimResult["stats"], b: SimResult["stats"]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(a)) {
    const w = (b as unknown as Record<string, unknown>)[k];
    if (typeof v === "number" && typeof w === "number" && Math.abs(v - w) > 1e-6) out[k] = v - w;
  }
  return out;
}

function observe(source: string, label: string, run: (p: Probe, withEffect: boolean) => SimResult | null): Obs[] {
  const out: Obs[] = [];
  for (const p of PROBES) {
    const r = run(p, true);
    const base = run(p, false);
    if (!r || !base) continue;
    out.push({
      probe: p.key,
      hits: r.events.filter((e) => e.source === source),
      amped: r.events.filter((e) => e.source !== source && e.amps.some((a) => a.source.startsWith(label))).length,
      delta: r.totalDamage - base.totalDamage,
      dt: r.duration - base.duration,
      stats: statDiff(r.stats, base.stats),
    });
  }
  return out;
}

const tryRun = (s: Scenario) => {
  try {
    return simulate(data, s);
  } catch {
    return null;
  }
};

function itemObs(item: ItemData, effect: Effect | undefined, options: Record<string, number>): Obs[] {
  // A copy of the item with its stats but no effect.
  const cloneId = 900000 + item.id;
  data.items[String(cloneId)] ??= { ...item, id: cloneId };
  const scenario = (p: Probe, withEffect: boolean): Scenario => ({
    champion: p.champion,
    level: 18,
    items: [withEffect ? item.id : cloneId],
    combo: p.combo,
    target: p.target,
    options: { ...p.options, ...options },
  });
  const obs = observe(`item:${item.id}`, item.name, (p, withEffect) => tryRun(scenario(p, withEffect)));
  if (effect?.active) {
    const p = PROBES[2];
    const r = tryRun({ ...scenario(p, true), combo: `item:${item.id} AA AA Q` });
    const base = tryRun({ ...scenario(p, false), combo: "AA AA Q" });
    if (r && base)
      obs.push({
        probe: "active",
        hits: r.events.filter((e) => e.source === `item:${item.id}`),
        amped: 0,
        delta: r.totalDamage - base.totalDamage,
        dt: 0,
        stats: {},
      });
  }
  return obs;
}

/** Items for the rune probes (Jack of All Trades counts their stat types). */
const RUNE_PROBE_ITEMS = ["Sorcerer's Shoes", "Kindlegem"];

function runeObs(id: number, name: string, options: Record<string, number>): Obs[] {
  return observe(`rune:${id}`, name, (p, withEffect) =>
    tryRun({
      champion: p.champion,
      level: 18,
      items: RUNE_PROBE_ITEMS,
      runes: withEffect ? [id] : [],
      combo: p.combo,
      target: p.target,
      options: { ...p.options, ...options },
    }),
  );
}

/** Observations with the effect's options (stacks, "buff active" switches) at their max, then min, if the defaults show nothing. */
function observeWithOptions(effect: Effect | undefined, run: (options: Record<string, number>) => Obs[]): { obs: Obs[]; options?: string } {
  let obs = run({});
  for (const pick of ["max", "min"] as const) {
    if (obs.some(affects) || !effect?.options?.length) break;
    const options = Object.fromEntries(effect.options.map((o) => [o.key, (pick === "max" ? o.max : o.min) ?? (pick === "max" ? Math.max(1, o.default) : 0)]));
    obs = run(options);
    if (obs.some(affects))
      return {
        obs,
        options: Object.entries(options)
          .map(([k, v]) => `${k}=${v}`)
          .join(", "),
      };
  }
  return { obs };
}

// ---------------------------------------------------------------- comparison

interface Finding {
  check: string;
  text: string;
}

const norm = (s: string) =>
  s
    .toLowerCase()
    .replace(/\(.*?\)/g, "")
    .replace(/[^a-z0-9]/g, "");
const join = (s: Iterable<string>) => [...s].join("/");

function summarize(obs: Obs[]): string {
  return (
    obs
      .filter(affects)
      .map((o) => {
        const types = join(new Set(o.hits.map((h) => h.type)));
        const tags = [o.hits.some((h) => h.flags.onHit) && "on-hit", o.hits.some(isSpell) && "spell", o.hits.some((h) => h.flags.dot) && "dot"]
          .filter(Boolean)
          .join(",");
        const stats = Object.entries(o.stats)
          .slice(0, 4)
          .map(([k, v]) => `${k}${v > 0 ? "+" : ""}${+v.toFixed(3)}`)
          .join(" ");
        return [
          `${o.probe}:`,
          o.hits.length && `${o.hits.length}× ${types}${tags ? ` [${tags}]` : ""}`,
          o.amped && `amps ${o.amped} hits`,
          Math.abs(o.delta) >= 0.5 && `Δ${o.delta > 0 ? "+" : ""}${Math.round(o.delta)}`,
          Math.abs(o.dt) >= 0.01 && `Δt${o.dt > 0 ? "+" : ""}${o.dt.toFixed(2)}s`,
          stats,
        ]
          .filter(Boolean)
          .join(" ");
      })
      .join(" | ") || "no effect in any probe"
  );
}

/** Shortest gap between procs of one effect (DoT/aura ticks and repeat hits excluded). */
function minGap(obs: Obs[], label: string): number {
  let gap = Infinity;
  for (const o of obs) {
    const times = o.hits
      .filter((h) => h.label === label && !h.flags.dot && !h.flags.aura)
      .map((h) => h.time)
      .sort((a, b) => a - b);
    for (let i = 1; i < times.length; i++) if (times[i] - times[i - 1] > 0.01) gap = Math.min(gap, times[i] - times[i - 1]);
  }
  return gap;
}

function compare(wiki: WikiEntry, obs: Obs[], modeled: boolean, effect: Effect | undefined): Finding[] {
  const f: Finding[] = [];
  const hits = obs.flatMap((o) => o.hits);
  const dealing = wiki.effects.filter((e) => e.types.size);
  const wikiTypes = new Set(dealing.flatMap((e) => [...e.types]));
  if (!modeled) {
    const what = dealing.length
      ? `deals ${join(wikiTypes)} damage (${dealing.map((e) => e.name).join(", ")})`
      : wiki.effects.some((e) => e.amplifies)
        ? "amplifies damage"
        : "";
    if (what) f.push({ check: "UNMODELED", text: `stats only, but the wiki says it ${what}` });
    return f;
  }
  if (!obs.some(affects)) f.push({ check: "NO EFFECT", text: "modeled, but changes nothing in any probe" });
  if (dealing.length && !hits.length && obs.some(affects) && !wiki.effects.some((e) => e.amplifies))
    f.push({ check: "NO HITS", text: `wiki: ${dealing.map((e) => `${e.name} deals ${join(e.types)} damage`).join("; ")}; the sim deals none` });
  if (!dealing.length && hits.length)
    f.push({ check: "TYPE", text: `sim deals ${join(new Set(hits.map((h) => h.type)))} damage; the wiki names no damage type` });

  // Per sim hit label: the wiki effect of the same name, or the only damage-dealing one.
  for (const label of new Set(hits.map((h) => h.label))) {
    if (/\(repeat\)/.test(label)) continue;
    const group = hits.filter((h) => h.label === label);
    const named = wiki.effects.find((e) => norm(e.name) === norm(label));
    const we = named ?? (dealing.length === 1 ? dealing[0] : undefined);
    if (!we) continue;
    const types = new Set(group.map((h) => h.type));
    const tag = named ? label : `${label} (as ${we.name})`;
    if (we.types.size && [...types].some((t) => !we.types.has(t as DamageType)))
      f.push({ check: "TYPE", text: `${tag}: sim ${join(types)}, wiki ${join(we.types)}` });
    const simOnHit = group.some((h) => h.flags.onHit);
    if (we.types.size && we.onHit !== simOnHit)
      f.push({ check: "ON-HIT", text: `${tag}: ${we.onHit ? "wiki says on-hit; sim hits are not" : "sim hits are on-hit; the wiki does not say so"}` });
    const cd = Math.max(0, ...we.cooldowns);
    const gap = minGap(obs, label);
    if (cd && gap < cd - 0.05) f.push({ check: "COOLDOWN", text: `${tag}: procs ${gap.toFixed(2)}s apart; wiki cooldown ${cd}s` });
  }

  const c = wiki.categories;
  const spellNotes = (c.has("spell") || c.has("ability") || c.has("spell effects")) && !c.has("proc") && !c.has("no spell effects");
  const procNotes = (c.has("proc") || c.has("no spell effects") || c.has("basic")) && !c.has("spell") && !c.has("spell effects");
  if (hits.length && spellNotes && !hits.some(isSpell))
    f.push({ check: "SPELL", text: `wiki notes: ${[...c].join(", ")}; sim hits don't count as ability damage` });
  if (hits.length && procNotes && hits.every(isSpell)) f.push({ check: "SPELL", text: `wiki notes: ${[...c].join(", ")}; sim hits count as ability damage` });

  const act = wiki.effects.find((e) => e.active && e.cooldowns.length);
  if (act && effect?.active && Math.abs(effect.active.cooldown - act.cooldowns[0]) > 0.01)
    f.push({ check: "ACTIVE CD", text: `active cooldown ${effect.active.cooldown}s; wiki ${act.cooldowns[0]}s` });
  return f;
}

function statFindings(item: ItemData, wiki: WikiEntry): Finding[] {
  const f: Finding[] = [];
  const ours: Record<string, number> = { ...(item.stats as Record<string, number>) };
  for (const [k, v] of Object.entries(wiki.stats ?? {})) {
    const map = WIKI_STATS[k];
    if (!map) continue;
    const mine = (ours[map[0]] ?? 0) * map[1];
    delete ours[map[0]];
    if (Math.abs(mine - v) > 0.01) f.push({ check: "STAT", text: `${map[0]}: data ${+mine.toFixed(2)}, wiki ${v}` });
  }
  // Stats the wiki gives in a passive's text instead ("Gain 25% slow resist").
  const text = wiki.effects.map((e) => e.text).join(" ");
  for (const [k, v] of Object.entries(ours)) {
    const shown = PERCENT_STATS.has(k) ? `${+(v * 100).toFixed(1)}%` : String(+v.toFixed(1));
    if (v && !new RegExp(`(^|[^\\d.])${escapeRe(shown)}`).test(text)) f.push({ check: "STAT", text: `${k}: data ${shown}, not on the wiki` });
  }
  return f;
}

// ---------------------------------------------------------------- report

let findings = 0;
let reviewedCount = 0;
let entries = 0;
const noWiki: string[] = [];

function report(name: string, modeled: boolean, wiki: WikiEntry, obs: Obs[], options: string | undefined, fs: Finding[]) {
  entries++;
  const open = fs.filter((x) => !REVIEWED[`${name} ${x.check}`]);
  findings += open.length;
  reviewedCount += fs.length - open.length;
  if (!open.length && !showAll) return;
  const describe = (e: WikiEffect) => {
    const bits = [
      e.types.size && join(e.types),
      e.onHit && "on-hit",
      e.amplifies && "amplifies",
      e.cooldowns.length && `cd ${join(new Set(e.cooldowns.map(String)))}s`,
    ].filter(Boolean);
    return `${e.name}${bits.length ? ` (${bits.join(", ")})` : ""}`;
  };
  console.log(`${name}${modeled ? "" : " (stats only)"}`);
  console.log(`  wiki  ${wiki.effects.map(describe).join("; ") || "—"}${wiki.categories.size ? ` | notes: ${[...wiki.categories].join(", ")}` : ""}`);
  if (modeled) console.log(`  sim   ${summarize(obs)}${options ? ` (with ${options})` : ""}`);
  for (const x of fs) {
    const r = REVIEWED[`${name} ${x.check}`];
    if (r && !showAll) continue;
    console.log(`  ${(r ? "reviewed" : x.check).padEnd(9)} ${x.text}${r ? ` (${r})` : ""}`);
  }
}

const matches = (name: string) => !wanted.length || wanted.includes(name.toLowerCase());

if (only !== "runes") {
  console.log("== Items ==\n");
  for (const li of listItems(data).filter((i) => (i.tier >= 2 || i.gold >= 2000) && matches(i.name))) {
    const item = data.items[String(li.id)];
    const wiki = wikiItem(item);
    if (!wiki) {
      noWiki.push(item.name);
      continue;
    }
    const effect = new Sim(data, { champion: "Ahri", items: [item.id], combo: [] }).effects.find((e) => e.id === `item:${item.id}`);
    const { obs, options } = li.modeled ? observeWithOptions(effect, (o) => itemObs(item, effect, o)) : { obs: [], options: undefined };
    report(item.name, li.modeled, wiki, obs, options, [...statFindings(item, wiki), ...compare(wiki, obs, li.modeled, effect)]);
  }
}

if (only !== "items") {
  console.log("\n== Runes ==\n");
  for (const r of listRunes(data).filter((r) => r.slot !== "shard" && matches(r.name))) {
    const wiki = wikiRune(r.name);
    if (!wiki) {
      noWiki.push(r.name);
      continue;
    }
    const effect = new Sim(data, { champion: "Ahri", runes: [r.id], combo: [] }).effects.find((e) => e.id === `rune:${r.id}`);
    const { obs, options } = r.modeled ? observeWithOptions(effect, (o) => runeObs(r.id, r.name, o)) : { obs: [], options: undefined };
    report(r.name, r.modeled, wiki, obs, options, compare(wiki, obs, r.modeled, effect));
  }
}

if (noWiki.length) console.log(`\nNo wiki data for: ${noWiki.join(", ")}`);
console.log(`\n${entries} items and runes, ${findings} findings${reviewedCount ? `, ${reviewedCount} reviewed` : ""}.`);
console.log(`Probes (level 18): ${PROBES.map((p) => `${p.key} = ${p.champion} ${p.combo}`).join("; ")}.`);
