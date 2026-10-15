// Render ability tooltips with numbers filled in, for display and for checking against the client.

import type { CalcNode, ItemData, RuneData, SpellData } from './data-types.ts';
import type { Sim } from './sim.ts';
import type { Slot } from './effects.ts';
import { adaptiveDamageType } from './runes.ts';

export function formatNumber(v: number, precision?: number): string {
  if (!Number.isFinite(v)) return '?';
  if (precision !== undefined && precision >= 0) return String(Number(v.toFixed(precision)));
  const abs = Math.abs(v);
  if (abs >= 100) return String(Math.round(v));
  if (abs >= 10) return String(Number(v.toFixed(1)));
  return String(Number(v.toFixed(2)));
}

/** A calculation's value as tooltip text. A modified calculation shows like the one it modifies
 *  (Jax's max attack speed: 76%, not 0.76). */
function formatCalc(calcs: Record<string, CalcNode>, name: string, v: number): string {
  const display = (n: string, depth = 0): { pct?: boolean; precision?: number } => {
    const node = calcs[n];
    if (node?.t !== 'mod' || depth > 5) return node ?? {};
    const of = display(node.of, depth + 1);
    return { pct: node.pct ?? of.pct, precision: node.precision ?? of.precision };
  };
  const { pct, precision } = display(name);
  return pct ? `${formatNumber(v * 100, precision)}%` : formatNumber(v, precision);
}

/** Replace @Placeholders@ in a tooltip with values evaluated in the simulator's current state. */
export function renderTooltip(sim: Sim, slot: Slot, spell: SpellData, rank?: number, opts: { html?: boolean } = {}): string {
  const r = rank ?? sim.abilityRank(slot);
  const all = sim.champ.abilities.flatMap((a) => a.spells);
  const text = spell.tooltip.replace(/@([^@]+)@/g, (_m, ref: string) => {
    let [name, multStr] = ref.split('*');
    const mult = multStr ? Number(multStr) : 1;
    let target = spell;
    let targetRank = r;
    const m = /^spell\.([^:]+):(.+)$/.exec(name);
    if (m) {
      const s = all.find((x) => x.scriptName.toLowerCase() === m[1].toLowerCase());
      if (!s) return '?';
      target = s;
      targetRank = sim.abilityRank(sim.slotOfSpell(s));
      name = m[2];
    }
    const lower = name.toLowerCase();
    const ck = Object.keys(target.calcs).find((k) => k.toLowerCase() === lower);
    if (ck) return formatCalc(target.calcs, ck, sim.calc(target, ck, targetRank) * mult);
    const dk = Object.keys(target.dataValues).find((k) => k.toLowerCase() === lower);
    if (dk) return formatNumber(sim.dataValue(target, dk, targetRank) * mult);
    const eff = /^Effect(\d+)Amount$/i.exec(name);
    if (eff) {
      const arr = target.effects?.[Number(eff[1]) - 1];
      return arr ? formatNumber((arr[Math.min(targetRank, arr.length - 1)] ?? 0) * mult) : '?';
    }
    if (lower === 'cooldown') return formatNumber(target.cooldown?.[targetRank] ?? 0);
    if (lower === 'cost') return formatNumber(target.cost?.[targetRank - 1] ?? 0);
    return `[${name}]`;
  });
  if (opts.html) return text;
  return text
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<li>/gi, '\n• ')
    .replace(/<[^>]+>/g, '')
    .replace(/\{\{[^}]*\}\}/g, '')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Fill an item text's @Placeholders@ from the item's data values and, with a simulator, its
 *  calculations for the simulator's champion, level and stats. Unresolved ones (melee/ranged splits,
 *  text keys) are left out and reported. */
function fillItemValues(text: string, item: ItemData, sim?: Sim | null): { text: string; resolved: boolean } {
  let resolved = true;
  const filled = text.replace(/@([^@]+)@/g, (_m, ref: string) => {
    const [name, multStr] = ref.split('*');
    const mult = multStr ? Number(multStr) : 1;
    const lower = name.toLowerCase();
    const ck = Object.keys(item.calcs).find((k) => k.toLowerCase() === lower);
    if (ck && sim) return formatCalc(item.calcs, ck, sim.evalDataCalc(item.calcs, item.dataValues, ck) * mult);
    const dk = Object.keys(item.dataValues).find((k) => k.toLowerCase() === lower);
    if (dk) return formatNumber(item.dataValues[dk] * mult);
    resolved = false;
    return '';
  });
  return { text: filled, resolved };
}

