// Combo steps and the shorthand parser ("E Q AA W R AA ignite").

import type { Slot } from './effects.ts';
import type { ChampionKit, ComponentSpec } from './kit-types.ts';

export type ComboStep =
  | {
      type: 'ability';
      slot: Slot;
      /** Variant key from the kit (e.g. "empowered", "Q2"). */
      variant?: string;
      /** Override hit counts per component id (0 disables a component). */
      hits?: Record<string, number>;
      /** Seconds the cast lasts, where the player chooses it (Smolder E's flight, Karthus E's toggle), or is held to charge (Sion Q). */
      duration?: number;
      /** Enable optional components by id. */
      enable?: string[];
      /** Treat this cast as missing the target (still triggers on-cast effects). */
      miss?: boolean;
      /** Crit mark ("Q!", "Q?"): see the attack step's. */
      crit?: boolean;
    }
  | {
      type: 'attack';
      count?: number;
      /**
       * Crit mark ("AA!", "AA?"): true crits, false doesn't, unset deals the expected value. It holds
       * for every crit the step causes, follow-up attacks included (Akshan's second shot).
       */
      crit?: boolean;
      /** Enable optional on-hit components (e.g. "AA+bounce"). */
      enable?: string[];
    }
  | { type: 'item'; item: number | string }
  | { type: 'summoner'; spell: 'ignite' }
  | { type: 'wait'; seconds: number };

const SLOTS = new Set(['P', 'Q', 'W', 'E', 'R']);

/**
 * Shorthand grammar (tokens separated by spaces, commas or ">"):
 *   Q W E R P          cast an ability (P = passive proc where the kit defines one)
 *   Q:empowered        cast a variant
 *   Q{out:1,back:0}    override component hit counts
 *   E{0.5s}            how long the cast lasts (a channel ended early, a toggle left on)
 *   Q+bonus            enable an optional component
 *   AA  A  AA*3  3AA   basic attacks;  AA! = forced crit,  AA? = forced non-crit
 *   Q!  Q?             a cast whose hits that can crit all crit, or none do
 *   ignite             Ignite
 *   item:3152  item:rocketbelt   item active by id or name
 *   wait:1.5  ~1.5     wait seconds
 */
export function parseCombo(src: string): ComboStep[] {
  const steps: ComboStep[] = [];
  const tokens = src
    .replace(/\{[^}]*\}/g, (m) => m.replace(/[\s,]+/g, ';'))
    .split(/[\s,>]+/)
    .filter(Boolean);
  for (const raw of tokens) {
    const tok = raw.trim();
    let m: RegExpExecArray | null;
    if ((m = /^(?:(\d+)\s*[x*]?\s*)?(AA|A)(?:\s*[x*]\s*(\d+))?([!?])?((?:\+[A-Za-z0-9_-]+)*)$/i.exec(tok))) {
      const count = Number(m[1] ?? m[3] ?? 1);
      const enable = m[5] ? m[5].split('+').filter(Boolean) : [];
      steps.push({ type: 'attack', count, ...(m[4] === '!' ? { crit: true } : m[4] === '?' ? { crit: false } : {}), ...(enable.length ? { enable } : {}) });
      continue;
    }
    if ((m = /^(?:wait:|~)(\d*\.?\d+)s?$/i.exec(tok))) {
      steps.push({ type: 'wait', seconds: Number(m[1]) });
      continue;
    }
    if (/^(ignite|ign|dot)$/i.test(tok)) {
      steps.push({ type: 'summoner', spell: 'ignite' });
      continue;
    }
    if ((m = /^item:(.+)$/i.exec(tok))) {
      const v = m[1].replace(/_/g, ' ');
      steps.push({ type: 'item', item: /^\d+$/.test(v) ? Number(v) : v });
      continue;
    }
    if ((m = /^([PQWER])(?:[:.]([A-Za-z0-9_-]+))?(\{[^}]*\})?([!?])?((?:\+[A-Za-z0-9_-]+)*)(?:\s*[x*]\s*(\d+))?$/i.exec(tok))) {
      const slot = m[1].toUpperCase() as Slot;
      if (!SLOTS.has(slot)) throw new Error(`bad ability "${tok}"`);
      const step: ComboStep = { type: 'ability', slot };
      if (m[2]) step.variant = m[2];
      if (m[3]) {
        for (const kv of m[3].slice(1, -1).split(/[;,]/).filter(Boolean)) {
          const secs = /^(\d*\.?\d+)s$/i.exec(kv.trim());
          if (secs) {
            step.duration = Number(secs[1]);
            continue;
          }
          const [k, v] = kv.split(':');
          if (v === undefined || !Number.isFinite(Number(v))) throw new Error(`bad "${kv}" in "${tok}" (expected seconds like {0.5s}, or hits like {id:3})`);
          (step.hits ??= {})[k.trim()] = Number(v);
        }
      }
      if (m[4]) step.crit = m[4] === '!';
      if (m[5]) step.enable = m[5].split('+').filter(Boolean);
      const times = Number(m[6] ?? 1);
      for (let i = 0; i < times; i++) steps.push({ ...step });
      continue;
    }
    throw new Error(`can't parse combo token "${tok}" (expected Q/W/E/R/P, AA, ignite, item:<name>, wait:<s>)`);
  }
  return steps;
}

