// Generates a best-effort kit from tooltips, for champions without a curated kit.
//
// Every <physicalDamage>/<magicDamage>/<trueDamage> span in an ability tooltip becomes a damage
// component whose amount is the game formula referenced inside the span — so per-hit numbers match
// the in-game tooltip. What can't be inferred reliably (hit counts, conditions, which spans are
// alternatives of each other) is flagged: only the first span of each ability is on by default.

import type { ChampionData, SpellData } from './data-types.ts';
import type { AbilitySpec, ChampionKit, ComponentSpec } from './kit-types.ts';

const SPAN = /<(physicalDamage|magicDamage|trueDamage)>([\s\S]*?)<\/\1>/g;
const REF = /@([^@]+)@/g;

const TYPE: Record<string, ComponentSpec['type']> = { physicalDamage: 'physical', magicDamage: 'magic', trueDamage: 'true' };

export interface ParsedRef {
  raw: string;
  /** Expression for the referenced value (in game units, e.g. 0.04 for 4%). */
  expr: string | null;
  kind: 'calc' | 'dv' | 'ext' | 'unknown';
  pctCalc: boolean;
  mult: number;
  after: string;
}

function findKey<T>(obj: Record<string, T>, name: string): string | undefined {
  if (name in obj) return name;
  const l = name.toLowerCase();
  return Object.keys(obj).find((k) => k.toLowerCase() === l);
}

function q(name: string) {
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(name) ? `.${name}` : `['${name}']`;
}

export function parseRef(spell: SpellData, ref: string, after: string, allSpells: SpellData[]): ParsedRef {
  let [name, multStr] = ref.split('*');
  const mult = multStr ? Number(multStr) : 1;
  let target = spell;
  let prefix = '';
  const m = /^spell\.([^:]+):(.+)$/.exec(name);
  if (m) {
    const s = allSpells.find((x) => x.scriptName.toLowerCase() === m[1].toLowerCase());
    if (!s) return { raw: ref, expr: null, kind: 'unknown', pctCalc: false, mult, after };
    target = s;
    name = m[2];
    prefix = `spell['${s.scriptName}']`;
  }
  const ck = findKey(target.calcs, name);
  if (ck) {
    return { raw: ref, expr: `${prefix || ''}${prefix ? '.calc' : 'calc'}${q(ck)}`, kind: prefix ? 'ext' : 'calc', pctCalc: !!target.calcs[ck].pct, mult, after };
  }
  const dk = findKey(target.dataValues, name);
  if (dk) return { raw: ref, expr: `${prefix || ''}${prefix ? '.dv' : 'dv'}${q(dk)}`, kind: prefix ? 'ext' : 'dv', pctCalc: false, mult, after };
  return { raw: ref, expr: null, kind: 'unknown', pctCalc: false, mult, after };
}

function healthBasis(after: string): string | null {
  const a = after.toLowerCase();
  if (/^\s*%?\s*(of\s+(the\s+)?(target'?s\s+)?)?(max(imum)?)\s+health/.test(a)) return 'target.maxHp';
  if (/^\s*%?\s*(of\s+(the\s+)?(target'?s\s+)?)?current\s+health/.test(a)) return 'target.hp';
  if (/^\s*%?\s*(of\s+(the\s+)?(target'?s\s+)?)?missing[\s-]+health/.test(a)) return 'target.missingHp';
  if (/^\s*%?\s*(of\s+(the\s+)?(target'?s\s+)?)?bonus\s+health/.test(a)) return 'target.bonusHp';
  return null;
}

/** Turn one damage span into an amount expression, or null when it can't be interpreted. */
export function spanToExpr(spell: SpellData, inner: string, allSpells: SpellData[]): { exprs: string[]; range: boolean } | null {
  const refs: ParsedRef[] = [];
  const matches = [...inner.matchAll(REF)];
  matches.forEach((mm, i) => {
    const after = inner.slice(mm.index! + mm[0].length, matches[i + 1]?.index ?? inner.length);
    refs.push(parseRef(spell, mm[1], after, allSpells));
  });
  if (!refs.length || refs.some((r) => !r.expr)) return null;
  const terms: string[] = [];
  for (const r of refs) {
    const basis = healthBasis(r.after);
    let v = r.expr!;
    if (r.mult !== 1 && !(r.mult === 100 && /^\s*%/.test(r.after))) v = `${v} * ${r.mult}`;
    if (basis) {
      const isFraction = r.pctCalc || (r.mult === 100 && /^\s*%/.test(r.after));
      if (!isFraction && /^\s*%/.test(r.after)) v = `${v} / 100`;
      terms.push(`${v} * ${basis}`);
    } else {
      if (r.pctCalc || /^\s*%/.test(r.after)) return null; // percent of something we can't identify
      terms.push(v);
    }
  }
  // "A to B" / "A - B": a range, not a sum.
  if (refs.length === 2 && /^\s*(to|-|–)\s*$/i.test(refs[0].after)) return { exprs: terms, range: true };
  return { exprs: [terms.join(' + ')], range: false };
}

function stripTags(s: string) {
  return s
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<[^>]+>/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Text around a span, to explain the component. */
function context(tooltip: string, index: number, length: number): string {
  const before = stripTags(tooltip.slice(Math.max(0, index - 120), index)).split(/[.!:]/).pop() ?? '';
  const after = stripTags(tooltip.slice(index + length, index + length + 80)).split(/[.<]/)[0] ?? '';
  return `${before.trim()} [damage] ${after.trim()}`.trim();
}

export function autoComponents(spell: SpellData, allSpells: SpellData[], slot: string): ComponentSpec[] {
  const out: ComponentSpec[] = [];
  const tip = spell.tooltip ?? '';
  let i = 0;
  for (const m of tip.matchAll(SPAN)) {
    const parsed = spanToExpr(spell, m[2], allSpells);
    if (!parsed) continue;
    const type = TYPE[m[1]];
    const ctx = context(tip, m.index!, m[0].length);
    const perSecond = /per second|each second|every second/i.test(tip.slice(m.index! + m[0].length, m.index! + m[0].length + 30));
    const base = {
      type,
      note: `Tooltip: "${ctx}"${perSecond ? ' (per second)' : ''}`,
      ...(perSecond ? { dot: true } : {}),
    };
    if (parsed.range) {
      out.push({ id: `${slot.toLowerCase()}${++i}min`, label: `${slot} damage ${i} (min)`, amount: parsed.exprs[0], ...base, optional: out.length > 0 });
      out.push({ id: `${slot.toLowerCase()}${i}max`, label: `${slot} damage ${i} (max)`, amount: parsed.exprs[1], ...base, optional: true });
    } else {
      out.push({ id: `${slot.toLowerCase()}${++i}`, label: `${slot} damage ${i}`, amount: parsed.exprs[0], ...base, optional: out.length > 0 });
    }
  }
  return out;
}

export function autoKit(champ: ChampionData): ChampionKit {
  const all = champ.abilities.flatMap((a) => a.spells);
  const abilities: ChampionKit['abilities'] = {};
  for (const slot of ['P', 'Q', 'W', 'E', 'R'] as const) {
    const ab = champ.abilities.find((a) => a.slot === slot);
    if (!ab) continue;
    const spell = ab.spells[0];
    const comps = autoComponents(spell, all, slot);
    // Passive damage is conditional; leave everything opt-in for the P step except the first.
    const spec: AbilitySpec = { components: comps };
    abilities[slot] = spec;
  }
  return { id: champ.id, status: 'auto', abilities };
}
