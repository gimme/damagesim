// Hover cards: the hook that shows one beside its element, and the item, rune and markup cards shown in them.

import {
  Fragment,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type FocusEvent,
  type MouseEvent,
  type PointerEvent,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { DATA } from "../data.ts";
import { ItemIcon, RuneIcon } from "./icons.tsx";
import { fmt } from "./common.tsx";
import type { ItemData } from "../../engine/data-types.ts";
import { hasItemModel } from "../../engine/items.ts";
import { hasRuneModel } from "../../engine/runes.ts";
import { itemText, runeText } from "../../engine/tooltip.ts";
import type { Sim } from "../../engine/sim.ts";

/**
 * A card shown while the pointer is over (or keyboard focus is on) an element: beside the panel the
 * element sits in when there's room, otherwise below or above it. A finger held on an element counts
 * as hovering it: the card shows after the same delay, follows the finger to other elements and
 * closes when it lifts. Spread `bind(content)` on each element and render `node` once.
 */
export function useHoverCard() {
  const [card, setCard] = useState<{ anchor: HTMLElement; content: ReactNode; touch: boolean } | null>(null);
  const el = useRef<HTMLDivElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  // Once a card is open, moving to the next element swaps it without the opening delay.
  const isOpen = useRef(false);
  // When the current touch went down, so a hold long enough to read the card isn't also a tap.
  const pressed = useRef(0);
  // Once a held finger has opened a card, moving it goes from element to element, not scrolling.
  const scrubbing = useRef(false);
  // The element whose keyboard focus opened the card; only its blur closes it, as touching an
  // element (a long press too) moves focus, which would close the card a finger opened.
  const focused = useRef<HTMLElement | null>(null);
  // The element the open card is for. An element that's removed (a search filtering the list under
  // the pointer), or loses its card (an item moved off its slot), gets no pointerleave, so that
  // closes its card.
  const shownFor = useRef<HTMLElement | null>(null);
  // The element a card is due to show for once the delay is up; losing its card before then cancels it.
  const pendingFor = useRef<HTMLElement | null>(null);
  const show = (anchor: HTMLElement, content: ReactNode, touch = false) => {
    pendingFor.current = null;
    if (!anchor.isConnected) return;
    shownFor.current = anchor;
    isOpen.current = true;
    focused.current = null;
    if (touch) scrubbing.current = true;
    setCard({ anchor, content, touch });
  };
  const hide = () => {
    clearTimeout(timer.current);
    pendingFor.current = null;
    shownFor.current = null;
    isOpen.current = false;
    focused.current = null;
    setCard(null);
  };
  const enter = (anchor: HTMLElement, content: ReactNode, touch: boolean) => {
    clearTimeout(timer.current);
    pendingFor.current = null;
    if (isOpen.current || scrubbing.current) show(anchor, content, touch);
    else {
      pendingFor.current = anchor;
      timer.current = setTimeout(() => show(anchor, content, touch), 200);
    }
  };
  const leave = () => {
    clearTimeout(timer.current);
    pendingFor.current = null;
    timer.current = setTimeout(hide, 80);
  };

  useLayoutEffect(() => {
    const node = el.current;
    if (!card || !node) return;
    node.style.left = "0px";
    node.style.top = "0px";
    const { width: w, height: h } = node.getBoundingClientRect();
    const a = card.anchor.getBoundingClientRect();
    const panel = (card.anchor.closest("section.card") ?? card.anchor).getBoundingClientRect();
    const vw = document.documentElement.clientWidth;
    const vh = window.innerHeight;
    const m = 8;
    const besideTop = Math.max(m, Math.min(vh - h - m, a.top));
    let left: number;
    let top: number;
    const above = a.top - 6 - h;
    if (panel.right + m + w <= vw - m) [left, top] = [panel.right + m, besideTop];
    else if (panel.left - m - w >= m) [left, top] = [panel.left - m - w, besideTop];
    // A finger covers the element and the hand what's below it, so touch prefers above.
    else if (card.touch && above >= m) [left, top] = [Math.max(m, Math.min(vw - w - m, a.left)), above];
    else [left, top] = [Math.max(m, Math.min(vw - w - m, a.left)), a.bottom + 6 + h <= vh - m ? a.bottom + 6 : Math.max(m, above)];
    node.style.left = `${left}px`;
    node.style.top = `${top}px`;
  }, [card]);

  useEffect(() => {
    if (!card) return;
    window.addEventListener("scroll", hide, true);
    window.addEventListener("resize", hide);
    return () => {
      window.removeEventListener("scroll", hide, true);
      window.removeEventListener("resize", hide);
    };
  }, [card]);
  useEffect(() => () => clearTimeout(timer.current), []);
  // Touch events go to the element the finger went down on wherever it moves, and React's touchmove
  // is passive, so these are added to each element directly.
  const attach = useCallback((node: HTMLElement | null) => {
    if (!node) return;
    const move = (e: TouchEvent) => scrubbing.current && e.cancelable && e.preventDefault();
    const end = () => {
      scrubbing.current = false;
    };
    node.addEventListener("touchmove", move, { passive: false });
    node.addEventListener("touchend", end);
    node.addEventListener("touchcancel", end);
    return () => {
      node.removeEventListener("touchmove", move);
      node.removeEventListener("touchend", end);
      node.removeEventListener("touchcancel", end);
      if (pendingFor.current === node) {
        clearTimeout(timer.current);
        pendingFor.current = null;
      }
      if (shownFor.current === node) hide();
    };
  }, []);

  // A touch enters when the finger goes down and leaves when it lifts or a scroll takes it over. A
  // finger is held by the element it went down on; letting go of it lets the finger enter others. A
  // tap still acts; a hold of over half a second doesn't. Holding doesn't select text (styles.css),
  // and the long-press menu isn't prevented, as Android vibrates when a page prevents it.
  const bind = (content: ReactNode) => ({
    ref: attach,
    "data-hovercard": "",
    onPointerEnter: (e: PointerEvent<HTMLElement>) => enter(e.currentTarget, content, e.pointerType === "touch"),
    onPointerLeave: leave,
    onPointerDown: (e: PointerEvent<HTMLElement>) => {
      pressed.current = e.pointerType === "touch" ? e.timeStamp : 0;
      if (pressed.current) (e.target as Element).releasePointerCapture(e.pointerId);
      else hide();
    },
    onPointerCancel: () => {
      pressed.current = 0;
    },
    // A keyboard's click (detail 0) is never a hold.
    onClickCapture: (e: MouseEvent<HTMLElement>) => {
      if (pressed.current && e.detail > 0 && e.timeStamp - pressed.current > 500) {
        e.preventDefault();
        e.stopPropagation();
      }
      pressed.current = 0;
    },
    onFocus: (e: FocusEvent<HTMLElement>) => {
      if (!e.currentTarget.matches(":focus-visible")) return;
      show(e.currentTarget, content);
      focused.current = e.currentTarget;
    },
    onBlur: (e: FocusEvent<HTMLElement>) => focused.current === e.currentTarget && hide(),
  });
  const node =
    card &&
    createPortal(
      <div ref={el} className="tooltip hovercard" role="tooltip">
        {card.content}
      </div>,
      document.body,
    );
  return { bind, node, hide };
}

// Riot tooltip markup (from itemText: tags, <br>, no icons or {{keys}}) as React elements. Unknown
// tags keep their text; nothing is injected as HTML.
const EMPHASIS: Record<string, string> = {
  passive: "it-name",
  active: "it-name",
  unique: "it-name",
  keywordmajor: "it-name",
  spellname: "it-name",
  attention: "it-value",
  magicdamage: "it-value magic",
  physicaldamage: "it-value physical",
  truedamage: "it-value true",
  rules: "it-rules",
  b: "it-name",
  i: "it-em",
};

export function Markup({ text }: { text: string }) {
  type Frame = { tag: string; kids: ReactNode[] };
  const stack: Frame[] = [{ tag: "", kids: [] }];
  const top = () => stack[stack.length - 1];
  let key = 0;
  const close = () => {
    const f = stack.pop()!;
    const cls = EMPHASIS[f.tag.toLowerCase()];
    top().kids.push(
      cls ? (
        <span key={key++} className={cls}>
          {f.kids}
        </span>
      ) : (
        <Fragment key={key++}>{f.kids}</Fragment>
      ),
    );
  };
  let last = 0;
  for (const m of text.matchAll(/<(\/?)([a-zA-Z]\w*)[^>]*>/g)) {
    if (m.index > last) top().kids.push(text.slice(last, m.index));
    last = m.index + m[0].length;
    const [, closing, tag] = m;
    if (tag.toLowerCase() === "br") top().kids.push(<br key={key++} />);
    else if (!closing) stack.push({ tag, kids: [] });
    else {
      const i = stack.findLastIndex((f) => f.tag === tag);
      if (i > 0) while (stack.length > i) close();
    }
  }
  if (last < text.length) top().kids.push(text.slice(last));
  while (stack.length > 1) close();
  return <>{stack[0].kids}</>;
}

/** A rune's hover card: its description; numbers for the attacker when `sim` is given. */
export function RuneTip({ id, sim }: { id: number; sim?: Sim | null }) {
  const rune = DATA.runes.find((r) => r.id === id);
  if (!rune) return null;
  const text = runeText(rune, sim);
  return (
    <div className="item-tip">
      <div className="it-head">
        <RuneIcon id={id} />
        <strong>{rune.name}</strong>
        <span className="secondary">{rune.tree}</span>
      </div>
      <div className="it-body">
        <Markup text={text.body} />
      </div>
      {!hasRuneModel(id) && <div className="it-foot muted">Effects not simulated</div>}
    </div>
  );
}

/** Whether an item has a passive or active the simulator doesn't model; stat-only items have none. */
export const effectsNotSimulated = (item: ItemData) => !hasItemModel(item.id) && /<(passive|active)>/i.test(item.description);

/** An item's hover card: cost, stats and passive/active text; numbers for the attacker when `sim` is given. `foot` replaces the note that its effects aren't simulated. */
export function ItemTip({ id, sim, foot }: { id: number; sim?: Sim | null; foot?: ReactNode }) {
  const item = DATA.items[id];
  if (!item) return null;
  const text = itemText(item, sim);
  return (
    <div className="item-tip">
      <div className="it-head">
        <ItemIcon id={id} size="sm" />
        <strong>{item.name}</strong>
        <span className="num secondary">{fmt(item.gold.total)}g</span>
      </div>
      {!!text.stats.length && (
        <div className="it-stats">
          {text.stats.map((s, i) => (
            <div key={i}>
              <Markup text={s} />
            </div>
          ))}
        </div>
      )}
      {text.body && (
        <div className="it-body">
          <Markup text={text.body} />
        </div>
      )}
      {foot ? <div className="it-foot muted">{foot}</div> : effectsNotSimulated(item) && <div className="it-foot muted">Effects not simulated</div>}
    </div>
  );
}
