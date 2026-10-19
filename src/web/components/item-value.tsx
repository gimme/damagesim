// Item value: what each legendary or pair of boots would add to the current build, or the best sets
// of several to buy together (item-sets.tsx), ranked by damage per gold or total damage, as a list or
// a gold-vs-damage map. Recomputed live as the build changes, in the ranking worker (ranking.ts).

import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type MouseEvent,
  type PointerEvent,
  type ReactNode,
  type RefObject,
} from "react";
import { DATA } from "../data.ts";
import { BootsGlyph, Icon, ItemIcon, sourceMark } from "./icons.tsx";
import { ItemTip, useHoverCard } from "./hover.tsx";
import { useItemSlots } from "./drag.tsx";
import { Card, Chevron, fmt } from "./common.tsx";
import { GoldScatter, useTooltip, type GoldPoint } from "./charts.tsx";
import { CountPicker, Excluded, SetItems, setKey, setList, setName } from "./item-sets.tsx";
import { defaultCandidates, type ItemSet } from "../../engine/analysis.ts";
import type { Scenario, Sim } from "../../engine/sim.ts";
import { buildItems, type Set, type UIState } from "../state.ts";
import { useRanking, type ItemRanking, type RunProgress } from "../ranking.ts";
import { BOOTS_SLOT, buyItem, buyItems, isBoots, isQuestBoots, slotFits, withItems } from "../slots.ts";

type Row = ItemRanking["items"][number];
/** A row of the list: an item, or a set of items. */
type Entry = Row | ItemSet;
type By = "perGold" | "damage";

const isSet = (r: Entry): r is ItemSet => "items" in r;
/** A row's own hits, named by their item. */
const hitsOf = (r: Entry) => (isSet(r) ? r.itemHits : r.itemHits.map((h) => ({ ...h, source: `item:${r.id}` })));

const DEFAULT_IDS = defaultCandidates(DATA).map((i) => i.id);
const SHOWN = 8;
/** How far ahead of the next best an item has to be, per gold, to stand out. */
const STANDOUT = 1.15;
/** Whether a number shows as 0, to d decimals. */
const nil = (v: number, d = 0) => Math.abs(v) < 0.5 / 10 ** d;
/** A gain: + or −, and no sign for one that shows as 0. */
const signed = (v: number) => (nil(v) ? "0" : `${v > 0 ? "+" : "−"}${fmt(Math.abs(v))}`);
/** Per gold: − for a loss, as a gain has it. */
const perGold = (v: number, d = 0) => `${v < 0 && !nil(v, d) ? "−" : ""}${fmt(Math.abs(v), d)}`;

/** The parts of an item's bar: base, what it adds to your other damage (its stats, Rabadon's-style
 *  multipliers); effect, the damage it deals itself (its procs, burns); procs, the hits of your other
 *  damage that land only with it (Electrocute it procs, an execute it brings the target into range of);
 *  lost, what it takes away from your other damage (a proc it makes land later, adaptive force
 *  turning AD), struck out at the bar's end. */
const PARTS = ["base", "effect", "procs", "lost"] as const;
type Part = (typeof PARTS)[number];

/** A row's bar: a segment per entry of its card, the base, each of the items' hits and each proc,
 *  largest first within each part; a negligible one is left out. */
function segments(r: Entry): { part: Part; key: string; damage: number }[] {
  return [
    { part: "base" as const, key: "base", damage: r.baseDamage },
    ...hitsOf(r).map((h) => ({ part: "effect" as const, key: `effect|${h.source}|${h.name}`, damage: h.damage })),
    ...r.procs.map((p) => ({ part: "procs" as const, key: `procs|${p.source}|${p.name}`, damage: p.damage })),
  ].filter((s) => s.damage > 0.5);
}

/** What the bar's segments add up to, before what the items take away. */
const added = (r: Entry) => r.baseDamage + r.itemDamage + r.procDamage;
/** What the items take away, the bar's struck part: none, where it rounds to nothing. */
const taken = (r: Entry) => (r.lostDamage <= -0.5 ? -r.lostDamage : 0);
const loses = (r: Entry) => taken(r) > 0;
/** The bar's solid part: what the items add, less what they take away. */
const kept = (r: Entry) => Math.max(0, added(r) - taken(r));
/** The segments drawn: none where nothing's kept. */
const drawnSegments = (r: Entry) => (kept(r) >= 0.5 ? segments(r) : []);

