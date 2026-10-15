// Item value: what each legendary or pair of boots would add to the current build, ranked by damage
// per gold or total damage, as a list or a gold-vs-damage map. Recomputed live as the build changes.

import { useEffect, useMemo, useRef, useState, type PointerEvent } from 'react';
import { DATA } from '../data.ts';
import { Card, ItemIcon, ItemTip, fmt } from './common.tsx';
import { GoldScatter, useTooltip, type GoldPoint } from './charts.tsx';
import { rankItems, defaultCandidates } from '../../engine/analysis.ts';
import type { Scenario, Sim } from '../../engine/sim.ts';
import type { UIState } from '../state.ts';

type Set = (fn: (s: UIState) => UIState) => void;
type Ranking = ReturnType<typeof rankItems>;
type Row = Ranking['items'][number];

const DEFAULT_IDS = defaultCandidates(DATA).map((i) => i.id);
const SHOWN = 8;
const signed = (v: number) => `${v >= 0 ? '+' : '−'}${fmt(Math.abs(v))}`;

export function ItemValueCard({ state, set, scenario, sim }: { state: UIState; set: Set; scenario: Scenario; sim: Sim | null }) {
  const [by, setBy] = useState<'perGold' | 'damage'>('perGold');
  const [view, setView] = useState<'list' | 'map'>('list');
  const [showAll, setShowAll] = useState(false);
  // The slot being ranked: the first empty one, or a filled one whose item is being reconsidered.
  const [chosen, setChosen] = useState<number | null>(null);
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
    const all = ranking?.items ?? [];
    const useful = all.filter((r) => r.gain > 0.5 || r.id === current);
    useful.sort((a, b) => (by === 'perGold' ? b.gainPerGold - a.gainPerGold : b.gain - a.gain));
    return { useful, none: all.length - useful.length };
  }, [ranking, by, current]);

  const pick = (id: number) => {
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
        <div className="row" style={{ gap: 6 }}>
          {view === 'list' && (
            <div className="segmented small" role="group" aria-label="Rank by">
              <button aria-pressed={by === 'perGold'} onClick={() => setBy('perGold')}>
                Per gold
              </button>
              <button aria-pressed={by === 'damage'} onClick={() => setBy('damage')}>
                Damage
              </button>
            </div>
          )}
          <div className="segmented small" role="group" aria-label="View">
            <button aria-pressed={view === 'list'} onClick={() => setView('list')}>
              List
            </button>
            <button aria-pressed={view === 'map'} onClick={() => setView('map')}>
              Gold map
            </button>
          </div>
        </div>
      }
    >
      <div className="row small secondary" style={{ marginBottom: 10 }}>
        <span>Damage each item adds to this combo</span>
        <select aria-label="Slot to rank" value={slot} onChange={(e) => setChosen(Number(e.target.value))}>
          {state.items.map((id, i) =>
            id != null ? (
              <option key={i} value={i}>
                in place of {DATA.items[id]?.name}
              </option>
            ) : (
              i === firstEmpty && (
                <option key={i} value={i}>
                  in slot {i + 1} (next item)
                </option>
              )
            ),
          )}
        </select>
      </div>
      {res?.error && <div className="notice warn small">{res.error}</div>}
      {!res && <div className="muted small">Simulating…</div>}
      {ranking && (
        <div className="iv-body" style={{ opacity: stale ? 0.55 : 1 }} aria-busy={stale}>
          {!rows.useful.length ? (
            <div className="muted small">No legendary item or pair of boots adds damage to this combo.</div>
          ) : view === 'list' ? (
            <RankList rows={rows.useful} limit={showAll ? Infinity : SHOWN} by={by} current={current} slotLabel={slotLabel} onPick={pick} sim={sim} />
          ) : (
            <GoldScatter
              points={rows.useful.map((r): GoldPoint => ({ id: r.id, label: r.item, gold: r.gold, gain: r.gain, perGold: r.gainPerGold, highlight: r.id === current }))}
              tip={(p, touch) => <RowTip row={rows.useful.find((r) => r.id === p.id)!} current={current} view="map" action={p.id === current || touch ? undefined : 'Click to buy'} />}
              onPick={(p) => pick(p.id)}
            />
          )}
          <div className="row small muted" style={{ marginTop: 8, justifyContent: 'space-between' }}>
            <span>
              {view === 'map'
                ? `The diagonal lines are equal damage per gold, so dots above a line beat that rate.${current != null ? ' The ring is the current item.' : ''}`
                : 'Per gold = damage gained per 1000 gold of item cost.'}
              {current != null && rows.useful.some((r) => r.id === current) && ` ${DATA.items[current]?.name} ranks #${rows.useful.findIndex((r) => r.id === current) + 1} of ${rows.useful.length} ${by === 'perGold' ? 'per gold' : 'by damage'}.`}
              {rows.none > 0 && ` ${rows.none} other item${rows.none === 1 ? '' : 's'} add no damage.`}
            </span>
            {view === 'list' && rows.useful.length > SHOWN && (
              <button className="btn small ghost" onClick={() => setShowAll(!showAll)}>
                {showAll ? 'Show top ' + SHOWN : `Show all ${rows.useful.length}`}
              </button>
            )}
          </div>
        </div>
      )}
    </Card>
  );
}

