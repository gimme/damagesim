#!/usr/bin/env node
// MCP server (stdio) exposing the simulator to AI agents.
//
//   claude mcp add damagesim -- node /path/to/damagesim/src/mcp/server.ts
//
// Tools: list_champions, get_champion, list_items, get_item, list_runes, simulate, compare_builds,
// rank_items, optimize_build, optimize_combo, resist_sweep, scenario_help.

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { loadGameData } from "../node/load.ts";
import { loadAllKits } from "../node/kits.ts";
import { simulate, Sim, type Scenario, type SimResult } from "../engine/sim.ts";
import { compare, rankItems, optimizeItems, optimizeCombo, resistSweep, round, type Metric } from "../engine/analysis.ts";
import { describeChampion, describeItem, listItems, listRunes, listChampions } from "../engine/describe.ts";
import { SCENARIO_HELP } from "../engine/help.ts";

const data = loadGameData();
await loadAllKits();

const idOrName = z.union([z.string(), z.number()]);
const comboStep = z.union([
  z.object({
    type: z.literal("ability"),
    slot: z.enum(["P", "Q", "W", "E", "R"]),
    variant: z.string().optional(),
    hits: z.record(z.string(), z.number()).optional(),
    duration: z
      .number()
      .optional()
      .describe(
        "Seconds the cast lasts, where the player chooses it: a channel ended early (Smolder E, Katarina R), a toggle left on (Karthus E), or a charge held (Sion Q)",
      ),
    count: z
      .number()
      .optional()
      .describe("How many of its hits the cast fires, the first in the order they're fired, where the player chooses it (Xerath R's and Jhin R's shots)"),
    enable: z.array(z.string()).optional(),
    miss: z.boolean().optional(),
    crit: z.boolean().optional(),
  }),
  z.object({ type: z.literal("attack"), count: z.number().optional(), crit: z.boolean().optional() }),
  z.object({ type: z.literal("item"), item: idOrName }),
  z.object({ type: z.literal("summoner"), spell: z.literal("ignite") }),
  z.object({ type: z.literal("energize") }).describe("You're Energized: the next attack (or Voltaic's Galvanize) fires your Energized items"),
  z.object({ type: z.literal("wait"), seconds: z.number().optional().describe("Default 1") }),
]);

const target = z
  .object({
    champion: z.string().optional().describe("Derive stats from a champion (level + items); explicit numbers override"),
    preset: z
      .enum(["squishy", "bruiser", "tank"])
      .optional()
      .describe(
        "Archetype whose stats follow the target level: class-average base stats + a typical build for that level (or `items`) + health shards. Explicit numbers override",
      ),
    level: z.number().optional().describe("Absolute target level (default: your level + levelDiff)"),
    levelDiff: z.number().optional().describe("Target level relative to yours (default 0), e.g. -1 when you are a level ahead"),
    items: z.array(idOrName).optional().describe("The champion's items, or a preset's in place of its typical build. Only their stats count"),
    maxHp: z.number().optional().describe("Total max health"),
    bonusHp: z.number().optional().describe("Bonus part of max health (from items and runes)"),
    armor: z.number().optional().describe("Total armor"),
    bonusArmor: z.number().optional(),
    mr: z.number().optional().describe("Total magic resist"),
    bonusMr: z.number().optional(),
    hp: z.number().optional().describe("Current HP (absolute)"),
    hpPercent: z.number().optional().describe("Current HP as a percentage of max (0-100)"),
    damageReduction: z.number().optional().describe("Generic % damage reduction (fraction)"),
    label: z.string().optional(),
  })
  .describe(
    "The enemy champion being hit: a preset ({preset:\"tank\"}), a champion with items, or raw stats. A total (maxHp, armor, mr) keeps the champion's or preset's base and puts the rest in bonus; a bonus adds to that base; raw numbers are all base unless a bonus is given. Default: 2000 HP, 80 armor, 50 MR.",
  );

