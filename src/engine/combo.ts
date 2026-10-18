// Combo steps and the shorthand parser ("E Q AA W R AA ignite").

import type { Slot } from "./effects.ts";
import type { AbilitySpec, ChampionKit, VariantSpec } from "./kit-types.ts";
import type { CastSetting } from "./sim.ts";

export type ComboStep =
  | {
      type: "ability";
      slot: Slot;
      /** Variant key from the kit (e.g. "empowered", "Q2"). */
      variant?: string;
      /** Override hit counts per component id (0 disables a component). */
      hits?: Record<string, number>;
      /** Seconds the cast lasts, where the player chooses it (Smolder E's flight, Karthus E's toggle), or is held to charge (Sion Q). */
      duration?: number;
      /** How many of its hits it fires, the first in the order they're fired, where the player chooses it (Xerath R's and Jhin R's shots). */
      count?: number;
      /** How far the target stands for the cast, in units, where what it deals goes by it (Nidalee's Javelin Toss). */
      distance?: number;
      /** Enable optional components by id. */
      enable?: string[];
      /** Treat this cast as missing the target (still triggers on-cast effects). */
      miss?: boolean;
      /** Crit mark ("Q!", "Q?"): see the attack step's. */
      crit?: boolean;
    }
  | {
      type: "attack";
      count?: number;
      /**
       * Crit mark ("AA!", "AA?"): true crits, false doesn't, unset deals the expected value. It holds
       * for every crit the step causes, follow-up attacks included (Akshan's second shot).
       */
      crit?: boolean;
      /** Enable optional on-hit components (e.g. "AA+bounce"). */
      enable?: string[];
    }
  | { type: "item"; item: number | string }
  | { type: "summoner"; spell: "ignite" }
  | {
      type: "wait";
      /** Default 1. */
      seconds?: number;
    };

export type AbilityStep = Extract<ComboStep, { type: "ability" }>;

/** `spec`'s variant called `key` in any case (Q:Tornado for Q:tornado), and its own key. */
export function findVariant(spec: AbilitySpec | undefined, key: string): [string, VariantSpec] | undefined {
  return Object.entries(spec?.variants ?? {}).find(([k]) => k.toLowerCase() === key.toLowerCase());
}

/** Whether `kit` makes something of a P step: hits, variants or a buff (Kha'Zix's Unseen Threat). */
export function hasPassiveStep(kit: ChampionKit): boolean {
  const p = kit.abilities.P;
  return !!(p?.components?.length || Object.keys(p?.variants ?? {}).length || p?.buff);
}

const SLOTS = new Set(["P", "Q", "W", "E", "R"]);

/**
 * Shorthand grammar (tokens separated by spaces, commas or ">"):
 *   Q W E R P          cast an ability (P = passive proc where the kit defines one)
 *   Q:empowered        cast a variant
 *   Q{out:1,back:0}    override component hit counts
 *   E{0.5s}  R{3}      how long the cast lasts (a channel ended early, a toggle left on, a
 *                      charge held), or how many hits it fires (Xerath R's and Jhin R's shots)
 *   Q{1300u}           how far the target stands for the cast (Nidalee's Javelin Toss)
 *   Q+bonus            enable an optional component
 *   AA  A  AA*3  3AA   basic attacks;  AA! = forced crit,  AA? = forced non-crit
 *   Q!  Q?             a cast whose hits that can crit all crit, or none do
 *   ignite             Ignite
 *   item:3152  item:rocketbelt   item active by id or name
 *   wait  wait{1.5s}   wait 1 second, or that many
 */
