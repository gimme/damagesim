// The champion search and the item shop.

import { useEffect, useMemo, useRef, useState } from "react";
import { DATA } from "../data.ts";
import { ChampIcon, ItemIcon } from "./icons.tsx";
import { ItemTip, useHoverCard } from "./hover.tsx";
import type { ItemData } from "../../engine/data-types.ts";
import type { Sim } from "../../engine/sim.ts";
import { builtFrom } from "../../engine/analysis.ts";
import { search } from "../search.ts";
import { isQuestBoots } from "../slots.ts";

export function ChampionPicker({ value, onChange, label = "Champion" }: { value: string; onChange: (id: string) => void; label?: string }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [active, setActive] = useState(0);
  const ref = useRef<HTMLDivElement>(null);
  const list = useMemo(() => {
    return search(DATA.championIndex, (c) => c.name, q);
  }, [q]);
  useEffect(() => {
    const close = (e: globalThis.MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);
  const pick = (id: string) => {
    onChange(id);
    setOpen(false);
    setQ("");
  };
  // As a combobox: the focus stays in the field after a pick, which then shows the champion with the
  // list closed, as after Escape; a click, an arrow key or typing opens the list again, and what's
  // typed starts a new search.
  const startSearch = (text: string) => {
    setOpen(true);
    setQ(text);
    setActive(0);
  };
  const champ = DATA.champions[value];
  return (
    <div className="picker" ref={ref}>
      <div className="row" style={{ flexWrap: "nowrap" }}>
        <ChampIcon id={value} size="lg" />
        <input
          type="search"
          style={{ flex: 1 }}
          aria-label={label}
          placeholder={champ?.name ?? "Search champion"}
          value={open ? q : (champ?.name ?? value)}
          onFocus={() => startSearch("")}
          onClick={() => !open && startSearch("")}
          // Closed, the field held the champion's name: only what was typed counts (nothing, for a deletion).
          onChange={(e) => startSearch(open ? e.target.value : ((e.nativeEvent as InputEvent).data ?? ""))}
          onKeyDown={(e) => {
            // A search field's Escape also empties it, which would open the list again.
            if (e.key === "Escape") {
              e.preventDefault();
              setOpen(false);
            } else if (!open) {
              if (e.key === "ArrowDown" || e.key === "ArrowUp") startSearch("");
            } else if (e.key === "ArrowDown") setActive((a) => Math.min(list.length - 1, a + 1));
            else if (e.key === "ArrowUp") setActive((a) => Math.max(0, a - 1));
            else if (e.key === "Enter" && list[active]) pick(list[active].id);
          }}
        />
      </div>
      {open && (
        <div className="picker-list" role="listbox">
          {list.map((c, i) => (
            <div
              key={c.id}
              role="option"
              aria-selected={i === active}
              className="picker-option"
              // Without taking the focus from the field.
              onMouseDown={(e) => {
                e.preventDefault();
                pick(c.id);
              }}
              onMouseEnter={() => setActive(i)}
            >
              <ChampIcon id={c.id} size="sm" />
              <span style={{ flex: 1 }}>{c.name}</span>
            </div>
          ))}
          {!list.length && (
            <div className="muted small" style={{ padding: 8 }}>
              No champion matches “{q}”.
            </div>
          )}
        </div>
      )}
    </div>
  );
}

const isBoots = (i: ItemData) => i.tags.includes("Boots");

const ITEM_FILTERS: { label: string; test: (i: ItemData) => boolean }[] = [
  { label: "All", test: () => true },
  { label: "AP", test: (i) => !!i.stats.ap },
  { label: "AD", test: (i) => !!i.stats.ad },
  { label: "Crit", test: (i) => !!i.stats.critChance },
  { label: "Attack speed", test: (i) => !!i.stats.attackSpeed },
  { label: "Lethality", test: (i) => !!i.stats.lethality || !!i.stats.armorPenPercent },
  { label: "Magic pen", test: (i) => !!i.stats.magicPenFlat || !!i.stats.magicPenPercent },
  { label: "Health", test: (i) => !!i.stats.hp },
  { label: "Boots", test: isBoots },
];

export const SHOP_ITEMS: ItemData[] = Object.values(DATA.items)
  .filter(
    (i) =>
      (i.inStore || [3040, 3042, 3121].includes(i.id)) &&
      !i.requiredChampion &&
      i.gold.total > 0 &&
      !i.tags.includes("Consumable") &&
      !i.tags.includes("Trinket"),
  )
  .sort((a, b) => b.depth - a.depth || a.name.localeCompare(b.name));

/**
 * The shop. `bootsOnly`: for the boots slot, which every tier lists; `questBoots`: with the tier 3
 * boots; `build`: the items an item's price leaves out, those it's built from.
 */
export function ItemPicker({
  onPick,
  onClose,
  sim,
  bootsOnly,
  questBoots,
  build,
}: {
  onPick: (id: number) => void;
  onClose: () => void;
  sim?: Sim | null;
  bootsOnly?: boolean;
  questBoots: boolean;
  build?: (number | null)[];
}) {
  const hover = useHoverCard();
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState(0);
  const [tier, setTier] = useState<"legendary" | "all">("legendary");
  const filters = bootsOnly ? [] : ITEM_FILTERS;
  const price = (i: ItemData) => i.gold.total - (build ? builtFrom(DATA, build, i.id).reduce((sum, k) => sum + DATA.items[build[k]!].gold.total, 0) : 0);
  const list = search(
    SHOP_ITEMS.filter(
      (i) =>
        (!bootsOnly || isBoots(i)) &&
        (questBoots || !isQuestBoots(i.id)) &&
        (tier === "all" || i.depth >= 3 || isBoots(i) || i.gold.total >= 2200) &&
        (filters[filter]?.test(i) ?? true),
    ),
    (i) => i.name,
    q,
  );
  // Enter buys the top match, marked while there's a search.
  const top = q.trim() ? list[0]?.id : undefined;
  // It drops down over what's below its parent, which holds what opens it; a click outside that,
  // or Escape, closes it.
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const close = (e: globalThis.MouseEvent) => {
      if (!ref.current?.parentElement?.contains(e.target as Node)) onClose();
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [onClose]);
  return (
    <div className="item-picker" ref={ref} onKeyDown={(e) => e.key === "Escape" && onClose()}>
      <div className="row">
        <input
          type="search"
          autoFocus
          placeholder="Search items"
          aria-label="Search items"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          style={{ flex: "1 1 140px" }}
          onKeyDown={(e) => e.key === "Enter" && top !== undefined && onPick(top)}
        />
        <div className="row" style={{ gap: 4, flexWrap: "nowrap", marginLeft: "auto" }}>
          {!bootsOnly && (
            <div className="segmented">
              <button aria-pressed={tier === "legendary"} onClick={() => setTier("legendary")}>
                Completed
              </button>
              <button aria-pressed={tier === "all"} onClick={() => setTier("all")}>
                All
              </button>
            </div>
          )}
          <button className="btn ghost small" onClick={onClose} aria-label="Close item picker">
            ✕
          </button>
        </div>
      </div>
      {!!filters.length && (
        <div className="row" style={{ marginTop: 6, gap: 4 }}>
          {filters.map((f, i) => (
            <button key={f.label} className="btn small" aria-pressed={filter === i} onClick={() => setFilter(i)}>
              {f.label}
            </button>
          ))}
        </div>
      )}
      <div className="item-grid">
        {list.map((i) => (
          <button
            key={i.id}
            className={`item-option${i.id === top ? " top" : ""}`}
            onClick={() => onPick(i.id)}
            {...hover.bind(<ItemTip id={i.id} sim={sim} />)}
          >
            <ItemIcon id={i.id} size="sm" />
            <span className="stack" style={{ gap: 0, minWidth: 0 }}>
              <span className="name">{i.name}</span>
              <span className="muted small">{price(i)}g</span>
            </span>
          </button>
        ))}
      </div>
      {hover.node}
    </div>
  );
}