const scenarioShape = {
  champion: z.string().describe('Champion name or id, e.g. "Ahri", "Kai\'Sa", "wukong"'),
  level: z.number().min(1).max(20).optional().describe("Champion level (default 11)"),
  ranks: z
    .object({ Q: z.number().optional(), W: z.number().optional(), E: z.number().optional(), R: z.number().optional() })
    .optional()
    .describe("Ability ranks (default: standard leveling)"),
  skillOrder: z.string().optional().describe('Max order for default ranks, e.g. "QEW"'),
  items: z.array(idOrName).optional().describe('Item names/aliases/ids, e.g. ["Luden\'s Echo", "sorcs", 3089]'),
  runes: z
    .array(idOrName)
    .optional()
    .describe(
      "A rune page, names or ids: a keystone and one rune from each row of its tree, two runes from different rows of another tree, and one shard from each shard row (e.g. 5008 adaptive). Warnings name runes no page holds together.",
    ),
  options: z.record(z.string(), z.number()).optional().describe("Champion/item/rune parameters (see get_champion options and scenario_help)"),
  combo: z
    .union([z.string(), z.array(comboStep)])
    .optional()
    .describe('Combo shorthand like "E Q W R AA ignite" or steps array. Default "Q W E R AA"'),
  target: target.optional(),
  settings: z
    .object({
      finishDots: z.boolean().optional(),
      executes: z.boolean().optional(),
      waitForCooldowns: z.boolean().optional(),
    })
    .optional(),
};
const scenarioSchema = z.object(scenarioShape);
const metric = z.enum(["damage", "burst", "percentHp", "damagePerGold", "killTime", "dps"]).optional();

function toScenario(a: z.infer<typeof scenarioSchema>): Scenario {
  return { ...a, combo: a.combo ?? "Q W E R AA" } as Scenario;
}

function compactResult(r: SimResult, includeEvents: boolean) {
  const st = r.stats;
  return {
    patch: r.patch,
    champion: r.champion,
    items: r.items,
    runes: r.runes.map((x) => x.name),
    gold: r.gold,
    combo: r.combo,
    stats: {
      ad: round(st.ad),
      bonusAd: round(st.bonusAd),
      ap: round(st.ap),
      attackSpeed: round(st.attackSpeed, 3),
      critChance: round(st.critChance, 3),
      critDamage: round(st.critDamage, 3),
      maxHp: round(st.maxHp),
      lethality: round(st.lethality),
      armorPenPercent: round(st.armorPenPercent, 3),
      magicPenFlat: round(st.magicPenFlat),
      magicPenPercent: round(st.magicPenPercent, 3),
      abilityHaste: round(st.abilityHaste),
    },
    target: {
      ...r.target,
      effectiveArmor: round(r.target.effectiveArmor),
      effectiveMr: round(r.target.effectiveMr),
      physicalMultiplier: round(r.target.physicalMultiplier, 4),
      magicMultiplier: round(r.target.magicMultiplier, 4),
    },
    totalDamage: round(r.totalDamage),
    burstDamage: round(r.comboDamage),
    dotDamage: round(r.dotDamage),
    byType: { physical: round(r.byType.physical), magic: round(r.byType.magic), true: round(r.byType.true) },
    percentOfTargetHp: round(r.percentOfHp * 100, 1),
    killed: r.killed,
    ...(r.killTime !== undefined ? { killTime: round(r.killTime, 2) } : {}),
    ...(r.executeLines.length ? { executeLines: r.executeLines.map((l) => ({ execute: l.label, killsBelowHp: round(l.hp) })) } : {}),
    durationSeconds: round(r.duration, 2),
    bySource: r.bySource.map((s) => ({ source: s.label, hits: s.hits, damage: round(s.damage), raw: round(s.raw) })),
    ...(includeEvents
      ? {
          events: r.events.map((e) => ({
            t: round(e.time, 2),
            source: e.sourceLabel,
            hit: e.label,
            type: e.type,
            raw: round(e.raw),
            dealt: round(e.final ?? 0),
            targetHp: round(Math.max(0, e.targetHpAfter ?? 0)),
            ...(e.amps.length ? { modifiers: e.amps.map((a) => `${a.source} ${(a.value * 100).toFixed(1)}%`) } : {}),
          })),
        }
      : {}),
    warnings: r.warnings,
    notes: r.notes,
  };
}