function RankList({ rows: all, limit, by, current, slotLabel, onPick, sim }: { rows: Row[]; limit: number; by: 'perGold' | 'damage'; current: number | null; slotLabel: string; onPick: (id: number) => void; sim: Sim | null }) {
  const tt = useTooltip();
  // The current item stays listed even when it isn't in the top rows.
  const rank = all.findIndex((r) => r.id === current) + 1;
  const rows = rank > limit ? [...all.slice(0, limit), all[rank - 1]] : all.slice(0, limit);
  const max = Math.max(1e-9, ...all.map((r) => (by === 'perGold' ? r.gainPerGold : r.gain)));
  // The item shows its details, the bar and numbers where its damage comes from, the Buy column nothing.
  const show = (e: { clientX: number; clientY: number; pointerType?: string }, r: Row, col: string) => {
    if (col === 'iv-item') tt.show(e, <ItemTip id={r.id} sim={sim} />);
    else if (col === 'iv-act') tt.hide();
    else tt.show(e, <RowTip row={r} current={current} view="list" />);
  };
  // Touch has no hover: a tap opens the card of the column tapped, and it stays until the next tap
  // (on the same spot, on the card, elsewhere in the list or outside it). Phones show only icons, so
  // this is how to see an item's name. A finger held on a row shows its card as hover would, moves it
  // from row to row as it slides (useTooltip keeps those moves from scrolling the page) and closes it
  // when it lifts.
  const [tapped, setTapped] = useState<string | null>(null);
  const hold = useRef<{ timer?: ReturnType<typeof setTimeout>; on: boolean }>({ on: false });
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
    if (col === 'iv-act' || tapped === key) close();
    else {
      setTapped(key);
      show(e, r, col);
    }
  };
  useEffect(() => {
    if (tapped == null) return;
    const outside = (e: globalThis.PointerEvent) => !tt.ref.current?.contains(e.target as Node) && close();
    document.addEventListener('pointerdown', outside);
    return () => document.removeEventListener('pointerdown', outside);
  }, [tapped]);
  return (
    <div className="chart-wrap" ref={tt.ref}>
      <div className="iv-list" role="table" aria-label="Items ranked by the damage they add" onPointerCancel={endHold} onTouchEnd={endHold} onTouchCancel={endHold}>
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
              effect damage
            </span>
          </span>
          <span role="columnheader" className={`iv-pg ${by === 'perGold' ? 'on' : ''}`}>
            per 1000g
          </span>
          <span role="columnheader" className={`iv-dmg ${by === 'damage' ? 'on' : ''}`}>
            damage
          </span>
          <span role="columnheader" className="iv-act" />
        </div>
        {rows.map((r) => {
          const v = by === 'perGold' ? r.gainPerGold : r.gain;
          const isCurrent = r.id === current;
          // Bar split: what the item adds to your other damage (its stats, Rabadon's-style multipliers)
          // and the damage it deals itself (procs, burns); a negative part is left out of the bar.
          const stats = Math.max(0, r.gain - r.itemDamage);
          const fx = Math.max(0, r.itemDamage);
          const width = (Math.max(0, v) / max) * 100;
          return (
            <div
              key={r.id}
              role="row"
              className={`iv-row ${isCurrent ? 'current' : ''}`}
              onPointerDown={(e) => {
                if (e.pointerType !== 'touch') return;
                const at = { clientX: e.clientX, clientY: e.clientY, pointerType: e.pointerType };
                const col = nearestColumn(e);
                clearTimeout(hold.current.timer);
                hold.current.timer = setTimeout(() => {
                  hold.current.on = true;
                  setTapped(null);
                  show(at, r, col);
                }, 200);
              }}
              onPointerMove={(e) => {
                if (e.pointerType !== 'touch') {
                  setTapped(null);
                  show(e, r, nearestColumn(e));
                } else if (hold.current.on) show(e, r, nearestColumn(e));
              }}
              onPointerLeave={(e) => e.pointerType !== 'touch' && tt.hide()}
              onPointerUp={(e) => e.pointerType === 'touch' && !hold.current.on && tap(e, r)}
            >
              <span role="cell" className="iv-item">
                <ItemIcon id={r.id} size="sm" />
                <span className="iv-name">{r.item}</span>
                <span className="iv-gold muted num">{fmt(r.gold)}g</span>
              </span>
              <span role="cell" className="iv-track" aria-hidden>
                {stats > 0.5 && <span className="iv-bar" style={{ width: `${(width * stats) / (stats + fx)}%` }} />}
                {fx > 0.5 && <span className="iv-bar fx" style={{ width: `${(width * fx) / (stats + fx)}%` }} />}
              </span>
              <span role="cell" className={`iv-pg num ${by === 'perGold' ? 'on' : ''}`}>
                {fmt(r.gainPerGold)}
              </span>
              <span role="cell" className={`iv-dmg num ${by === 'damage' ? 'on' : ''}`}>
                {signed(r.gain)}
              </span>
              <span role="cell" className="iv-act">
                {isCurrent ? (
                  <span className="small secondary">current</span>
                ) : (
                  <button className="btn small" aria-label={`Buy ${r.item} ${slotLabel}`} title={`Put ${r.item} ${slotLabel}`} onClick={() => onPick(r.id)}>
                    Buy
                  </button>
                )}
              </span>
            </div>
          );
        })}
      </div>
      {/* A tapped card takes taps itself, so a tap on it closes it instead of reaching the row or Buy
          button under it; on click, as closing it earlier would let the click land on those. */}
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
    const dx = Math.max(r.left - e.clientX, 0, e.clientX - r.right);
    const dy = Math.max(r.top - e.clientY, 0, e.clientY - r.bottom);
    if (dx * dx + dy * dy < bestDist) [best, bestDist] = [cell.classList[0], dx * dx + dy * dy];
  }
  return best;
}

/** A row's card shows what its view doesn't: in the list, which already has the numbers, how the bar
 *  splits between stats and effect damage; on the map, whose dots only have positions, the numbers. */
function RowTip({ row: r, current, view, action }: { row: Row; current: number | null; view: 'list' | 'map'; action?: string }) {
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
              Effect damage
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
      {action && <div className="muted">{action}</div>}
    </>
  );
}
