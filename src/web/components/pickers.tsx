// The champion search and the item shop.

import { useEffect, useMemo, useRef, useState } from "react";
import { DATA } from "../data.ts";
import { ChampIcon, ItemIcon } from "./icons.tsx";
import { ItemTip, effectsNotSimulated, useHoverCard } from "./hover.tsx";
import { getKit } from "../../kits/index.ts";
import type { ItemData } from "../../engine/data-types.ts";
import type { Sim } from "../../engine/sim.ts";
import { search } from "../search.ts";

export function KitBadge({ id }: { id: string }) {
  const status = getKit(DATA.champions[id]).status;
  const text = status === "auto" ? "auto kit" : status;
  return (
    <span
      className={`badge ${status === "auto" ? "auto" : "curated"}`}
      title={
        status === "auto"
          ? "Abilities auto-mapped from tooltips: per-hit numbers exact, hit counts/conditions approximate."
          : "Mechanics modeled by hand from the game data."
      }
    >
      {text}
    </span>
  );
}

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
  const champ = DATA.champions[value];
  return (
    <div className="picker" ref={ref}>
      <div className="row" style={{ flexWrap: "nowrap" }}>
        <ChampIcon id={value} size="lg" />
        <div className="stack" style={{ gap: 4, flex: 1, minWidth: 0 }}>
          <input
            type="search"
            aria-label={label}
            placeholder={champ?.name ?? "Search champion"}
            value={open ? q : (champ?.name ?? value)}
            onFocus={() => {
              setOpen(true);
              setQ("");
              setActive(0);
            }}
            onChange={(e) => {
              setQ(e.target.value);
              setActive(0);
            }}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") setActive((a) => Math.min(list.length - 1, a + 1));
              else if (e.key === "ArrowUp") setActive((a) => Math.max(0, a - 1));
              else if (e.key === "Enter" && list[active]) pick(list[active].id);
              else if (e.key === "Escape") setOpen(false);
            }}
          />
          <div className="row small secondary" style={{ gap: 6 }}>
            <span>{champ?.title}</span>
            <KitBadge id={value} />
          </div>
        </div>
      </div>
      {open && (
        <div className="picker-list" role="listbox">
          {list.map((c, i) => (
            <div
              key={c.id}
              role="option"
              aria-selected={i === active}
              className="picker-option"
              onMouseDown={() => pick(c.id)}
              onMouseEnter={() => setActive(i)}
            >
              <ChampIcon id={c.id} size="sm" />
              <span style={{ flex: 1 }}>{c.name}</span>
              <KitBadge id={c.id} />
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

const ITEM_FILTERS: { label: string; test: (i: ItemData) => boolean }[] = [
  { label: "All", test: () => true },
  { label: "AP", test: (i) => !!i.stats.ap },
  { label: "AD", test: (i) => !!i.stats.ad },
  { label: "Crit", test: (i) => !!i.stats.critChance },
  { label: "Attack speed", test: (i) => !!i.stats.attackSpeed },
  { label: "Lethality", test: (i) => !!i.stats.lethality || !!i.stats.armorPenPercent },
  { label: "Magic pen", test: (i) => !!i.stats.magicPenFlat || !!i.stats.magicPenPercent },
  { label: "Health", test: (i) => !!i.stats.hp },
  { label: "Boots", test: (i) => i.tags.includes("Boots") },
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

export function ItemPicker({ onPick, onClose, sim }: { onPick: (id: number) => void; onClose: () => void; sim?: Sim | null }) {
  const hover = useHoverCard();
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState(0);
  const [tier, setTier] = useState<"legendary" | "all">("legendary");
  const list = search(
    SHOP_ITEMS.filter((i) => (tier === "all" || i.depth >= 3 || i.tags.includes("Boots") || i.gold.total >= 2200) && ITEM_FILTERS[filter].test(i)),
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
          <div className="segmented">
            <button aria-pressed={tier === "legendary"} onClick={() => setTier("legendary")}>
              Completed
            </button>
            <button aria-pressed={tier === "all"} onClick={() => setTier("all")}>
              All
            </button>
          </div>
          <button className="btn ghost small" onClick={onClose} aria-label="Close item picker">
            ✕
          </button>
        </div>
      </div>
      <div className="row" style={{ marginTop: 6, gap: 4 }}>
        {ITEM_FILTERS.map((f, i) => (
          <button key={f.label} className="btn small" aria-pressed={filter === i} onClick={() => setFilter(i)}>
            {f.label}
          </button>
        ))}
      </div>
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
              <span className="muted small">
                {i.gold.total}g{effectsNotSimulated(i) ? " · stats only" : ""}
              </span>
            </span>
          </button>
        ))}
      </div>
      {hover.node}
    </div>
  );
}
