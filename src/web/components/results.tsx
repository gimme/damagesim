import { useMemo, useState } from "react";
import { DATA, abilityIcon } from "../data.ts";
import { Icon, ItemIcon, sourceMark } from "./icons.tsx";
import { ItemTip, useHoverCard } from "./hover.tsx";
import { Card, fmt } from "./common.tsx";
import { HpBar, LineChart, SimpleBars, SourceBars, SourceName, Timeline, TypeLegend, TYPE_COLOR, TYPE_LABEL, type DmgType } from "./charts.tsx";
import type { DamageInstance } from "../../engine/effects.ts";
import type { Scenario, SimResult, Sim } from "../../engine/sim.ts";
import { resistSweep, optimizeCombo, compare } from "../../engine/analysis.ts";
import { describeChampion } from "../../engine/describe.ts";
import type { UIState } from "../state.ts";
import { pageRunes } from "../../engine/rune-page.ts";

export function Summary({ r }: { r: SimResult }) {
  const [by, setBy] = useState<"time" | "size">("time");
  return (
    <Card title="Result" right={<TypeLegend amounts={r.byType} />}>
      <div className="hero">
        <div>
          <div className="label">Total damage</div>
          <div className="value num">{fmt(r.totalDamage)}</div>
        </div>
        <div className="stat-tile">
          <div className="label">of target health</div>
          <div className="value">{(r.percentOfHp * 100).toFixed(1)}%</div>
        </div>
        <div className="stat-tile">
          <div className="label">Duration · DPS</div>
          <div className="value">
            {r.duration.toFixed(2)}s · {fmt(r.dps)}
          </div>
        </div>
        {r.killed && (
          <div className="stat-tile end">
            <div className="label">Kill at</div>
            <div className="value kill">✓ {r.killTime!.toFixed(2)}s</div>
          </div>
        )}
      </div>
      <div style={{ marginTop: 14 }}>
        <HpBar
          sources={r.bySource}
          events={r.events}
          by={by}
          maxHp={r.target.maxHp}
          startHp={r.target.startHp}
          champion={r.champion.id}
          executes={r.executeLines}
        />
      </div>
      <div className="row">
        <span className="muted small" style={{ flex: 1 }}>
          {r.dotDamage > 1 && `${fmt(r.comboDamage)} burst + ${fmt(r.dotDamage)} damage over time.`}
        </span>
        <div className="segmented small" role="group" aria-label="Order the bar's sources">
          <button aria-pressed={by === "time"} onClick={() => setBy("time")}>
            Chronological
          </button>
          <button aria-pressed={by === "size"} onClick={() => setBy("size")}>
            By source
          </button>
        </div>
      </div>
      <Warnings r={r} />
    </Card>
  );
}

