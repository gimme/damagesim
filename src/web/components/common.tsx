import { Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState, type FocusEvent, type PointerEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { DATA, championIcon, itemIcon, runeIcon } from '../data.ts';
import { getKit } from '../../kits/index.ts';
import type { ItemData } from '../../engine/data-types.ts';
import { ITEM_GROUPS, hasItemModel } from '../../engine/items.ts';
import { itemText } from '../../engine/tooltip.ts';
import type { Sim } from '../../engine/sim.ts';

export function Icon({ src, label, size = '' }: { src: string; label: string; size?: '' | 'sm' | 'lg' }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [src]);
  const initials = label
    .replace(/[^A-Za-z ]/g, '')
    .split(' ')
    .map((w) => w[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();
  if (!src || failed)
    return (
      <span className={`icon ${size}`} aria-hidden>
        {initials}
      </span>
    );
  return <img className={`icon ${size}`} src={src} alt="" loading="lazy" onError={() => setFailed(true)} />;
}

export const ChampIcon = ({ id, size = '' }: { id: string; size?: '' | 'sm' | 'lg' }) => <Icon src={championIcon(id)} label={DATA.champions[id]?.name ?? id} size={size} />;
export const ItemIcon = ({ id, size = '' }: { id: number; size?: '' | 'sm' | 'lg' }) => <Icon src={itemIcon(id)} label={DATA.items[id]?.name ?? String(id)} size={size} />;
export const RuneIcon = ({ id }: { id: number }) => {
  const r = DATA.runes.find((x) => x.id === id);
  return <Icon src={r ? runeIcon(r.icon) : ''} label={r?.name ?? String(id)} size="sm" />;
};

export function KitBadge({ id }: { id: string }) {
  const status = getKit(DATA.champions[id]).status;
  const text = status === 'auto' ? 'auto kit' : status;
  return (
    <span className={`badge ${status === 'auto' ? 'auto' : 'curated'}`} title={status === 'auto' ? 'Abilities auto-mapped from tooltips: per-hit numbers exact, hit counts/conditions approximate.' : 'Mechanics modeled by hand from the game data.'}>
      {text}
    </span>
  );
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');

export function ChampionPicker({ value, onChange, label = 'Champion' }: { value: string; onChange: (id: string) => void; label?: string }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [active, setActive] = useState(0);
  const ref = useRef<HTMLDivElement>(null);
  const list = useMemo(() => DATA.championIndex.filter((c) => !q || norm(c.name).includes(norm(q)) || norm(c.id).includes(norm(q))), [q]);
  useEffect(() => {
    const close = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, []);
  const pick = (id: string) => {
    onChange(id);
    setOpen(false);
    setQ('');
  };
  const champ = DATA.champions[value];
  return (
    <div className="picker" ref={ref}>
      <div className="row" style={{ flexWrap: 'nowrap' }}>
        <ChampIcon id={value} size="lg" />
        <div className="stack" style={{ gap: 4, flex: 1, minWidth: 0 }}>
          <input
            type="search"
            aria-label={label}
            placeholder={champ?.name ?? 'Search champion'}
            value={open ? q : champ?.name ?? value}
            onFocus={() => {
              setOpen(true);
              setQ('');
              setActive(0);
            }}
            onChange={(e) => {
              setQ(e.target.value);
              setActive(0);
            }}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') setActive((a) => Math.min(list.length - 1, a + 1));
              else if (e.key === 'ArrowUp') setActive((a) => Math.max(0, a - 1));
              else if (e.key === 'Enter' && list[active]) pick(list[active].id);
              else if (e.key === 'Escape') setOpen(false);
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
            <div key={c.id} role="option" aria-selected={i === active} className="picker-option" onMouseDown={() => pick(c.id)} onMouseEnter={() => setActive(i)}>
              <ChampIcon id={c.id} size="sm" />
              <span style={{ flex: 1 }}>{c.name}</span>
              <KitBadge id={c.id} />
            </div>
          ))}
          {!list.length && <div className="muted small" style={{ padding: 8 }}>No champion matches “{q}”.</div>}
        </div>
      )}
    </div>
  );
}

