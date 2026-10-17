// Drag and drop: a box's children reordered with a pointer or the keyboard, and a build's item slots built on it.

import { useEffect, useLayoutEffect, useRef, useState, type DragEvent, type KeyboardEvent, type MouseEvent, type PointerEvent } from "react";
import { DATA } from "../data.ts";
import { mergeProps } from "./common.tsx";

/** Where a box's child is laid out in it. */
export type Place = { x: number; y: number; w: number; h: number };

/** A press on a child (or on a key that brings a new one in, with `bring`), then a drag once the
 *  pointer moves: what was pressed, where the pointer went down (x, y) and is (px, py), where it holds
 *  the child (fx, fy, fractions of its size), the child's transform, the index it would drop at (null
 *  until it moves), and whether a brought child is away from the box, where it lands nowhere. */
type Grab = {
  el: HTMLElement;
  from: number;
  x: number;
  y: number;
  px: number;
  py: number;
  fx: number;
  fy: number;
  tx: number;
  ty: number;
  to: number | null;
  bring?: (on: boolean) => void;
  away?: boolean;
};

/**
 * The first `count` children of a box, dragged to new places with a mouse or a finger: a pointer that
 * moves a few pixels from where it went down on one (anywhere but in a field or a list) picks it up,
 * and only then captures the pointer, so a press that doesn't move is a click on what's under it (a
 * button in the child). It follows the pointer by its transform, set on each move without rendering; with
 * `makeWay`, the others slide to where they'd be if it landed there. On release it glides into its
 * place, and the others it moved glide into theirs. While dragging, the children are laid out by flex
 * or grid `order` rather than moved in the DOM, so the dragged one keeps the pointer captured: a
 * finger's drag doesn't scroll the page (with touch-action: none) and it follows the pointer outside
 * the box. Escape, a cancelled touch or a lost pointer capture puts it back. Arrow keys move a focused
 * child, and focus follows it.
 *
 * A key outside the box (`source`) drags a new child in the same way: picked up, it's rendered last in
 * the box, out of the flow while the pointer is away from the box; over it, it lands among the others.
 *
 * - `arrange(from, to)`: the children's indices in their new order, with `from` moved to `to`.
 * - `landAt(x, y, cells, at, from)`: where the dragged child lands with its middle (or, `byPointer`,
 *   the pointer) at (x, y) in the box, from the places of the children in their order as laid out;
 *   it is at `at` among them.
 * - `move(from, to)`: makes the move; for a child brought in, `from` is its index as the last one.
 * - `movable(i)`: whether child i is dragged and glides; one that isn't (an empty slot) just moves.
 * - `onPick(i)`: when child i is picked up.
 * - `drag`, returned: the child being dragged, where it would land, and whether it's brought in and
 *   away from the box.
 */
