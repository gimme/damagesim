// The builds compared, in the Result card: a health bar each in the tabs' order, the one on screen's
// tinted, a click on one's name opening it; then a table of their items and runes, totals, time to
// kill, gold and damage by source, each against the first build, its top rows until it's shown all,
// its columns as wide each and a click on one opening its build. What the builds share (the champion,
// the target…) is the screen's, so they're all against one target. Folded (the page's, see
// encodePage), the card has the build on screen alone.

import { useMemo, useRef, useState, type CSSProperties, type PointerEvent, type ReactNode } from "react";
import { DATA } from "../data.ts";
import { ItemIcon, RuneIcon } from "./icons.tsx";
import { fmt } from "./common.tsx";
import { HpBar, SourceName } from "./charts.tsx";
import { Chevron } from "./item-value.tsx";
import { encodeSetup, toScenario, type UIState } from "../state.ts";
import { simulate, type SimResult } from "../../engine/sim.ts";
import { withBuild } from "../scenarios.ts";
import type { Scenarios } from "./scenarios.tsx";

/** The table's rows shown until all are: the top ones, fading. */
const PEEK = 3;

/** The difference from the first build: "+212", "−0.35s"; nothing where there's none, or with `room`, its room. */
function Delta({ v, base, digits = 0, unit = "", room }: { v?: number; base?: number; digits?: number; unit?: string; room?: boolean }) {
  const d = v == null || base == null ? 0 : v - base;
  if (Math.abs(d) < 0.5 * 10 ** -digits) return room ? <span className="delta" /> : null;
  return (
    <span className="delta">
      {d > 0 ? "+" : "−"}
      {fmt(Math.abs(d), digits)}
      {unit}
    </span>
  );
}

interface Column {
  id: number;
  name: string;
  on: boolean;
  state: UIState;
  result: SimResult | null;
  error?: string;
}