export function parseCombo(src: string): ComboStep[] {
  const steps: ComboStep[] = [];
  const tokens = src
    .replace(/\{[^}]*\}/g, (m) => m.replace(/[\s,]+/g, ";"))
    .split(/[\s,>]+/)
    .filter(Boolean);
  for (const raw of tokens) {
    const tok = raw.trim();
    let m: RegExpExecArray | null;
    if ((m = /^(?:(\d+)\s*[x*]?\s*)?(AA|A)(?:\s*[x*]\s*(\d+))?([!?])?((?:\+[A-Za-z0-9_-]+)*)$/i.exec(tok))) {
      const count = Number(m[1] ?? m[3] ?? 1);
      if (count < 1) throw new Error(`"${tok}" attacks 0 times (expected 1 or more)`);
      const enable = m[5] ? m[5].split("+").filter(Boolean) : [];
      steps.push({ type: "attack", count, ...(m[4] === "!" ? { crit: true } : m[4] === "?" ? { crit: false } : {}), ...(enable.length ? { enable } : {}) });
      continue;
    }
    if ((m = /^wait(?:\{(\d*\.?\d+)s?\})?$/i.exec(tok))) {
      steps.push(m[1] !== undefined ? { type: "wait", seconds: Number(m[1]) } : { type: "wait" });
      continue;
    }
    if (/^(ignite|ign|dot)$/i.test(tok)) {
      steps.push({ type: "summoner", spell: "ignite" });
      continue;
    }
    if ((m = /^item:(.+)$/i.exec(tok))) {
      const v = m[1].replace(/_/g, " ");
      steps.push({ type: "item", item: /^\d+$/.test(v) ? Number(v) : v });
      continue;
    }
    if ((m = /^([PQWER])(?:[:.]([A-Za-z0-9_-]+))?(\{[^}]*\})?([!?])?((?:\+[A-Za-z0-9_-]+)*)(?:\s*[x*]\s*(\d+))?$/i.exec(tok))) {
      const slot = m[1].toUpperCase() as Slot;
      if (!SLOTS.has(slot)) throw new Error(`bad ability "${tok}"`);
      const step: ComboStep = { type: "ability", slot };
      if (m[2]) step.variant = m[2];
      if (m[3]) {
        for (const kv of m[3].slice(1, -1).split(/[;,]/).filter(Boolean)) {
          const n = /^(\d*\.?\d+)(s|u)?$/i.exec(kv.trim());
          if (n) {
            if (n[2]?.toLowerCase() === "s") step.duration = Number(n[1]);
            else if (n[2]) step.distance = Number(n[1]);
            else step.count = Number(n[1]);
            continue;
          }
          const [k, v] = kv.split(":");
          if (v === undefined || !/^\s*\d+\s*$/.test(v))
            throw new Error(`bad "${kv}" in "${tok}" (expected seconds like {0.5s}, a count like {3}, a distance like {1300u}, or hits like {id:3})`);
          (step.hits ??= {})[k.trim()] = Number(v);
        }
      }
      if (m[4]) step.crit = m[4] === "!";
      if (m[5]) step.enable = m[5].split("+").filter(Boolean);
      const times = Number(m[6] ?? 1);
      if (times < 1) throw new Error(`"${tok}" casts 0 times (expected 1 or more)`);
      for (let i = 0; i < times; i++) steps.push({ ...step });
      continue;
    }
    throw new Error(`can't parse combo token "${tok}" (expected Q/W/E/R/P, AA, ignite, item:<name>, wait{<s>s})`);
  }
  return steps;
}

export function formatCombo(steps: ComboStep[]): string {
  return steps
    .map((s) => {
      switch (s.type) {
        case "ability": {
          let t = s.slot + (s.variant ? ":" + s.variant : "");
          const inner = [
            ...(s.duration !== undefined ? [`${s.duration}s`] : []),
            ...(s.count !== undefined ? [String(s.count)] : []),
            ...(s.distance !== undefined ? [`${s.distance}u`] : []),
            ...Object.entries(s.hits ?? {}).map(([k, v]) => `${k}:${v}`),
          ];
          if (inner.length) t += "{" + inner.join(",") + "}";
          t += critSuffix(s.crit);
          if (s.enable?.length) t += s.enable.map((e) => "+" + e).join("");
          return t;
        }
        case "attack":
          return (s.count && s.count > 1 ? `AA*${s.count}` : "AA") + critSuffix(s.crit) + (s.enable?.length ? s.enable.map((e) => "+" + e).join("") : "");
        case "item":
          return `item:${String(s.item).replace(/\s+/g, "_")}`;
        case "summoner":
          return "ignite";
        case "wait":
          return s.seconds === undefined ? "wait" : `wait{${s.seconds}s}`;
      }
    })
    .join(" ");
}

const critSuffix = (crit?: boolean) => (crit === true ? "!" : crit === false ? "?" : "");

/** The optional hits an attack step can enable (AA+id): among the kit's on-hits and its abilities' empowered attacks. */
export function attackOptions(kit: ChampionKit): Set<string> {
  const specs = Object.values(kit.abilities).flatMap((a) => [a, ...Object.values(a?.variants ?? {})]);
  const buffs = specs.flatMap((s) => (Array.isArray(s?.buff) ? s.buff : s?.buff ? [s.buff] : []));
  const comps = [
    ...(kit.attack?.onHit ?? []),
    ...(kit.attack?.everyNth?.components ?? []),
    ...buffs.flatMap((b) => [...(b.onHit ?? []), ...(b.empowerAttacks?.components ?? [])]),
  ];
  return new Set(comps.filter((c) => c.optional).map((c) => c.id));
}

/**
 * The steps as `kit`'s champion takes them, for a champion switch: another champion's variants,
 * durations, counts, hit counts, optional hits and crit marks are dropped.
 */