export function useDragOrder({
  count,
  arrange,
  landAt,
  move,
  makeWay = true,
  byPointer = false,
  movable = () => true,
  onPick,
}: {
  count: number;
  arrange: (from: number, to: number) => number[];
  landAt: (x: number, y: number, cells: Place[], at: number, from: number) => number;
  move: (from: number, to: number) => void;
  makeWay?: boolean;
  byPointer?: boolean;
  movable?: (i: number) => boolean;
  onPick?: (i: number) => void;
}) {
  const box = useRef<HTMLDivElement>(null);
  const child = (k: number) => box.current?.children[k] as HTMLElement | undefined;
  const grab = useRef<Grab | null>(null);
  const [drag, setDrag] = useState<{ from: number; to: number; away?: boolean } | null>(null);
  /** Whether the last press picked its child up: its click isn't one. */
  const moved = useRef(false);
  /** The child to focus after the next render. */
  const refocus = useRef<number | null>(null);
  /** The children's places in the box as laid out (not as they slide), measured whenever they change. */
  const homes = useRef<Place[]>([]);
  /** Where each child is on screen before a change that moves them, by its index after it; the
   *  change's render slides them from there. `settle`: a dropped child, which also loses its lift. */
  const glide = useRef<{ from: (DOMRect | undefined)[]; settle?: { at: number; lift: Keyframe } } | null>(null);
  const onScreen = (order: number[], skip?: number) => order.map((j) => (j === skip || !movable(j) ? undefined : child(j)?.getBoundingClientRect()));
  const indices = () => Array.from({ length: count }, (_, j) => j);
  /** The children's order as laid out while child `from` is dragged to `to`. */
  const laidOut = (from: number, to: number) => (makeWay ? arrange(from, to) : indices());
  /** How a dragged child looks, to fade from as it lands; over the others meanwhile. */
  const lift = (el: Element): Keyframe => {
    const c = getComputedStyle(el);
    return { boxShadow: c.boxShadow, borderColor: c.borderColor, opacity: c.opacity, zIndex: 2 };
  };
  /** Moves the dragged child under the pointer, then the others to where it would land. */
  const track = () => {
    const g = grab.current;
    const [el, home] = [g && child(g.from), g && homes.current[g.from]];
    if (!g || g.to == null || !el || !home) return;
    const b = box.current!.getBoundingClientRect();
    const [x, y] = [g.px - g.fx * home.w - b.left, g.py - g.fy * home.h - b.top];
    [g.tx, g.ty] = [x - home.x, y - home.y];
    el.style.transform = `translate(${g.tx}px, ${g.ty}px)`;
    // A brought child lands only over the box. Coming over it, it first joins the others, last, to
    // land from where it's laid out among them.
    const away = !!g.bring && !(g.px >= b.left && g.px < b.right && g.py >= b.top && g.py < b.bottom);
    const [lx, ly] = byPointer ? [g.px - b.left, g.py - b.top] : [x + home.w / 2, y + home.h / 2];
    const to =
      away || g.away
        ? g.from
        : landAt(
            lx,
            ly,
            laidOut(g.from, g.to).map((j) => homes.current[j]),
            makeWay ? g.to : g.from,
            g.from,
          );
    if (to !== g.to || away !== !!g.away) reorder(to, away);
  };
  const reorder = (to: number, away = false) => {
    const g = grab.current!;
    [g.to, g.away] = [to, away];
    glide.current = { from: onScreen(indices(), g.from) };
    setDrag({ from: g.from, to, away });
  };
  /** Picks up what was pressed, which captures the pointer: a child, or the new one a key brings in. */
  const pickUp = (e: PointerEvent<HTMLElement>) => {
    const g = grab.current!;
    e.currentTarget.setPointerCapture(e.pointerId);
    moved.current = true;
    if (g.bring) {
      g.from = count;
      g.bring(true);
      return reorder(count, true);
    }
    // Picked up mid-glide: from where it is on screen.
    e.currentTarget.getAnimations().forEach((a) => a.cancel());
    onPick?.(g.from);
    reorder(g.from);
  };
  /** Ends a drag: the child glides from where it was let go to its new place, or back on a cancel. A
   *  child brought in goes away instead, unless it's let go over the box. */
  const drop = (keep: boolean) => {
    const g = grab.current;
    grab.current = null;
    if (g?.to == null) return;
    setDrag(null);
    const el = child(g.from);
    if (g.bring && (!keep || g.away || !el)) return g.bring(false);
    if (!el) return;
    const to = keep ? g.to : g.from;
    glide.current = { from: onScreen(arrange(g.from, to)), settle: { at: to, lift: lift(el) } };
    el.style.transform = "";
    if (to === g.from && !g.bring) return;
    if (el.contains(document.activeElement)) refocus.current = to;
    move(g.from, to);
  };
  /** Moves child `from` to `to` at once (the keyboard's way), focus following it. */
  const shift = (from: number, to: number) => {
    refocus.current = to;
    glide.current = { from: onScreen(arrange(from, to)) };
    move(from, to);
  };
  // After a render that moves children: measure where they are now, and slide each from where it was.
  useLayoutEffect(() => {
    const g = glide.current;
    glide.current = null;
    if (!g || !box.current) return;
    const b = box.current.getBoundingClientRect();
    const still = matchMedia("(prefers-reduced-motion: reduce)").matches;
    for (let k = 0; k < count; k++) {
      const el = child(k);
      if (!el) continue;
      const f = g.from[k];
      if (f) el.getAnimations().forEach((a) => a.cancel());
      const r = el.getBoundingClientRect();
      const [tx, ty] = k === drag?.from ? [grab.current?.tx ?? 0, grab.current?.ty ?? 0] : [0, 0];
      homes.current[k] = { x: r.left - tx - b.left, y: r.top - ty - b.top, w: r.width, h: r.height };
      const [dx, dy] = f ? [f.left - r.left, f.top - r.top] : [0, 0];
      const settle = g.settle?.at === k;
      if (still || !f || (!settle && Math.abs(dx) + Math.abs(dy) < 0.5)) continue;
      const [a, z] = settle ? [g.settle!.lift, lift(el)] : [{}, {}];
      el.animate(
        [
          { transform: `translate(${dx}px, ${dy}px)`, ...a },
          { transform: "none", ...z },
        ],
        { duration: settle ? 180 : 160, easing: "cubic-bezier(0.2, 0, 0, 1)" },
      );
    }
    track();
  });
  useEffect(() => {
    if (refocus.current != null) child(refocus.current)?.focus();
    refocus.current = null;
  });

  /** A press's handlers, on child `from` or on a key that brings a new child in. */
  const press = (from: number, bring?: (on: boolean) => void) => ({
    onPointerDown: (e: PointerEvent<HTMLElement>) => {
      moved.current = false;
      if (e.button !== 0 || !box.current || (!bring && !movable(from)) || (e.target as Element).closest("input, select, textarea, [role=listbox]")) return;
      const r = e.currentTarget.getBoundingClientRect();
      const [x, y] = [e.clientX, e.clientY];
      grab.current = { el: e.currentTarget, from, x, y, px: x, py: y, fx: (x - r.left) / r.width, fy: (y - r.top) / r.height, tx: 0, ty: 0, to: null, bring };
    },
    onPointerMove: (e: PointerEvent<HTMLElement>) => {
      const g = grab.current;
      if (g?.el !== e.currentTarget) return;
      [g.px, g.py] = [e.clientX, e.clientY];
      if (g.to != null) return track();
      if ((g.px - g.x) ** 2 + (g.py - g.y) ** 2 >= 16) pickUp(e);
    },
    // Off what it pressed before it moved far: picked up all the same (a fast flick), or let go unseen.
    onPointerLeave: (e: PointerEvent<HTMLElement>) => {
      const g = grab.current;
      if (g?.el !== e.currentTarget || g.to != null) return;
      if (e.buttons & 1) pickUp(e);
      else grab.current = null;
    },
    onPointerUp: (e: PointerEvent<HTMLElement>) => grab.current?.el === e.currentTarget && drop(true),
    onPointerCancel: (e: PointerEvent<HTMLElement>) => grab.current?.el === e.currentTarget && drop(false),
    // Its own capture's (a touch's implicit capture by what it touched moves to it when picked up).
    onLostPointerCapture: (e: PointerEvent<HTMLElement>) => e.target === e.currentTarget && grab.current?.el === e.currentTarget && drop(false),
    // An icon is an image, which the browser would drag itself (and cancel the pointer).
    onDragStart: (e: DragEvent<HTMLElement>) => e.preventDefault(),
    // A mouse's click after a drag isn't one (a keyboard's, detail 0, is).
    onClickCapture: (e: MouseEvent<HTMLElement>) => {
      if (!moved.current || e.detail === 0) return;
      moved.current = false;
      e.preventDefault();
      e.stopPropagation();
    },
  });
  const cancel = (e: KeyboardEvent<HTMLElement>) => e.key === "Escape" && grab.current?.to != null && (drop(false), true);
  const placed = drag && makeWay ? arrange(drag.from, drag.to) : null;
  /** Props for child i. */
  const item = (i: number) => ({
    style: placed ? { order: placed.indexOf(i) } : undefined,
    ...press(i),
    onKeyDown: (e: KeyboardEvent<HTMLElement>) => {
      if (cancel(e) || !movable(i) || e.target !== e.currentTarget) return;
      const to = e.key === "ArrowLeft" ? i - 1 : e.key === "ArrowRight" ? i + 1 : null;
      if (to == null || to < 0 || to >= count) return;
      e.preventDefault();
      shift(i, to);
    },
  });
  /**
   * Props for a key outside the box whose drag brings a new child into it: when it's picked up,
   * `bring(true)` must render that child last in the box (`count` counting it); let go over the box,
   * it's placed by `move`, and otherwise (or cancelled) `bring(false)` takes it out.
   */
  const source = (bring: (on: boolean) => void) => ({ ...press(-1, bring), onKeyDown: cancel });
  /** Focuses child k after the next render. */
  const focusLater = (k: number) => {
    refocus.current = k;
  };
  return { box, drag, item, source, focusLater };
}

