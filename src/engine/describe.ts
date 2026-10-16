// Structured descriptions of champions, items and runes (for the CLI, MCP server and UI).

import type { GameData } from './gamedata.ts';
import { findItem } from './gamedata.ts';
import type { Sim } from './sim.ts';
import { maxRanks } from './sim.ts';
import type { Slot } from './effects.ts';
import type { ComponentSpec } from './kit-types.ts';
import { renderTooltip } from './tooltip.ts';
import { getKit } from '../kits/index.ts';
import { hasItemModel, ITEM_GROUPS } from './items.ts';
import { NOT_LIVE_RUNES, hasRuneModel } from './runes.ts';
import { hasteCooldown } from './stats.ts';

export interface ComponentInfo {
  id: string;
  label: string;
  type: string;
  value: number;
  hits: number;
  optional: boolean;
  formula: string;
  flags: string[];
  condition?: string;
  note?: string;
}

function componentInfo(sim: Sim, slot: Slot, c: ComponentSpec, spellName?: string): ComponentInfo {
  let value = NaN;
  let hits = 1;
  try {
    const spell = spellName ? sim.findSpell(spellName) : undefined;
    const ctx = { slot, ...(spell ? { spell } : {}) };
    value = sim.evalExpr(c.amount, ctx);
    hits = Math.round(sim.evalExpr(c.hits ?? 1, ctx));
  } catch {
    // reported via sim warnings
  }
  const flags = (['aoe', 'dot', 'attack', 'onHit', 'canCrit', 'pet', 'noProc'] as const).filter((f) => (c as any)[f]);
  return {
    id: c.id,
    label: c.label,
    type: c.type,
    value,
    hits,
    optional: !!c.optional,
    formula: String(c.amount),
    flags,
    ...(c.condition ? { condition: c.condition } : {}),
    ...(c.note ? { note: c.note } : {}),
  };
}

export function describeChampion(sim: Sim) {
  const champ = sim.champ;
  const kit = sim.kit;
  const max = maxRanks(champ);
  const st = sim.stats;
  const abilities = (['P', 'Q', 'W', 'E', 'R'] as Slot[]).map((slot) => {
    const ab = champ.abilities.find((a) => a.slot === slot);
    const spec = kit.abilities[slot] ?? {};
    const spell = sim.spellFor(slot);
    const rank = sim.abilityRank(slot);
    const cdSpell = spell.cooldown?.some((x) => x > 0) ? spell : (sim.siblingsOf(spell).find((x) => x.cooldown?.some((y) => y > 0)) ?? spell);
    const maxRank = slot === 'P' ? 1 : max[slot as 'Q'];
    const haste = st.abilityHaste + (slot === 'R' ? st.ultimateHaste : st.basicAbilityHaste);
    const comps = [...(spec.components ?? [])];
    const abilitySpell = spec.spell;
    const buffs = Array.isArray(spec.buff) ? spec.buff : spec.buff ? [spec.buff] : [];
    for (const b of buffs) {
      if (b.empowerAttacks) comps.push(...b.empowerAttacks.components.map((c) => ({ ...c, label: `${c.label} (empowered attack)` })));
      if (b.onHit) comps.push(...b.onHit.map((c) => ({ ...c, label: `${c.label} (on-hit while active)` })));
    }
    if (slot === 'P') {
      for (const m of kit.marks ?? []) {
        for (const c of [...(m.onStack ?? []), ...(m.dot?.components ?? []), ...(m.atMax?.components ?? [])]) comps.push({ ...c, label: `${m.label}: ${c.label}` });
      }
      for (const c of kit.attack?.onHit ?? []) comps.push({ ...c, label: `${c.label} (on-hit)` });
      if (kit.attack?.everyNth) for (const c of kit.attack.everyNth.components) comps.push({ ...c, label: `${c.label} (every ${kit.attack.everyNth.n} attacks)` });
    }
    return {
      slot,
      name: spec.name ?? (slot === 'P' ? champ.passive.name : spell.name),
      rank,
      maxRank,
      cooldown: slot === 'P' || !cdSpell.cooldown ? null : cdSpell.cooldown.slice(1, maxRank + 1).map((c) => Math.round((cdSpell.cooldownFixed ? c : hasteCooldown(c, haste)) * 100) / 100),
      cost: spell.cost?.slice(0, maxRank) ?? null,
      castTime: spec.castTime ?? spell.castTime,
      tooltip: ab ? renderTooltip(sim, slot, spell) : '',
      components: comps.map((c) => componentInfo(sim, slot, c, abilitySpell)),
      variants: Object.entries(spec.variants ?? {}).map(([key, v]) => ({ key, label: v.label, note: v.note, components: v.components.map((c) => componentInfo(sim, slot, c, v.spell ?? spec.spell)) })),
      buffs: buffs.map((b) => ({ id: b.id, label: b.label, stats: b.stats ?? {} })),
      debuff: spec.debuff ? { id: spec.debuff.id, label: spec.debuff.label } : null,
      cc: spec.cc ?? [],
      recasts: spec.recasts ?? 1,
      notes: spec.notes ?? [],
    };
  });
  return {
    id: champ.id,
    name: champ.name,
    title: champ.title,
    attackType: champ.attackType,
    adaptive: champ.adaptive,
    level: sim.level,
    kitStatus: kit.status,
    kitNotes: kit.notes ?? [],
    options: kit.options ?? [],
    /** Parameters of the items/runes in the scenario (pass them in scenario.options). */
    effectOptions: sim.effects.flatMap((e) => (e.options ?? []).map((o) => ({ ...o, from: e.label }))),
    ranks: sim.ranks,
    maxRanks: max,
    stats: {
      hp: round(st.maxHp),
      ad: round(st.ad),
      baseAd: round(st.baseAd),
      ap: round(st.ap),
      armor: round(st.armor),
      mr: round(st.mr),
      attackSpeed: Math.round(st.attackSpeed * 1000) / 1000,
      range: st.range,
      moveSpeed: round(st.moveSpeed),
    },
    abilities,
    warnings: sim.warnings,
  };
}