const ITEM_FILTERS: { label: string; test: (i: ItemData) => boolean }[] = [
  { label: 'All', test: () => true },
  { label: 'AP', test: (i) => !!i.stats.ap },
  { label: 'AD', test: (i) => !!i.stats.ad },
  { label: 'Crit', test: (i) => !!i.stats.critChance },
  { label: 'Attack speed', test: (i) => !!i.stats.attackSpeed },
  { label: 'Lethality', test: (i) => !!i.stats.lethality || !!i.stats.armorPenPercent },
  { label: 'Magic pen', test: (i) => !!i.stats.magicPenFlat || !!i.stats.magicPenPercent },
  { label: 'Health', test: (i) => !!i.stats.hp },
  { label: 'Boots', test: (i) => i.tags.includes('Boots') },
];

export const SHOP_ITEMS: ItemData[] = Object.values(DATA.items)
  .filter((i) => (i.inStore || [3040, 3042, 3121].includes(i.id)) && !i.requiredChampion && i.gold.total > 0 && !i.tags.includes('Consumable') && !i.tags.includes('Trinket'))
  .sort((a, b) => b.depth - a.depth || a.name.localeCompare(b.name));

export function ItemPicker({ onPick, onClose, sim }: { onPick: (id: number) => void; onClose: () => void; sim?: Sim | null }) {
  const hover = useHoverCard();
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState(0);
  const [tier, setTier] = useState<'legendary' | 'all'>('legendary');
  const list = SHOP_ITEMS.filter((i) => (tier === 'all' || i.depth >= 3 || i.tags.includes('Boots') || i.gold.total >= 2200) && ITEM_FILTERS[filter].test(i) && (!q || norm(i.name).includes(norm(q))));
  return (
    <div className="card" style={{ marginTop: 8, boxShadow: 'none', background: 'var(--surface-2)' }}>
      <div className="row">
        <input type="search" autoFocus placeholder="Search items" value={q} onChange={(e) => setQ(e.target.value)} style={{ flex: 1 }} onKeyDown={(e) => e.key === 'Escape' && onClose()} />
        <div className="segmented">
          <button aria-pressed={tier === 'legendary'} onClick={() => setTier('legendary')}>
            Completed
          </button>
          <button aria-pressed={tier === 'all'} onClick={() => setTier('all')}>
            All
          </button>
        </div>
        <button className="btn ghost small" onClick={onClose} aria-label="Close item picker">
          ✕
        </button>
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
          <button key={i.id} className="item-option" onClick={() => onPick(i.id)} {...hover.bind(<ItemTip id={i.id} sim={sim} />)}>
            <ItemIcon id={i.id} size="sm" />
            <span className="stack" style={{ gap: 0, minWidth: 0 }}>
              <span className="name">{i.name}</span>
              <span className="muted small">
                {i.gold.total}g{hasItemModel(i.id) ? ' · modeled' : ''}
              </span>
            </span>
          </button>
        ))}
      </div>
      {hover.node}
    </div>
  );
}

export function Card({ title, right, children }: { title: ReactNode; right?: ReactNode; children: ReactNode }) {
  return (
    <section className="card">
      <h2>
        {title}
        {right && <span className="right">{right}</span>}
      </h2>
      {children}
    </section>
  );
}

export function NumberField({ label, value, onChange, step = 1, min, max, width }: { label: string; value: number; onChange: (v: number) => void; step?: number; min?: number; max?: number; width?: number }) {
  return (
    <label className="field">
      {label}
      <input type="number" value={Number.isFinite(value) ? value : 0} step={step} min={min} max={max} style={width ? { width } : undefined} onChange={(e) => onChange(Number(e.target.value))} />
    </label>
  );
}

export const fmt = (v: number, d = 0) => (Number.isFinite(v) ? v.toLocaleString(undefined, { maximumFractionDigits: d, minimumFractionDigits: d }) : '–');

// -----------------------------------------------------------------------------
// Hover cards

/**
 * A card shown while the pointer is over (or keyboard focus is on) an element: beside the panel the
 * element sits in when there's room, otherwise below or above it. Spread `bind(content)` on each
 * element and render `node` once.
 */