const Swatch = ({ part, gap }: { part: Part; gap?: boolean }) => <span className={`swatch iv-${part}`} style={gap ? { marginRight: 6 } : undefined} />;

/**
 * The items far more gold-efficient than the rest: the best one, or the best two, when they're 15%
 * or more ahead of the next best per gold. About 2 rankings in 5 have one. Only items whose damage
 * per gold shows as more than 0 count: being ahead of a pair of boots that adds nothing isn't standing out.
 */
function standouts(rows: Row[]): ReadonlySet<number> {
  const v = rows.filter((r) => r.gainPerGold > 0 && !nil(r.gainPerGold)).sort((a, b) => b.gainPerGold - a.gainPerGold);
  for (let k = 0; k < 2 && k + 1 < v.length; k++) {
    if (v[k].gainPerGold >= STANDOUT * v[k + 1].gainPerGold) return new Set(v.slice(0, k + 1).map((r) => r.id));
  }
  return new Set();
}

export function ItemValueCard({ state, set, scenario, sim }: { state: UIState; set: Set; scenario: Scenario; sim: Sim | null }) {
  const [by, setBy] = useState<By>("perGold");
  const [view, setView] = useState<"list" | "map">("list");
  const [showAll, setShowAll] = useState(false);
  // How many items to rank together, the build's (state.next, so in the address), never more than its
  // empty slots, which sets of more than one fill: items bought, by any route, take it down by as many
  // (withItems), and undo brings it back. Sets are for the empty slots, so more than one picks no
  // item to replace.
  const count = state.next;
  const setCount = (n: number) => set((s) => ({ ...s, next: n, replace: n > 1 ? null : s.replace }));
  const empty = state.items.filter((x) => x == null).length;
  // What's ranked: what could take the place of the build's item picked (state.replace, so in the
  // address; it follows its item moved, and sold or bought over, nothing is picked: withItems), or the
  // next item, for an empty slot: the one clicked, else the first; a full build's in place of its last
  // item, the boots slot's aside. The empty slot clicked is the card's own, not the build's (empty
  // slots are alike but for where the item lands), and for the next change to the build's items, any
  // (a buy, here or in Items, a sale, a move, an undo, another build), after which it's the first.
  const [emptySlot, setEmptySlot] = useState<number | null>(null);
  useLayoutEffect(() => setEmptySlot(null), [state.items]);
  const picked = state.replace != null ? state.items.indexOf(state.replace) : -1;
  const firstEmpty = state.items.findIndex((x) => x == null);
  const slot = picked >= 0 ? picked : (emptySlot ?? (firstEmpty >= 0 ? firstEmpty : Math.min(state.items.length, BOOTS_SLOT) - 1));
  const current = count === 1 ? state.items[slot] : null;
  const bootsSlot = state.items.length > BOOTS_SLOT;
  const forBoots = bootsSlot && slot === BOOTS_SLOT && count === 1;

  // What can be bought: the tier 3 boots only with their setting, and nothing excluded.
  const pool = useMemo(
    () => DEFAULT_IDS.filter((id) => (state.settings.questBoots || !isQuestBoots(id)) && !state.excluded.includes(id)),
    [state.settings.questBoots, state.excluded],
  );
  const itemsJob = useMemo(() => {
    if (count > 1) return null;
    const base: Scenario = { ...scenario, items: buildItems(state.items.map((x, i) => (i === slot ? null : x))) };
    // An empty slot ranks what to buy next, as the shop places it: a pair of boots in the boots slot, an
    // upgrade in place of what it's built from. In place of an item, what could go in its slot: with
    // the boots slot, boots in it and the rest in the others; the item itself too, excluded or not.
    const fit = pool.filter((id) => (current == null && !forBoots) || slotFits(state.items, slot, id));
    const candidates = current != null && !fit.includes(current) ? [...fit, current] : fit.length < DEFAULT_IDS.length ? fit : undefined;
    return { kind: "items" as const, base, candidates };
  }, [scenario, state.items, slot, current, pool, count]);
  // Sets fill the build's empty slots, a pair of boots the boots slot.
  const setsJob = useMemo(
    () =>
      count > 1
        ? { kind: "sets" as const, base: scenario, size: count, slots: state.items.length, candidates: pool.length < DEFAULT_IDS.length ? pool : undefined }
        : null,
    [scenario, state.items.length, pool, count],
  );

  // Simulated in the worker, a moment after the job last changed, so typing in the combo box doesn't
  // start a ranking on every key; the last result stays on screen (dimmed) until the new one is ready.
  // ~100 simulations for the next item, some 600 to 4,000 for a set.
  const items = useRanking(itemsJob, 250);
  const sets = useRanking(setsJob, 250);
  const ranked = count > 1 ? sets : items;

  const ranking = items.result;
  const rows = useMemo(() => {
    // The items that add damage, in place of an item, not an upgrade of another; for the boots slot,
    // every pair that could go there, whatever it adds, as it holds boots or nothing.
    const useful = (ranking?.items ?? []).filter(
      (r) => (forBoots || r.gain > 0.5 || r.id === current) && !(current != null && r.replaces) && (r.id === current || !state.excluded.includes(r.id)),
    );
    useful.sort((a, b) => (by === "perGold" ? b.gainPerGold - a.gainPerGold : b.gain - a.gain));
    return useful;
  }, [ranking, by, current, forBoots, state.excluded]);
  const lead = useMemo(() => standouts(rows), [rows]);
  // A set with an item just excluded goes at once, before the ranking without it is ready.
  const setRows = useMemo(() => {
    const kept = (sets.result?.sets ?? []).filter((s) => !s.items.some((x) => state.excluded.includes(x.id)));
    return kept.sort((a, b) => (by === "perGold" ? b.gainPerGold - a.gainPerGold : b.gain - a.gain));
  }, [sets.result, by, state.excluded]);
  const shown: Entry[] = count > 1 ? setRows : rows;

  const pick = (id: number) => set((s) => withItems(s, buyItem(s.items, slot, id)));
  const buySet = (s: ItemSet) =>
    set((st) =>
      withItems(
        st,
        buyItems(
          st.items,
          s.items.map((x) => x.id),
        ),
      ),
    );
  const buy = (r: Entry) => (isSet(r) ? buySet(r) : pick(r.id));
  const exclude = (id: number) => set((s) => (s.excluded.includes(id) ? s : { ...s, excluded: [...s.excluded, id] }));

  const hover = useHoverCard();
  const slots = useItemSlots(state.items, (fn) => set((s) => withItems(s, fn(s.items))), { onPick: hover.hide, onSell: hover.hide });
  // A row's item, or a set's, dragged onto a slot is bought there alone; with a mouse or a pen, as a
  // finger on a row scrolls the list or opens its card.
  const dragOut = (id: number) => {
    const own = slots.source(id);
    return { ...own, onPointerDown: (e: PointerEvent<HTMLElement>) => e.pointerType !== "touch" && own.onPointerDown(e) };
  };

  const slotLabel = (r: Row) =>
    r.replaces
      ? `in place of ${r.replaces.map((x) => x.item).join(" and ")}`
      : current != null
        ? `in place of ${DATA.items[current]?.name}`
        : bootsSlot && isBoots(r.id)
          ? "in the boots slot"
          : `in slot ${slot + 1}`;
  const buyLabel = (r: Entry) =>
    isSet(r) ? `Buy ${setList(r)}${r.replaces ? `, in place of ${r.replaces.map((x) => x.item).join(" and ")}` : ""}` : `Buy ${r.item} ${slotLabel(r)}`;

  return (
    <Card
      title="Item value"
      right={
        <div className="segmented small" role="group" aria-label="View">
          <button aria-pressed={view === "list"} onClick={() => setView("list")}>
            List
          </button>
          <button aria-pressed={view === "map"} onClick={() => setView("map")}>
            Gold map
          </button>
        </div>
      }
    >
      {/* The slot being ranked, picked from the build's slots, which are also the build's inventory:
          an item is dragged to another slot, and sold with its ✕. A set fills the empty ones; a slot
          picked then ranks one item for it. */}
      <div className="iv-for">
        <div
          className="slots compact"
          ref={slots.box}
          role="group"
          aria-label="Slot to rank items for"
          style={{ "--slots": state.items.length } as CSSProperties}
        >
          {state.items.map((id, i) => {
            const name = id != null ? DATA.items[id]?.name : null;
            const ranks = count === 1 && i === slot;
            const foot = ranks ? undefined : "Click to rank what could take its place.";
            const pickSlot = () => {
              if (id == null) setEmptySlot(i);
              set((s) => ({ ...s, replace: id, next: 1 }));
            };
            return (
              <div
                key={i}
                aria-pressed={ranks}
                aria-label={
                  bootsSlot && i === BOOTS_SLOT
                    ? name
                      ? `In place of ${name}, in the boots slot. Delete sells it.`
                      : "Boots slot"
                    : name
                      ? `In place of ${name}. Arrow keys move it, Delete sells it.`
                      : `Next item, in slot ${i + 1}`
                }
                title={id == null && !ranks ? `Rank ${bootsSlot && i === BOOTS_SLOT ? "boots" : "items"} for this slot` : undefined}
                {...slots.slot(i, {
                  ...(id != null ? hover.bind(<ItemTip id={id} sim={sim} foot={foot} />) : {}),
                  onClick: pickSlot,
                  onKeyDown: (e: KeyboardEvent) => {
                    if (e.target !== e.currentTarget || (e.key !== "Enter" && e.key !== " ")) return;
                    e.preventDefault();
                    pickSlot();
                  },
                })}
              >
                {id != null ? <ItemIcon id={id} /> : bootsSlot && i === BOOTS_SLOT ? <BootsGlyph /> : "+"}
                {slots.remove(i)}
              </div>
            );
          })}
          {slots.incoming}
          {slots.vacated}
        </div>
        <div className="iv-caption small secondary">
          {count > 1 ? (
            `Next ${count} items`
          ) : current != null ? (
            <>
              In place of <strong>{DATA.items[current]?.name}</strong>
            </>
          ) : forBoots ? (
            "Boots"
          ) : (
            "Next item"
          )}
        </div>
        <CountPicker count={count} slots={state.items.length} empty={empty} onChange={setCount} />
      </div>
      {state.excluded.length > 0 && (
        <Excluded
          ids={state.excluded}
          onInclude={(id) => set((s) => ({ ...s, excluded: s.excluded.filter((x) => x !== id) }))}
          onClear={() => {
            hover.hide();
            set((s) => ({ ...s, excluded: [] }));
          }}
          bind={(id) => hover.bind(<ItemTip id={id} sim={sim} foot="Click to put it back in the ranking." />)}
        />
      )}
      {hover.node}
      {ranked.error && <div className="notice warn small">{ranked.error}</div>}
      <div className="iv-results">
        {count > 1 && <Progress since={sets.since} progress={sets.progress} />}
        {!ranked.result && !ranked.error && <div className="muted small">Simulating…</div>}
        {ranked.result && (
          <div className="iv-body" style={{ opacity: ranked.stale ? 0.55 : 1 }} aria-busy={ranked.stale}>
            {!shown.length ? null : view === "list" ? (
              <RankList
                rows={shown}
                shown={SHOWN}
                expanded={showAll}
                onExpand={setShowAll}
                by={by}
                setBy={setBy}
                current={current}
                lead={lead}
                buyLabel={buyLabel}
                onBuy={buy}
                onExclude={exclude}
                dragOut={dragOut}
                dragging={slots.bringing}
                sim={sim}
                champion={state.champion}
              />
            ) : (
              <GoldScatter
                points={shown.map((r, k): GoldPoint =>
                  isSet(r)
                    ? { id: k, label: setName(r), gold: r.gold, gain: r.gain, perGold: r.gainPerGold }
                    : {
                        id: r.id,
                        label: r.item,
                        gold: r.gold,
                        gain: r.gain,
                        perGold: r.gainPerGold,
                        highlight: r.id === current,
                        standout: lead.has(r.id),
                      },
                )}
                tip={(p, touch) => {
                  const r = count > 1 ? setRows[p.id] : rows.find((x) => x.id === p.id)!;
                  const mine = !isSet(r) && r.id === current;
                  return <RowTip row={r} current={current} champion={state.champion} view="map" action={mine || touch ? undefined : buyHint(r)} />;
                }}
                onPick={(p) => buy(count > 1 ? setRows[p.id] : rows.find((x) => x.id === p.id)!)}
              />
            )}
          </div>
        )}
      </div>
    </Card>
  );
}

