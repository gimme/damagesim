// Item value: what each legendary or pair of boots would add to the current build, ranked by damage
// per gold or total damage, as a list or a gold-vs-damage map. Recomputed live as the build changes.

import { useEffect, useLayoutEffect, useMemo, useRef, useState, type PointerEvent, type ReactNode } from 'react';
import { DATA } from '../data.ts';
import { Card, ItemIcon, ItemTip, fmt } from './common.tsx';
import { GoldScatter, useTooltip, type GoldPoint } from './charts.tsx';
import { rankItems, defaultCandidates } from '../../engine/analysis.ts';
import type { Scenario, Sim } from '../../engine/sim.ts';
import type { UIState } from '../state.ts';

type Set = (fn: (s: UIState) => UIState) => void;
type Ranking = ReturnType<typeof rankItems>;
type Row = Ranking['items'][number];
type By = 'perGold' | 'damage';

const DEFAULT_IDS = defaultCandidates(DATA).map((i) => i.id);
const SHOWN = 8;
/** How far ahead of the next best an item has to be, per gold, to stand out. */
const STANDOUT = 1.15;
const signed = (v: number) => `${v >= 0 ? '+' : '−'}${fmt(Math.abs(v))}`;

/**
 * The items far more gold-efficient than the rest: the best one, or the best two, when they're 15%
 * or more ahead of the next best per gold. About 2 rankings in 5 have one.
 */
function standouts(rows: Row[]): ReadonlySet<number> {
  const v = [...rows].sort((a, b) => b.gainPerGold - a.gainPerGold);
  for (let k = 0; k < 2 && k + 1 < v.length; k++) {
    const rest = v[k + 1].gainPerGold;
    if (rest > 0 && v[k].gainPerGold >= STANDOUT * rest) return new Set(v.slice(0, k + 1).map((r) => r.id));
  }
  return new Set();
}