type Slots = (number | null)[];

/**
 * A build's item slots, as in the client's inventory (the Items card, Item value's slots): an item is
 * dragged to another slot, whose outline shows where it will land; nothing else moves meanwhile.
 * Dropped on an item, the two swap; on an empty slot, it moves there. Arrow keys swap a focused item
 * with its neighbour; its ✕ in the corner, or Delete, sells it.
 *
 * - `slot(i, own)`: props for slot i, the box's child i, with the panel's own merged in.
 * - `remove(i)`: slot i's ✕, when it has an item.
 * - `vacated`: while an item is dragged, the empty slot it left, to render after the slots.
 * - `onMove(from, to)`, `onSell(i)`: after a move, before a sale, for what goes with the slots.
 */
export function useItemSlots(
  items: Slots,
  change: (fn: (items: Slots) => Slots) => void,
  { onPick, onMove, onSell }: { onPick?: () => void; onMove?: (from: number, to: number) => void; onSell?: (i: number) => void } = {},
) {
  const swap = (from: number, to: number) => {
    const next = items.map((_, j) => j);
    [next[from], next[to]] = [next[to], next[from]];
    return next;
  };
  const order = useDragOrder({
    count: items.length,
    arrange: swap,
    // The slot the pointer is nearest, within a slot's size; farther away, it goes back. By the
    // pointer, not the item's middle, as the item is held wherever it was grabbed.
    landAt: (x, y, cells, _at, from) => {
      const d = cells.map((c) => Math.hypot((x - c.x) / c.w - 0.5, (y - c.y) / c.h - 0.5));
      const k = d.indexOf(Math.min(...d));
      return d[k] < 1 ? k : from;
    },
    move: (from, to) => {
      change((xs) => swap(from, to).map((j) => xs[j]));
      onMove?.(from, to);
    },
    makeWay: false,
    byPointer: true,
    movable: (i) => items[i] != null,
    onPick,
  });
  const landing = order.drag && order.drag.to !== order.drag.from ? order.drag.to : null;
  const sell = (i: number) => {
    onSell?.(i);
    change((xs) => xs.map((x, j) => (j === i ? null : x)));
  };
  const slot = (i: number, { className = "", ...own }: { className?: string } & Record<string, unknown> = {}) => ({
    ...mergeProps(
      order.item(i),
      {
        onKeyDown: (e: KeyboardEvent) => {
          if (e.target !== e.currentTarget || items[i] == null || (e.key !== "Delete" && e.key !== "Backspace")) return;
          e.preventDefault();
          sell(i);
        },
      },
      own,
    ),
    className: `slot ${items[i] != null ? "filled" : ""} ${order.drag?.from === i ? "dragging" : ""} ${landing === i ? "landing" : ""} ${className}`,
    role: "button",
    tabIndex: 0,
  });
  const remove = (i: number) => {
    const id = items[i];
    if (id == null) return null;
    return (
      <button
        className="remove"
        aria-label={`Sell ${DATA.items[id]?.name}`}
        title="Sell"
        onClick={(e) => {
          e.stopPropagation();
          sell(i);
        }}
      >
        <svg viewBox="0 0 10 10" aria-hidden>
          <path d="M3 3 7 7M7 3 3 7" />
        </svg>
      </button>
    );
  };
  const vacated = order.drag && (
    <div className="slot vacated" aria-hidden style={{ gridColumn: `${order.drag.from + 1} / span 1` }}>
      +
    </div>
  );
  return { box: order.box, drag: order.drag, slot, remove, vacated };
}
