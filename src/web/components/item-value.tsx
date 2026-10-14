// Item value: what each legendary or pair of boots would add to the current build, ranked by damage
// per gold or total damage, as a list or a gold-vs-damage map. Recomputed live as the build changes.

import { useEffect, useMemo, useState } from 'react';
import { DATA } from '../data.ts';
import { Card, ItemIcon, fmt } from './common.tsx';
import { GoldScatter, useTooltip, type GoldPoint } from './charts.tsx';
import { rankItems, defaultCandidates } from '../../engine/analysis.ts';
import type { Scenario } from '../../engine/sim.ts';
import type { UIState } from '../state.ts';

type Set = (fn: (s: UIState) => UIState) => void;
type Ranking = ReturnType<typeof rankItems>;
type Row = Ranking['items'][number];

const DEFAULT_IDS = defaultCandidates(DATA).map((i) => i.id);
const SHOWN = 8;
const signed = (v: number) => `${v >= 0 ? '+' : '−'}${fmt(Math.abs(v))}`;

export function ItemValueCard({ state, set, scenario }: { state: UIState; set: Set; scenario: Scenario }) {
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
  const base = ranking?.base;

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
        {base && (
          <span className="muted">
            Without it: {fmt(base.totalDamage)} damage, {(base.percentOfHp * 100).toFixed(0)}% of target health
          </span>
        )}
      </div>
      {res?.error && <div className="notice warn small">{res.error}</div>}
      {!res && <div className="muted small">Simulating…</div>}
      {ranking && (
        <div className="iv-body" style={{ opacity: stale ? 0.55 : 1 }} aria-busy={stale}>
          {!rows.useful.length ? (
            <div className="muted small">No legendary item or pair of boots adds damage to this combo.</div>
          ) : view === 'list' ? (
            <RankList rows={rows.useful} limit={showAll ? Infinity : SHOWN} by={by} current={current} slotLabel={slotLabel} onPick={pick} />
          ) : (
            <GoldScatter
              points={rows.useful.map((r): GoldPoint => ({ id: r.id, label: r.item, gold: r.gold, gain: r.gain, perGold: r.gainPerGold, highlight: r.id === current }))}
              tip={(p) => <RowTip row={rows.useful.find((r) => r.id === p.id)!} current={current} action={p.id === current ? undefined : 'Click to buy'} />}
              onPick={(p) => pick(p.id)}
            />
          )}
          <div className="row small muted" style={{ marginTop: 8, justifyContent: 'space-between' }}>
            <span>
              {view === 'map'
                ? `Higher is more damage; the diagonal lines are equal damage per gold, so dots above a line beat that rate.${current != null ? ' The ring is the current item.' : ''} Click a dot to buy it.`
                : `Each item simulated ${slotLabel}, same combo and target. Per gold = damage gained per 1000 gold of item cost.`}
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

function RankList({ rows: all, limit, by, current, slotLabel, onPick }: { rows: Row[]; limit: number; by: 'perGold' | 'damage'; current: number | null; slotLabel: string; onPick: (id: number) => void }) {
  const tt = useTooltip();
  // The current item stays listed even when it isn't in the top rows.
  const rank = all.findIndex((r) => r.id === current) + 1;
  const rows = rank > limit ? [...all.slice(0, limit), all[rank - 1]] : all.slice(0, limit);
  const max = Math.max(1e-9, ...all.map((r) => (by === 'perGold' ? r.gainPerGold : r.gain)));
  return (
    <div className="chart-wrap" ref={tt.ref}>
      <div className="iv-list" role="table" aria-label="Items ranked by the damage they add">
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
              <span className="swatch" style={{ background: 'var(--item-effect)' }} />
              item's own damage
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
              onPointerMove={(e) => tt.show(e, <RowTip row={r} current={current} />)}
              onPointerLeave={tt.hide}
            >
              <span role="cell" className="iv-item">
                <ItemIcon id={r.id} size="sm" />
                <span className="iv-name">{r.item}</span>
                <span className="muted num">{fmt(r.gold)}g</span>
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
      {tt.node}
    </div>
  );
}

function RowTip({ row: r, current, action }: { row: Row; current: number | null; action?: string }) {
  return (
    <>
      <div className="tt-title">
        {r.item} · {fmt(r.gold)}g{r.id === current ? ' (current)' : ''}
      </div>
      <div className="tt-row">
        <span>Damage gained</span>
        <strong>{signed(r.gain)}</strong>
      </div>
      <div className="tt-row">
        <span>Per 1000 gold</span>
        <strong>{fmt(r.gainPerGold, 1)}</strong>
      </div>
      <div className="tt-row">
        <span>
          <span className="swatch" style={{ background: 'var(--accent)', marginRight: 6 }} />
          added to your other damage
        </span>
        <span className="num">{signed(r.gain - r.itemDamage)}</span>
      </div>
      <div className="tt-row">
        <span>
          <span className="swatch" style={{ background: 'var(--item-effect)', marginRight: 6 }} />
          dealt by the item itself
        </span>
        <span className="num">{signed(r.itemDamage)}</span>
      </div>
      <div className="tt-row muted">
        <span>Total with it</span>
        <span className="num">{fmt(r.totalDamage)}</span>
      </div>
      {action && <div className="muted">{action}</div>}
    </>
  );
}
