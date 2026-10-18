#!/usr/bin/env node
// damagesim — League of Legends damage simulator CLI.
// Every command accepts --json for machine-readable output (for AI agents and scripts).

import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { loadGameData } from "../node/load.ts";
import { loadAllKits } from "../node/kits.ts";
import { simulate, Sim, type Scenario, type TargetSpec, type SimResult } from "../engine/sim.ts";
import { compare, rankItems, optimizeItems, optimizeCombo, resistSweep, summarize, type Metric } from "../engine/analysis.ts";
import { describeChampion, describeItem, listItems, listRunes, listChampions } from "../engine/describe.ts";
import { SCENARIO_HELP } from "../engine/help.ts";
import { isTargetPreset } from "../engine/presets.ts";

const HELP = `damagesim — League of Legends damage simulator (patch data in data/generated)

Usage: damagesim <command> [options]      (add --json to any command for JSON output)

Commands
  simulate     Run a combo.          damagesim simulate -c Ahri -l 11 -i "Luden's Echo,Sorcerer's Shoes" -r Electrocute --combo "E Q W R AA" --target hp=2000,armor=80,mr=50
  compare      Compare item builds.  damagesim compare -c Jinx -l 13 --combo "AA*8" --build "Kraken Slayer,Infinity Edge" --build "Yun Tal Wildarrows,Infinity Edge"
  rank-items   Value of adding each item to a build.   damagesim rank-items -c Zed -l 11 -i "Youmuu's Ghostblade" --combo "W E Q AA R"
  optimize     Best N items from a pool.               damagesim optimize -c Syndra -l 16 --slots 3 --combo "Q E W R"
  combo-order  Best ordering of the given combo steps. damagesim combo-order -c Ahri -l 11 --combo "E Q W R"
  sweep        Damage vs. target armor or MR.          damagesim sweep -c Ahri --combo "E Q W" --stat mr
  champion     Abilities, formulas and kit details.    damagesim champion Ahri -l 11
  champions    List champions and kit status.
  items        List items (filter with --search).
  runes        List runes.
  scenario     Print the scenario JSON format (for --scenario files and the MCP server).

Scenario options (simulate / compare / rank-items / optimize / combo-order / sweep)
  -c, --champion <name>         -l, --level <1-20>          --ranks Q=5,W=1,E=3,R=2   --skill-order QEW
  -i, --items <a,b,c>           -r, --runes <a,b,c>         -o, --options key=value,...
  --combo "<steps>"             combo shorthand: Q W E R P, AA, AA*3, AA!/Q! (crit), AA?/Q? (no crit), Q:variant, ignite, item:<name>, E{0.5s}, R{3}, wait{1.5s}
  --target hp=2000,armor=80,mr=50[,bonusHp=..,bonusArmor=..,bonusMr=..,hpPercent=50,dr=0.1]
  --target squishy|bruiser|tank[,hpPercent=..]   archetype whose stats follow its level (typical build)
  --target-champion <name>      --target-items <a,b>  the champion's items, or a preset's in place of its typical build
  --target-level-diff <n>       target level relative to yours (default 0)   --target-level <n> absolute
  --scenario <file.json|->      load a full scenario (JSON) instead; flags above override it
  --events                      print every damage instance

Other options
  --metric damage|burst|percentHp|damagePerGold|killTime|dps   (compare/rank/optimize)
  --slots <n> --pool <a,b,c> --top <n>                                (optimize)
  --stat armor|mr --from 0 --to 300 --step 10                         (sweep)
`;

const { values: o, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    champion: { type: "string", short: "c" },
    level: { type: "string", short: "l" },
    ranks: { type: "string" },
    "skill-order": { type: "string" },
    items: { type: "string", short: "i" },
    runes: { type: "string", short: "r" },
    options: { type: "string", short: "o" },
    combo: { type: "string" },
    target: { type: "string" },
    "target-champion": { type: "string" },
    "target-level": { type: "string" },
    "target-level-diff": { type: "string" },
    "target-items": { type: "string" },
    scenario: { type: "string" },
    events: { type: "boolean" },
    json: { type: "boolean" },
    build: { type: "string", multiple: true },
    metric: { type: "string" },
    slots: { type: "string" },
    pool: { type: "string" },
    top: { type: "string" },
    stat: { type: "string" },
    from: { type: "string" },
    to: { type: "string" },
    step: { type: "string" },
    search: { type: "string" },
    help: { type: "boolean", short: "h" },
  },
});

const list = (s?: string) =>
  (s ?? "")
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean)
    .map((x) => (/^\d+$/.test(x) ? Number(x) : x));