export function ItemValueCard({ state, set, scenario, sim }: { state: UIState; set: Set; scenario: Scenario; sim: Sim | null }) {
  const [by, setBy] = useState<By>('perGold');
  const [view, setView] = useState<'list' | 'map'>('list');
  const [showAll, setShowAll] = useState(false);
  // The slot being ranked: the first empty one, or a filled one whose item is being reconsidered.
  const [chosen, setChosen] = useState<number | null>(null);
  // It follows its item when the build's items are moved.
  const seen = useRef(state.items);
  useLayoutEffect(() => {
    const [was, now] = [seen.current, state.items];
    seen.current = now;
    const id = chosen != null ? was[chosen] : null;
    if (id == null || now[chosen!] === id) return;
    const to = now.findIndex((x, k) => x === id && was[k] !== id);
    if (to >= 0) setChosen(to);
  }, [state.items]);
  const firstEmpty = state.items.findIndex((x) => x == null);
  const slot = chosen != null && (state.items[chosen] != null || chosen === firstEmpty) ? chosen : firstEmpty >= 0 ? firstEmpty : state.items.length - 1;
  const current = state.items[slot];

  const job = useMemo(() => {
    const base: Scenario = { ...scenario, items: state.items.filter((x, i): x is number => x != null && i !== slot) };
    const candidates = current != null && !DEFAULT_IDS.includes(current) ? [...DEFAULT_IDS, current] : undefined;
    return { key: JSON.stringify([base, candidates]), base, candidates };
  }, [scenario, state.items, slot, current]);

  // ~100 simulations: debounced so typing in the combo box stays responsive; the last result stays
  // on screen (dimmed) until the new one is ready.
  const [res, setRes] = useState<{ key: string; ranking: Ranking | null; error?: string } | null>(null);
  useEffect(() => {
    const t = setTimeout(
      () => {
        try {
          setRes({ key: job.key, ranking: rankItems(DATA, job.base, { candidates: job.candidates, limit: Infinity }) });
        } catch (e) {
          setRes({ key: job.key, ranking: null, error: (e as Error).message });
        }
      },
      res ? 250 : 0,
    );
    return () => clearTimeout(t);
  }, [job.key]);
  const stale = res?.key !== job.key;

  const ranking = res?.ranking;
  const rows = useMemo(() => {
    const useful = (ranking?.items ?? []).filter((r) => r.gain > 0.5 || r.id === current);
    useful.sort((a, b) => (by === 'perGold' ? b.gainPerGold - a.gainPerGold : b.gain - a.gain));
    return useful;
  }, [ranking, by, current]);
  const lead = useMemo(() => standouts(rows), [rows]);

  const pick = (id: number | null) => {
    set((s) => {
      const items = [...s.items];
      items[slot] = id;
      return { ...s, items };
    });
    setChosen(null);
  };

  const slotLabel = current != null ? `in place of ${DATA.items[current]?.name}` : `in slot ${slot + 1}`;

  return (
    <Card
      title="Item value"
      right={
        <div className="segmented small" role="group" aria-label="View">
          <button aria-pressed={view === 'list'} onClick={() => setView('list')}>
            List
          </button>
          <button aria-pressed={view === 'map'} onClick={() => setView('map')}>
            Gold map
          </button>
        </div>
      }
    >
      {/* The slot being ranked, picked from the build's slots: the next empty one or an item's */}
      <div className="iv-for">
        <div className="iv-slots" role="group" aria-label="Slot to rank items for">
          {state.items.map((id, i) => {
            const name = id != null ? DATA.items[id]?.name : null;
            const label = name ? `In place of ${name}` : i === firstEmpty ? 'Next item' : `Slot ${i + 1} (fill the slots before it first)`;
            return (
              <button key={i} className={`iv-slot ${id != null ? 'filled' : ''}`} aria-pressed={i === slot} disabled={id == null && i !== firstEmpty} aria-label={label} title={label} onClick={() => setChosen(i)}>
                {id != null ? <ItemIcon id={id} size="sm" /> : i === firstEmpty ? '+' : null}
              </button>
            );
          })}
        </div>
        <div className="iv-caption small">
          <span className="secondary">
            {current != null ? (
              <>
                In place of <strong>{DATA.items[current]?.name}</strong>
              </>
            ) : (
              'Next item'
            )}
          </span>
          {current != null && (
            <button className="btn small" aria-label={`Sell ${DATA.items[current]?.name}`} onClick={() => pick(null)}>
              Sell
            </button>
          )}
        </div>
      </div>
      {res?.error && <div className="notice warn small">{res.error}</div>}
      {!res && <div className="muted small">Simulating…</div>}
      {ranking && (
        <div className="iv-body" style={{ opacity: stale ? 0.55 : 1 }} aria-busy={stale}>
          {!rows.length ? (
            <div className="muted small">No legendary item or pair of boots adds damage to this combo.</div>
          ) : view === 'list' ? (
            <RankList rows={rows} shown={SHOWN} expanded={showAll} onExpand={setShowAll} by={by} setBy={setBy} current={current} lead={lead} slotLabel={slotLabel} onPick={pick} sim={sim} />
          ) : (
            <GoldScatter
              points={rows.map((r): GoldPoint => ({ id: r.id, label: r.item, gold: r.gold, gain: r.gain, perGold: r.gainPerGold, highlight: r.id === current, standout: lead.has(r.id) }))}
              tip={(p, touch) => <RowTip row={rows.find((r) => r.id === p.id)!} current={current} view="map" action={p.id === current || touch ? undefined : 'Click to buy'} />}
              onPick={(p) => pick(p.id)}
            />
          )}
        </div>
      )}
    </Card>
  );
}

/** Sizes the item column for every item that can be ranked, listed or not, so the bars stay put as the
 *  list expands and collapses and as the slot or build changes. */
const SIZER = (
  <div className="iv-row iv-sizer" aria-hidden>
    <span className="iv-item">
      {DEFAULT_IDS.map((id) => (
        <span key={id}>
          <span className="icon sm" />
          <span className="iv-name">{DATA.items[id].name}</span>
        </span>
      ))}
    </span>
  </div>
);