export function Compared({
  scenarios,
  state,
  result,
  by,
  controls,
}: {
  scenarios: Scenarios;
  state: UIState;
  result: SimResult;
  by: "time" | "size";
  /** Under the bars: how they're drawn. */
  controls: ReactNode;
}) {
  const { page } = scenarios;
  const [all, setAll] = useState(false);
  // The column the mouse is over, to open its build with a click.
  const [hot, setHot] = useState<number | null>(null);
  // Each build simulated once for what it is with what's shared.
  const cache = useRef(new Map<string, { result: SimResult | null; error?: string }>());
  const columns = useMemo(
    () =>
      page.builds.map((b, i): Column => {
        if (i === page.active) return { id: b.id, name: b.name, on: true, state, result };
        const s = withBuild(state, page, i);
        const key = encodeSetup(DATA, s);
        let r = cache.current.get(key);
        if (!r) {
          try {
            r = { result: simulate(DATA, toScenario(DATA, s)) };
          } catch (e) {
            r = { result: null, error: (e as Error).message };
          }
          if (cache.current.size > 100) cache.current.clear();
          cache.current.set(key, r);
        }
        return { id: b.id, name: b.name, on: false, state: s, ...r };
      }),
    [page, state, result],
  );
  const first = columns[0].result;
  // Every source any of them deals, the most damage first.
  const sources = new Map<string, { source: string; label: string; icon?: string; most: number }>();
  for (const c of columns)
    for (const s of c.result?.bySource ?? []) {
      const key = `${s.source}|${s.label}`;
      const was = sources.get(key);
      if (!was) sources.set(key, { source: s.source, label: s.label, icon: s.icon, most: s.damage });
      else was.most = Math.max(was.most, s.damage);
    }
  const dealt = (c: Column, key: string) => c.result?.bySource.find((s) => `${s.source}|${s.label}` === key)?.damage;
  /** A column's cell's props: the one on screen tinted, another opened by a click. */
  const col = (c: Column, i: number, className = "") => ({
    className: `r ${className}${c.on ? " on" : " pick"}${hot === i ? " hot" : ""}`,
    onPointerEnter: (e: PointerEvent) => e.pointerType === "mouse" && setHot(i),
    onClick: c.on ? undefined : () => scenarios.select(i),
  });
  const cell = (c: Column, i: number, v: number | undefined, base: number | undefined, digits = 0, unit = "") => (
    <td key={c.id} {...col(c, i)}>
      {v == null ? "–" : `${fmt(v, digits)}${unit}`}
      <Delta v={i ? v : undefined} base={base} digits={digits} unit={unit === "%" ? " pts" : unit} room />
    </td>
  );
  const figures: [string, (r: SimResult) => number | undefined, number, string][] = [
    ["Total damage", (r) => r.totalDamage, 0, ""],
    ["Of its health", (r) => r.percentOfHp * 100, 1, "%"],
    ["Kill at", (r) => (r.killed ? r.killTime : undefined), 2, "s"],
    ["Duration", (r) => r.duration, 2, "s"],
    ["DPS", (r) => r.dps, 0, ""],
    ["Gold", (r) => r.gold, 0, ""],
  ];
  const rows: ReactNode[] = [
    <tr key="build">
      <th scope="row">Build</th>
      {columns.map((c, i) => (
        <td key={c.id} {...col(c, i)}>
          <span className="compare-build">
            {c.state.items.map((id, k) => id != null && <ItemIcon key={k} id={id} size="sm" />)}
            {c.state.runes.picks[0] != null && <RuneIcon id={c.state.runes.picks[0]} />}
          </span>
        </td>
      ))}
    </tr>,
    ...(page.ownCombos
      ? [
          <tr key="combo">
            <th scope="row">Combo</th>
            {columns.map((c, i) => (
              <td key={c.id} {...col(c, i, "small compare-combo")}>
                {c.result?.combo ?? c.state.combo}
              </td>
            ))}
          </tr>,
        ]
      : []),
    ...figures.map(([label, value, digits, unit]) => (
      <tr key={label} className={label === "Total damage" ? "compare-total" : undefined}>
        <th scope="row">{label}</th>
        {columns.map((c, i) => cell(c, i, c.result ? value(c.result) : undefined, first ? value(first) : undefined, digits, unit))}
      </tr>
    )),
    <tr key="sources">
      <th scope="row" colSpan={columns.length + 1} className="compare-section">
        {/* Where the row's names stay, as the columns scroll under it */}
        <span>Damage by source</span>
      </th>
    </tr>,
    ...[...sources.entries()]
      .sort((a, b) => b[1].most - a[1].most)
      .map(([key, s]) => (
        <tr key={key}>
          <th scope="row">
            <SourceName source={s.source} label={s.label} champion={state.champion} icon={s.icon} />
          </th>
          {columns.map((c, i) => cell(c, i, dealt(c, key), dealt(columns[0], key) ?? 0))}
        </tr>
      )),
  ];
  return (
    <div className="stack" style={{ gap: 10, marginTop: 14 }}>
      <div className="compare-bars">
        {columns.map((c, i) => (
          <div key={c.id} className={`compare-bar${c.on ? " on" : ""}`} role="group" aria-label={c.name}>
            <div className="row compare-head">
              <button className="compare-name" aria-pressed={c.on} title={c.on ? "On screen" : `Open ${c.name}`} onClick={() => scenarios.select(i)}>
                {c.name}
              </button>
              {c.result && (
                <span className="small secondary num">
                  {fmt(c.result.totalDamage)}
                  {i > 0 && <Delta v={c.result.totalDamage} base={first?.totalDamage} />} · {(c.result.percentOfHp * 100).toFixed(1)}% ·{" "}
                  {c.result.killed ? <span className="kill">kill at {c.result.killTime!.toFixed(2)}s</span> : `${fmt(c.result.target.endHp)} HP left`} ·{" "}
                  {fmt(c.result.gold)}g
                </span>
              )}
            </div>
            {c.result ? (
              <HpBar
                sources={c.result.bySource}
                events={c.result.events}
                by={by}
                maxHp={c.result.target.maxHp}
                startHp={c.result.target.startHp}
                champion={c.result.champion.id}
                executes={c.result.executeLines}
                axis={i === columns.length - 1}
              />
            ) : (
              <div className="notice warn small">{c.error ?? "Doesn't simulate."}</div>
            )}
          </div>
        ))}
      </div>
      {controls}
      <div className="table-scroll compare-table">
        <table className="data" aria-label="Compared builds" style={{ "--builds": columns.length } as CSSProperties} onPointerLeave={() => setHot(null)}>
          <colgroup>
            <col className="names" />
            {columns.map((c) => (
              <col key={c.id} />
            ))}
          </colgroup>
          <thead>
            <tr>
              <th />
              {columns.map((c, i) => (
                <th key={c.id} {...col(c, i)} title={c.on ? undefined : `Open ${c.name}`}>
                  {c.name}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className={all ? undefined : "compare-peek"}>{all ? rows : rows.slice(0, PEEK)}</tbody>
        </table>
      </div>
      <button className="iv-more" aria-expanded={all} onClick={() => setAll(!all)}>
        <span>
          <Chevron />
          {all ? "Show less" : "Show more"}
        </span>
      </button>
    </div>
  );
}