const sections = (markup: string) =>
  [...new Set([...markup.matchAll(/<(passive|active)>([^<]*)<\/\1>/gi)].map((m) => m[2].replace(/:\s*$/, '').trim()))].sort().join('|');

const cleanItemMarkup = (markup: string) =>
  markup
    .replace(/<\/?mainText>/gi, '')
    .replace(/\{\{\s*Item_Keyword_OnHit\s*\}\}/g, 'On-Hit')
    .replace(/\{\{[^}]*\}\}/g, '')
    // The client draws an icon on its own line before an active; the text doesn't always break there.
    .replace(/(<br\s*\/?>|\s)*%i:activeEffect%/gi, '<br><br>')
    .replace(/%i:\w+%/g, '')
    .replace(/\s*\((\s|<[^>]+>)*\)/g, '')
    .replace(/<li>/gi, '<br>• ')
    .replace(/^(\s|<br\s*\/?>)+|(\s|<br\s*\/?>)+$/gi, '');

/**
 * What an item's hover card shows, as tooltip markup: the shop text's stat lines, and its passive and
 * active text. With a simulator, the text comes from the formula tooltip with numbers filled in, as
 * long as it covers the same passives and actives; the shop text leaves values that depend on level
 * or stats blank, and the formula tooltip sometimes omits an active or is out of date.
 */
export function itemText(item: ItemData, sim?: Sim | null): { stats: string[]; body: string; live: boolean } {
  const stats = /<stats>([\s\S]*?)<\/stats>/i.exec(item.description)?.[1] ?? '';
  const shop = item.description.replace(/<stats>[\s\S]*?<\/stats>/i, '');
  const live = sim && item.tooltip ? fillItemValues(item.tooltip, item, sim) : null;
  const useLive = !!live?.resolved && !live.text.includes('{{') && sections(live.text) === sections(shop);
  return {
    stats: fillItemValues(stats, item, sim)
      .text.split(/<br\s*\/?>/i)
      .map(cleanItemMarkup)
      .filter((s) => /\d/.test(s.replace(/<[^>]+>/g, ''))),
    body: cleanItemMarkup(useLive ? live.text : fillItemValues(shop, item, sim).text),
    live: useLive,
  };
}

/** A rune text placeholder: @Name@, with an optional precision (.1) and multiplier (*100). */
const RUNE_REF = /^\s*([A-Za-z_{}][\w{}]*)\s*(?:\.(-?\d+))?\s*(?:\*\s*(-?[\d.]+))?\s*$/;
/** Values only the rune's script knows in game (@f1@, and includes chosen by them), mostly stats it tracks. */
const RUNTIME = /@\s*f\d+[^@]*@|\{\{[^}]*@[^}]*\}\}/i;

/** Fill a rune text's @Placeholders@ from its values and, with a simulator, its calculations. */
function fillRuneValues(text: string, rune: RuneData, sim?: Sim | null) {
  let resolved = true;
  let calcs = false;
  const filled = text.replace(/@([^@]+)@/g, (m, ref: string) => {
    const p = RUNE_REF.exec(ref);
    if (!p) return ((resolved = false), m);
    const lower = p[1].toLowerCase();
    const mult = p[3] ? Number(p[3]) : 1;
    const ck = Object.keys(rune.calcs).find((k) => k.toLowerCase() === lower);
    if (ck && sim) {
      calcs = true;
      return formatCalc(rune.calcs, ck, sim.evalDataCalc(rune.calcs, rune.values, ck) * mult);
    }
    const vk = Object.keys(rune.values).find((k) => k.toLowerCase() === lower);
    // The text's own precision is left out: Biscuit Delivery's 1.5% would show as 2%.
    if (vk) return formatNumber(rune.values[vk] * mult);
    return ((resolved = false), m);
  });
  return { text: filled, resolved, calcs };
}