function RankList({
  rows: all,
  shown,
  expanded,
  onExpand,
  by,
  setBy,
  current,
  lead,
  slotLabel,
  onPick,
  sim,
}: {
  rows: Row[];
  shown: number;
  expanded: boolean;
  onExpand: (expanded: boolean) => void;
  by: By;
  setBy: (by: By) => void;
  current: number | null;
  lead: ReadonlySet<number>;
  slotLabel: string;
  onPick: (id: number) => void;
  sim: Sim | null;
}) {
  const tt = useTooltip();
  // Under the top rows, a line with Show all / Show less, then the rest: collapsed, only the current
  // item, when it isn't in the top rows. Rows come and go only under the line, so it stays in place.
  const rank = all.findIndex((r) => r.id === current) + 1;
  const top = all.slice(0, shown);
  const rest = expanded ? all.slice(shown) : rank > shown ? [all[rank - 1]] : [];
  const hidden = all.length - shown - (rank > shown ? 1 : 0);
  const max = Math.max(1e-9, ...all.map((r) => (by === 'perGold' ? r.gainPerGold : r.gain)));
  // A click on a row buys its item. The item shows its details, the rest of the row where its damage
  // comes from; a card from hovering says a click buys, one from a tap has the Buy button.
  const show = (e: { clientX: number; clientY: number; pointerType?: string }, r: Row, col: string, how: 'hover' | 'hold' | 'tap') => {
    const buy =
      r.id === current || how === 'hold' ? null : how === 'tap' ? (
        <button
          className="btn small primary iv-tip-buy"
          aria-label={`Buy ${r.item} ${slotLabel}`}
          onClick={(ev) => {
            ev.stopPropagation();
            close();
            onPick(r.id);
          }}
        >
          Buy
        </button>
      ) : (
        <div className="tt-foot">Click to buy</div>
      );
    tt.show(
      e,
      <>
        {col === 'iv-item' ? <ItemTip id={r.id} sim={sim} /> : <RowTip row={r} current={current} view="list" />}
        {buy}
      </>,
    );
  };
  // Touch has no hover: a tap opens the card of the column tapped, and it stays until the next tap
  // (on the same spot, on the card, elsewhere in the list or outside it); its Buy button buys. Phones
  // show only icons, so this is how to see an item's name. A finger held on a row shows its card as
  // hover would, moves it from row to row as it slides (useTooltip keeps those moves from scrolling
  // the page) and closes it when it lifts.
  const [tapped, setTapped] = useState<string | null>(null);
  const hold = useRef<{ timer?: ReturnType<typeof setTimeout>; on: boolean }>({ on: false });
  // What the last press on a row was, as the click that follows a tap opens a card rather than buying.
  const pointer = useRef('');
  const endHold = () => {
    clearTimeout(hold.current.timer);
    if (hold.current.on) tt.hide();
    hold.current.on = false;
  };
  const close = () => {
    setTapped(null);
    tt.hide();
  };
  const tap = (e: PointerEvent<HTMLElement>, r: Row) => {
    const col = nearestColumn(e);
    const key = `${r.id} ${col}`;
    if (tapped === key) close();
    else {
      setTapped(key);
      show(e, r, col, 'tap');
    }
  };
  useEffect(() => {
    if (tapped == null) return;
    const outside = (e: globalThis.PointerEvent) => !tt.ref.current?.contains(e.target as Node) && close();
    document.addEventListener('pointerdown', outside);
    return () => document.removeEventListener('pointerdown', outside);
  }, [tapped]);
  const sortBy = (key: By, label: string) => (
    <button className="iv-sort" onClick={() => setBy(key)}>
      {by === key && <Chevron />}
      {label}
    </button>
  );
  const row = (r: Row) => {
    const v = by === 'perGold' ? r.gainPerGold : r.gain;
    const isCurrent = r.id === current;
    // Bar split: what the item adds to your other damage (its stats, Rabadon's-style multipliers)
    // and the damage it deals itself (procs, burns); a negative part is left out of the bar.
    const stats = Math.max(0, r.gain - r.itemDamage);
    const fx = Math.max(0, r.itemDamage);
    const width = (Math.max(0, v) / max) * 100;
    const ahead = lead.has(r.id);
    const item = (
      <>
        <span className="iv-icon">
          <ItemIcon id={r.id} size="sm" />
          {ahead && <Sparkle className="iv-spark" />}
        </span>
        <span className="iv-name">{r.item}</span>
        {isCurrent && !expanded && rank > shown && <span className="iv-tag">#{rank}</span>}
      </>
    );
    return (
      <div
        key={r.id}
        role="row"
        aria-current={isCurrent || undefined}
        className={`iv-row ${isCurrent ? 'current' : ''} ${ahead ? 'standout' : ''}`}
        onPointerDown={(e) => {
          pointer.current = e.pointerType;
          if (e.pointerType !== 'touch') return;
          const at = { clientX: e.clientX, clientY: e.clientY, pointerType: e.pointerType };
          const col = nearestColumn(e);
          clearTimeout(hold.current.timer);
          hold.current.timer = setTimeout(() => {
            hold.current.on = true;
            setTapped(null);
            show(at, r, col, 'hold');
          }, 200);
        }}
        onPointerMove={(e) => {
          if (e.pointerType !== 'touch') {
            setTapped(null);
            show(e, r, nearestColumn(e), 'hover');
          } else if (hold.current.on) show(e, r, nearestColumn(e), 'hold');
        }}
        onPointerLeave={(e) => e.pointerType !== 'touch' && tt.hide()}
        onPointerUp={(e) => e.pointerType === 'touch' && !hold.current.on && tap(e, r)}
        // A keyboard's click (detail 0) on the item's button buys too.
        onClick={(e) => !isCurrent && (e.detail === 0 || pointer.current !== 'touch') && onPick(r.id)}
      >
        <span role="cell" className="iv-item">
          {isCurrent ? (
            item
          ) : (
            // For the keyboard; its click reaches the row, which buys.
            <button type="button" className="iv-buy" aria-label={`Buy ${r.item} ${slotLabel}${ahead ? ', far more damage per gold than the rest' : ''}`}>
              {item}
            </button>
          )}
        </span>
        <span role="cell" className="iv-track" aria-hidden>
          <span className="iv-bars" style={{ width: `${width}%` }}>
            {stats > 0.5 && <span className="iv-bar" style={{ flexGrow: stats }} />}
            {fx > 0.5 && <span className="iv-bar fx" style={{ flexGrow: fx }} />}
          </span>
        </span>
        <span role="cell" className={`iv-pg num ${by === 'perGold' ? 'on' : ''}`}>
          {fmt(r.gainPerGold)}
        </span>
        <span role="cell" className={`iv-dmg num ${by === 'damage' ? 'on' : ''}`}>
          {signed(r.gain)}
        </span>
      </div>
    );
  };
  return (
    <div className="chart-wrap" ref={tt.ref}>
      <div className="iv-list">
        <div className="iv-grid" role="table" aria-label="Items ranked by the damage they add" onPointerCancel={endHold} onTouchEnd={endHold} onTouchCancel={endHold}>
          <div className="iv-row iv-head" role="row">
            <span role="columnheader" className="iv-item">
              Item
            </span>
            <span role="columnheader" className="iv-track">
              <span>
                <span className="swatch" style={{ background: 'var(--accent)' }} />
                stats
              </span>
              <span>
                <span className="swatch" style={{ background: 'var(--accent-2)' }} />
                effect
              </span>
            </span>
            {/* The numbers' headings sort by them; where only one number fits, its heading switches it */}
            <span role="columnheader" className={`iv-pg ${by === 'perGold' ? 'on' : ''}`} aria-sort={by === 'perGold' ? 'descending' : undefined}>
              {sortBy('perGold', 'per 1000g')}
            </span>
            <span role="columnheader" className={`iv-dmg ${by === 'damage' ? 'on' : ''}`} aria-sort={by === 'damage' ? 'descending' : undefined}>
              {sortBy('damage', 'damage')}
            </span>
            <span role="columnheader" className="iv-swap on" aria-sort="descending">
              <button className="iv-sort" aria-label={`Ranked ${by === 'perGold' ? 'per 1000 gold' : 'by damage'}; rank ${by === 'perGold' ? 'by damage' : 'per 1000 gold'}`} onClick={() => setBy(by === 'perGold' ? 'damage' : 'perGold')}>
                <SwapIcon />
                {by === 'perGold' ? 'per 1000g' : 'damage'}
              </button>
            </span>
          </div>
          {SIZER}
          {top.map(row)}
          {hidden > 0 && (
            <div role="row" className="iv-more-row">
              <div role="cell">
                <button className="iv-more" aria-expanded={expanded} onClick={() => onExpand(!expanded)}>
                  <span>
                    <Chevron />
                    {expanded ? 'Show less' : 'Show all'}
                  </span>
                </button>
              </div>
            </div>
          )}
          {rest.map(row)}
        </div>
      </div>
      {/* A tapped card takes taps itself, so a tap on it closes it instead of reaching the row under
          it; on click, as closing it earlier would let the click land on the row. */}
      <div className={tapped ? 'iv-tapped' : undefined} onClick={tapped ? close : undefined}>
        {tt.node}
      </div>
    </div>
  );
}

/** The column of a row the pointer is over or nearest to. Nearest, so the row's padding and the gaps
 *  between columns don't switch between the cards. */
function nearestColumn(e: PointerEvent<HTMLElement>): string {
  let best = '';
  let bestDist = Infinity;
  for (const cell of Array.from(e.currentTarget.children)) {
    const r = cell.getBoundingClientRect();
    if (!r.width) continue;
    const dx = Math.max(r.left - e.clientX, 0, e.clientX - r.right);
    const dy = Math.max(r.top - e.clientY, 0, e.clientY - r.bottom);
    if (dx * dx + dy * dy < bestDist) [best, bestDist] = [cell.classList[0], dx * dx + dy * dy];
  }
  return best;
}

/** A row's card shows what its view doesn't: in the list, which already has the numbers, how the bar
 *  splits between stats and effect damage; on the map, whose dots only have positions, the numbers. */
function RowTip({ row: r, current, view, action }: { row: Row; current: number | null; view: 'list' | 'map'; action?: ReactNode }) {
  return (
    <>
      <div className="tt-title">
        {r.item} · {fmt(r.gold)}g{r.id === current ? ' (current)' : ''}
      </div>
      {view === 'list' ? (
        <>
          <div className="tt-row">
            <span>
              <span className="swatch" style={{ background: 'var(--accent)', marginRight: 6 }} />
              Stats
            </span>
            <strong>{signed(r.gain - r.itemDamage)}</strong>
          </div>
          <div className="tt-row">
            <span>
              <span className="swatch" style={{ background: 'var(--accent-2)', marginRight: 6 }} />
              Effect
            </span>
            <strong>{signed(r.itemDamage)}</strong>
          </div>
        </>
      ) : (
        <>
          <div className="tt-row">
            <span>Damage gained</span>
            <strong>{signed(r.gain)}</strong>
          </div>
          <div className="tt-row">
            <span>Per 1000 gold</span>
            <strong>{fmt(r.gainPerGold, 1)}</strong>
          </div>
        </>
      )}
      {action && <div className="tt-foot">{action}</div>}
    </>
  );
}

/** A four-pointed star: an item that stands out. */
export function Sparkle({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" aria-hidden>
      <path d="M12 0C12.9 6.6 17.4 11.1 24 12C17.4 12.9 12.9 17.4 12 24C11.1 17.4 6.6 12.9 0 12C6.6 11.1 11.1 6.6 12 0Z" fill="currentColor" />
    </svg>
  );
}

const Chevron = () => (
  <svg className="chevron" viewBox="0 0 10 10" aria-hidden>
    <path d="M2 3.5 5 6.5 8 3.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

const SwapIcon = () => (
  <svg className="chevron" viewBox="0 0 10 10" aria-hidden>
    <path d="M3 1.5v7M1.2 3.3 3 1.5l1.8 1.8M7 8.5v-7M5.2 6.7 7 8.5l1.8-1.8" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);