function Warnings({ r }: { r: SimResult }) {
  const [showNotes, setShowNotes] = useState(false);
  if (!r.warnings.length && !r.notes.length) return null;
  return (
    <div className="stack" style={{ marginTop: 10, gap: 6 }}>
      {r.warnings.map((w) => (
        <div key={w} className="notice warn small">
          <span className="ico">!</span>
          {w}
        </div>
      ))}
      {r.notes.length > 0 && (
        <button
          className="btn small ghost"
          style={{ alignSelf: "flex-start", padding: 0, whiteSpace: "normal", textAlign: "left" }}
          onClick={() => setShowNotes(!showNotes)}
        >
          {showNotes ? "▾" : "▸"} {r.notes.length} model note{r.notes.length === 1 ? "" : "s"} (assumptions and what isn't simulated)
        </button>
      )}
      {showNotes &&
        r.notes.map((n) => (
          <div key={n} className="notice small">
            <span className="ico">i</span>
            {n}
          </div>
        ))}
    </div>
  );
}

const TABS = ["Timeline", "Breakdown", "Events", "Abilities", "Compare", "Resist sweep", "Stats"] as const;
type Tab = (typeof TABS)[number];

export function Details({
  r,
  scenario,
  sim,
  state,
  pinned,
  onPin,
  onUnpin,
}: {
  r: SimResult;
  scenario: Scenario;
  sim: Sim | null;
  state: UIState;
  pinned: { label: string; state: UIState }[];
  onPin: () => void;
  onUnpin: (i: number) => void;
}) {
  const [tab, setTab] = useState<Tab>("Timeline");
  return (
    <section className="card">
      <div className="tabs" role="tablist">
        {TABS.map((t) => (
          <button key={t} role="tab" aria-selected={tab === t} onClick={() => setTab(t)}>
            {t}
          </button>
        ))}
      </div>
      {tab === "Timeline" && (
        <>
          <div className="row small secondary" style={{ justifyContent: "space-between", marginBottom: 6 }}>
            <span>Target health over time; dots are damage instances, bars along the bottom are your actions.</span>
            <TypeLegend />
          </div>
          <Timeline events={r.events} startHp={r.target.startHp} maxHp={r.target.maxHp} timeline={r.timeline} champion={r.champion.id} />
        </>
      )}
      {tab === "Breakdown" && (
        <>
          <div className="row small secondary" style={{ justifyContent: "space-between", marginBottom: 6 }}>
            <span>Damage dealt by source.</span>
            <TypeLegend />
          </div>
          <SourceBars sources={r.bySource} maxHp={r.target.maxHp} champion={r.champion.id} />
          <table className="data" style={{ marginTop: 10 }}>
            <thead>
              <tr>
                <th>Source</th>
                <th className="r" title="Damage instances: an ability's parts, a DoT's ticks and each proc count separately.">
                  Instances
                </th>
                <th className="r">Raw</th>
                <th className="r">Dealt</th>
                <th className="r">Share</th>
              </tr>
            </thead>
            <tbody>
              {r.bySource.map((s) => (
                <tr key={s.source + s.label}>
                  <td>
                    <SourceName source={s.source} label={s.label} champion={r.champion.id} />
                  </td>
                  <td className="r">{s.hits}</td>
                  <td className="r">{fmt(s.raw)}</td>
                  <td className="r">{fmt(s.damage)}</td>
                  <td className="r">{((s.damage / Math.max(1, r.totalDamage)) * 100).toFixed(1)}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
      {tab === "Events" && <Events r={r} />}
      {tab === "Abilities" && sim && <Abilities sim={sim} />}
      {tab === "Compare" && <Compare r={r} pinned={pinned} onPin={onPin} onUnpin={onUnpin} scenario={scenario} />}
      {tab === "Resist sweep" && <Sweep scenario={scenario} r={r} />}
      {tab === "Stats" && <Stats r={r} sim={sim} />}
    </section>
  );
}

/** A modifier's value: +10%, +7.5%. */
const signedPct = (v: number) => `${v >= 0 ? "+" : ""}${+(v * 100).toFixed(1)}%`;

function Events({ r }: { r: SimResult }) {
  const hover = useHoverCard();
  const champion = r.champion.id;
  return (
    <div className="table-scroll">
      <table className="data">
        <thead>
          <tr>
            <th className="r">Time</th>
            <th>Source</th>
            <th>Hit</th>
            <th>Type</th>
            <th className="r">Raw</th>
            <th className="r">Resist</th>
            <th className="r">Dealt</th>
            <th className="r">Target HP</th>
            <th>Modifiers</th>
          </tr>
        </thead>
        <tbody>
          {r.events.map((e) => (
            <tr key={e.id}>
              <td className="r">{e.time.toFixed(2)}s</td>
              <td>
                <SourceName source={e.source} label={e.sourceLabel} champion={champion} />
              </td>
              <td>{e.label}</td>
              <td>
                <span className="type-dot" style={{ background: TYPE_COLOR[e.type] }} />
                {TYPE_LABEL[e.type]}
              </td>
              <td className="r">{fmt(e.raw, 1)}</td>
              <td className="r">{e.type === "true" ? "–" : fmt(e.effectiveResist ?? 0, 1)}</td>
              <td className="r">{fmt(e.final ?? 0, 1)}</td>
              <td className="r">{fmt(Math.max(0, e.targetHpAfter ?? 0))}</td>
              <td className="small secondary">
                {/* What the modifiers do together, and each by its icon; the card names them with their values */}
                {e.amps.length > 0 && (
                  <span
                    className="amps"
                    tabIndex={0}
                    role="img"
                    aria-label={`${signedPct((e.ampMult ?? 1) - 1)}: ${e.amps.map((a) => `${a.source} ${signedPct(a.value)}`).join(", ")}`}
                    {...hover.bind(<AmpsTip e={e} champion={champion} />)}
                  >
                    <span className="total">{signedPct((e.ampMult ?? 1) - 1)}</span>
                    {e.amps.map((a, i) => (
                      <Icon key={i} src={sourceMark(a.id ?? "", a.source, champion).icon} label={a.source} size="xs" />
                    ))}
                  </span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {hover.node}
    </div>
  );
}

function AmpsTip({ e, champion }: { e: DamageInstance; champion: string }) {
  return (
    <>
      {e.amps.map((a, i) => (
        <div className="tt-row" key={i}>
          <SourceName source={a.id ?? ""} label={a.source} champion={champion} />
          <strong>{signedPct(a.value)}</strong>
        </div>
      ))}
      {/* Not always their sum: damage-taken modifiers multiply the rest */}
      {e.amps.length > 1 && (
        <div className="tt-row tt-total">
          <span className="muted">Combined</span>
          <strong>{signedPct((e.ampMult ?? 1) - 1)}</strong>
        </div>
      )}
    </>
  );
}

function Abilities({ sim }: { sim: Sim }) {
  const d = useMemo(() => describeChampion(sim), [sim]);
  return (
    <div>
      {d.kitNotes.length > 0 && (
        <div className="notice small" style={{ marginBottom: 8 }}>
          <span className="ico">i</span>
          <span>{d.kitNotes.join(" ")}</span>
        </div>
      )}
      {d.abilities.map((a) => (
        <div key={a.slot} className="ability">
          <div className="row">
            <Icon src={abilityIcon(sim.champ.id, a.slot)} label={a.name} size="sm" />
            <span className="kbd">{a.slot}</span>
            <strong>{a.name}</strong>
            {a.slot !== "P" && (
              <span className="muted small">
                rank {a.rank}/{a.maxRank}
                {a.cooldown ? ` · cooldown ${a.cooldown.join("/")}s` : ""}
              </span>
            )}
          </div>
          <div className="tip">{a.tooltip}</div>
          {a.components.length > 0 && (
            <table className="data">
              <tbody>
                {a.components.map((c) => (
                  <tr key={c.id + c.label}>
                    <td style={{ width: "40%" }}>
                      <span className="type-dot" style={{ background: TYPE_COLOR[c.type as DmgType] ?? "var(--axis)" }} />
                      {c.label}
                      {c.optional ? <span className="muted"> (optional)</span> : ""}
                    </td>
                    <td className="r">
                      <strong>{fmt(c.value, 1)}</strong>
                      {c.hits !== 1 ? ` × ${c.hits}` : ""}
                    </td>
                    <td className="small muted" style={{ whiteSpace: "normal" }}>
                      {c.formula}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {a.variants.map((v) => (
            <div key={v.key} className="small secondary" style={{ marginTop: 4 }}>
              Variant{" "}
              <code>
                {a.slot}:{v.key}
              </code>{" "}
              — {v.label}: {v.components.map((c) => `${c.label} ${fmt(c.value, 1)}`).join(", ")}
            </div>
          ))}
          {a.notes.map((n) => (
            <div key={n} className="small muted">
              {n}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

function Compare({
  r,
  pinned,
  onPin,
  onUnpin,
  scenario,
}: {
  r: SimResult;
  pinned: { label: string; state: UIState }[];
  onPin: () => void;
  onUnpin: (i: number) => void;
  scenario: Scenario;
}) {
  const [combos, setCombos] = useState<ReturnType<typeof optimizeCombo> | null>(null);
  return (
    <div className="stack">
      <div className="row">
        <span className="small secondary" style={{ flex: 1 }}>
          Pinned setups are re-simulated against the current target.
        </span>
        <button className="btn primary" onClick={onPin} disabled={pinned.length >= 6}>
          Pin current
        </button>
      </div>
      <PinnedBars r={r} pinned={pinned} onUnpin={onUnpin} scenario={scenario} />
      <div className="row" style={{ marginTop: 8 }}>
        <span className="small secondary" style={{ flex: 1 }}>
          Best ordering of the current combo's steps.
        </span>
        <button className="btn" onClick={() => setCombos(optimizeCombo(DATA, scenario, { top: 8 }))}>
          Find best order
        </button>
      </div>
      {combos && (
        <SimpleBars
          unit="Total damage"
          rows={combos.best.map((c) => ({
            label: c.combo,
            value: c.summary.totalDamage,
            sub: c.summary.killed ? `kill ${c.summary.killTime}s` : undefined,
            highlight: c.combo === r.combo,
          }))}
        />
      )}
    </div>
  );
}

function PinnedBars({
  r,
  pinned,
  onUnpin,
  scenario,
}: {
  r: SimResult;
  pinned: { label: string; state: UIState }[];
  onUnpin: (i: number) => void;
  scenario: Scenario;
}) {
  const results = useMemo(
    () =>
      compare(
        DATA,
        scenario,
        pinned.map((p) => {
          const s = p.state;
          return {
            label: p.label,
            changes: {
              champion: s.champion,
              level: s.level,
              ranks: s.ranks ?? undefined,
              skillOrder: s.skillOrder,
              items: s.items.filter((x): x is number => x != null),
              runes: pageRunes(DATA, s.runes),
              options: s.options,
              combo: s.combo,
            },
          };
        }),
      ).results,
    [pinned, scenario],
  );
  if (!pinned.length) return <div className="muted small">Nothing pinned yet.</div>;
  const rows = [
    { label: "Current", value: r.totalDamage, sub: `${r.gold}g${r.killed ? ` · kill ${r.killTime!.toFixed(2)}s` : ""}`, highlight: true },
    ...results.map((x) => ({ label: x.label, value: x.totalDamage, sub: `${x.gold}g${x.killed ? ` · kill ${x.killTime}s` : ""}` })),
  ];
  return (
    <>
      <SimpleBars unit="Total damage" rows={rows} />
      <div className="row" style={{ gap: 4 }}>
        {pinned.map((p, i) => (
          <button key={i} className="btn small" onClick={() => onUnpin(i)} title="Remove pinned setup">
            {p.label} ✕
          </button>
        ))}
      </div>
    </>
  );
}

function Sweep({ scenario, r }: { scenario: Scenario; r: SimResult }) {
  const [stat, setStat] = useState<"armor" | "mr">(r.byType.magic >= r.byType.physical ? "mr" : "armor");
  const points = useMemo(() => resistSweep(DATA, scenario, { stat, from: 0, to: 300, step: 10 }), [scenario, stat]);
  return (
    <div className="stack">
      <div className="row">
        <span className="small secondary" style={{ flex: 1 }}>
          Total damage of this combo as the target's {stat === "mr" ? "magic resist" : "armor"} changes. The vertical line marks the current target.
        </span>
        <div className="segmented">
          <button aria-pressed={stat === "armor"} onClick={() => setStat("armor")}>
            Armor
          </button>
          <button aria-pressed={stat === "mr"} onClick={() => setStat("mr")}>
            Magic resist
          </button>
        </div>
      </div>
      <LineChart
        xLabel={stat === "mr" ? "MR" : "armor"}
        markerX={stat === "mr" ? r.target.mr : r.target.armor}
        series={[{ label: "Total damage", color: "var(--accent)", points: points.map((p: any) => ({ x: p[stat], y: p.totalDamage })) }]}
      />
    </div>
  );
}

function Stats({ r, sim }: { r: SimResult; sim: Sim | null }) {
  const hover = useHoverCard();
  const s = r.stats;
  const t = r.target;
  const rows: [string, string][] = [
    ["Health", fmt(s.maxHp)],
    ["Attack damage", `${fmt(s.ad, 1)} (${fmt(s.baseAd, 1)} + ${fmt(s.bonusAd, 1)})`],
    ["Ability power", fmt(s.ap, 1)],
    ["Attack speed", s.attackSpeed.toFixed(3)],
    ["Crit", `${fmt(s.critChance * 100)}% · ${fmt(s.critDamage * 100)}% dmg`],
    ["Armor / MR", `${fmt(s.armor)} / ${fmt(s.mr)}`],
    ["Lethality", fmt(s.lethality, 1)],
    ["Armor pen", `${fmt(s.armorPenPercent * 100, 1)}%`],
    ["Magic pen", `${fmt(s.magicPenFlat)} + ${fmt(s.magicPenPercent * 100, 1)}%`],
    ["Ability haste", fmt(s.abilityHaste)],
    ["Move speed", fmt(s.moveSpeed)],
    ["Range", fmt(s.range)],
  ];
  return (
    <div className="stack">
      <div className="stats-grid">
        {rows.map(([k, v]) => (
          <div key={k}>
            <span>{k}</span>
            <strong className="num">{v}</strong>
          </div>
        ))}
      </div>
      <div className="small secondary" style={{ marginTop: 8 }}>
        Target: {t.label} — {fmt(t.maxHp)} HP, armor {fmt(t.armor)} → <strong>{fmt(t.effectiveArmor, 1)}</strong> after your penetration (takes{" "}
        {(t.physicalMultiplier * 100).toFixed(1)}% physical), MR {fmt(t.mr)} → <strong>{fmt(t.effectiveMr, 1)}</strong> (takes{" "}
        {(t.magicMultiplier * 100).toFixed(1)}% magic).
      </div>
      <div className="row small" style={{ gap: 6 }}>
        {r.items.map((i) => (
          <span key={i.id} className="row" style={{ gap: 4 }} {...hover.bind(<ItemTip id={i.id} sim={sim} />)}>
            <ItemIcon id={i.id} size="sm" />
            {i.name}
          </span>
        ))}
        {hover.node}
      </div>
    </div>
  );
}