function kv(s?: string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const part of (s ?? "").split(",").filter(Boolean)) {
    const [k, v] = part.split("=");
    if (v === undefined) continue;
    out[k.trim()] = Number(v);
  }
  return out;
}

function buildScenario(): Scenario {
  let sc: Partial<Scenario> = {};
  if (o.scenario) sc = JSON.parse(o.scenario === "-" ? readFileSync(0, "utf8") : readFileSync(o.scenario, "utf8"));
  if (o.champion) sc.champion = o.champion;
  if (positionals[1] && !sc.champion) sc.champion = positionals[1];
  if (o.level) sc.level = Number(o.level);
  if (o.ranks) sc.ranks = kv(o.ranks) as Scenario["ranks"];
  if (o["skill-order"]) sc.skillOrder = o["skill-order"];
  if (o.items !== undefined) sc.items = list(o.items);
  if (o.runes !== undefined) sc.runes = list(o.runes);
  if (o.options) sc.options = { ...sc.options, ...kv(o.options) };
  if (o.combo) sc.combo = o.combo;
  if (o.target || o["target-champion"] || o["target-items"] || o["target-level"] || o["target-level-diff"]) {
    const t: TargetSpec = { ...(sc.target ?? {}) };
    if (o["target-champion"]) t.champion = o["target-champion"];
    if (o["target-items"] !== undefined) t.items = list(o["target-items"]);
    const preset = (o.target ?? "")
      .split(",")
      .map((x) => x.trim().toLowerCase())
      .find((x) => x && !x.includes("="));
    if (preset) {
      if (!isTargetPreset(preset)) throw new Error(`unknown target preset "${preset}" (squishy, bruiser, tank)`);
      t.preset = preset;
    }
    if (o["target-level"]) t.level = Number(o["target-level"]);
    if (o["target-level-diff"]) t.levelDiff = Number(o["target-level-diff"]);
    const tv = kv(o.target);
    if (tv.hp !== undefined) t.maxHp = tv.hp;
    if (tv.maxHp !== undefined) t.maxHp = tv.maxHp;
    if (tv.currentHp !== undefined) t.hp = tv.currentHp;
    if (tv.hpPercent !== undefined) t.hpPercent = tv.hpPercent;
    if (tv.bonusHp !== undefined) t.bonusHp = tv.bonusHp;
    if (tv.armor !== undefined) t.armor = tv.armor;
    if (tv.bonusArmor !== undefined) t.bonusArmor = tv.bonusArmor;
    if (tv.mr !== undefined) t.mr = tv.mr;
    if (tv.bonusMr !== undefined) t.bonusMr = tv.bonusMr;
    if (tv.dr !== undefined) t.damageReduction = tv.dr;
    sc.target = t;
  }
  if (!sc.champion) throw new Error("missing --champion");
  if (sc.combo === undefined) sc.combo = "Q W E R AA";
  return sc as Scenario;
}

const pad = (s: string | number, n: number) => String(s).padEnd(n);
const num = (v: number, d = 0) => v.toFixed(d);