export function useHoverCard() {
  const [card, setCard] = useState<{ anchor: HTMLElement; content: ReactNode } | null>(null);
  const el = useRef<HTMLDivElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  // Once a card is open, moving to the next element swaps it without the opening delay.
  const isOpen = useRef(false);
  const show = (anchor: HTMLElement, content: ReactNode) => {
    isOpen.current = true;
    setCard({ anchor, content });
  };
  const hide = () => {
    clearTimeout(timer.current);
    isOpen.current = false;
    setCard(null);
  };
  const enter = (anchor: HTMLElement, content: ReactNode) => {
    clearTimeout(timer.current);
    if (isOpen.current) show(anchor, content);
    else timer.current = setTimeout(() => show(anchor, content), 200);
  };
  const leave = () => {
    clearTimeout(timer.current);
    timer.current = setTimeout(hide, 80);
  };

  useLayoutEffect(() => {
    const node = el.current;
    if (!card || !node) return;
    node.style.left = '0px';
    node.style.top = '0px';
    const { width: w, height: h } = node.getBoundingClientRect();
    const a = card.anchor.getBoundingClientRect();
    const panel = (card.anchor.closest('section.card') ?? card.anchor).getBoundingClientRect();
    const vw = document.documentElement.clientWidth;
    const vh = window.innerHeight;
    const m = 8;
    const besideTop = Math.max(m, Math.min(vh - h - m, a.top));
    let left: number;
    let top: number;
    if (panel.right + m + w <= vw - m) [left, top] = [panel.right + m, besideTop];
    else if (panel.left - m - w >= m) [left, top] = [panel.left - m - w, besideTop];
    else [left, top] = [Math.max(m, Math.min(vw - w - m, a.left)), a.bottom + 6 + h <= vh - m ? a.bottom + 6 : Math.max(m, a.top - 6 - h)];
    node.style.left = `${left}px`;
    node.style.top = `${top}px`;
  }, [card]);

  useEffect(() => {
    if (!card) return;
    window.addEventListener('scroll', hide, true);
    window.addEventListener('resize', hide);
    return () => {
      window.removeEventListener('scroll', hide, true);
      window.removeEventListener('resize', hide);
    };
  }, [card]);
  useEffect(() => () => clearTimeout(timer.current), []);

  const bind = (content: ReactNode) => ({
    onPointerEnter: (e: PointerEvent<HTMLElement>) => e.pointerType !== 'touch' && enter(e.currentTarget, content),
    onPointerLeave: leave,
    onPointerDown: hide,
    onFocus: (e: FocusEvent<HTMLElement>) => e.currentTarget.matches(':focus-visible') && show(e.currentTarget, content),
    onBlur: hide,
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
  passive: 'it-name',
  active: 'it-name',
  unique: 'it-name',
  keywordmajor: 'it-name',
  spellname: 'it-name',
  attention: 'it-value',
  magicdamage: 'it-value',
  physicaldamage: 'it-value',
  truedamage: 'it-value',
  rules: 'it-rules',
};

export function Markup({ text }: { text: string }) {
  type Frame = { tag: string; kids: ReactNode[] };
  const stack: Frame[] = [{ tag: '', kids: [] }];
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
    if (tag.toLowerCase() === 'br') top().kids.push(<br key={key++} />);
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

/** An item's hover card: cost, stats and passive/active text; numbers for the attacker when `sim` is given. */
export function ItemTip({ id, sim, action }: { id: number; sim?: Sim | null; action?: string }) {
  const item = DATA.items[id];
  if (!item) return null;
  const text = itemText(item, sim);
  const groups = Object.entries(ITEM_GROUPS)
    .filter(([, ids]) => ids.includes(id))
    .map(([g]) => g);
  const hasEffects = /<(passive|active)>/i.test(text.body);
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
      {(hasEffects || groups.length > 0 || text.live || action) && (
        <div className="it-foot muted">
          {hasEffects && <div>{hasItemModel(id) ? 'Effects simulated' : 'Stats only: effects not simulated'}</div>}
          {groups.map((g) => (
            <div key={g}>{g} item: only one per build</div>
          ))}
          {text.live && <div>Numbers at your level and stats</div>}
          {action && <div>{action}</div>}
        </div>
      )}
    </div>
  );
}
