// The Champion card: who attacks, at what level and ranks, and the champion, item and rune parameters.

import { useMemo } from "react";
import { DATA, castIcon, championIcon } from "../data.ts";
import { ChampIcon, Icon, sourceMark } from "./icons.tsx";
import { ChampionPicker } from "./pickers.tsx";
import { ItemTip, Markup, RuneTip, useHoverCard } from "./hover.tsx";
import { Card, fmt } from "./common.tsx";
import type { Set, UIState } from "../state.ts";
import { maxRanks, resolveRanks, type Sim } from "../../engine/sim.ts";
import { renderTooltip } from "../../engine/tooltip.ts";
import { describeChampion } from "../../engine/describe.ts";
import { bonusSkillPoints } from "../../engine/runes.ts";
import { getKit } from "../../kits/index.ts";
import { DISTANCE, type Effect } from "../../engine/effects.ts";
import type { KitOption } from "../../engine/kit-types.ts";

/** `pick` opens another champion's page, `linkTo` is its address: the picker's options are links to them. */
export function AttackerPanel({
  state,
  set,
  sim,
  pick,
  linkTo,
}: {
  state: UIState;
  set: Set;
  sim: Sim | null;
  pick: (id: string) => void;
  linkTo: (id: string) => string;
}) {
  const champ = DATA.champions[state.champion];
  const max = maxRanks(champ);
  // Triple Tonic's extra skill point (the sim's runes match the current state).
  const extraPoints = sim ? bonusSkillPoints(sim.runes, state.level) : 0;
  const ranks =
    state.ranks ??
    (() => {
      const r = resolveRanks(champ, state.level, undefined, state.skillOrder, extraPoints);
      return { Q: r.Q, W: r.W, E: r.E, R: r.R };
    })();
  const totalPoints = ranks.Q + ranks.W + ranks.E + ranks.R;
  const setRank = (k: "Q" | "W" | "E" | "R", v: number) => set((s) => ({ ...s, ranks: { ...ranks, [k]: Math.max(0, Math.min(max[k], v)) } }));
  const hover = useHoverCard();
  const described = useMemo(() => (sim ? describeChampion(sim).abilities : null), [sim]);
  return (
    <Card title="Champion">
      <div className="stack" style={{ gap: 12 }}>
        <ChampionPicker value={state.champion} onChange={pick} href={linkTo} />
        <div className="row" style={{ flexWrap: "nowrap" }}>
          <span className="small secondary" style={{ width: 44 }}>
            Level
          </span>
          <input
            type="range"
            min={1}
            max={20}
            value={state.level}
            aria-label="Champion level"
            onChange={(e) => set((s) => ({ ...s, level: Number(e.target.value), ranks: null }))}
          />
          <strong className="num" style={{ width: 24, textAlign: "right" }}>
            {state.level}
          </strong>
        </div>
        <div className="row" style={{ gap: 6 }}>
          {(["P", "Q", "W", "E", "R"] as const).map((k) => {
            // The ability's card on hover: its name, cooldown and cost, and its tooltip at its rank
            const key = (
              <span
                className="row"
                style={{ gap: 4 }}
                tabIndex={0}
                aria-label={k === "P" ? champ.passive.name : (champ.abilities.find((a) => a.slot === k)?.spells[0]?.name ?? k)}
                {...(sim && described ? hover.bind(<AbilityTip sim={sim} ability={described.find((a) => a.slot === k)!} />) : {})}
              >
                <Icon src={castIcon(state.champion, k, sim?.slotIcon(k))} label={k} size="xs" />
                <span className="kbd">{k}</span>
              </span>
            );
            // The passive has no rank: its key alone, in line with the others'.
            return k === "P" ? (
              <div key={k} style={{ alignSelf: "flex-start" }}>
                {key}
              </div>
            ) : (
              <label key={k} className="field" style={{ alignItems: "center" }}>
                {key}
                <input
                  type="number"
                  min={0}
                  max={max[k]}
                  value={ranks[k]}
                  style={{ width: 52 }}
                  aria-label={`${k} rank`}
                  onChange={(e) => setRank(k, Number(e.target.value))}
                />
              </label>
            );
          })}
          <div className="stack" style={{ gap: 2, marginLeft: "auto" }}>
            <label className="field">
              Max order
              <select value={state.skillOrder} onChange={(e) => set((s) => ({ ...s, skillOrder: e.target.value, ranks: null }))}>
                {["QWE", "QEW", "WQE", "WEQ", "EQW", "EWQ"].map((o) => (
                  <option key={o}>{o}</option>
                ))}
              </select>
            </label>
          </div>
        </div>
        {totalPoints > state.level + extraPoints && (
          <div className="notice warn small">
            {totalPoints} skill points used at level {state.level}.
          </div>
        )}
        {state.ranks && (
          <button className="btn small" style={{ alignSelf: "flex-start" }} onClick={() => set((s) => ({ ...s, ranks: null }))}>
            Reset to default leveling
          </button>
        )}
        <OptionsEditor state={state} set={set} sim={sim} />
      </div>
      {hover.node}
    </Card>
  );
}