const json = (v: unknown) => ({ content: [{ type: "text" as const, text: JSON.stringify(v, null, 1) }] });
const safe =
  <A>(fn: (a: A) => unknown) =>
  async (a: A) => {
    try {
      return json(fn(a));
    } catch (err) {
      return { content: [{ type: "text" as const, text: `Error: ${(err as Error).message}` }], isError: true };
    }
  };

const server = new McpServer(
  { name: "damagesim", version: "0.1.0" },
  {
    instructions: `League of Legends damage simulator for patch ${data.meta.patch}. Numbers come from the game's own data files.
Typical flow: get_champion (see abilities, per-hit values, kit notes and options) → simulate a combo vs. a target → compare_builds / rank_items / optimize_build to recommend items, optimize_combo for ability order.
Kits marked "auto" are tooltip-derived (per-hit numbers exact, hit counts/conditions approximate); "curated" kits model mechanics explicitly. Always mention relevant warnings/notes from results.
Call scenario_help for the full scenario format.`,
  },
);

server.registerTool(
  "scenario_help",
  { description: "Full documentation of the scenario format, combo shorthand and common options.", inputSchema: {} },
  async () => ({ content: [{ type: "text", text: SCENARIO_HELP }] }),
);

server.registerTool(
  "list_champions",
  { description: "List champions with their kit status (curated/auto).", inputSchema: { search: z.string().optional() } },
  safe(({ search }: { search?: string }) => listChampions(data).filter((c) => !search || c.name.toLowerCase().includes(search.toLowerCase()))),
);

server.registerTool(
  "get_champion",
  {
    description:
      "Champion abilities at a level: rendered tooltips, cooldowns, every damage component with its current value and formula, variants, kit notes and options.",
    inputSchema: { champion: z.string(), level: z.number().min(1).max(20).optional(), ranks: scenarioShape.ranks, items: z.array(idOrName).optional() },
  },
  safe((a: { champion: string; level?: number; ranks?: Scenario["ranks"]; items?: (string | number)[] }) =>
    describeChampion(new Sim(data, { champion: a.champion, level: a.level ?? 11, ranks: a.ranks, items: a.items, combo: [] })),
  ),
);

server.registerTool(
  "list_items",
  {
    description: "Summoner's Rift items with stats, gold and whether their passive is modeled. Filter by name or tag (e.g. 'SpellDamage', 'CriticalStrike').",
    inputSchema: { search: z.string().optional() },
  },
  safe(({ search }: { search?: string }) => listItems(data, search)),
);

server.registerTool(
  "get_item",
  { description: "Item details: stats, passive text with numbers, data values, build path.", inputSchema: { item: idOrName } },
  safe(({ item }: { item: string | number }) => describeItem(data, item)),
);

server.registerTool(
  "list_runes",
  { description: "Live runes by tree and row (keystone, row 1-3; shards by the rows that offer them) and whether they are modeled.", inputSchema: {} },
  safe(() => listRunes(data)),
);

server.registerTool(
  "simulate",
  {
    description:
      "Simulate a combo against a target. Returns total damage, damage by source/type, kill time, effective resists, stats, warnings and model notes. Set includeEvents for every damage instance.",
    inputSchema: { ...scenarioShape, includeEvents: z.boolean().optional() },
  },
  safe((a: z.infer<typeof scenarioSchema> & { includeEvents?: boolean }) => {
    const { includeEvents, ...sc } = a;
    return compactResult(simulate(data, toScenario(sc)), !!includeEvents);
  }),
);

