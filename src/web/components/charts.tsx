// Small SVG charts. Color encodes damage type (magic / physical / true) with fixed slots, always
// accompanied by a legend or labels; every chart has a hover tooltip and a table elsewhere.

import { Fragment, useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import type { DamageInstance } from '../../engine/effects.ts';
import type { SourceTotal } from '../../engine/sim.ts';
import { abilityIcon } from '../data.ts';
import { Icon, fmt, sourceMark } from './common.tsx';

export type DmgType = 'physical' | 'magic' | 'true';
export const TYPE_COLOR: Record<DmgType, string> = { magic: 'var(--magic)', physical: 'var(--physical)', true: 'var(--true)' };
export const TYPE_ORDER: DmgType[] = ['magic', 'physical', 'true'];
export const TYPE_LABEL: Record<DmgType, string> = { magic: 'Magic', physical: 'Physical', true: 'True' };
/** The damage types' colors for small text: a tooltip's numbers. */
const TYPE_TEXT: Record<DmgType, string> = { magic: 'var(--magic-text)', physical: 'var(--physical-text)', true: 'var(--true-text)' };
/** The damage types, the one with the most damage first. */
const typesByAmount = (amounts: Partial<Record<DmgType, number>>) => [...TYPE_ORDER].sort((a, b) => (amounts[b] ?? 0) - (amounts[a] ?? 0));

/** With `amounts`, only the types dealt, largest first, each with its share of the damage. */
export function TypeLegend({ amounts }: { amounts?: Record<DmgType, number> }) {
  const total = amounts ? TYPE_ORDER.reduce((s, t) => s + amounts[t], 0) : 0;
  const types = amounts ? typesByAmount(amounts).filter((t) => amounts[t] > 0.5) : TYPE_ORDER;
  const share = (v: number) => (v / total < 0.005 ? '<1%' : `${Math.round((v / total) * 100)}%`);
  return (
    <div className="legend" aria-label={amounts ? 'Damage by type' : 'Damage types'}>
      {types.map((t) => (
        <span key={t} className="key">
          <span className="swatch" style={{ background: TYPE_COLOR[t] }} />
          {TYPE_LABEL[t]}
          {amounts && <strong className="num">{share(amounts[t])}</strong>}
        </span>
      ))}
    </div>
  );
}

interface TipState {
  x: number;
  y: number;
  touch: boolean;
  content: ReactNode;
}

/** Tooltip + container width (charts draw in real pixels so text stays legible at any size). */
export function useTooltip() {
  const ref = useRef<HTMLDivElement>(null);
  const tipRef = useRef<HTMLDivElement>(null);
  const [tip, setTip] = useState<TipState | null>(null);
  const [width, setWidth] = useState(900);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver((entries) => {
      const w = Math.round(entries[0].contentRect.width);
      if (w > 0) setWidth(w);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  // A finger is held by the part of the chart it went down on; letting go of it lets a finger slid
  // sideways move on to the next part (styles.css leaves sideways slides to the chart). Once it has
  // been down a moment with a tooltip showing, its moves in any direction stay with the chart rather
  // than scrolling the page; a swipe that starts moving at once still scrolls. React's touchmove is
  // passive, so that one is added here.
  const shown = useRef(false);
  const downAt = useRef(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const down = (e: PointerEvent) => {
      if (e.pointerType !== 'touch') return;
      downAt.current = e.timeStamp;
      (e.target as Element).releasePointerCapture(e.pointerId);
    };
    const move = (e: TouchEvent) => shown.current && e.timeStamp - downAt.current >= 200 && e.cancelable && e.preventDefault();
    el.addEventListener('pointerdown', down);
    el.addEventListener('touchmove', move, { passive: false });
    return () => {
      el.removeEventListener('pointerdown', down);
      el.removeEventListener('touchmove', move);
    };
  }, []);
  const show = (e: { clientX: number; clientY: number; pointerType?: string }, content: ReactNode) => {
    const box = ref.current?.getBoundingClientRect();
    if (!box) return;
    shown.current = true;
    setTip({ x: e.clientX - box.left, y: e.clientY - box.top, touch: e.pointerType === 'touch', content });
  };
  const hide = () => {
    shown.current = false;
    setTip(null);
  };
  // Below and right of the cursor; left of it when it would pass the chart's right edge, above it
  // when it would pass the bottom of the window. Above a finger, which covers what's below it.
  useLayoutEffect(() => {
    const el = tipRef.current;
    const box = ref.current?.getBoundingClientRect();
    if (!tip || !el || !box) return;
    el.style.left = '0px';
    el.style.top = '0px';
    const { width: w, height: h } = el.getBoundingClientRect();
    let x = tip.x + 14;
    if (x + w > box.width) x = Math.max(0, tip.x - 14 - w);
    const above = tip.y - (tip.touch ? 40 : 14) - h;
    let y = tip.touch && box.top + above >= 8 ? above : tip.y + 14;
    if (box.top + y + h > window.innerHeight - 8) y = Math.max(8 - box.top, above);
    el.style.left = `${x}px`;
    el.style.top = `${y}px`;
  }, [tip]);
  const node = tip ? (
    <div ref={tipRef} className="tooltip" role="status">
      {tip.content}
    </div>
  ) : null;
  return { ref, show, hide, node, width: Math.max(280, width) };
}

export const niceMax = (v: number) => {
  if (v <= 0) return 1;
  const p = 10 ** Math.floor(Math.log10(v));
  for (const m of [1, 2, 2.5, 5, 10]) if (m * p >= v) return m * p;
  return 10 * p;
};
export const ticks = (max: number, n = 4) => Array.from({ length: n + 1 }, (_, i) => (max / n) * i);
export const compact = (v: number) => (v >= 1000 ? `${Math.round(v / 100) / 10}K` : `${Math.round(v)}`);

let measurer: CanvasRenderingContext2D | null | undefined;
/** The width of `text` in the page's font, with `font` its weight and size ('650 12.5px'). */
function textWidth(text: string, font: string) {
  measurer ??= typeof document === 'undefined' ? null : document.createElement('canvas').getContext('2d');
  if (!measurer) return text.length * 8;
  measurer.font = `${font} ${getComputedStyle(document.body).fontFamily}`;
  return measurer.measureText(text).width;
}

// -----------------------------------------------------------------------------
// HP bar: target health as a track, damage segments by source (part-to-whole)

/** What one block of the HP bar by time holds: its parts by source, and when its first and last hits landed. */
type Moment = SourceTotal & { action?: number; dot: boolean; parts: SourceTotal[]; from: number; to: number };
/** The source of a block with several sources' DoTs. */
const DOTS = 'dots';
/** A block's source in a few letters and its icon; several sources' DoTs show Brand's burn (Blaze), a common stand-in for damage over time. */
const blockMark = (source: string, label: string, champion: string) => (source === DOTS ? { text: 'DoTs', icon: abilityIcon('Brand', 'P') } : sourceMark(source, label, champion));

const addHit = (s: SourceTotal, e: DamageInstance) => {
  s.damage += e.final ?? 0;
  s.raw += e.raw;
  s.hits++;
  s.type[e.type] = (s.type[e.type] ?? 0) + (e.final ?? 0);
};

/**
 * The hits as they landed, in blocks: one combo action's hits (its own, those counted as casts of
 * their own, and the procs they set off: an attack and its on-hit items are one block), or the DoT
 * ticks between two of those blocks, whatever their sources. An action's hit landing after another
 * action's block began starts a new one, so the bar fills as the target's health went down. DoT
 * ticks, and the procs they set off (sharing their cast), don't split blocks, or every tick would.
 * A block is named by its first hit that isn't an item's or rune's proc (one can land before the
 * ability that set it off: Voltaic Cyclosword's before Smolder's W), else by its first hit; several
 * sources' DoTs are named DoTs.
 */
function moments(events: DamageInstance[]) {
  const out: Moment[] = [];
  const open = new Map<string, number>();
  const ticks = new Set<number>();
  const named = new Set<Moment>();
  for (const e of events) {
    if (e.flags.dot) ticks.add(e.castId);
    const dot = !!e.flags.dot || (!!e.flags.proc && ticks.has(e.castId));
    const key = dot ? DOTS : `${e.action}`;
    let i = open.get(key);
    if (i === undefined || out.slice(i + 1).some((m) => !m.dot && (dot || m.action !== e.action))) {
      open.set(key, (i = out.length));
      out.push({ source: e.source, label: e.sourceLabel, action: e.action, dot, parts: [], damage: 0, raw: 0, hits: 0, type: {}, from: e.time, to: e.time });
    }
    const m = out[i];
    if (!e.flags.proc && !named.has(m)) {
      named.add(m);
      Object.assign(m, { source: e.source, label: e.sourceLabel });
    }
    let part = m.parts.find((p) => p.source === e.source && p.label === e.sourceLabel);
    if (!part) m.parts.push((part = { source: e.source, label: e.sourceLabel, damage: 0, raw: 0, hits: 0, type: {} }));
    addHit(part, e);
    addHit(m, e);
    m.to = e.time;
  }
  for (const m of out) {
    m.parts.sort((a, b) => b.damage - a.damage);
    if (m.dot && m.parts.length > 1) Object.assign(m, { source: DOTS, label: 'DoTs' });
  }
  return out;
}

export function HpBar({ sources, events, by, maxHp, startHp, champion }: { sources: SourceTotal[]; events: DamageInstance[]; by: 'time' | 'size'; maxHp: number; startHp: number; champion: string }) {
  const tt = useTooltip();
  const clipId = useId().replace(/[^\w-]/g, '');
  const [broken, setBroken] = useState<ReadonlySet<string>>(new Set());
  const W = tt.width;
  const H = 34;
  const total = sources.reduce((s, x) => s + x.damage, 0);
  const startOffset = ((maxHp - startHp) / maxHp) * W;
  let x = startOffset;
  // Blocks clipped at the target's health: by time as the hits landed (see moments), so a source used
  // again shows again and the clip falls where the target dies; by size one per source, largest
  // first. A block dealing several damage types has them as layers, each as tall as its share, so it
  // stays one block. Its largest layer is on top; layers dealing exactly as much go in the legend's
  // order instead.
  const ordered: (SourceTotal | Moment)[] = by === 'time' ? moments(events) : sources;
  const amounts: Partial<Record<DmgType, number>> = {};
  for (const s of sources) for (const t of TYPE_ORDER) amounts[t] = (amounts[t] ?? 0) + (s.type[t] ?? 0);
  const order = typesByAmount(amounts);
  const blocks: { s: SourceTotal | Moment; x: number; w: number; layers: { t: DmgType; top: number }[] }[] = [];
  for (const s of ordered) {
    const sum = TYPE_ORDER.reduce((a, t) => a + Math.max(0, s.type[t] ?? 0), 0);
    const w = (Math.min(sum, Math.max(0, maxHp - (x / W) * maxHp)) / maxHp) * W;
    let top = 0;
    const layers = order
      .filter((t) => (s.type[t] ?? 0) > 0)
      .sort((a, b) => s.type[b]! - s.type[a]!)
      .map((t) => {
        const layer = { t, top };
        top += (s.type[t]! / sum) * H;
        return layer;
      });
    if (w > 0) blocks.push({ s, x, w, layers });
    x += w;
  }
  const last = blocks.at(-1);
  // Each block gives 1px each side to the 2px between blocks, where the bar's dark track shows as a
  // line, except one too thin to keep much color after it (a DoT's few ticks between two hits): it
  // would read as a dark line itself, so it's drawn whole.
  const gap = (w: number) => (w < 5 ? 0 : 1);
  const overkill = Math.max(0, total - startHp);
  const left = Math.max(0, startHp - total);
  // The damage is ticked along its top like a health bar in game: a short notch every 100 and a
  // longer one every 1000, counted from where it starts. Only the 1000s when the 100s are crowded.
  const tick = (100 / maxHp) * W;
  const notches: number[] = [];
  for (let k = 1; startOffset + k * tick < x - 1; k++) if (k % 10 === 0 || tick >= 4) notches.push(k);
  const leftText = [`${fmt(left)} HP left`, fmt(left)].find((s) => s.length * 6.5 < W - x - 16);
  const ICON = 18;
  return (
    <div className="chart-wrap" ref={tt.ref}>
      <svg viewBox={`0 0 ${W} ${H + 22}`} role="img" aria-label={`Target health bar: ${fmt(total)} damage of ${fmt(startHp)} health`}>
        <defs>
          <clipPath id={`${clipId}bar`}>
            <rect x={0} y={0} width={W} height={H} rx={6} />
          </clipPath>
          <clipPath id={`${clipId}icon`} clipPathUnits="objectBoundingBox">
            <rect width={1} height={1} rx={0.2} />
          </clipPath>
          {/* The bar's last block has the rounded end of a data bar */}
          {last && (
            <clipPath id={`${clipId}end`}>
              <path d={barPath(last.x + gap(last.w), 0, last.w - 2 * gap(last.w), H)} />
            </clipPath>
          )}
          <pattern id={`${clipId}missing`} width={6} height={6} patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <rect width={2.5} height={6} fill="var(--hp-stripe)" />
          </pattern>
        </defs>
        {/* The track: dark, as a health bar's empty part is in game */}
        <rect x={0} y={0} width={W} height={H} rx={6} fill="var(--hp-track)" />
        {/* Health the target was missing before the combo, striped as in game (K'Sante's All Out, for one) */}
        {startOffset > 0 && <rect x={0} y={0} width={startOffset} height={H} fill={`url(#${clipId}missing)`} clipPath={`url(#${clipId}bar)`} />}
        {left > 0.5 && (
          <g
            onPointerMove={(e) =>
              tt.show(
                e,
                <>
                  <div className="tt-title">Health left</div>
                  <div className="tt-row">
                    <span>{((left / maxHp) * 100).toFixed(1)}% max HP</span>
                    <strong>{fmt(left)}</strong>
                  </div>
                </>,
              )
            }
            onPointerLeave={tt.hide}
          >
            <rect x={x} y={0} width={W - x} height={H} fill="transparent" />
            {leftText && (
              <text x={(x + W) / 2} y={H / 2 + 4} textAnchor="middle" fontSize={12} fill="var(--hp-left-text)" className="num" style={{ pointerEvents: 'none' }}>
                {leftText}
              </text>
            )}
          </g>
        )}
        <g clipPath={`url(#${clipId}bar)`}>
          {blocks.map(({ s, x, w, layers }, i) => (
            <g key={i} onPointerMove={(e) => tt.show(e, <SourceTip s={s} maxHp={maxHp} champion={champion} />)} onPointerLeave={tt.hide}>
              {/* The whole block, gap included, so moving across the bar never leaves all of them */}
              <rect x={x} y={0} width={w} height={H} fill="transparent" />
              {/* 2px between blocks (see gap). Each layer runs to the bottom, under the next, so no seam shows between them. */}
              <g clipPath={i === blocks.length - 1 ? `url(#${clipId}end)` : undefined}>
                {layers.map(({ t, top }) => (
                  <rect key={t} x={x + gap(w)} y={top} width={w - 2 * gap(w)} height={H - top} fill={TYPE_COLOR[t]} />
                ))}
              </g>
            </g>
          ))}
          {notches.map((k) => (
            <line key={k} x1={startOffset + k * tick} x2={startOffset + k * tick} y1={0} y2={k % 10 ? H * 0.18 : H * 0.33} stroke="var(--hp-track)" strokeWidth={k % 10 ? 1 : 2} style={{ pointerEvents: 'none' }} />
          ))}
          {/* Over the notches */}
          {blocks.map(({ s, x, w }, i) => {
            const mark = blockMark(s.source, s.label, champion);
            const icon = mark.icon && !broken.has(mark.icon) ? mark.icon : '';
            // A source's icon names it, and an ability's key with it where there's room: a champion's
            // ability icons are less known than which key they're on. Letters stand in for no icon. A
            // block too narrow for the icon shows nothing.
            const key = /^[QWER]$/.test(s.source);
            const textW = textWidth(mark.text, '650 12.5px');
            const show = icon ? (key && ICON + 3 + textW + 8 <= w ? 'both' : ICON + 6 <= w ? 'icon' : null) : textW + 6 <= w ? 'text' : null;
            const cx = x + w / 2;
            const textX = show === 'both' ? cx + (ICON + 3) / 2 : cx;
            const iconX = show === 'both' ? textX - textW / 2 - 3 - ICON : cx - ICON / 2;
            return (
              <g key={i} style={{ pointerEvents: 'none' }}>
                {(show === 'both' || show === 'icon') && (
                  <image
                    href={icon}
                    x={iconX}
                    y={(H - ICON) / 2}
                    width={ICON}
                    height={ICON}
                    preserveAspectRatio="xMidYMid slice"
                    clipPath={`url(#${clipId}icon)`}
                    onError={() => setBroken((b) => new Set(b).add(icon))}
                  />
                )}
                {(show === 'both' || show === 'text') && (
                  <text x={textX} y={H / 2 + 4.5} textAnchor="middle" fontSize={12.5} fontWeight={650} fill="#0b0b0b">
                    {mark.text}
                  </text>
                )}
              </g>
            );
          })}
        </g>
        <text x={0} y={H + 16} fontSize={12} fill="var(--text-muted)">
          0
        </text>
        <text x={W} y={H + 16} fontSize={12} fill="var(--text-muted)" textAnchor="end">
          {fmt(maxHp)} HP{overkill > 0 ? ` · overkill ${fmt(overkill)}` : ''}
        </text>
      </svg>
      {tt.node}
    </div>
  );
}

/** A source's name, or `children` in its place, with its icon on the left (the initials of its name when it has none). */
function SourceName({ source, label, champion, children = label }: { source: string; label: string; champion: string; children?: ReactNode }) {
  return (
    <span className="tt-source">
      <Icon src={blockMark(source, label, champion).icon} label={label} size="xs" />
      {children}
    </span>
  );
}

function SourceTip({ s, maxHp, champion }: { s: SourceTotal | Moment; maxHp?: number; champion: string }) {
  // A row per source, its damage in its type's color. A source dealing several types splits it,
  // largest first; a type dealing under half a point is left out unless it's the only one.
  return (
    <>
      {('parts' in s ? s.parts : [s]).map((p) => (
        <div className="tt-row" key={`${p.source}|${p.label}`}>
          <SourceName source={p.source} label={p.label} champion={champion} />
          <span>
            {typesByAmount(p.type)
              .filter((t, i) => i === 0 || (p.type[t] ?? 0) >= 0.5)
              .map((t, i) => (
                <Fragment key={t}>
                  {i > 0 && <span className="muted"> + </span>}
                  <strong style={{ color: TYPE_TEXT[t] }}>{fmt(p.type[t] ?? 0)}</strong>
                </Fragment>
              ))}
          </span>
        </div>
      ))}
      <div className="tt-row muted">
        <span>
          {s.hits} hit{s.hits === 1 ? '' : 's'}
          {maxHp && ` · ${((s.damage / maxHp) * 100).toFixed(1)}% max HP`}
          {'from' in s && (s.to - s.from < 0.005 ? ` · at ${s.from.toFixed(2)}s` : ` · ${s.from.toFixed(2)}–${s.to.toFixed(2)}s`)}
        </span>
      </div>
    </>
  );
}

// -----------------------------------------------------------------------------
// Timeline: target HP over time (step line) with each damage instance as a dot.

export function Timeline({ events, startHp, maxHp, timeline, champion }: { events: DamageInstance[]; startHp: number; maxHp: number; timeline: { step: string; start: number; end: number }[]; champion: string }) {
  const tt = useTooltip();
  const W = tt.width;
  const H = 260;
  const m = { l: 44, r: 12, t: 12, b: 50 };
  const tMax = Math.max(1, ...events.map((e) => e.time), ...timeline.map((s) => s.end)) * 1.04;
  const yMax = niceMax(maxHp);
  const sx = (t: number) => m.l + (t / tMax) * (W - m.l - m.r);
  const sy = (hp: number) => m.t + (1 - Math.max(0, hp) / yMax) * (H - m.t - m.b);
  // Step path of HP.
  let d = `M ${sx(0)} ${sy(startHp)}`;
  for (const e of events) d += ` H ${sx(e.time)} V ${sy(e.targetHpAfter ?? 0)}`;
  d += ` H ${sx(tMax)}`;
  const xTicks = ticks(niceMax(tMax), 5).filter((t) => t <= tMax);
  const onMove = (e: React.PointerEvent<SVGRectElement>) => {
    const box = (e.currentTarget.ownerSVGElement as SVGSVGElement).getBoundingClientRect();
    const t = ((e.clientX - box.left) / box.width) * W;
    const time = ((t - m.l) / (W - m.l - m.r)) * tMax;
    const near = events.filter((ev) => Math.abs(ev.time - time) <= tMax / 60);
    const hpAt = [...events].reverse().find((ev) => ev.time <= time)?.targetHpAfter ?? startHp;
    tt.show(
      e,
      <>
        <div className="tt-title">
          t = {time.toFixed(2)}s · target HP <strong>{fmt(Math.max(0, hpAt))}</strong>
        </div>
        {near.slice(0, 8).map((ev) => (
          <div className="tt-row" key={ev.id}>
            <SourceName source={ev.source} label={ev.sourceLabel} champion={champion}>
              {ev.sourceLabel === ev.label ? ev.label : `${ev.sourceLabel}: ${ev.label}`}
            </SourceName>
            <strong style={{ color: TYPE_TEXT[ev.type] }}>{fmt(ev.final ?? 0)}</strong>
          </div>
        ))}
        {near.length > 8 && <div className="muted">+{near.length - 8} more</div>}
      </>,
    );
  };
  return (
    <div className="chart-wrap" ref={tt.ref}>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Target health over time">
        {ticks(yMax).map((v) => (
          <g key={v}>
            <line x1={m.l} x2={W - m.r} y1={sy(v)} y2={sy(v)} stroke="var(--grid)" />
            <text x={m.l - 8} y={sy(v) + 4} fontSize={11} textAnchor="end" fill="var(--text-muted)" className="num">
              {compact(v)}
            </text>
          </g>
        ))}
        <line x1={m.l} x2={W - m.r} y1={sy(0)} y2={sy(0)} stroke="var(--axis)" />
        {xTicks.map((t) => (
          <text key={t} x={sx(t)} y={H - m.b + 16} fontSize={11} textAnchor="middle" fill="var(--text-muted)" className="num">
            {t.toFixed(t % 1 ? 1 : 0)}s
          </text>
        ))}
        {/* Combo steps along the bottom */}
        {(() => {
          let lastLabelEnd = -Infinity;
          return timeline.map((s, i) => {
            const text = s.step.length > 10 ? s.step.slice(0, 9) + '…' : s.step;
            const x0 = sx(s.start);
            const showLabel = x0 >= lastLabelEnd + 4;
            if (showLabel) lastLabelEnd = x0 + text.length * 7;
            return (
              <g key={i}>
                <rect x={x0} y={H - m.b + 24} width={Math.max(3, sx(s.end) - x0)} height={6} rx={2} fill="var(--axis)" />
                {showLabel && (
                  <text x={x0} y={H - m.b + 44} fontSize={10.5} fill="var(--text-secondary)">
                    {text}
                  </text>
                )}
              </g>
            );
          });
        })()}
        <path d={d} fill="none" stroke="var(--accent)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
        {events.map((ev) => (
          <circle key={ev.id} cx={sx(ev.time)} cy={sy(ev.targetHpAfter ?? 0)} r={4.5} fill={TYPE_COLOR[ev.type]} stroke="var(--surface)" strokeWidth={2} />
        ))}
        <rect x={m.l} y={m.t} width={W - m.l - m.r} height={H - m.t - m.b} fill="transparent" onPointerMove={onMove} onPointerLeave={tt.hide} />
      </svg>
      {tt.node}
    </div>
  );
}

// -----------------------------------------------------------------------------
// Horizontal stacked bars: damage by source, segments by damage type.

export function SourceBars({ sources, champion }: { sources: SourceTotal[]; champion: string }) {
  const tt = useTooltip();
  const rows = sources.filter((s) => s.damage > 0.5);
  const W = tt.width;
  const rowH = 30;
  const labelW = Math.min(230, W * 0.36);
  const H = rows.length * rowH + 8;
  const max = niceMax(Math.max(1, ...rows.map((r) => r.damage)));
  const sx = (v: number) => (v / max) * (W - labelW - 64);
  const maxChars = Math.floor((labelW - 12) / 7);
  return (
    <div className="chart-wrap" ref={tt.ref}>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Damage by source">
        {rows.map((s, i) => {
          let x = labelW;
          const y = i * rowH + 6;
          const parts = TYPE_ORDER.filter((t) => (s.type[t] ?? 0) > 0);
          return (
            <g key={i} onPointerMove={(e) => tt.show(e, <SourceTip s={s} champion={champion} />)} onPointerLeave={tt.hide}>
              <rect x={0} y={y - 4} width={W} height={rowH} fill="transparent" />
              <text x={labelW - 10} y={y + 15} textAnchor="end" fontSize={13} fill="var(--text-primary)">
                {s.label.length > maxChars ? s.label.slice(0, maxChars - 1) + '…' : s.label}
              </text>
              {parts.map((t, j) => {
                const w = sx(s.type[t] ?? 0);
                const last = j === parts.length - 1;
                const el = <path key={t} d={barPath(x, y, Math.max(1, w), 20, last)} fill={TYPE_COLOR[t]} />;
                x += w;
                return el;
              })}
              <text x={x + 8} y={y + 15} fontSize={12.5} fill="var(--text-secondary)" className="num">
                {fmt(s.damage)}
              </text>
            </g>
          );
        })}
      </svg>
      {tt.node}
    </div>
  );
}

/** Horizontal bar with a 4px rounded data end and a square baseline end. */
function barPath(x: number, y: number, w: number, h: number, roundEnd = true) {
  const r = roundEnd ? Math.min(4, w / 2, h / 2) : 0;
  return `M ${x} ${y} H ${x + w - r} Q ${x + w} ${y} ${x + w} ${y + r} V ${y + h - r} Q ${x + w} ${y + h} ${x + w - r} ${y + h} H ${x} Z`;
}

// -----------------------------------------------------------------------------
// Simple horizontal bars (single hue) with labels — item ranking, build comparison.

export function SimpleBars({ rows, unit = '', format = (v: number) => fmt(v) }: { rows: { label: string; value: number; sub?: string; icon?: ReactNode; highlight?: boolean }[]; unit?: string; format?: (v: number) => string }) {
  const tt = useTooltip();
  const W = tt.width;
  const rowH = 32;
  const labelW = Math.min(300, W * 0.4);
  const H = rows.length * rowH + 8;
  const max = niceMax(Math.max(1e-9, ...rows.map((r) => r.value)));
  const sx = (v: number) => (Math.max(0, v) / max) * (W - labelW - (W < 600 ? 70 : 150));
  const maxChars = Math.floor((labelW - 12) / 7);
  return (
    <div className="chart-wrap" ref={tt.ref}>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Bar chart">
        {rows.map((r, i) => {
          const y = i * rowH + 6;
          return (
            <g
              key={i}
              onPointerMove={(e) =>
                tt.show(
                  e,
                  <>
                    <div className="tt-title">{r.label}</div>
                    <div className="tt-row">
                      <span>{unit || 'Value'}</span>
                      <strong>{format(r.value)}</strong>
                    </div>
                    {r.sub && <div className="muted">{r.sub}</div>}
                  </>,
                )
              }
              onPointerLeave={tt.hide}
            >
              <rect x={0} y={y - 4} width={W} height={rowH} fill="transparent" />
              <text x={labelW - 10} y={y + 15} textAnchor="end" fontSize={13} fill="var(--text-primary)" fontWeight={r.highlight ? 650 : 400}>
                {r.label.length > maxChars ? r.label.slice(0, maxChars - 1) + '…' : r.label}
              </text>
              <path d={barPath(labelW, y, Math.max(1, sx(r.value)), 20)} fill="var(--accent)" opacity={r.highlight ? 1 : 0.85} />
              <text x={labelW + sx(r.value) + 8} y={y + 15} fontSize={12.5} fill="var(--text-secondary)" className="num">
                {format(r.value)}
                {r.sub && W >= 600 ? `  ·  ${r.sub}` : ''}
              </text>
            </g>
          );
        })}
      </svg>
      {tt.node}
    </div>
  );
}

// -----------------------------------------------------------------------------
// Line chart (resist sweep): x = resist, y = damage, one line per series.

export function LineChart({ xLabel, series, markerX }: { xLabel: string; series: { label: string; color: string; points: { x: number; y: number }[] }[]; markerX?: number }) {
  const tt = useTooltip();
  const W = tt.width;
  const H = 280;
  const m = { l: 56, r: 20, t: 14, b: 36 };
  const all = series.flatMap((s) => s.points);
  const xMax = Math.max(1, ...all.map((p) => p.x));
  const yMax = niceMax(Math.max(1, ...all.map((p) => p.y)));
  const sx = (x: number) => m.l + (x / xMax) * (W - m.l - m.r);
  const sy = (y: number) => m.t + (1 - y / yMax) * (H - m.t - m.b);
  const onMove = (e: React.PointerEvent<SVGRectElement>) => {
    const box = (e.currentTarget.ownerSVGElement as SVGSVGElement).getBoundingClientRect();
    const x = (((e.clientX - box.left) / box.width) * W - m.l) / (W - m.l - m.r) * xMax;
    const pts = series.map((s) => ({ s, p: s.points.reduce((best, p) => (Math.abs(p.x - x) < Math.abs(best.x - x) ? p : best), s.points[0]) }));
    tt.show(
      e,
      <>
        <div className="tt-title">
          {xLabel} {pts[0]?.p.x}
        </div>
        {pts.map(({ s, p }) => (
          <div className="tt-row" key={s.label}>
            <span>
              <span className="line-key" style={{ background: s.color, marginRight: 6 }} />
              {s.label}
            </span>
            <strong>{fmt(p.y)}</strong>
          </div>
        ))}
      </>,
    );
  };
  return (
    <div className="chart-wrap" ref={tt.ref}>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Damage versus target ${xLabel}`}>
        {ticks(yMax).map((v) => (
          <g key={v}>
            <line x1={m.l} x2={W - m.r} y1={sy(v)} y2={sy(v)} stroke="var(--grid)" />
            <text x={m.l - 8} y={sy(v) + 4} fontSize={11} textAnchor="end" fill="var(--text-muted)">
              {compact(v)}
            </text>
          </g>
        ))}
        {ticks(xMax, 6).map((v) => (
          <text key={v} x={sx(v)} y={H - m.b + 18} fontSize={11} textAnchor="middle" fill="var(--text-muted)">
            {Math.round(v)}
          </text>
        ))}
        <text x={W - m.r} y={H - 4} fontSize={11} textAnchor="end" fill="var(--text-muted)">
          target {xLabel}
        </text>
        {markerX !== undefined && <line x1={sx(markerX)} x2={sx(markerX)} y1={m.t} y2={H - m.b} stroke="var(--axis)" />}
        {series.map((s) => (
          <g key={s.label}>
            <path d={s.points.map((p, i) => `${i ? 'L' : 'M'} ${sx(p.x)} ${sy(p.y)}`).join(' ')} fill="none" stroke={s.color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
            {s.points.length > 0 && (
              <circle cx={sx(s.points[s.points.length - 1].x)} cy={sy(s.points[s.points.length - 1].y)} r={4} fill={s.color} stroke="var(--surface)" strokeWidth={2} />
            )}
          </g>
        ))}
        <rect x={m.l} y={m.t} width={W - m.l - m.r} height={H - m.t - m.b} fill="transparent" onPointerMove={onMove} onPointerLeave={tt.hide} />
      </svg>
      {tt.node}
    </div>
  );
}

// -----------------------------------------------------------------------------
// Gold vs damage scatter (item value): x = item cost, y = damage gained. The diagonal lines are
// equal damage per gold, so the higher-left a dot sits above them, the more gold-efficient it is.

export interface GoldPoint {
  id: number;
  label: string;
  gold: number;
  gain: number;
  /** Damage gained per 1000 gold. */
  perGold: number;
  /** Drawn as a ring (the item currently in the slot being ranked). */
  highlight?: boolean;
}

export function GoldScatter({ points, labelTop = 6, tip, onPick }: { points: GoldPoint[]; labelTop?: number; tip: (p: GoldPoint, touch: boolean) => ReactNode; onPick?: (p: GoldPoint) => void }) {
  const tt = useTooltip();
  const [hover, setHover] = useState<number | null>(null);
  // A click buys the dot clicked, but a tap shows its card instead, as a finger hides which dot it's
  // on; the card stays until the next touch. Whether the click was a tap, from its pointerdown.
  const touched = useRef(false);
  const [tapped, setTapped] = useState(false);
  useEffect(() => {
    if (!tapped) return;
    const close = () => {
      setTapped(false);
      setHover(null);
      tt.hide();
    };
    document.addEventListener('pointerdown', close);
    return () => document.removeEventListener('pointerdown', close);
  }, [tapped]);
  const W = tt.width;
  const H = W < 600 ? 260 : 320;
  const m = { l: 48, r: 14, t: 24, b: 30 };
  const golds = points.map((p) => p.gold);
  const xLo = Math.max(0, Math.floor((Math.min(...golds) - 150) / 500) * 500);
  const xHi = Math.ceil((Math.max(...golds) + 150) / 500) * 500;
  const top = Math.max(1, ...points.map((p) => p.gain)) * 1.05;
  const yStep = niceMax(top / 4);
  const yMax = Math.ceil(top / yStep) * yStep;
  const yTicks = Array.from({ length: Math.round(yMax / yStep) + 1 }, (_, i) => i * yStep);
  const sx = (g: number) => m.l + ((g - xLo) / (xHi - xLo)) * (W - m.l - m.r);
  const sy = (v: number) => m.t + (1 - Math.max(0, v) / yMax) * (H - m.t - m.b);
  const xStep = (W - m.l - m.r) / ((xHi - xLo) / 500) < 120 ? 1000 : 500;
  const xTicks: number[] = [];
  for (let g = Math.ceil(xLo / xStep) * xStep; g <= xHi; g += xStep) xTicks.push(g);

  // Equal-efficiency lines (damage per 1000 gold), up to just past the best item.
  const best = Math.max(0, ...points.map((p) => p.perGold));
  const kStep = niceMax(best / 5 || 1);
  const rays: { k: number; x: number; y: number; w: number }[] = [];
  for (let k = kStep; k <= best * 1.2 + 1e-9 && rays.length < 6; k += kStep) {
    // Label where the line leaves the plot: the right edge, or the top if it gets there first.
    const yAtHi = (k * xHi) / 1000;
    const exit = yAtHi <= yMax ? { x: sx(xHi), y: sy(yAtHi) } : { x: sx((yMax * 1000) / k), y: sy(yMax) };
    rays.push({ k, x: exit.x - 4, y: exit.y + (yAtHi <= yMax ? -5 : 12), w: `${fmt(k)} per 1000g`.length * 5.9 });
  }

  // Direct labels for the current item, the most efficient items and the biggest gains: right of
  // the dot, else left, else skipped when both sides would cover another label or dot.
  const labels = new Map<number, { x: number; y: number; w: number }>();
  const byEff = [...points].sort((a, b) => b.perGold - a.perGold);
  const byGain = [...points].sort((a, b) => b.gain - a.gain);
  for (const p of [...points.filter((q) => q.highlight), ...byEff.slice(0, labelTop), ...byGain.slice(0, 2)]) {
    if (labels.has(p.id)) continue;
    const w = p.label.length * 6.4 + 4;
    const y = sy(p.gain) - 7;
    const free = (x: number) =>
      x >= m.l &&
      x + w <= W - m.r &&
      !points.some((q) => q.id !== p.id && sx(q.gold) > x - 6 && sx(q.gold) < x + w + 6 && Math.abs(sy(q.gain) - sy(p.gain)) < 10) &&
      ![...labels.values()].some((b) => x < b.x + b.w && b.x < x + w && Math.abs(y - b.y) < 14) &&
      !rays.some((r) => x < r.x && r.x - r.w < x + w && Math.abs(y + 7 - (r.y - 4)) < 13);
    const x = [sx(p.gold) + 9, sx(p.gold) - 9 - w].find(free);
    if (x !== undefined) labels.set(p.id, { x, y, w });
  }

  const nearest = (e: React.MouseEvent<SVGRectElement>) => {
    const box = (e.currentTarget.ownerSVGElement as SVGSVGElement).getBoundingClientRect();
    const px = ((e.clientX - box.left) / box.width) * W;
    const py = ((e.clientY - box.top) / box.height) * H;
    let hit: GoldPoint | null = null;
    let bestD = 28 * 28;
    for (const p of points) {
      const d = (sx(p.gold) - px) ** 2 + (sy(p.gain) - py) ** 2;
      if (d < bestD) [hit, bestD] = [p, d];
    }
    return hit;
  };
  const hovered = points.find((p) => p.id === hover);

  return (
    <div className="chart-wrap" ref={tt.ref}>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Damage gained versus item cost">
        <defs>
          <clipPath id="gold-plot">
            <rect x={m.l} y={m.t} width={W - m.l - m.r} height={H - m.t - m.b} />
          </clipPath>
        </defs>
        {yTicks.map((v) => (
          <g key={v}>
            <line x1={m.l} x2={W - m.r} y1={sy(v)} y2={sy(v)} stroke="var(--grid)" />
            <text x={m.l - 8} y={sy(v) + 4} fontSize={11} textAnchor="end" fill="var(--text-muted)" className="num">
              {v > 0 ? `+${compact(v)}` : '0'}
            </text>
          </g>
        ))}
        {xTicks.map((g) => (
          <text key={g} x={sx(g)} y={H - m.b + 16} fontSize={11} textAnchor={g === xHi ? 'end' : 'middle'} fill="var(--text-muted)" className="num">
            {fmt(g)}g{g === xHi ? ' item cost' : ''}
          </text>
        ))}
        <text x={m.l - 8} y={m.t - 12} fontSize={11} fill="var(--text-muted)">
          damage gained
        </text>
        <g clipPath="url(#gold-plot)">
          {rays.map((r) => (
            <line key={r.k} x1={sx(xLo)} y1={sy((r.k * xLo) / 1000)} x2={sx(xHi)} y2={sy((r.k * xHi) / 1000)} stroke="var(--axis)" />
          ))}
        </g>
        {rays.map((r) => (
          <text key={r.k} x={r.x} y={r.y} fontSize={10.5} textAnchor="end" fill="var(--text-muted)" className="num">
            {fmt(r.k)} per 1000g
          </text>
        ))}
        {points.map((p) =>
          p.highlight ? (
            <circle key={p.id} cx={sx(p.gold)} cy={sy(p.gain)} r={5} fill="var(--surface)" stroke="var(--text-primary)" strokeWidth={2} />
          ) : (
            <circle key={p.id} cx={sx(p.gold)} cy={sy(p.gain)} r={5} fill="var(--accent)" stroke="var(--surface)" strokeWidth={2} />
          ),
        )}
        {points.map((p) => {
          const b = labels.get(p.id);
          return (
            b && (
              <text key={p.id} x={b.x} y={b.y + 11} fontSize={11.5} fill="var(--text-secondary)" fontWeight={p.highlight ? 650 : 400} style={{ pointerEvents: 'none' }}>
                {p.label}
              </text>
            )
          );
        })}
        {hovered && <circle cx={sx(hovered.gold)} cy={sy(hovered.gain)} r={9} fill="none" stroke="var(--accent)" strokeWidth={2} style={{ pointerEvents: 'none' }} />}
        <rect
          x={m.l}
          y={m.t}
          width={W - m.l - m.r}
          height={H - m.t - m.b}
          fill="transparent"
          style={{ cursor: hovered && onPick && !hovered.highlight ? 'pointer' : 'default' }}
          onPointerDown={(e) => {
            touched.current = e.pointerType === 'touch';
          }}
          onPointerMove={(e) => {
            const p = nearest(e);
            setHover(p?.id ?? null);
            if (p) tt.show(e, tip(p, e.pointerType === 'touch'));
            else tt.hide();
          }}
          onPointerLeave={() => {
            setHover(null);
            tt.hide();
          }}
          onClick={(e) => {
            const p = nearest(e);
            if (!touched.current) {
              if (p && onPick && !p.highlight) onPick(p);
              return;
            }
            setHover(p?.id ?? null);
            if (!p) return;
            tt.show({ clientX: e.clientX, clientY: e.clientY, pointerType: 'touch' }, tip(p, true));
            setTapped(true);
          }}
        />
      </svg>
      {tt.node}
    </div>
  );
}