function printResult(r: SimResult, events: boolean) {
  const st = r.stats;
  console.log(
    `${r.champion.name} lvl ${r.champion.level} [${Object.entries(r.champion.ranks)
      .filter(([k]) => k !== "P")
      .map(([k, v]) => `${k}${v}`)
      .join(" ")}]  kit: ${r.champion.kitStatus}  patch ${r.patch}`,
  );
  console.log(`Items: ${r.items.map((i) => i.name).join(", ") || "(none)"}  (${r.gold}g)`);
  if (r.runes.length) console.log(`Runes: ${r.runes.map((x) => x.name).join(", ")}`);
  console.log(
    `Stats: AD ${num(st.ad)} (bonus ${num(st.bonusAd)})  AP ${num(st.ap)}  AS ${st.attackSpeed.toFixed(3)}  crit ${num(st.critChance * 100)}%/${num(st.critDamage * 100)}%  HP ${num(st.maxHp)}  lethality ${num(st.lethality)}  armor pen ${num(st.armorPenPercent * 100)}%  magic pen ${num(st.magicPenFlat)} + ${num(st.magicPenPercent * 100)}%  AH ${num(st.abilityHaste)}`,
  );
  const t = r.target;
  console.log(
    `Target: ${t.label}  HP ${num(t.startHp)}/${num(t.maxHp)} (bonus ${num(t.bonusHp)})  armor ${num(t.armor)} (bonus ${num(t.bonusArmor)}) → ${num(t.effectiveArmor, 1)} after your penetration (×${t.physicalMultiplier.toFixed(3)})  MR ${num(t.mr)} (bonus ${num(t.bonusMr)}) → ${num(t.effectiveMr, 1)} (×${t.magicMultiplier.toFixed(3)})`,
  );
  console.log(`Combo: ${r.combo}`);
  console.log("");
  if (events) {
    console.log(`${pad("time", 7)}${pad("source", 26)}${pad("hit", 24)}${pad("type", 9)}${pad("raw", 9)}${pad("dealt", 9)}target HP   modifiers`);
    for (const e of r.events) {
      const amps = e.amps.map((a) => `${a.source} ${a.value >= 0 ? "+" : ""}${(a.value * 100).toFixed(1)}%`).join(", ");
      console.log(
        `${pad(e.time.toFixed(2), 7)}${pad(e.sourceLabel.slice(0, 25), 26)}${pad(e.label.slice(0, 23), 24)}${pad(e.type, 9)}${pad(num(e.raw, 1), 9)}${pad(num(e.final ?? 0, 1), 9)}${pad(num(Math.max(0, e.targetHpAfter ?? 0)), 12)}${amps}`,
      );
    }
    console.log("");
  }
  console.log(`${pad("source", 30)}${pad("hits", 6)}${pad("damage", 10)}share`);
  for (const s of r.bySource)
    console.log(`${pad(s.label.slice(0, 29), 30)}${pad(s.hits, 6)}${pad(num(s.damage), 10)}${((s.damage / r.totalDamage) * 100).toFixed(1)}%`);
  console.log("");
  console.log(
    `TOTAL ${num(r.totalDamage)} damage (${num(r.byType.physical)} physical, ${num(r.byType.magic)} magic, ${num(r.byType.true)} true) = ${(r.percentOfHp * 100).toFixed(1)}% of target HP over ${r.duration.toFixed(2)}s${r.killed ? `  → KILL at ${r.killTime!.toFixed(2)}s` : `  → ${num(r.target.endHp)} HP left`}`,
  );
  if (r.dotDamage > 0.5) console.log(`  (${num(r.comboDamage)} burst + ${num(r.dotDamage)} damage over time: burns, bleeds, Ignite, auras)`);
  for (const l of r.executeLines) console.log(`  ${l.label}: kills below ${num(l.hp)} HP`);
  for (const w of r.warnings) console.log(`WARNING: ${w}`);
  for (const n of r.notes) console.log(`note: ${n}`);
}