const round = (v: number) => Math.round(v * 10) / 10;

export function listChampions(data: GameData) {
  return data.championIndex.map((c) => ({
    id: c.id,
    name: c.name,
    title: c.title,
    attackType: c.attackType,
    tags: c.tags,
    kitStatus: getKit(data.champions[c.id]).status,
  }));
}

function statLine(stats: Record<string, number>): string {
  const pct = new Set(['attackSpeed', 'critChance', 'critDamage', 'armorPenPercent', 'magicPenPercent', 'msPercent', 'lifeSteal', 'omnivamp', 'tenacity', 'healShieldPower', 'baseHpRegen', 'baseMpRegen', 'slowResist']);
  return Object.entries(stats)
    .map(([k, v]) => `${pct.has(k) ? `${Math.round(v * 1000) / 10}%` : Math.round(v * 10) / 10} ${k}`)
    .join(', ');
}

export function listItems(data: GameData, search?: string) {
  const q = search?.toLowerCase();
  return Object.values(data.items)
    .filter((i) => (i.inStore || [3040, 3042, 3121].includes(i.id)) && !i.requiredChampion && i.gold.total > 0)
    .filter((i) => !q || i.name.toLowerCase().includes(q) || i.tags.some((t) => t.toLowerCase().includes(q)))
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((i) => ({
      id: i.id,
      name: i.name,
      gold: i.gold.total,
      tags: i.tags,
      tier: i.depth,
      stats: statLine(i.stats),
      modeled: hasItemModel(i.id),
      groups: Object.entries(ITEM_GROUPS)
        .filter(([, ids]) => ids.includes(i.id))
        .map(([g]) => g),
    }));
}

export function describeItem(data: GameData, query: string | number) {
  const i = findItem(data, query);
  return {
    id: i.id,
    name: i.name,
    gold: i.gold,
    tags: i.tags,
    stats: i.stats,
    statLine: statLine(i.stats),
    description: i.description.replace(/<br\s*\/?>/g, '\n').replace(/<[^>]+>/g, '').replace(/%i:[a-zA-Z]+%/g, '').replace(/\{\{[^}]*\}\}/g, '').replace(/[ \t]+/g, ' ').trim(),
    dataValues: i.dataValues,
    from: i.from.map((id) => data.items[id]?.name ?? id),
    into: i.into.map((id) => data.items[id]?.name ?? id),
    modeled: hasItemModel(i.id),
    groups: Object.entries(ITEM_GROUPS)
      .filter(([, ids]) => ids.includes(i.id))
      .map(([g]) => g),
  };
}

/** The shard rows that offer a shard: "offense, flex". */
const shardRows = (data: GameData, id: number) =>
  data.runePage.shards
    .filter((row) => row.options.includes(id))
    .map((row) => row.label.toLowerCase())
    .join(', ');

export function listRunes(data: GameData) {
  return data.runes
    .filter((r) => !NOT_LIVE_RUNES.has(r.id))
    .map((r) => ({
      id: r.id,
      name: r.name,
      tree: r.tree,
      slot: r.row === 0 ? 'keystone' : r.row === -1 ? `shard: ${shardRows(data, r.id)}` : `row ${r.row}`,
      modeled: hasRuneModel(r.id),
      description: r.description.replace(/<[^>]+>/g, '').replace(/@[^@]+@/g, '…').slice(0, 300),
    }));
}