/** "[A Melee || B Ranged]": the side for the champion's attack type, both without one. */
const meleeRanged = (text: string, ranged?: boolean) =>
  text.replace(/\[([^\][|]*)\|\|([^\][|]*)\]/g, (_m, melee: string, rangedText: string) => {
    if (ranged === undefined) return `${melee.trim()} / ${rangedText.trim()}`;
    return (ranged ? rangedText : melee).trim().replace(/\s*\b(Melee|Ranged)$/i, '');
  });

/** Riot's "adaptive damage" keyword and highlight color as the damage type the rune deals for the
 *  attacker, or highlighted values when it deals none (or there's no attacker). */
const markAdaptive = (markup: string, type: 'physical' | 'magic' | null) => {
  const tag = type ? `${type}Damage` : 'attention';
  return markup
    .replace(/<lol-uikit-tooltipped-keyword key=['"]LinkTooltip_Description_AdaptiveDmg['"]>([\s\S]*?)<\/lol-uikit-tooltipped-keyword>/gi, (_m, inner: string) => (type ? `<${tag}>${inner.replace(/<\/?font[^>]*>/gi, '')}</${tag}>` : inner))
    .replace(/<font color=['"]#48C4B7['"]>([^<]*)<\/font>/gi, (_m, inner: string) => `<${tag}>${inner}</${tag}>`);
};

const cleanRuneMarkup = (markup: string) =>
  markup
    .replace(/%i:\w+%/g, '')
    .replace(/\{\{[^}]*\}\}/g, '')
    .replace(/<\/?lol-uikit-tooltipped-keyword[^>]*>/gi, '')
    .replace(/\s*\((\s|<[^>]+>)*\)/g, '')
    .replace(/ {2,}/g, ' ')
    .replace(/<hr\s*\/?>/gi, '<br>')
    .replace(/<li>/gi, '<br>• ')
    .replace(/(<br\s*\/?>\s*){3,}/gi, '<br><br>')
    .replace(/^(\s|<br\s*\/?>)+|(\s|<br\s*\/?>)+$/gi, '');

/**
 * The in-game tooltip with numbers for the simulator's champion, level and stats, without the stats
 * the rune tracks in game (damage dealt, stacks…). Null when the description itself depends on a value
 * only the game knows (Press the Attack's damage), or a placeholder can't be filled.
 */
function liveRuneTooltip(rune: RuneData, sim: Sim) {
  // Riot's melee/ranged split ({{ Item_Melee_Ranged_Split }}) picks a value by @ChampRange@.
  const text = rune.tooltip.replace(/\{\{\s*Item_Range_Mod_@ChampRange@\s*\}\}/gi, sim.stats.ranged ? '@RangedItemCalcValue@' : '@MeleeItemCalcValue@');
  const lines = text.split(/<br\s*\/?>|<hr\s*\/?>/i);
  const first = lines.find((l) => l.replace(/<[^>]+>/g, '').trim());
  if (!first || RUNTIME.test(first)) return null;
  const kept = lines.filter((l) => !RUNTIME.test(l)).join('<br>');
  const live = fillRuneValues(meleeRanged(kept, sim.stats.ranged), rune, sim);
  return live.resolved ? live : null;
}

/**
 * What a rune's hover card shows, as tooltip markup. With a simulator, the in-game tooltip with
 * numbers for the champion, level and stats when it can be filled; otherwise the long description,
 * whose level-based values are ranges. `live` is set when numbers come from the simulator, and
 * `adaptive` is the type the rune's adaptive damage takes at the simulator's stats.
 */
export function runeText(rune: RuneData, sim?: Sim | null): { body: string; live: boolean; adaptive: 'physical' | 'magic' | null } {
  const adaptive = sim ? adaptiveDamageType(rune, sim) : null;
  const live = sim && rune.tooltip ? liveRuneTooltip(rune, sim) : null;
  if (live) return { body: cleanRuneMarkup(markAdaptive(live.text, adaptive)), live: live.calcs, adaptive };
  // A value only the game knows: dropped with its parentheses (Unsealed Spellbook's first cooldown).
  const text = meleeRanged(rune.description, sim?.stats.ranged).replace(/\s*\([^()]*@\s*f\d+[^@]*@[^()]*\)/gi, '');
  const desc = fillRuneValues(text, rune, sim);
  return { body: cleanRuneMarkup(markAdaptive(desc.text.replace(/@[^@]+@/g, '…'), adaptive)), live: desc.calcs, adaptive };
}
