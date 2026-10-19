// The Items card: the build's six slots, and the bot lane quest's for boots, with the shop, drags
// between slots, and undo.

import { useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent } from "react";
import { DATA } from "../data.ts";
import { BootsGlyph, ItemIcon } from "./icons.tsx";
import { ItemPicker } from "./pickers.tsx";
import { ItemTip, useHoverCard } from "./hover.tsx";
import { useItemSlots } from "./drag.tsx";
import { BuildTitle, Card, fmt, useHistory } from "./common.tsx";
import type { Set, UIState } from "../state.ts";
import { BOOTS_SLOT, addBootsSlot, buyItem, withItems } from "../slots.ts";
import type { Sim } from "../../engine/sim.ts";
import { conflicts } from "../../engine/analysis.ts";

export function ItemsPanel({ state, set, gold, sim, buildName }: { state: UIState; set: Set; gold: number; sim: Sim | null; buildName?: string }) {
  const [picking, setPicking] = useState<number | null>(null);
  const hover = useHoverCard();
  const items = state.items;
  const bootsSlot = items.length > BOOTS_SLOT;
  const build = items.filter((x): x is number => x != null).map((id) => DATA.items[id]);
  const warnings = build.flatMap((it, i) => {
    const c = conflicts(build.slice(0, i), it);
    return c ? [`${it.name}: only one ${c === "duplicate" ? "copy" : c === "boots" ? "pair of boots" : `${c} item`} works`] : [];
  });
  // Boots go to the build's boots, an upgrade to what it's built from (see buyItem).
  const pick = (id: number) => {
    set((s) => withItems(s, buyItem(s.items, picking ?? 0, id)));
    setPicking(null);
  };
  // Items are dragged between the slots and sold as in Item value's; the picker stays with what it
  // was opened for.
  const slots = useItemSlots(items, (fn) => set((s) => withItems(s, fn(s.items))), {
    onPick: hover.hide,
    onMove: (from, to) => setPicking((p) => (p === from ? to : p === to ? from : p)),
    onSell: hover.hide,
  });
  // Few builds have the bot lane quest's boots slot: a narrow button after the six adds it, and once
  // empty, its ✕ or Delete takes it away. The focus goes from one to the other.
  const addButton = useRef<HTMLButtonElement>(null);
  const focusAdd = useRef(false);
  useEffect(() => {
    if (focusAdd.current) addButton.current?.focus();
    focusAdd.current = false;
  });
  const addSlot = () => {
    hover.hide();
    slots.focusLater(BOOTS_SLOT);
    set((s) => withItems(s, addBootsSlot(s.items)));
  };
  const removeSlot = () => {
    hover.hide();
    setPicking((p) => (p === BOOTS_SLOT ? null : p));
    focusAdd.current = !!slots.box.current?.contains(document.activeElement);
    set((s) => withItems(s, s.items.slice(0, BOOTS_SLOT)));
  };
  // Every change to the items, from here or elsewhere (a buy in Item value, Reset), can be undone, and
  // brings back with it Item value's count of items to rank, which a buy takes down (withItems): a set
  // of 3 undone is 3 ranked again, a sale undone leaves it. The count picked by itself isn't a change
  // to undo; it goes with the next one.
  const entry = useMemo(() => ({ items, next: state.next }), [items, state.next]);
  const past = useHistory(
    entry,
    (v) => {
      hover.hide();
      set((s) => ({ ...s, ...v }));
    },
    (a, b) => a.items.length === b.items.length && a.items.every((x, i) => x === b.items[i]),
  );
  // Ctrl+Z and Ctrl+Shift+Z (or Ctrl+Y) while in this card, or with nothing focused.
  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      const k = e.key.toLowerCase();
      if (!(e.ctrlKey || e.metaKey) || e.altKey || (k !== "z" && k !== "y")) return;
      const el = e.target as HTMLElement;
      if (el !== document.body && !slots.box.current?.closest(".card")?.contains(el)) return;
      if (el.matches("input, textarea, select, [contenteditable]")) return;
      e.preventDefault();
      if (k === "z" && !e.shiftKey) past.undo();
      else past.redo();
    };
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  });
  return (
    <Card
      title={<BuildTitle title="Items" build={buildName} />}
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
              set((s) =>
                withItems(
                  s,
                  s.items.map(() => null),
                ),
              );
            }}
          >
            Clear
          </button>
        </div>
      }
    >
      <div className="picker-host">
        <div className="slots-row">
          <div className="slots" ref={slots.box} style={{ "--slots": items.length } as CSSProperties}>
            {items.map((id, i) => {
              const boots = bootsSlot && i === BOOTS_SLOT;
              return (
                <div
                  key={i}
                  aria-expanded={picking === i}
                  aria-label={
                    boots
                      ? id
                        ? `Boots slot: ${DATA.items[id]?.name}. Delete sells it.`
                        : "Empty boots slot. Delete removes it."
                      : id
                        ? `Item slot ${i + 1}: ${DATA.items[id]?.name}. Arrow keys move it, Delete sells it.`
                        : `Empty item slot ${i + 1}`
                  }
                  title={id ? undefined : boots ? "Add boots" : "Add item"}
                  {...slots.slot(i, {
                    className: picking === i ? "picking" : "",
                    ...(id ? hover.bind(<ItemTip id={id} sim={sim} />) : {}),
                    onClick: () => setPicking((p) => (p === i ? null : i)),
                    onKeyDown: (e: KeyboardEvent) => {
                      if (e.target !== e.currentTarget) return;
                      if (e.key === "Enter") setPicking(i);
                      else if (boots && !id && (e.key === "Delete" || e.key === "Backspace")) {
                        e.preventDefault();
                        removeSlot();
                      }
                    },
                  })}
                >
                  {id ? <ItemIcon id={id} /> : boots ? <BootsGlyph /> : "+"}
                  {boots && !id ? (
                    <button
                      className="remove"
                      aria-label="Remove the boots slot"
                      title="Remove the boots slot"
                      onClick={(e) => {
                        e.stopPropagation();
                        removeSlot();
                      }}
                    >
                      <svg viewBox="0 0 10 10" aria-hidden>
                        <path d="M3 3 7 7M7 3 3 7" />
                      </svg>
                    </button>
                  ) : (
                    slots.remove(i)
                  )}
                </div>
              );
            })}
            {slots.vacated}
          </div>
          {!bootsSlot && (
            <button ref={addButton} className="add-boots-slot" aria-label="Add an extra boots slot" title="Extra boots slot" onClick={addSlot}>
              <BootsGlyph plus />
            </button>
          )}
        </div>
        {picking !== null && (
          <ItemPicker
            onPick={pick}
            onClose={() => setPicking(null)}
            sim={sim}
            bootsOnly={bootsSlot && picking === BOOTS_SLOT}
            questBoots={state.settings.questBoots}
            build={items}
          />
        )}
      </div>
      {hover.node}
      {!!build.length && (
        <div className="small secondary" style={{ marginTop: 8 }}>
          {build.map((b) => b.name).join(" · ")}
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