export function formatCombo(steps: ComboStep[]): string {
  return steps
    .map((s) => {
      switch (s.type) {
        case 'ability': {
          let t = s.slot + (s.variant ? ':' + s.variant : '');
          const inner = [
            ...(s.duration !== undefined ? [`${s.duration}s`] : []),
            ...Object.entries(s.hits ?? {}).map(([k, v]) => `${k}:${v}`),
          ];
          if (inner.length) t += '{' + inner.join(',') + '}';
          t += critSuffix(s.crit);
          if (s.enable?.length) t += s.enable.map((e) => '+' + e).join('');
          return t;
        }
        case 'attack':
          return (s.count && s.count > 1 ? `AA*${s.count}` : 'AA') + critSuffix(s.crit) + (s.enable?.length ? s.enable.map((e) => '+' + e).join('') : '');
        case 'item':
          return `item:${String(s.item).replace(/\s+/g, '_')}`;
        case 'summoner':
          return 'ignite';
        case 'wait':
          return `wait:${s.seconds}`;
      }
    })
    .join(' ');
}

const critSuffix = (crit?: boolean) => (crit === true ? '!' : crit === false ? '?' : '');

/**
 * The steps as `kit`'s champion takes them, for a champion switch: another champion's variants,
 * durations, hit counts, optional hits and crit marks are dropped.
 */
export function fitCombo(steps: ComboStep[], kit: ChampionKit): ComboStep[] {
  // Optional hits an attack step can enable: the kit's on-hits and its abilities' empowered attacks.
  const onAttack = new Set(
    [
      ...(kit.attack?.onHit ?? []),
      ...(kit.attack?.everyNth?.components ?? []),
      ...Object.values(kit.abilities).flatMap((a) => (Array.isArray(a?.buff) ? a.buff : a?.buff ? [a.buff] : []).flatMap((b) => [...(b.onHit ?? []), ...(b.empowerAttacks?.components ?? [])])),
    ].map((c) => c.id),
  );
  const keep = <T,>(xs: T[] | undefined, ok: (x: T) => boolean) => {
    const kept = (xs ?? []).filter(ok);
    return kept.length ? kept : undefined;
  };
  return steps.map((step) => {
    if (step.type === 'attack') {
      const { enable, ...rest } = step;
      const kept = keep(enable, (id) => onAttack.has(id));
      return markCrit(kept ? { ...rest, enable: kept } : rest, kit, markMode(step.crit), true);
    }
    if (step.type !== 'ability') return step;
    const spec = kit.abilities[step.slot];
    const { variant: key, duration, hits, enable, ...rest } = step;
    const variant = key ? Object.keys(spec?.variants ?? {}).find((k) => k.toLowerCase() === key.toLowerCase()) : undefined;
    const ids = new Set(((variant ? spec?.variants?.[variant].components : spec?.components) ?? ([] as ComponentSpec[])).map((c) => c.id));
    const kept = Object.entries(hits ?? {}).filter(([id]) => ids.has(id));
    const fitted: ComboStep = {
      ...rest,
      ...(variant ? { variant } : {}),
      ...(duration !== undefined && (spec?.variableDuration || spec?.charge) ? { duration } : {}),
      ...(kept.length ? { hits: Object.fromEntries(kept) } : {}),
      ...(keep(enable, (id) => ids.has(id)) ? { enable: keep(enable, (id) => ids.has(id)) } : {}),
    };
    return markCrit(fitted, kit, markMode(step.crit), true);
  });
}

/** How crits resolve: their expected value, or every crit-capable hit crits or doesn't. */
export type CritMode = 'expected' | 'always' | 'never';

type MarkableStep = Extract<ComboStep, { type: 'attack' | 'ability' }>;
const CRIT_MARK: Record<CritMode, boolean | undefined> = { expected: undefined, always: true, never: false };
const markMode = (crit?: boolean): CritMode => (crit === true ? 'always' : crit === false ? 'never' : 'expected');

/** Whether a step rolls crits: basic attacks (unless the champion's can't crit), and casts with a hit
 *  that can crit (its variant's hits, for a variant). */
export function rollsCrits(step: ComboStep, kit: ChampionKit): boolean {
  const attacksCrit = kit.attack?.canCrit !== false;
  if (step.type === 'attack') return attacksCrit;
  if (step.type !== 'ability') return false;
  const spec = kit.abilities[step.slot];
  const key = step.variant ?? spec?.defaultVariant;
  const variant = key ? Object.entries(spec?.variants ?? {}).find(([k]) => k.toLowerCase() === key.toLowerCase())?.[1] : undefined;
  return (variant?.components ?? spec?.components ?? []).some((c) => c.canCrit || (c.attack && c.canCrit !== false && attacksCrit));
}

/** A step with the crit mark for `mode` (none for expected), if it rolls crits; `clear`: else without one. */
export function markCrit(step: ComboStep, kit: ChampionKit, mode: CritMode, clear = false): ComboStep {
  if (!rollsCrits(step, kit)) {
    if (!clear || (step.type !== 'attack' && step.type !== 'ability')) return step;
    const { crit: _, ...rest } = step;
    return rest;
  }
  const { crit: _, ...rest } = step as MarkableStep;
  const crit = CRIT_MARK[mode];
  return crit === undefined ? rest : { ...rest, crit };
}

/** How the steps that roll crits are marked: their mode when they agree, 'mixed' when they don't,
 *  null when no step rolls crits. */
export function critMarking(steps: ComboStep[], kit: ChampionKit): CritMode | 'mixed' | null {
  const modes = new Set(steps.filter((s) => rollsCrits(s, kit)).map((s) => markMode((s as MarkableStep).crit)));
  return modes.size === 0 ? null : modes.size > 1 ? 'mixed' : [...modes][0];
}
