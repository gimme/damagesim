// The Items card: the build's six slots, with the shop, drags between slots, and undo.

import { useEffect, useState, type KeyboardEvent } from 'react';
import { DATA } from '../data.ts';
import { ItemIcon } from './icons.tsx';
import { ItemPicker } from './pickers.tsx';
import { ItemTip, useHoverCard } from './hover.tsx';
import { useItemSlots } from './drag.tsx';
import { Card, fmt, useHistory } from './common.tsx';
import type { Set, UIState } from '../state.ts';
import type { Sim } from '../../engine/sim.ts';
import { conflicts } from '../../engine/analysis.ts';

export function ItemsPanel({ state, set, gold, sim }: { state: UIState; set: Set; gold: number; sim: Sim | null }) {
  const [picking, setPicking] = useState<number | null>(null);
  const hover = useHoverCard();
  const items = state.items;
  const build = items.filter((x): x is number => x != null).map((id) => DATA.items[id]);
  const warnings = build.flatMap((it, i) => {
    const c = conflicts(build.slice(0, i), it);
    return c ? [`${it.name}: only one ${c === 'duplicate' ? 'copy' : c === 'boots' ? 'pair of boots' : `${c} item`} works`] : [];
  });
  const put = (i: number, id: number | null) =>
    set((s) => {
      const next = [...s.items];
      next[i] = id;
      return { ...s, items: next };
    });
  const pick = (id: number) => {
    put(picking ?? 0, id);
    setPicking(null);
  };
  // Items are dragged between the slots and sold as in Item value's; the picker stays with what it
  // was opened for.
  const slots = useItemSlots(items, (fn) => set((s) => ({ ...s, items: fn(s.items) })), {
    onPick: hover.hide,
    onMove: (from, to) => setPicking((p) => (p === from ? to : p === to ? from : p)),
    onSell: hover.hide,
  });
  // Every change to the items, from here or elsewhere (a buy in Item value, Reset), can be undone.
  const past = useHistory(
    items,
    (v) => {
      hover.hide();
      set((s) => ({ ...s, items: v }));
    },
    (a, b) => a.length === b.length && a.every((x, i) => x === b[i]),
  );
  // Ctrl+Z and Ctrl+Shift+Z (or Ctrl+Y) while in this card, or with nothing focused.
  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      const k = e.key.toLowerCase();
      if (!(e.ctrlKey || e.metaKey) || e.altKey || (k !== 'z' && k !== 'y')) return;
      const el = e.target as HTMLElement;
      if (el !== document.body && !slots.box.current?.closest('.card')?.contains(el)) return;
      if (el.matches('input, textarea, select, [contenteditable]')) return;
      e.preventDefault();
      if (k === 'z' && !e.shiftKey) past.undo();
      else past.redo();
    };
    addEventListener('keydown', onKey);
    return () => removeEventListener('keydown', onKey);
  });
  return (
    <Card
      title="Items"
      right={
        <div className="row" style={{ gap: 6 }}>
          <span className="num secondary">{fmt(gold)}g</span>
          <button className="btn small" disabled={!past.canUndo} onClick={past.undo} aria-label="Undo" title="Undo (Ctrl+Z)">
            <span className="glyph">↶</span>
          </button>
          <button className="btn small" disabled={!past.canRedo} onClick={past.redo} aria-label="Redo" title="Redo (Ctrl+Shift+Z)">
            <span className="glyph">↷</span>
          </button>
          <button
            className="btn small"
            disabled={!build.length}
            onClick={() => {
              hover.hide();
              setPicking(null);
              set((s) => ({ ...s, items: s.items.map(() => null) }));
            }}
          >
            Clear
          </button>
        </div>
      }
    >
      <div className="picker-host">
        <div className="slots" ref={slots.box}>
          {items.map((id, i) => (
            <div
              key={i}
              aria-expanded={picking === i}
              aria-label={id ? `Item slot ${i + 1}: ${DATA.items[id]?.name}. Arrow keys move it, Delete sells it.` : `Empty item slot ${i + 1}`}
              title={id ? undefined : 'Add item'}
              {...slots.slot(i, {
                className: picking === i ? 'picking' : '',
                ...(id ? hover.bind(<ItemTip id={id} sim={sim} />) : {}),
                onClick: () => setPicking((p) => (p === i ? null : i)),
                onKeyDown: (e: KeyboardEvent) => e.target === e.currentTarget && e.key === 'Enter' && setPicking(i),
              })}
            >
              {id ? <ItemIcon id={id} /> : '+'}
              {slots.remove(i)}
            </div>
          ))}
          {slots.vacated}
        </div>
        {picking !== null && <ItemPicker onPick={pick} onClose={() => setPicking(null)} sim={sim} />}
      </div>
      {hover.node}
      {!!build.length && (
        <div className="small secondary" style={{ marginTop: 8 }}>
          {build.map((b) => b.name).join(' · ')}
        </div>
      )}
      {warnings.map((w) => (
        <div key={w} className="notice warn small" style={{ marginTop: 6 }}>
          <span className="ico">!</span>
          {w}
        </div>
      ))}
    </Card>
  );
}
