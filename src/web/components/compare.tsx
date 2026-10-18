// The builds compared, in the Result card: a health bar each in the tabs' order, the one on screen
// marked, a click on one's name opening it; then a table of their items and runes, totals, time to
// kill, gold and damage by source, each against the first build, its top rows until it's shown all.
// What the builds share (the champion, the target…) is the screen's, so they're all against one
// target. Folded, the card has the build on screen alone, a view preference kept in the browser.

import { useMemo, useRef, useState, type ReactNode } from "react";
import { DATA } from "../data.ts";
import { ItemIcon, RuneIcon } from "./icons.tsx";
import { fmt } from "./common.tsx";
import { HpBar, SourceName } from "./charts.tsx";
import { Chevron } from "./item-value.tsx";
import { encodeSetup, toScenario, type UIState } from "../state.ts";
import { simulate, type SimResult } from "../../engine/sim.ts";
import { withBuild } from "../scenarios.ts";
import type { Scenarios } from "./scenarios.tsx";

const FOLD_KEY = "damagesim:compare";

/** Whether the comparison is folded away: kept in the browser, a view's, not the page's. */
export function useFolded(): [boolean, (on: boolean) => void] {
  const [folded, setFolded] = useState(() => {
    try {
      return localStorage.getItem(FOLD_KEY) === "folded";
    } catch {
      return false;
    }
  });
  return [
    folded,
    (on) => {
      setFolded(on);
      try {
        if (on) localStorage.setItem(FOLD_KEY, "folded");
        else localStorage.removeItem(FOLD_KEY);
      } catch {
        // storage unavailable: for the session
      }
    },
  ];
}

/** The table's rows shown until all are: the top ones, fading. */
const PEEK = 3;

/** The difference from the first build: "+212", "−0.35s"; nothing where there's none. */
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
  const cell = (c: Column, v: number | undefined, base: number | undefined, digits = 0, unit = "") => (
    <td key={c.id} className={`r${c.on ? " on" : ""}`}>
      {v == null ? "–" : `${fmt(v, digits)}${unit}`}
      {c !== columns[0] && <Delta v={v} base={base} digits={digits} unit={unit === "%" ? " pts" : unit} />}
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
      {columns.map((c) => (
        <td key={c.id} className={`r${c.on ? " on" : ""}`}>
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
            {columns.map((c) => (
              <td key={c.id} className={`r small compare-combo${c.on ? " on" : ""}`}>
                {c.result?.combo ?? c.state.combo}
              </td>
            ))}
          </tr>,
        ]
      : []),
    ...figures.map(([label, value, digits, unit]) => (
      <tr key={label} className={label === "Total damage" ? "compare-total" : undefined}>
        <th scope="row">{label}</th>
        {columns.map((c) => cell(c, c.result ? value(c.result) : undefined, first ? value(first) : undefined, digits, unit))}
      </tr>
    )),
    <tr key="sources">
      <th scope="row" colSpan={columns.length + 1} className="compare-section">
        Damage by source
      </th>
    </tr>,
    ...[...sources.entries()]
      .sort((a, b) => b[1].most - a[1].most)
      .map(([key, s]) => (
        <tr key={key}>
          <th scope="row">
            <SourceName source={s.source} label={s.label} champion={state.champion} icon={s.icon} />
          </th>
          {columns.map((c) => cell(c, dealt(c, key), dealt(columns[0], key) ?? 0))}
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
        <table className="data" aria-label="Compared builds">
          <thead>
            <tr>
              <th />
              {columns.map((c) => (
                <th key={c.id} className={`r${c.on ? " on" : ""}`}>
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
          {all ? "Show less" : "Show all"}
        </span>
      </button>
    </div>
  );
}