/** An ability's hover card: its name, rank, cooldown and cost there, and its tooltip with the numbers
 *  for your rank, level and stats (rank 1's while it has no points). The passive's has no rank. */
function AbilityTip({ sim, ability: a }: { sim: Sim; ability: ReturnType<typeof describeChampion>["abilities"][number] }) {
  const slot = a.slot as "P" | "Q" | "W" | "E" | "R";
  const rank = Math.max(1, a.rank);
  const cooldown = a.cooldown?.[rank - 1];
  const cost = a.cost?.[rank - 1];
  // Other resources' costs in the data aren't costs to cast (Zac's health, Sett's Grit, Yasuo's Flow).
  const resource = sim.champ.partype === "Mana" || sim.champ.partype === "Energy" ? sim.champ.partype.toLowerCase() : null;
  const text = renderTooltip(sim, slot, sim.spellFor(slot), rank, { html: true })
    .replace(/<li>/gi, "<br>• ")
    .replace(/\{\{[^}]*\}\}|%i:\w+%/g, "")
    .replace(/^(\s|<br\s*\/?>)+|(\s|<br\s*\/?>)+$/gi, "");
  const facts = [
    slot === "P" ? "" : a.rank ? `Rank ${a.rank}/${a.maxRank}` : "No points: rank 1 shown",
    cooldown ? `${fmt(cooldown, 2)}s cooldown` : "",
    cost && resource ? `${fmt(cost)} ${resource}` : "",
  ]
    .filter(Boolean)
    .join(" · ");
  return (
    <div className="item-tip">
      <div className="it-head">
        <Icon src={castIcon(sim.champ.id, slot, sim.slotIcon(slot))} label={a.name} size="sm" />
        <strong>{a.name}</strong>
        <span className="kbd">{slot}</span>
      </div>
      {facts && <div className="secondary">{facts}</div>}
      {text && (
        <div className="it-body">
          <Markup text={text} />
        </div>
      )}
    </div>
  );
}

function OptionsEditor({ state, set, sim }: { state: UIState; set: Set; sim: Sim | null }) {
  const hover = useHoverCard();
  const champ = DATA.champions[state.champion];
  const kit = getKit(champ);
  // Each parameter once, with everything in the scenario that reads it: your HP can matter to Olaf,
  // Last Stand and Overlord's Bloodmail at once.
  // Where the target stands matters to every champion's missiles and dashes.
  const declared: { o: KitOption; id: string; name: string }[] = [
    ...(kit.options ?? []).map((o) => ({ o, id: "kit", name: champ.name })),
    { o: DISTANCE, id: "kit", name: champ.name },
    ...(sim?.effects ?? []).flatMap((e: Effect) => (e.options ?? []).map((o) => ({ o, id: e.id, name: e.label }))),
  ];
  const opts = new Map<string, { o: KitOption; sources: { id: string; name: string }[] }>();
  for (const { o, id, name } of declared) {
    const entry = opts.get(o.key) ?? { o, sources: [] };
    if (!entry.sources.some((s) => s.id === id)) entry.sources.push({ id, name });
    opts.set(o.key, entry);
  }
  if (!opts.size) return null;
  const card = (id: string, name: string) => {
    const [kind, n] = id.split(":");
    if (kind === "item") return <ItemTip id={Number(n)} sim={sim} />;
    if (kind === "rune") return <RuneTip id={Number(n)} sim={sim} />;
    return (
      <div className="item-tip">
        <div className="it-head">
          <ChampIcon id={state.champion} size="sm" />
          <strong>{name}</strong>
        </div>
      </div>
    );
  };
  const setOpt = (key: string, v: number) => set((s) => ({ ...s, options: { ...s.options, [key]: v } }));
  return (
    <details>
      <summary>Champion, item & rune parameters ({opts.size})</summary>
      <div className="stack" style={{ marginTop: 8 }}>
        {[...opts.values()].map(({ o, sources }) => {
          const v = state.options[o.key] ?? sim?.opt[o.key] ?? o.default;
          const isToggle = o.toggle || (o.max === 1 && (o.min ?? 0) === 0 && o.step === 1);
          return (
            <div key={o.key} className="row" style={{ flexWrap: "nowrap" }}>
              <span className="small" style={{ flex: 1 }} title={o.description}>
                {o.label}
              </span>
              <span className="opt-sources">
                {sources.map((s) => (
                  <span key={s.id} tabIndex={0} role="img" aria-label={s.name} {...hover.bind(card(s.id, s.name))}>
                    <Icon src={s.id === "kit" ? championIcon(state.champion) : sourceMark(s.id, s.name, state.champion).icon} label={s.name} size="xs" />
                  </span>
                ))}
              </span>
              <span className="opt-control">
                {isToggle ? (
                  <input type="checkbox" aria-label={o.label} checked={!!v} onChange={(e) => setOpt(o.key, e.target.checked ? 1 : 0)} />
                ) : (
                  <input
                    type="number"
                    aria-label={o.label}
                    value={v}
                    min={o.min}
                    max={o.max}
                    step={o.step ?? 1}
                    onChange={(e) => setOpt(o.key, Number(e.target.value))}
                  />
                )}
              </span>
            </div>
          );
        })}
      </div>
      {hover.node}
    </details>
  );
}