export function fitCombo(steps: ComboStep[], kit: ChampionKit): ComboStep[] {
  const onAttack = attackOptions(kit);
  const keep = <T>(xs: T[] | undefined, ok: (x: T) => boolean) => {
    const kept = (xs ?? []).filter(ok);
    return kept.length ? kept : undefined;
  };
  // A crit mark stays where the step can still crit.
  const critFit = (step: MarkableStep): ComboStep => {
    if (rollsCrits(step, kit)) return step;
    const { crit: _, ...rest } = step;
    return rest;
  };
  return steps.map((step) => {
    if (step.type === "attack") {
      const { enable, ...rest } = step;
      const kept = keep(enable, (id) => onAttack.has(id));
      return critFit(kept ? { ...rest, enable: kept } : rest);
    }
    if (step.type !== "ability") return step;
    const spec = kit.abilities[step.slot];
    const { variant: key, duration, count, distance, hits, enable, ...rest } = step;
    const [variant, vspec] = (key && findVariant(spec, key)) || [];
    const comps = vspec?.components ?? spec?.components ?? [];
    const keptHits = Object.entries(hits ?? {}).filter(([id]) => comps.some((c) => c.id === id));
    const kept = keep(enable, (id) => comps.some((c) => c.id === id && c.optional));
    return critFit({
      ...rest,
      ...(variant ? { variant } : {}),
      ...(duration !== undefined && (spec?.variableDuration || spec?.charge) ? { duration } : {}),
      ...(count !== undefined && spec?.variableCount ? { count } : {}),
      ...(distance !== undefined && spec?.variableDistance ? { distance } : {}),
      ...(keptHits.length ? { hits: Object.fromEntries(keptHits) } : {}),
      ...(kept ? { enable: kept } : {}),
    });
  });
}

/**
 * The steps with each number they set kept within what its cast allows now (`range`, a CastSetting),
 * and dropped where it takes none: after a lower rank, Xerath's R{5} fires 4 shots and says so, and
 * Ahri's Q{3} is a plain Q.
 */
export function clampCombo(steps: ComboStep[], range: (step: AbilityStep) => Pick<CastSetting, "kind" | "min" | "max"> | null): ComboStep[] {
  return steps.map((step) => {
    if (step.type !== "ability" || (step.duration === undefined && step.count === undefined && step.distance === undefined)) return step;
    const r = range(step);
    const key = settingKey(r?.kind ?? "lasts");
    const v = step[key];
    const c = r && v !== undefined ? Math.max(r.min, Math.min(key === "count" ? Math.round(v) : v, r.max)) : undefined;
    if (c === v && SETTING_KEYS.every((k) => k === key || step[k] === undefined)) return step;
    const { duration: _d, count: _c, distance: _x, ...rest } = step;
    return c === undefined ? rest : { ...rest, [key]: c };
  });
}

/** The step fields the cast settings set. */
export const SETTING_KEYS = ["duration", "count", "distance"] as const;
/** Which of them a cast setting's number goes in. */
export const settingKey = (kind: CastSetting["kind"]): (typeof SETTING_KEYS)[number] =>
  kind === "count" ? "count" : kind === "distance" ? "distance" : "duration";

/** How crits resolve: their expected value, or every crit-capable hit crits or doesn't. */
export type CritMode = "expected" | "always" | "never";

type MarkableStep = Extract<ComboStep, { type: "attack" | "ability" }>;
const CRIT_MARK: Record<CritMode, boolean | undefined> = { expected: undefined, always: true, never: false };
const markMode = (crit?: boolean): CritMode => (crit === true ? "always" : crit === false ? "never" : "expected");

/** Whether a step rolls crits: basic attacks (unless the champion's can't crit), and casts with a hit
 *  that can crit (its variant's hits, for a variant). */
export function rollsCrits(step: ComboStep, kit: ChampionKit): boolean {
  if (step.type === "attack") return kit.attack?.canCrit !== false;
  if (step.type !== "ability") return false;
  const spec = kit.abilities[step.slot];
  const key = step.variant ?? spec?.defaultVariant;
  const variant = key ? findVariant(spec, key)?.[1] : undefined;
  return !!spec?.followUpCrits || (variant?.components ?? spec?.components ?? []).some((c) => c.canCrit || (c.attack && c.canCrit !== false));
}

/** A step with the crit mark for `mode` (none for expected), if it rolls crits. */
export function markCrit(step: ComboStep, kit: ChampionKit, mode: CritMode): ComboStep {
  if (!rollsCrits(step, kit)) return step;
  const { crit: _, ...rest } = step as MarkableStep;
  const crit = CRIT_MARK[mode];
  return crit === undefined ? rest : { ...rest, crit };
}

/** How the steps that roll crits are marked: their mode when they agree, 'mixed' when they don't,
 *  null when no step rolls crits. */
export function critMarking(steps: ComboStep[], kit: ChampionKit): CritMode | "mixed" | null {
  const modes = new Set(steps.filter((s) => rollsCrits(s, kit)).map((s) => markMode((s as MarkableStep).crit)));
  return modes.size === 0 ? null : modes.size > 1 ? "mixed" : [...modes][0];
}