async function main() {
  const cmd = positionals[0];
  if (!cmd || o.help || cmd === "help") {
    console.log(HELP);
    return;
  }
  const data = loadGameData();
  await loadAllKits();
  const out = (v: unknown, human: () => void) => (o.json ? console.log(JSON.stringify(v, null, 2)) : human());
  const metric = (o.metric as Metric) ?? "damage";

  switch (cmd) {
    case "simulate":
    case "sim": {
      const r = simulate(data, buildScenario());
      if (o.json && !o.events) {
        const { events, ...rest } = r;
        return console.log(JSON.stringify({ ...rest, eventCount: events.length }, null, 2));
      }
      return out(r, () => printResult(r, !!o.events));
    }
    case "compare": {
      const base = buildScenario();
      const builds = o.build ?? [];
      if (!builds.length) throw new Error('give at least one --build "item1,item2"');
      const res = compare(
        data,
        base,
        builds.map((b) => ({ changes: { items: list(b) } })),
        metric,
      );
      return out(res, () => {
        console.log(`Ranked by ${metric}:`);
        res.results.forEach((x, i) =>
          console.log(
            `${i + 1}. ${num(x.totalDamage)} dmg (${(x.percentOfHp * 100).toFixed(1)}% HP)${x.killed ? ` kill @${x.killTime}s` : ""}  ${x.gold}g  — ${x.items.join(", ")}`,
          ),
        );
      });
    }
    case "rank-items": {
      const res = rankItems(data, buildScenario(), { metric, limit: Number(o.top ?? 25), candidates: list(o.pool) });
      return out(res, () => {
        console.log(`Base: ${num(res.base.totalDamage)} dmg with ${res.base.items.join(", ") || "no items"}. Adding one item (ranked by ${metric}):`);
        res.items.forEach((x, i) =>
          console.log(
            `${pad(i + 1 + ".", 4)}${pad(x.item, 28)}+${pad(num(x.gain), 8)} (${num(x.totalDamage)} total, ${x.gold}g${x.replaces ? ` upgrading ${x.replaces.map((r) => r.item).join(", ")}` : ""}, ${x.gainPerGold}/1000g)${x.procs.length ? `  procs ${x.procs.map((p) => `${p.name} +${num(p.damage)}`).join(", ")}` : ""}`,
          ),
        );
      });
    }
    case "optimize": {
      const res = optimizeItems(data, buildScenario(), {
        slots: Number(o.slots ?? 3),
        pool: list(o.pool),
        metric,
        top: Number(o.top ?? 10),
        fixed: list(o.items),
      });
      return out(res, () => {
        console.log(`Evaluated ${res.evaluated} builds from a pool of ${res.poolSize} (metric ${metric}):`);
        res.best.forEach((x, i) =>
          console.log(
            `${i + 1}. ${num(x.summary.totalDamage)} dmg${x.summary.killed ? ` kill @${x.summary.killTime}s` : ""}  ${x.summary.gold}g — ${x.items.join(", ")}`,
          ),
        );
      });
    }
    case "combo-order": {
      const res = optimizeCombo(data, buildScenario(), { metric, top: Number(o.top ?? 10) });
      return out(res, () => {
        console.log(`Evaluated ${res.evaluated} orderings (metric ${metric}):`);
        res.best.forEach((x, i) =>
          console.log(`${i + 1}. ${pad(x.combo, 40)} ${num(x.summary.totalDamage)} dmg${x.summary.killed ? ` kill @${x.summary.killTime}s` : ""}`),
        );
      });
    }
    case "sweep": {
      const stat = (o.stat as "armor" | "mr") ?? "armor";
      const res = resistSweep(data, buildScenario(), { stat, from: Number(o.from ?? 0), to: Number(o.to ?? 300), step: Number(o.step ?? 25) });
      return out(res, () => {
        for (const p of res) console.log(`${pad(stat + " " + p[stat], 12)} ${num(p.totalDamage)}`);
      });
    }
    case "champion": {
      const name = positionals[1] ?? o.champion;
      if (!name) throw new Error("usage: damagesim champion <name>");
      const sim = new Sim(data, {
        champion: name,
        level: Number(o.level ?? 11),
        combo: [],
        items: list(o.items),
        ranks: o.ranks ? (kv(o.ranks) as any) : undefined,
      });
      const d = describeChampion(sim);
      return out(d, () => {
        console.log(`${d.name} — ${d.title} (${d.attackType}, kit: ${d.kitStatus})  level ${d.level}`);
        if (d.kitNotes.length) console.log(d.kitNotes.map((n) => `  note: ${n}`).join("\n"));
        if (d.options.length) console.log(`  options: ${d.options.map((x) => `${x.key}=${x.default} (${x.label})`).join("; ")}`);
        for (const a of d.abilities) {
          console.log(`\n[${a.slot}] ${a.name}  rank ${a.rank}/${a.maxRank}${a.cooldown ? `  cd ${a.cooldown.join("/")}` : ""}`);
          console.log(`  ${a.tooltip.replace(/\n+/g, " | ")}`);
          for (const c of a.components)
            console.log(
              `  • ${c.label} [${c.type}${c.optional ? ", optional" : ""}${c.hits !== 1 ? `, ×${c.hits}` : ""}] = ${num(c.value, 1)}    ${c.formula}`,
            );
          for (const v of a.variants) console.log(`  variant "${v.key}": ${v.label} — ${v.components.map((c) => `${c.label} ${num(c.value, 1)}`).join(", ")}`);
          for (const n of a.notes) console.log(`  note: ${n}`);
        }
      });
    }
    case "champions":
      return out(listChampions(data), () => {
        for (const c of listChampions(data)) console.log(`${pad(c.id, 14)}${pad(c.name, 16)}${pad(c.attackType, 8)}${c.kitStatus}`);
      });
    case "items": {
      const items = listItems(data, o.search);
      return out(items, () => {
        for (const i of items) console.log(`${pad(i.id, 6)}${pad(i.name, 30)}${pad(i.gold + "g", 7)}${pad(i.modeled ? "modeled" : "", 9)}${i.stats}`);
      });
    }
    case "item": {
      const d = describeItem(data, positionals[1]);
      return out(d, () => console.log(JSON.stringify(d, null, 2)));
    }
    case "runes": {
      const runes = listRunes(data);
      return out(runes, () => {
        for (const r of runes) console.log(`${pad(r.id, 6)}${pad(r.name, 26)}${pad(r.tree, 12)}${pad(r.slot, 22)}${r.modeled ? "modeled" : ""}`);
      });
    }
    case "scenario":
      return console.log(SCENARIO_HELP);
    default:
      throw new Error(`unknown command "${cmd}" (try --help)`);
  }
}

main().catch((err) => {
  console.error(`error: ${(err as Error).message}`);
  process.exit(1);
});

export { summarize };