server.registerTool(
  "compare_builds",
  {
    description: "Run the same scenario with different variants (items, runes, combo, level, options) and rank them.",
    inputSchema: {
      scenario: scenarioSchema,
      variants: z.array(
        z.object({
          label: z.string().optional(),
          items: z.array(idOrName).optional(),
          runes: z.array(idOrName).optional(),
          combo: z.union([z.string(), z.array(comboStep)]).optional(),
          level: z.number().optional(),
          options: z.record(z.string(), z.number()).optional(),
        }),
      ),
      metric,
    },
  },
  safe((a: { scenario: z.infer<typeof scenarioSchema>; variants: any[]; metric?: Metric }) =>
    compare(
      data,
      toScenario(a.scenario),
      a.variants.map(({ label, ...changes }) => ({ label, changes })),
      a.metric,
    ),
  ),
);

server.registerTool(
  "rank_items",
  {
    description:
      "Marginal value of adding each candidate item to the scenario's build (default candidates: all legendaries and boots; with components: true, every component too, e.g. Serrated Dirk, B. F. Sword; components with candidates is an error, list them among the candidates). Returns damage gain, gain per 1000 gold of the item (metric damagePerGold ranks by it), and the gain's parts, which add up to it: baseDamage, the item's stats making your other hits deal more; itemDamage, what the item deals itself; procDamage, hits of your other damage that land only with the item (procs: by source, e.g. Electrocute that Stormsurge's Squall strikes, an execute its damage brings the target into range of); and lostDamage (negative), what it takes away from your other damage: hits that land only without it, hits that deal less with it (lost: by source, e.g. a proc it makes land later, adaptive force turning AD; adaptive says when the item turns it).",
    inputSchema: {
      scenario: scenarioSchema,
      candidates: z.array(idOrName).optional(),
      components: z.boolean().optional(),
      metric,
      limit: z.number().optional(),
    },
  },
  safe((a: { scenario: z.infer<typeof scenarioSchema>; candidates?: (string | number)[]; components?: boolean; metric?: Metric; limit?: number }) =>
    rankItems(data, toScenario(a.scenario), { candidates: a.candidates, components: a.components, metric: a.metric, limit: a.limit }),
  ),
);

server.registerTool(
  "optimize_build",
  {
    description:
      "Find the best set of `slots` items (on top of the scenario's items) from a pool (default: all legendaries/boots, pruned by single-item value). Respects item groups (one Spellblade, Hydra, Fatality…).",
    inputSchema: {
      scenario: scenarioSchema,
      slots: z.number().min(1).max(6),
      pool: z.array(idOrName).optional(),
      metric,
      top: z.number().optional(),
      maxEvaluations: z.number().optional(),
    },
  },
  safe((a: { scenario: z.infer<typeof scenarioSchema>; slots: number; pool?: (string | number)[]; metric?: Metric; top?: number; maxEvaluations?: number }) =>
    optimizeItems(data, toScenario(a.scenario), {
      slots: a.slots,
      pool: a.pool,
      metric: a.metric,
      top: a.top,
      maxEvaluations: a.maxEvaluations,
      fixed: a.scenario.items,
    }),
  ),
);

server.registerTool(
  "optimize_combo",
  {
    description: "Try every ordering of the scenario combo steps (optionally keeping the first N fixed) and rank them.",
    inputSchema: { scenario: scenarioSchema, metric, keepFirst: z.number().optional(), top: z.number().optional() },
  },
  safe((a: { scenario: z.infer<typeof scenarioSchema>; metric?: Metric; keepFirst?: number; top?: number }) =>
    optimizeCombo(data, toScenario(a.scenario), { metric: a.metric, keepFirst: a.keepFirst, top: a.top }),
  ),
);

server.registerTool(
  "resist_sweep",
  {
    description: "Damage of the scenario as the target's armor or MR varies (e.g. to decide between penetration items).",
    inputSchema: {
      scenario: scenarioSchema,
      stat: z.enum(["armor", "mr"]),
      from: z.number().optional(),
      to: z.number().optional(),
      step: z.number().optional(),
    },
  },
  safe((a: { scenario: z.infer<typeof scenarioSchema>; stat: "armor" | "mr"; from?: number; to?: number; step?: number }) =>
    resistSweep(data, toScenario(a.scenario), a),
  ),
);

await server.connect(new StdioServerTransport());
