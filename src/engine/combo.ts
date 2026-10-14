// Combo steps and the shorthand parser ("E Q AA W R AA ignite").

import type { Slot } from './effects.ts';

export type ComboStep =
  | {
      type: 'ability';
      slot: Slot;
      /** Variant key from the kit (e.g. "empowered", "Q2"). */
      variant?: string;
      /** Override hit counts per component id (0 disables a component). */
      hits?: Record<string, number>;
      /** Enable optional components by id. */
      enable?: string[];
      /** Treat this cast as missing the target (still triggers on-cast effects). */
      miss?: boolean;
    }
  | { type: 'attack'; count?: number; crit?: boolean; /** Enable optional on-hit components (e.g. "AA+bounce"). */ enable?: string[] }
  | { type: 'item'; item: number | string }
  | { type: 'summoner'; spell: 'ignite' }
  | { type: 'wait'; seconds: number };

const SLOTS = new Set(['P', 'Q', 'W', 'E', 'R']);

/**
 * Shorthand grammar (tokens separated by spaces, commas or ">"):
 *   Q W E R P          cast an ability (P = passive proc where the kit defines one)
 *   Q:empowered        cast a variant
 *   Q{out:1,back:0}    override component hit counts
 *   Q+bonus            enable an optional component
 *   AA  A  AA*3  3AA   basic attacks;  AA! = forced crit,  AA? = forced non-crit
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
    if ((m = /^([PQWER])(?:[:.]([A-Za-z0-9_-]+))?(\{[^}]*\})?((?:\+[A-Za-z0-9_-]+)*)(?:\s*[x*]\s*(\d+))?$/i.exec(tok))) {
      const slot = m[1].toUpperCase() as Slot;
      if (!SLOTS.has(slot)) throw new Error(`bad ability "${tok}"`);
      const step: ComboStep = { type: 'ability', slot };
      if (m[2]) step.variant = m[2];
      if (m[3]) {
        step.hits = {};
        for (const kv of m[3].slice(1, -1).split(/[;,]/).filter(Boolean)) {
          const [k, v] = kv.split(':');
          step.hits[k.trim()] = Number(v);
        }
      }
      if (m[4]) step.enable = m[4].split('+').filter(Boolean);
      const times = Number(m[5] ?? 1);
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
          if (s.hits && Object.keys(s.hits).length) t += '{' + Object.entries(s.hits).map(([k, v]) => `${k}:${v}`).join(',') + '}';
          if (s.enable?.length) t += s.enable.map((e) => '+' + e).join('');
          return t;
        }
        case 'attack':
          return (s.count && s.count > 1 ? `AA*${s.count}` : 'AA') + (s.crit === true ? '!' : s.crit === false ? '?' : '') + (s.enable?.length ? s.enable.map((e) => '+' + e).join('') : '');
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
