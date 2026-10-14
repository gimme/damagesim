// Render ability tooltips with numbers filled in, for display and for checking against the client.

import type { SpellData } from './data-types.ts';
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
