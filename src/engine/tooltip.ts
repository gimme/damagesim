// Render ability tooltips with numbers filled in, for display and for checking against the client.

import type { ItemData, SpellData } from './data-types.ts';
import type { Sim } from './sim.ts';
import type { Slot } from './effects.ts';

export function formatNumber(v: number, precision?: number): string {
  if (!Number.isFinite(v)) return '?';
  if (precision !== undefined && precision >= 0) return String(Number(v.toFixed(precision)));
  const abs = Math.abs(v);
  if (abs >= 100) return String(Math.round(v));
  if (abs >= 10) return String(Number(v.toFixed(1)));
  return String(Number(v.toFixed(2)));
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
    if (ck) {
      const node = target.calcs[ck];
      const v = sim.calc(target, ck, targetRank) * mult;
      return node.pct ? `${formatNumber(v * 100, node.precision)}%` : formatNumber(v, node.precision);
    }
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
    if (ck && sim) {
      const node = item.calcs[ck];
      const v = sim.evalDataCalc(item.calcs, item.dataValues, ck) * mult;
      return node.pct ? `${formatNumber(v * 100, node.precision)}%` : formatNumber(v, node.precision);
    }
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
