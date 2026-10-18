// The Compare card: what's on screen beside the other scenarios picked, each as it is now: their health
// bars at the end of the combo, then a table of their builds, totals, time to kill and damage by
// source, each against what's on screen. Optionally all against the target on screen, at its level.

import { useEffect, useMemo, useRef, useState } from "react";
import { DATA, championIcon } from "../data.ts";
import { Icon, ItemIcon } from "./icons.tsx";
import { Card, fmt } from "./common.tsx";
import { HpBar, SourceName } from "./charts.tsx";
import { toScenario, toTargetSpec, type UIState } from "../state.ts";
import { simulate, type SimResult } from "../../engine/sim.ts";
import { current, type Setup } from "../scenarios.ts";
import { stateOf, type Scenarios } from "./scenarios.tsx";

interface Column {
  /** The scenario's name, "" for the unsaved one. */
  name: string;
  setup: Setup;
  edited?: boolean;
  state: UIState;
  result: SimResult | null;
  error?: string;
}

const title = (c: Pick<Column, "name" | "edited">) => `${c.name || "Unsaved"}${c.edited ? " •" : ""}`;

/** A target's label without its items: "Tank lvl 11", "Lux lvl 13". */
const shortLabel = (label: string) => label.split(/,| \(/)[0];

/** The difference from what's on screen: "+212", "−0.35s"; nothing where there's none. */
function Delta({ v, base, digits = 0, unit = "" }: { v?: number; base?: number; digits?: number; unit?: string }) {
  if (v == null || base == null) return null;
  const d = v - base;
  if (Math.abs(d) < 0.5 * 10 ** -digits) return null;
  return (
    <span className="delta">
      {d > 0 ? "+" : "−"}
      {fmt(Math.abs(d), digits)}
      {unit}
    </span>
  );
}

export function CompareCard({ scenarios, state, result }: { scenarios: Scenarios; state: UIState; result: SimResult | null }) {
  const { shelf } = scenarios;
  // Left out, by name ("" the unsaved one): the rest are compared, a scenario saved later too.
  const [out, setOut] = useState<ReadonlySet<string>>(new Set());
  const [sameTarget, setSameTarget] = useState(false);
  const others = useMemo(
    () => [
      ...(shelf.unsaved ? [{ name: "", setup: shelf.unsaved }] : []),
      ...shelf.saved.filter((s) => s.name !== shelf.open).map((s) => ({ name: s.name, setup: current(s), edited: !!s.edited })),
    ],
    [shelf],
  );
  // Each scenario simulated once for what it is and the target it's against.
  const cache = useRef(new Map<string, { result: SimResult | null; error?: string }>());
  // The target on screen, at its level whatever the scenario's own level.
  const target = sameTarget ? { ...toTargetSpec(state.target), ...(result?.target.level != null ? { level: result.target.level } : {}) } : null;
  const targetKey = JSON.stringify(target);
  const columns = useMemo(() => {
    const cols: Column[] = [];
    if (!scenarios.comparing) return cols;
    for (const o of others) {
      if (out.has(o.name)) continue;
      const s = stateOf(o.setup);
      if (!s) continue;
      const key = `${o.setup.champion}#${o.setup.code}#${targetKey}`;
      let r = cache.current.get(key);
      if (!r) {
        try {
          r = { result: simulate(DATA, { ...toScenario(DATA, s), ...(target ? { target } : {}) }) };
        } catch (e) {
          r = { result: null, error: (e as Error).message };
        }
        if (cache.current.size > 100) cache.current.clear();
        cache.current.set(key, r);
      }
      cols.push({ ...o, state: s, ...r });
    }
    return cols;
  }, [scenarios.comparing, others, out, targetKey]);
  // Opened, it comes into view: on a phone it's under the cards for the build.
  const ref = useRef<HTMLDivElement>(null);
  const shown = useRef(false);
  useEffect(() => {
    if (scenarios.comparing && !shown.current && ref.current && ref.current.getBoundingClientRect().top > window.innerHeight) ref.current.scrollIntoView();
    shown.current = scenarios.comparing;
  }, [scenarios.comparing]);
  if (!scenarios.comparing) return null;
  const open = shelf.saved.find((s) => s.name === shelf.open);
  const all: Column[] = [{ name: open?.name ?? "", setup: scenarios.screen, edited: !!open?.edited, state, result }, ...columns];
  const base = result;
  // Every source any of them deals, the most damage first.
  const sources = new Map<string, { source: string; label: string; icon?: string; champion: string; most: number }>();
  for (const c of all)
    for (const s of c.result?.bySource ?? []) {
      const key = `${s.source}|${s.label}`;
      const was = sources.get(key);
      if (!was) sources.set(key, { source: s.source, label: s.label, icon: s.icon, champion: c.state.champion, most: s.damage });
      else was.most = Math.max(was.most, s.damage);
    }
  const rows = [...sources.entries()].sort((a, b) => b[1].most - a[1].most);
  const dealt = (c: Column, key: string) => c.result?.bySource.find((s) => `${s.source}|${s.label}` === key)?.damage;
  return (
    <div ref={ref}>
      <Card
        title="Compare"
        right={
          <span className="row" style={{ gap: 10 }}>
            <label className="row small" style={{ gap: 4 }} title="Each scenario against the target on screen, at its level, rather than its own">
              <input type="checkbox" checked={sameTarget} onChange={(e) => setSameTarget(e.target.checked)} />
              All against {result ? shortLabel(result.target.label) : "this target"}
            </label>
            <button className="btn small ghost" aria-label="Close Compare" onClick={() => scenarios.setComparing(false)}>
              ✕
            </button>
          </span>
        }
      >
        <div className="stack" style={{ gap: 12 }}>
          <div className="row" role="group" aria-label="Scenarios to compare" style={{ gap: 6 }}>
            <span className="small secondary">With</span>
            {others.map((o) => (
              <button
                key={o.name}
                className="btn small compare-pick"
                aria-pressed={!out.has(o.name)}
                disabled={!stateOf(o.setup)}
                onClick={() => setOut((x) => (x.has(o.name) ? new Set([...x].filter((n) => n !== o.name)) : new Set(x).add(o.name)))}
              >
                <Icon src={championIcon(o.setup.champion)} label={DATA.champions[o.setup.champion]?.name ?? o.setup.champion} size="xs" />
                {title(o)}
              </button>
            ))}
            {!others.length && <span className="small muted">no other scenario saved</span>}
          </div>
          <div className="compare-bars">
            {all.map((c, i) => (
              <div key={c.name} role="group" aria-label={title(c)}>
                <div className="row compare-head">
                  <Icon src={championIcon(c.state.champion)} label={DATA.champions[c.state.champion].name} size="xs" />
                  <strong>{title(c)}</strong>
                  {i === 0 && <span className="badge">on screen</span>}
                  {c.result && (
                    <span className="small secondary num">
                      {fmt(c.result.totalDamage)} · {(c.result.percentOfHp * 100).toFixed(1)}% ·{" "}
                      {c.result.killed ? <span className="kill">kill at {c.result.killTime!.toFixed(2)}s</span> : `${fmt(c.result.target.endHp)} HP left`}
                    </span>
                  )}
                </div>
                {c.result ? (
                  <HpBar
                    sources={c.result.bySource}
                    events={c.result.events}
                    by="time"
                    maxHp={c.result.target.maxHp}
                    startHp={c.result.target.startHp}
                    champion={c.result.champion.id}
                    executes={c.result.executeLines}
                  />
                ) : (
                  <div className="notice warn small">{c.error ?? "Doesn't simulate."}</div>
                )}
              </div>
            ))}
          </div>
          <div className="table-scroll compare-table">
            <table className="data" aria-label="Compared scenarios">
              <thead>
                <tr>
                  <th />
                  {all.map((c) => (
                    <th key={c.name} className="r">
                      {title(c)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                <tr>
                  <th scope="row">Build</th>
                  {all.map((c) => (
                    <td key={c.name} className="r">
                      <span className="compare-build">
                        <span className="small secondary">
                          {DATA.champions[c.state.champion].name} {c.state.level}
                        </span>
                        {c.state.items.map((id, k) => id != null && <ItemIcon key={k} id={id} size="sm" />)}
                      </span>
                    </td>
                  ))}
                </tr>
                <tr>
                  <th scope="row">Combo</th>
                  {all.map((c) => (
                    <td key={c.name} className="r small compare-combo">
                      {c.result?.combo ?? c.state.combo}
                    </td>
                  ))}
                </tr>
                <tr>
                  <th scope="row">Target</th>
                  {all.map((c) => (
                    <td key={c.name} className="r small" title={c.result?.target.label}>
                      {c.result && `${shortLabel(c.result.target.label)} · ${fmt(c.result.target.maxHp)} HP`}
                    </td>
                  ))}
                </tr>
                {(
                  [
                    ["Total damage", (r: SimResult) => r.totalDamage, 0, ""],
                    ["Of its health", (r: SimResult) => r.percentOfHp * 100, 1, "%"],
                    ["Kill at", (r: SimResult) => (r.killed ? r.killTime : undefined), 2, "s"],
                    ["Duration", (r: SimResult) => r.duration, 2, "s"],
                    ["DPS", (r: SimResult) => r.dps, 0, ""],
                    ["Gold", (r: SimResult) => r.gold, 0, ""],
                  ] as const
                ).map(([label, value, digits, unit]) => (
                  <tr key={label} className={label === "Total damage" ? "compare-total" : undefined}>
                    <th scope="row">{label}</th>
                    {all.map((c) => {
                      const v = c.result ? value(c.result) : undefined;
                      return (
                        <td key={c.name} className="r">
                          {v == null ? "–" : `${fmt(v, digits)}${unit}`}
                          {c !== all[0] && <Delta v={v} base={base ? value(base) : undefined} digits={digits} unit={unit === "%" ? " pts" : unit} />}
                        </td>
                      );
                    })}
                  </tr>
                ))}
                <tr>
                  <th scope="row" colSpan={all.length + 1} className="compare-section">
                    Damage by source
                  </th>
                </tr>
                {rows.map(([key, s]) => (
                  <tr key={key}>
                    <th scope="row">
                      <SourceName source={s.source} label={s.label} champion={s.champion} icon={s.icon} />
                    </th>
                    {all.map((c) => {
                      const v = dealt(c, key);
                      return (
                        <td key={c.name} className="r">
                          {v == null ? "–" : fmt(v)}
                          {c !== all[0] && <Delta v={v ?? 0} base={dealt(all[0], key) ?? 0} />}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </Card>
    </div>
  );
}
