// The Runes card: a rune page as in the client.

import type { CSSProperties } from "react";
import { DATA, runeIcon } from "../data.ts";
import { Icon } from "./icons.tsx";
import { RuneTip, useHoverCard } from "./hover.tsx";
import { Card } from "./common.tsx";
import type { Set, UIState } from "../state.ts";
import type { Sim } from "../../engine/sim.ts";
import { runeText } from "../../engine/tooltip.ts";
import { choosePrimary, chooseSecondary, pickRune, type RunePage } from "../../engine/rune-page.ts";
import type { RuneData, RuneTreeData } from "../../engine/data-types.ts";

const TREES = DATA.runePage.trees;
/** A shard's stat as its row shows it: abbreviated, AD and AP in their damage type's color. */
const SHARD_STATS: Record<string, { abbr: string; type?: "physical" | "magic" }> = {
  "Attack Damage": { abbr: "AD", type: "physical" },
  "Ability Power": { abbr: "AP", type: "magic" },
  "Attack Speed": { abbr: "AS" },
  "Ability Haste": { abbr: "AH" },
  "Move Speed": { abbr: "MS" },
  Health: { abbr: "HP" },
  "Tenacity and Slow Resist": { abbr: "Tenacity & Slow Resist" },
};
const treeRow = (tree: string, row: number) => DATA.runes.filter((r) => r.tree === tree && r.row === row);
/** Sets --tree to a tree's color, for what's inside. */
const treeColor = (tree: string) => ({ "--tree": `var(--tree-${tree.toLowerCase()})` }) as CSSProperties;

export function RunesPanel({ state, set, sim }: { state: UIState; set: Set; sim: Sim | null }) {
  const page = state.runes;
  const hover = useHoverCard();
  const change = (fn: (p: RunePage) => RunePage) => set((s) => ({ ...s, runes: fn(s.runes) }));
  const pick = (r: RuneData) => (
    <button
      key={r.id}
      className="rune-pick"
      aria-pressed={page.picks.includes(r.id)}
      aria-label={r.name}
      onClick={() => change((p) => pickRune(DATA, p, r.id))}
      {...hover.bind(<RuneTip id={r.id} sim={sim} />)}
    >
      <Icon src={runeIcon(r.icon)} label={r.name} />
    </button>
  );
  // A shard's whole text is one line, so the rows show it, with numbers at your level: "+9 AP", "+110
  // HP (based on level)".
  const shardText = (id?: number) => {
    if (id === undefined) return "";
    const rune = DATA.runes.find((r) => r.id === id);
    if (!rune) return String(id);
    const text = runeText(rune, sim).body.replace(/<[^>]+>/g, "") || rune.name;
    const m = /^([+-][\d.,]+(?:-[\d.,]+)?%?) ([^(]+?)\s*(\(.*\))?$/.exec(text);
    const stat = m && SHARD_STATS[m[2]];
    if (!stat) return text;
    return (
      <>
        <span className={`it-value ${stat.type ?? ""}`}>
          {m[1]} {stat.abbr}
        </span>
        {m[3] && <span className="muted"> {m[3]}</span>}
      </>
    );
  };
  return (
    <Card title="Runes">
      <div className="rune-page">
        <div className="rune-tree" style={treeColor(page.primary)}>
          <TreePicker label="Primary" value={page.primary} trees={TREES} onPick={(t) => change((p) => choosePrimary(DATA, p, t))} />
          <div className="rune-row keystones" role="group" aria-label="Keystone">
            {treeRow(page.primary, 0).map(pick)}
          </div>
          {[1, 2, 3].map((row) => (
            <div key={row} className="rune-row" role="group" aria-label={`${page.primary} row ${row}`}>
              {treeRow(page.primary, row).map(pick)}
            </div>
          ))}
        </div>
        <div className="rune-tree" style={treeColor(page.secondary)}>
          <TreePicker
            label="Secondary"
            value={page.secondary}
            trees={TREES.filter((t) => t.key !== page.primary)}
            onPick={(t) => change((p) => chooseSecondary(DATA, p, t))}
          />
          {/* Lines its rows up with the primary's, under the keystones */}
          <div className="rune-row keystones" aria-hidden />
          {[1, 2, 3].map((row) => (
            <div key={row} className="rune-row" role="group" aria-label={`${page.secondary} row ${row}`}>
              {treeRow(page.secondary, row).map(pick)}
            </div>
          ))}
        </div>
      </div>
      <div className="shard-rows">
        {DATA.runePage.shards.map((row, i) => (
          <div key={row.label} className="shard-row" role="group" aria-label={`${row.label} shard`}>
            <div className="row" style={{ gap: 6, flexWrap: "nowrap" }}>
              {row.options.map((id) => {
                const r = DATA.runes.find((x) => x.id === id)!;
                return (
                  <button
                    key={id}
                    className="shard-pick"
                    aria-pressed={page.shards[i] === id}
                    aria-label={r.name}
                    // A page has a shard in each row, or none (Reset's): the first pick on one without fills the other rows with their first.
                    onClick={() => change((p) => ({ ...p, shards: DATA.runePage.shards.map((r, j) => (j === i ? id : (p.shards[j] ?? r.options[0]))) }))}
                    {...hover.bind(<RuneTip id={id} sim={sim} />)}
                  >
                    <Icon src={runeIcon(r.icon)} label={r.name} />
                  </button>
                );
              })}
            </div>
            <span className="small shard-text">{shardText(page.shards[i])}</span>
          </div>
        ))}
      </div>
      {hover.node}
    </Card>
  );
}

/** A rune page's tree: its name in its color and the trees to choose from. */
function TreePicker({ label, value, trees, onPick }: { label: string; value: string; trees: RuneTreeData[]; onPick: (tree: string) => void }) {
  const tree = TREES.find((t) => t.key === value);
  return (
    <div className="tree-head">
      <div className="small">
        <span className="secondary">{label}</span> <strong className="tree-name">{tree?.name ?? value}</strong>
      </div>
      <div className="tree-picker" role="group" aria-label={`${label} tree`}>
        {trees.map((t) => (
          <button
            key={t.key}
            className="tree-btn"
            style={treeColor(t.key)}
            aria-pressed={t.key === value}
            aria-label={t.name}
            title={`${t.name}: ${t.description}`}
            onClick={() => onPick(t.key)}
          >
            <Icon src={runeIcon(t.icon)} label={t.name} />
          </button>
        ))}
      </div>
    </div>
  );
}