/** How long a search's progress is heard before its time left is judged, and how long that must be for its progress to show. */
const PROGRESS_SAMPLE = 150;
const PROGRESS_WORTH = 1000;

/**
 * How far a search for sets has got, shown only for one that will take a while: once its progress has
 * been heard a moment, its time left is judged by its speed since it was first heard, what's left of
 * its guessed total at that speed as last heard, less the time since, and the bar shows once that's a
 * second or more; a search done sooner never shows one. The speed leaves out the wait for the first
 * word, which on a page just opened is mostly the worker's start (with the first job, sent the game
 * data first): judged from the job's start, every search there looked slow. Drawn each frame, easing
 * toward the progress the worker's messages keep current, never going back (it holds where a guess
 * grows), and faded out as the search finishes; a run in place of another in the same wait (its job
 * changed under way) fills what's left of the bar from where it stood, where it had held until the run
 * caught up. `since` is when the wait for a result began, null once there's one.
 */
function Progress({ since, progress }: { since: number | null; progress: RefObject<RunProgress | null> }) {
  const bar = useRef<HTMLDivElement>(null);
  const [shown, setShown] = useState(false);
  // What the frames share: whether the wait goes on, how full the bar is drawn, whether it's in view,
  // when it began to fade (0: it hasn't), and the run filling it (when it began) and from how full.
  const draw = useRef({ since, at: 0, on: false, fade: 0, run: 0, from: 0 });
  draw.current.since = since;
  useEffect(() => {
    const still = matchMedia("(prefers-reduced-motion: reduce)").matches;
    const d = draw.current;
    // Another search while the last one's bar fades: it's judged afresh.
    if (since != null && d.on && d.fade) {
      d.on = false;
      setShown(false);
    }
    let frame = 0;
    let last = performance.now();
    const tick = (now: number) => {
      const running = d.since != null;
      const dt = now - last;
      last = now;
      const p = progress.current;
      if (p && p.start !== d.run) [d.run, d.from] = [p.start, d.on ? d.at : 0];
      const f = p ? d.from + (1 - d.from) * Math.min(1, p.done / p.total) : d.at;
      if (!d.on) {
        if (!running) return;
        const ran = p ? p.at - p.first.at : 0;
        const speed = ran > 0 ? (p!.done - p!.first.done) / ran : 0;
        if (ran >= PROGRESS_SAMPLE && speed > 0 && (p!.total - p!.done) / speed - (now - p!.at) >= PROGRESS_WORTH) {
          [d.on, d.at, d.fade] = [true, 0, 0];
          setShown(true);
        }
      } else {
        // Filling as it fades once the search is done.
        const to = running ? f : 1;
        d.at = Math.max(d.at, still ? to : d.at + (to - d.at) * (1 - Math.exp(-dt / 80)));
        if (!running && !d.fade) d.fade = now;
        const el = bar.current;
        el?.style.setProperty("--at", d.at.toFixed(4));
        el?.setAttribute("aria-valuenow", String(Math.round(d.at * 100)));
        el?.classList.toggle("fading", !!d.fade);
        if (d.fade && now - d.fade >= 200) {
          d.on = false;
          return setShown(false);
        }
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [since]);
  if (!shown) return null;
  return (
    <div ref={bar} className="iv-progress" role="progressbar" aria-label="Simulating" aria-valuemin={0} aria-valuemax={100} aria-valuenow={0}>
      <span />
    </div>
  );
}

/** What a click on a row, or a dot on the map, does. */
const buyHint = (r: Entry) => (isSet(r) ? `Click to buy all ${r.items.length}` : "Click to buy");

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

/** Sizes the item column for a set's icons, which take less room than a name. */
const setSizer = (n: number) => (
  <div className="iv-row iv-sizer" aria-hidden>
    <span className="iv-item">
      <span className="iv-set">
        {Array.from({ length: n }, (_, k) => (
          <span key={k} className="iv-set-item">
            <span className="icon sm" />
          </span>
        ))}
      </span>
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
  buyLabel,
  onBuy,
  onExclude,
  dragOut,
  dragging,
  sim,
  champion,
}: {
  rows: Entry[];
  shown: number;
  expanded: boolean;
  onExpand: (expanded: boolean) => void;
  by: By;
  setBy: (by: By) => void;
  current: number | null;
  lead: ReadonlySet<number>;
  buyLabel: (r: Entry) => string;
  onBuy: (r: Entry) => void;
  onExclude: (id: number) => void;
  dragOut: (id: number) => object;
  dragging: boolean;
  sim: Sim | null;
  champion: string;
}) {
  const tt = useTooltip();
  const isCurrent = (r: Entry) => !isSet(r) && r.id === current;
  // Under the top rows, a line with Show more / Show less, then the rest: collapsed, only the current
  // item, when it isn't in the top rows. Rows come and go only under the line, so it stays in place.
  const rank = all.findIndex(isCurrent) + 1;
  const top = all.slice(0, shown);
  const rest = expanded ? all.slice(shown) : rank > shown ? [all[rank - 1]] : [];
  // The legend has the parts the bars listed have.
  const drawn = PARTS.filter((p) => [...top, ...rest].some((r) => (p === "lost" ? loses(r) : drawnSegments(r).some((s) => s.part === p))));
  const hidden = all.length - shown - (rank > shown ? 1 : 0);
  // A bar's solid part ends at its number, per gold or in all, its segments scaled down to it from what
  // the item adds; then, struck out, what the item takes away, as long as it is.
  const perUnit = (r: Entry) => (by === "perGold" ? (r.gold > 0 ? 1000 / r.gold : 0) : 1);
  const max = Math.max(1e-9, ...all.map((r) => (kept(r) + taken(r)) * perUnit(r)));
  // A click on a row buys its item, or its set. The item shows its details, the rest of the row where
  // its damage comes from; a card from hovering says a click buys, one from a tap has the Buy button.
  // A set's items show theirs, and a click on one leaves it out of the ranking, as the Exclude button
  // of its card from a tap does.
  const show = (e: { clientX: number; clientY: number; pointerType?: string }, r: Entry, at: Spot, how: "hover" | "hold" | "tap") => {
    if (at.item != null) {
      const id = at.item;
      const exclude =
        how === "hold" ? null : how === "tap" ? (
          <button
            className="btn small iv-tip-buy"
            aria-label={`Exclude ${DATA.items[id]?.name} from the ranking`}
            onClick={(ev) => {
              ev.stopPropagation();
              close();
              onExclude(id);
            }}
          >
            Exclude
          </button>
        ) : (
          <div className="tt-foot">Click to leave it out of the ranking</div>
        );
      return tt.show(
        e,
        <>
          <ItemTip id={id} sim={sim} />
          {exclude}
        </>,
      );
    }
    const buy =
      isCurrent(r) || how === "hold" ? null : how === "tap" ? (
        <button
          className="btn small primary iv-tip-buy"
          aria-label={buyLabel(r)}
          onClick={(ev) => {
            ev.stopPropagation();
            close();
            onBuy(r);
          }}
        >
          {isSet(r) ? `Buy all ${r.items.length}` : "Buy"}
        </button>
      ) : (
        <div className="tt-foot">{buyHint(r)}</div>
      );
    tt.show(
      e,
      <>
        {at.col === "iv-item" && !isSet(r) ? <ItemTip id={r.id} sim={sim} /> : <RowTip row={r} current={current} champion={champion} view="list" />}
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
  const pointer = useRef("");
  const endHold = () => {
    clearTimeout(hold.current.timer);
    if (hold.current.on) tt.hide();
    hold.current.on = false;
  };
  const close = () => {
    setTapped(null);
    tt.hide();
  };
  const tap = (e: PointerEvent<HTMLElement>, r: Entry) => {
    const at = spot(e, r);
    const key = `${keyOf(r)} ${at.col} ${at.item ?? ""}`;
    if (tapped === key) close();
    else {
      setTapped(key);
      show(e, r, at, "tap");
    }
  };
  useEffect(() => {
    if (dragging) close();
  }, [dragging]);
  useEffect(() => {
    if (tapped == null) return;
    const outside = (e: globalThis.PointerEvent) => !tt.ref.current?.contains(e.target as Node) && close();
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [tapped]);
  // A set's item clicked: left out of the ranking, and not the row's click, which buys the set. A tap
  // opens its card instead; a keyboard's click (detail 0) is a click.
  const excludeClick = (e: MouseEvent, id: number) => {
    e.stopPropagation();
    if (e.detail > 0 && pointer.current === "touch") return;
    close();
    onExclude(id);
  };
  const sortBy = (key: By, label: string) => (
    <button className="iv-sort" onClick={() => setBy(key)}>
      {by === key && <Chevron />}
      {label}
    </button>
  );
  const row = (r: Entry) => {
    const mine = isCurrent(r);
    const segs = drawnSegments(r);
    const solid = segs.length ? kept(r) : 0;
    const width = (((solid + taken(r)) * perUnit(r)) / max) * 100;
    const scale = solid / segs.reduce((sum, s) => sum + s.damage, 0);
    const ahead = !isSet(r) && lead.has(r.id);
    const bars = (
      <span className="iv-bars" style={{ width: `${width}%` }}>
        {segs.map((s) => (
          <span key={s.key} className={`iv-bar iv-${s.part}`} style={{ flexGrow: s.damage * scale }} />
        ))}
        {loses(r) && <span className="iv-bar iv-lost" style={{ flexGrow: taken(r) }} />}
      </span>
    );
    let item: ReactNode;
    if (isSet(r)) item = <SetItems set={r} onClick={excludeClick} drag={dragOut} />;
    else {
      const named = (
        <>
          <span className="iv-icon">
            <ItemIcon id={r.id} size="sm" />
            {ahead && <Sparkle className="iv-spark" />}
          </span>
          <span className="iv-name">{r.item}</span>
          {mine && !expanded && rank > shown && <span className="iv-tag">#{rank}</span>}
        </>
      );
      item = mine ? (
        named
      ) : (
        // For the keyboard; its click reaches the row, which buys.
        <button type="button" className="iv-buy" aria-label={`${buyLabel(r)}${ahead ? ", far more damage per gold than the rest" : ""}`} {...dragOut(r.id)}>
          {named}
        </button>
      );
    }
    return (
      <div
        key={keyOf(r)}
        role="row"
        aria-current={mine || undefined}
        className={`iv-row ${mine ? "current" : ""} ${ahead ? "standout" : ""}`}
        onPointerDown={(e) => {
          pointer.current = e.pointerType;
          if (e.pointerType !== "touch") return;
          const at = { clientX: e.clientX, clientY: e.clientY, pointerType: e.pointerType };
          const where = spot(e, r);
          clearTimeout(hold.current.timer);
          hold.current.timer = setTimeout(() => {
            hold.current.on = true;
            setTapped(null);
            show(at, r, where, "hold");
          }, 200);
        }}
        onPointerMove={(e) => {
          // An item dragged out of the row to a slot: no card meanwhile.
          if (dragging) return;
          if (e.pointerType !== "touch") {
            setTapped(null);
            show(e, r, spot(e, r), "hover");
          } else if (hold.current.on) show(e, r, spot(e, r), "hold");
        }}
        onPointerLeave={(e) => e.pointerType !== "touch" && tt.hide()}
        onPointerUp={(e) => e.pointerType === "touch" && !hold.current.on && tap(e, r)}
        // A keyboard's click (detail 0) on the item's button buys too.
        onClick={(e) => !mine && (e.detail === 0 || pointer.current !== "touch") && onBuy(r)}
      >
        <span role="cell" className="iv-item">
          {item}
        </span>
        {isSet(r) ? (
          // A set's items are buttons that leave them out: its bar is its button for the keyboard.
          <span role="cell" className="iv-track">
            <button type="button" className="iv-buy" aria-label={buyLabel(r)}>
              {bars}
            </button>
          </span>
        ) : (
          <span role="cell" className="iv-track" aria-hidden>
            {bars}
          </span>
        )}
        <span role="cell" className={`iv-pg num ${by === "perGold" ? "on" : ""}`}>
          {perGold(r.gainPerGold)}
        </span>
        <span role="cell" className={`iv-dmg num ${by === "damage" ? "on" : ""}`}>
          {signed(r.gain)}
        </span>
      </div>
    );
  };
  return (
    <div className="chart-wrap" ref={tt.ref}>
      <div className="iv-list">
        <div
          className="iv-grid"
          role="table"
          aria-label={isSet(all[0]) ? "Sets of items ranked by the damage they add" : "Items ranked by the damage they add"}
          onPointerCancel={endHold}
          onTouchEnd={endHold}
          onTouchCancel={endHold}
        >
          <div className="iv-row iv-head" role="row">
            <span role="columnheader" className="iv-item" aria-label="Item" />
            <span role="columnheader" className="iv-track">
              {drawn.map((p) => (
                <span key={p}>
                  <Swatch part={p} />
                  {p}
                </span>
              ))}
            </span>
            {/* The numbers' headings sort by them; where only one number fits, its heading switches it */}
            <span role="columnheader" className={`iv-pg ${by === "perGold" ? "on" : ""}`} aria-sort={by === "perGold" ? "descending" : undefined}>
              {sortBy("perGold", "per 1000g")}
            </span>
            <span role="columnheader" className={`iv-dmg ${by === "damage" ? "on" : ""}`} aria-sort={by === "damage" ? "descending" : undefined}>
              {sortBy("damage", "damage")}
            </span>
            <span role="columnheader" className="iv-swap on" aria-sort="descending">
              <button
                className="iv-sort"
                aria-label={`Ranked ${by === "perGold" ? "per 1000 gold" : "by damage"}; rank ${by === "perGold" ? "by damage" : "per 1000 gold"}`}
                onClick={() => setBy(by === "perGold" ? "damage" : "perGold")}
              >
                <SwapIcon />
                {by === "perGold" ? "per 1000g" : "damage"}
              </button>
            </span>
          </div>
          {isSet(all[0]) ? setSizer(all[0].items.length) : SIZER}
          {top.map(row)}
          {hidden > 0 && (
            <div role="row" className="iv-more-row">
              <div role="cell">
                <button className="iv-more" aria-expanded={expanded} onClick={() => onExpand(!expanded)}>
                  <span>
                    <Chevron />
                    {expanded ? "Show less" : "Show more"}
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
      <div className={tapped ? "iv-tapped" : undefined} onClick={tapped ? close : undefined}>
        {tt.node}
      </div>
    </div>
  );
}

const keyOf = (r: Entry) => (isSet(r) ? setKey(r) : String(r.id));

/** Where on a row the pointer is: the column, and on a set's items, the item it's over. */
type Spot = { col: string; item?: number };

function spot(e: PointerEvent<HTMLElement>, r: Entry): Spot {
  const col = nearestColumn(e);
  if (!isSet(r) || col !== "iv-item") return { col };
  // Over the item's button: what a click there does is that item's.
  const over = Array.from(e.currentTarget.querySelectorAll<HTMLElement>("[data-item]")).find((el) => {
    const b = el.getBoundingClientRect();
    return e.clientX >= b.left && e.clientX <= b.right && e.clientY >= b.top && e.clientY <= b.bottom;
  });
  return { col, item: over ? Number(over.dataset.item) : undefined };
}

/** The column of a row the pointer is over or nearest to. Nearest, so the row's padding and the gaps
 *  between columns don't switch between the cards. */
function nearestColumn(e: PointerEvent<HTMLElement>): string {
  let best = "";
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
 *  splits between base, effect and procs damage, the parts it has, the hits by name; on the map,
 *  whose dots only have positions, the numbers. Both name what the item procs and what it takes away,
 *  and say when it turns your adaptive force, which is often why. A set's card names its items, and
 *  its items' hits by their item. */
function RowTip({
  row: r,
  current,
  champion,
  view,
  action,
}: {
  row: Entry;
  current: number | null;
  champion: string;
  view: "list" | "map";
  action?: ReactNode;
}) {
  const procs = r.procs.map((p) => <SourceRow key={`${p.source}|${p.name}`} part="procs" {...p} champion={champion} />);
  const lost = r.lost.map((l) => <SourceRow key={`lost|${l.source}|${l.name}`} part="lost" {...l} champion={champion} />);
  return (
    <>
      <div className="tt-title">
        {isSet(r) ? setName(r) : r.item} · {fmt(r.gold)}g{r.replaces ? `, from ${r.replaces.map((x) => x.item).join(" and ")}` : ""}
        {!isSet(r) && r.id === current ? " (current)" : ""}
      </div>
      {view === "list" ? (
        <>
          {r.baseDamage >= 0.5 && (
            <div className="tt-row">
              <span>
                <Swatch part="base" gap />
                Base
              </span>
              <strong>{signed(r.baseDamage)}</strong>
            </div>
          )}
          {hitsOf(r).map((h) => (
            <SourceRow key={`${h.source}|${h.name}`} part="effect" {...h} champion={champion} />
          ))}
          {procs}
          {lost}
        </>
      ) : (
        <>
          <div className="tt-row">
            <span>Damage gained</span>
            <strong>{signed(r.gain)}</strong>
          </div>
          <div className="tt-row">
            <span>Per 1000 gold</span>
            <strong>{perGold(r.gainPerGold, 1)}</strong>
          </div>
          {procs}
          {lost}
        </>
      )}
      {r.adaptive && <div className="tt-foot">Turns your adaptive force to {r.adaptive === "physical" ? "AD" : "AP"}</div>}
      {action && <div className="tt-foot">{action}</div>}
    </>
  );
}

/** Damage of one of an item's hits (Squall) or of one of its procs (Electrocute, Smolder's execute),
 *  by its part's swatch and its source's icon. */
function SourceRow({ part, source, name, damage, champion }: { part: Part; source: string; name: string; damage: number; champion: string }) {
  return (
    <div className="tt-row">
      <span className="source-name">
        <Swatch part={part} />
        <Icon src={sourceMark(source, name, champion).icon} label={name} size="xs" />
        {name}
      </span>
      <strong>{signed(damage)}</strong>
    </div>
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

const SwapIcon = () => (
  <svg className="chevron" viewBox="0 0 10 10" aria-hidden>
    <path
      d="M3 1.5v7M1.2 3.3 3 1.5l1.8 1.8M7 8.5v-7M5.2 6.7 7 8.5l1.8-1.8"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.3"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);
