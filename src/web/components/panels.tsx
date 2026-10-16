import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { DATA, abilityIcon, championIcon } from '../data.ts';
import { Card, ChampIcon, ChampionPicker, Icon, ItemIcon, ItemPicker, ItemTip, Markup, NumberField, RuneIcon, RuneTip, fmt, sourceMark, useHoverCard } from './common.tsx';
import { SHARD_ROWS, TARGET_MODES, type UIState, type TargetMode, type TargetState, type TargetStats } from '../state.ts';
import { ITEMS_BY_LEVEL_RULE, TARGET_PRESETS, isTargetPreset, itemsAtLevel, levelForItems, presetShardHp, type TargetPreset } from '../../engine/presets.ts';
import { maxRanks, resolveRanks, type Sim, type SimResult } from '../../engine/sim.ts';
import { renderTooltip, runeText } from '../../engine/tooltip.ts';
import { describeChampion } from '../../engine/describe.ts';
import { NOT_LIVE_RUNES, bonusSkillPoints } from '../../engine/runes.ts';
import { critMarking, formatCombo, markCrit, parseCombo, type ComboStep, type CritMode } from '../../engine/combo.ts';
import { conflicts } from '../../engine/analysis.ts';
import { findItem } from '../../engine/gamedata.ts';
import { getKit } from '../../kits/index.ts';
import type { Effect, Slot } from '../../engine/effects.ts';
import type { KitOption } from '../../engine/kit-types.ts';

type Set = (fn: (s: UIState) => UIState) => void;

// -----------------------------------------------------------------------------

export function AttackerPanel({ state, set, sim }: { state: UIState; set: Set; sim: Sim | null }) {
  const champ = DATA.champions[state.champion];
  const max = maxRanks(champ);
  // Triple Tonic's extra skill point (the sim's runes match the current state).
  const extraPoints = sim ? bonusSkillPoints(sim.runes, state.level) : 0;
  const ranks = state.ranks ?? (() => {
    const r = resolveRanks(champ, state.level, undefined, state.skillOrder, extraPoints);
    return { Q: r.Q, W: r.W, E: r.E, R: r.R };
  })();
  const totalPoints = ranks.Q + ranks.W + ranks.E + ranks.R;
  const setRank = (k: 'Q' | 'W' | 'E' | 'R', v: number) => set((s) => ({ ...s, ranks: { ...ranks, [k]: Math.max(0, Math.min(max[k], v)) } }));
  const hover = useHoverCard();
  const described = useMemo(() => (sim ? describeChampion(sim).abilities : null), [sim]);
  return (
    <Card title="Champion">
      <div className="stack" style={{ gap: 12 }}>
        <ChampionPicker value={state.champion} onChange={(id) => set((s) => ({ ...s, champion: id, ranks: null, options: {} }))} />
        <div className="row" style={{ flexWrap: 'nowrap' }}>
          <span className="small secondary" style={{ width: 44 }}>
            Level
          </span>
          <input type="range" min={1} max={20} value={state.level} aria-label="Champion level" onChange={(e) => set((s) => ({ ...s, level: Number(e.target.value), ranks: null }))} />
          <strong className="num" style={{ width: 24, textAlign: 'right' }}>
            {state.level}
          </strong>
        </div>
        <div className="row" style={{ gap: 6 }}>
          {(['Q', 'W', 'E', 'R'] as const).map((k) => (
            <label key={k} className="field" style={{ alignItems: 'center' }}>
              {/* The ability's card on hover: its name, cooldown and cost, and its tooltip at its rank */}
              <span className="row" style={{ gap: 4 }} tabIndex={0} aria-label={champ.abilities.find((a) => a.slot === k)?.spells[0]?.name ?? k} {...(sim && described ? hover.bind(<AbilityTip sim={sim} ability={described.find((a) => a.slot === k)!} />) : {})}>
                <Icon src={abilityIcon(state.champion, k)} label={k} size="xs" />
                <span className="kbd">{k}</span>
              </span>
              <input type="number" min={0} max={max[k]} value={ranks[k]} style={{ width: 52 }} aria-label={`${k} rank`} onChange={(e) => setRank(k, Number(e.target.value))} />
            </label>
          ))}
          <div className="stack" style={{ gap: 2, marginLeft: 'auto' }}>
            <label className="field">
              Max order
              <select value={state.skillOrder} onChange={(e) => set((s) => ({ ...s, skillOrder: e.target.value, ranks: null }))}>
                {['QWE', 'QEW', 'WQE', 'WEQ', 'EQW', 'EWQ'].map((o) => (
                  <option key={o}>{o}</option>
                ))}
              </select>
            </label>
          </div>
        </div>
        {totalPoints > state.level + extraPoints && <div className="notice warn small">{totalPoints} skill points used at level {state.level}.</div>}
        {state.ranks && (
          <button className="btn small" style={{ alignSelf: 'flex-start' }} onClick={() => set((s) => ({ ...s, ranks: null }))}>
            Reset to default leveling
          </button>
        )}
        <OptionsEditor state={state} set={set} sim={sim} />
      </div>
      {hover.node}
    </Card>
  );
}

/** An ability's hover card: its name, rank, cooldown and cost there, and its tooltip with the numbers
 *  for your rank, level and stats (rank 1's while it has no points). */
function AbilityTip({ sim, ability: a }: { sim: Sim; ability: ReturnType<typeof describeChampion>['abilities'][number] }) {
  const slot = a.slot as 'Q' | 'W' | 'E' | 'R';
  const rank = Math.max(1, a.rank);
  const cooldown = a.cooldown?.[rank - 1];
  const cost = a.cost?.[rank - 1];
  // Other resources' costs in the data aren't costs to cast (Zac's health, Sett's Grit, Yasuo's Flow).
  const resource = sim.champ.partype === 'Mana' || sim.champ.partype === 'Energy' ? sim.champ.partype.toLowerCase() : null;
  const text = renderTooltip(sim, slot, sim.spellFor(slot), rank, { html: true })
    .replace(/<li>/gi, '<br>• ')
    .replace(/\{\{[^}]*\}\}|%i:\w+%/g, '')
    .replace(/^(\s|<br\s*\/?>)+|(\s|<br\s*\/?>)+$/gi, '');
  return (
    <div className="item-tip">
      <div className="it-head">
        <Icon src={abilityIcon(sim.champ.id, slot)} label={a.name} size="sm" />
        <strong>{a.name}</strong>
        <span className="kbd">{slot}</span>
      </div>
      <div className="secondary">
        {[
          a.rank ? `Rank ${a.rank}/${a.maxRank}` : 'No points: rank 1 shown',
          cooldown ? `${fmt(cooldown, 2)}s cooldown` : '',
          cost && resource ? `${fmt(cost)} ${resource}` : '',
        ]
          .filter(Boolean)
          .join(' · ')}
      </div>
      {text && (
        <div className="it-body">
          <Markup text={text} />
        </div>
      )}
    </div>
  );
}

function OptionsEditor({ state, set, sim }: { state: UIState; set: Set; sim: Sim | null }) {
  const hover = useHoverCard();
  const champ = DATA.champions[state.champion];
  const kit = getKit(champ);
  // Each parameter once, with everything in the scenario that reads it: your HP can matter to Olaf,
  // Last Stand and Overlord's Bloodmail at once.
  const declared = [
    ...(kit.options ?? []).map((o) => ({ o, id: 'kit', name: champ.name })),
    ...(sim?.effects ?? []).flatMap((e: Effect) => (e.options ?? []).map((o) => ({ o, id: e.id, name: e.label }))),
  ];
  const opts = new Map<string, { o: KitOption; sources: { id: string; name: string }[] }>();
  for (const { o, id, name } of declared) {
    const entry = opts.get(o.key) ?? { o, sources: [] };
    if (!entry.sources.some((s) => s.id === id)) entry.sources.push({ id, name });
    opts.set(o.key, entry);
  }
  if (!opts.size) return null;
  const card = (id: string, name: string) => {
    const [kind, n] = id.split(':');
    if (kind === 'item') return <ItemTip id={Number(n)} sim={sim} />;
    if (kind === 'rune') return <RuneTip id={Number(n)} sim={sim} />;
    return (
      <div className="item-tip">
        <div className="it-head">
          <ChampIcon id={state.champion} size="sm" />
          <strong>{name}</strong>
        </div>
      </div>
    );
  };
  const setOpt = (key: string, v: number) => set((s) => ({ ...s, options: { ...s.options, [key]: v } }));
  return (
    <details>
      <summary>Champion, item & rune parameters ({opts.size})</summary>
      <div className="stack" style={{ marginTop: 8 }}>
        {[...opts.values()].map(({ o, sources }) => {
          const v = state.options[o.key] ?? o.default;
          const isToggle = o.toggle || (o.max === 1 && (o.min ?? 0) === 0 && o.step === 1);
          return (
            <div key={o.key} className="row" style={{ flexWrap: 'nowrap' }}>
              <span className="small" style={{ flex: 1 }} title={o.description ?? o.key}>
                {o.label}
              </span>
              <span className="opt-sources">
                {sources.map((s) => (
                  <span key={s.id} tabIndex={0} role="img" aria-label={s.name} {...hover.bind(card(s.id, s.name))}>
                    <Icon src={s.id === 'kit' ? championIcon(state.champion) : sourceMark(s.id, s.name, state.champion).icon} label={s.name} size="xs" />
                  </span>
                ))}
              </span>
              <span className="opt-control">
                {isToggle ? (
                  <input type="checkbox" aria-label={o.label} checked={!!v} onChange={(e) => setOpt(o.key, e.target.checked ? 1 : 0)} />
                ) : (
                  <input
                    type="number"
                    aria-label={o.label}
                    value={v}
                    min={o.min}
                    max={o.max}
                    step={o.step ?? 1}
                    onChange={(e) => setOpt(o.key, Number(e.target.value))}
                  />
                )}
              </span>
            </div>
          );
        })}
      </div>
      {hover.node}
    </details>
  );
}

// -----------------------------------------------------------------------------

export function ItemsPanel({ state, set, gold, sim }: { state: UIState; set: Set; gold: number; sim: Sim | null }) {
  const [picking, setPicking] = useState<number | null>(null);
  const hover = useHoverCard();
  const items = state.items;
  const build = items.filter((x): x is number => x != null).map((id) => DATA.items[id]);
  const warnings = build.flatMap((it, i) => {
    const c = conflicts(build.slice(0, i), it);
    return c ? [`${it.name}: only one ${c === 'duplicate' ? 'copy' : c === 'boots' ? 'pair of boots' : `${c} item`} works`] : [];
  });
  const pick = (id: number) => {
    set((s) => {
      const next = [...s.items];
      next[picking ?? 0] = id;
      return { ...s, items: next };
    });
    setPicking(null);
  };
  return (
    <Card title="Items" right={<span className="num secondary">{fmt(gold)}g</span>}>
      <div className="slots">
        {items.map((id, i) => (
          <div
            key={i}
            className={`slot ${id ? 'filled' : ''}`}
            role="button"
            tabIndex={0}
            aria-label={id ? `Item slot ${i + 1}: ${DATA.items[id]?.name}` : `Empty item slot ${i + 1}`}
            title={id ? undefined : 'Add item'}
            onClick={() => setPicking(i)}
            onKeyDown={(e) => e.key === 'Enter' && setPicking(i)}
            {...(id ? hover.bind(<ItemTip id={id} sim={sim} />) : {})}
          >
            {id ? <ItemIcon id={id} /> : '+'}
            {id && (
              <button
                className="remove"
                aria-label={`Remove ${DATA.items[id]?.name}`}
                onClick={(e) => {
                  e.stopPropagation();
                  set((s) => {
                    const next = [...s.items];
                    next[i] = null;
                    return { ...s, items: next };
                  });
                }}
              >
                ✕
              </button>
            )}
          </div>
        ))}
      </div>
      {hover.node}
      {picking !== null && <ItemPicker onPick={pick} onClose={() => setPicking(null)} sim={sim} />}
      {!!build.length && picking === null && (
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

// -----------------------------------------------------------------------------

const LIVE_RUNES = DATA.runes.filter((r) => !NOT_LIVE_RUNES.has(r.id));
const TREES = ['Precision', 'Domination', 'Sorcery', 'Resolve', 'Inspiration'];

export function RunesPanel({ state, set, sim }: { state: UIState; set: Set; sim: Sim | null }) {
  const [tree, setTree] = useState(() => DATA.runes.find((r) => r.id === state.keystone)?.tree ?? 'Precision');
  const hover = useHoverCard();
  const keystones = LIVE_RUNES.filter((r) => r.row === 0 && r.tree === tree);
  const minors = LIVE_RUNES.filter((r) => r.row > 0);
  const toggleMinor = (id: number) =>
    set((s) => ({ ...s, minors: s.minors.includes(id) ? s.minors.filter((x) => x !== id) : s.minors.length >= 5 ? [...s.minors.slice(1), id] : [...s.minors, id] }));
  // A shard's whole text is one line, so the options show it, with numbers at your level.
  const shardLabel = (id: number) => {
    const rune = DATA.runes.find((r) => r.id === id);
    if (!rune) return String(id);
    return runeText(rune, sim).body.replace(/<[^>]+>/g, '') || rune.name;
  };
  return (
    <Card title="Runes">
      <div className="stack">
        <div className="row" style={{ gap: 4 }}>
          {TREES.map((t) => (
            <button key={t} className="btn small" aria-pressed={t === tree} onClick={() => setTree(t)}>
              {t}
            </button>
          ))}
        </div>
        <div className="rune-grid" aria-label="Keystone">
          {keystones.map((r) => (
            <button key={r.id} className="rune-btn" aria-pressed={state.keystone === r.id} onClick={() => set((s) => ({ ...s, keystone: s.keystone === r.id ? null : r.id }))} {...hover.bind(<RuneTip id={r.id} sim={sim} />)}>
              <RuneIcon id={r.id} />
              {r.name}
            </button>
          ))}
        </div>
        <details>
          <summary>
            Minor runes ({state.minors.length}/5): {state.minors.map((id) => DATA.runes.find((r) => r.id === id)?.name).join(', ') || 'none'}
          </summary>
          {TREES.map((t) => (
            <div key={t} style={{ marginTop: 8 }}>
              <div className="muted small" style={{ marginBottom: 4 }}>
                {t}
              </div>
              <div className="rune-grid">
                {minors
                  .filter((r) => r.tree === t)
                  .map((r) => (
                    <button key={r.id} className="rune-btn" aria-pressed={state.minors.includes(r.id)} onClick={() => toggleMinor(r.id)} {...hover.bind(<RuneTip id={r.id} sim={sim} />)}>
                      <RuneIcon id={r.id} />
                      {r.name}
                    </button>
                  ))}
              </div>
            </div>
          ))}
        </details>
        <div className="stack" style={{ gap: 6 }}>
          {SHARD_ROWS.map((row, i) => (
            <label key={row.label} className="row small secondary" style={{ justifyContent: 'space-between', flexWrap: 'nowrap' }}>
              <span style={{ whiteSpace: 'nowrap', minWidth: '7.5em' }}>{row.label} shard</span>
              <select id={`shard-${i}`} style={{ flex: '1 1 0', maxWidth: 250, minWidth: 0 }} value={state.shards[i]} onChange={(e) => set((s) => ({ ...s, shards: s.shards.map((x, j) => (j === i ? Number(e.target.value) : x)) }))}>
                {row.options.map((o) => (
                  <option key={o} value={o}>
                    {shardLabel(o)}
                  </option>
                ))}
              </select>
            </label>
          ))}
        </div>
      </div>
      {hover.node}
    </Card>
  );
}

// -----------------------------------------------------------------------------

const MODE_LABEL: Record<TargetMode, string> = { squishy: 'Squishy', bruiser: 'Bruiser', tank: 'Tank', champion: 'Champion', custom: 'Custom' };
const MODE_TITLE: Record<TargetMode, string> = {
  squishy: TARGET_PRESETS.squishy.description,
  bruiser: TARGET_PRESETS.bruiser.description,
  tank: TARGET_PRESETS.tank.description,
  champion: 'A champion at a level, with the items you pick',
  custom: 'Your own numbers, starting from the target you had',
};

const STAT_ROWS: { key: keyof TargetStats; label: string; step: number }[] = [
  { key: 'hp', label: 'Health', step: 50 },
  { key: 'armor', label: 'Armor', step: 5 },
  { key: 'mr', label: 'Magic resist', step: 5 },
];

/** A resolved target's base and bonus stats, whole numbers that add up to its rounded totals. */
function splitStats(t: SimResult['target']): { base: TargetStats; bonus: TargetStats } {
  const total = { hp: Math.round(t.maxHp), armor: Math.round(t.armor), mr: Math.round(t.mr) };
  const bonus = { hp: Math.round(t.bonusHp), armor: Math.round(t.bonusArmor), mr: Math.round(t.bonusMr) };
  return { base: { hp: total.hp - bonus.hp, armor: total.armor - bonus.armor, mr: total.mr - bonus.mr }, bonus };
}

export function TargetPanel({ state, set, resolved }: { state: UIState; set: Set; resolved?: SimResult['target'] }) {
  const t = state.target;
  const upd = (p: Partial<TargetState>) => set((s) => ({ ...s, target: { ...s.target, ...p } }));
  const preset = isTargetPreset(t.mode) ? t.mode : null;
  const targetLevel = Math.max(1, Math.min(20, state.level + t.levelDiff));
  // Custom starts from the numbers of the target you had.
  const pick = (mode: TargetMode) => upd(mode === 'custom' && t.mode !== 'custom' && resolved ? { mode, ...splitStats(resolved) } : { mode });
  const stats = t.mode === 'custom' ? { base: t.base, bonus: t.bonus } : resolved && splitStats(resolved);
  const shardHp = preset ? Math.round(presetShardHp(DATA, preset, targetLevel)) : 0;
  return (
    <Card title="Target">
      <div className="stack" style={{ gap: 10 }}>
        <div className="segmented fill" role="group" aria-label="Target">
          {TARGET_MODES.map((m) => (
            <button key={m} aria-pressed={t.mode === m} title={MODE_TITLE[m]} onClick={() => pick(m)}>
              {MODE_LABEL[m]}
            </button>
          ))}
        </div>
        {preset && <div className="small secondary">{TARGET_PRESETS[preset].description}</div>}
        {t.mode === 'champion' && <ChampionPicker label="Target champion" value={t.champion} onChange={(id) => upd({ champion: id })} />}
        {t.mode !== 'custom' && (
          <div className="target-field">
            <span className="small secondary">Level</span>
            <div className="row" style={{ flexWrap: 'nowrap' }}>
              <input type="range" min={-5} max={5} value={t.levelDiff} aria-label="Target level relative to yours" onChange={(e) => upd({ levelDiff: Number(e.target.value) })} />
              <strong className="num" style={{ minWidth: 92, textAlign: 'right', whiteSpace: 'nowrap' }} title="Target level minus your level">
                {t.levelDiff === 0 ? 'same' : t.levelDiff > 0 ? `+${t.levelDiff}` : `−${-t.levelDiff}`} <span className="muted">(lvl {targetLevel})</span>
              </strong>
            </div>
          </div>
        )}
        {preset && <PresetItems preset={preset} level={targetLevel} build={t.builds[preset]} onChange={(b) => upd({ builds: { ...t.builds, [preset]: b } })} />}
        {t.mode === 'champion' && (
          <div className="target-field">
            <span className="small secondary">Items</span>
            <TargetItems slots={t.items} onChange={(items) => upd({ items: items.filter((x): x is number => x !== null) })} />
          </div>
        )}
        {stats && (
          <TargetStatsTable
            base={stats.base}
            bonus={stats.bonus}
            onChange={t.mode === 'custom' ? (base, bonus) => upd({ base, bonus }) : undefined}
            note={
              t.mode === 'custom'
                ? 'Total = base + bonus. A total you type keeps the base and sets the bonus.'
                : `Base: ${t.mode === 'champion' ? DATA.champions[t.champion]?.name : `the average ${TARGET_PRESETS[preset!].label.toLowerCase()}`} at lvl ${targetLevel}. Bonus: the items' stats${shardHp ? ` and ${shardHp} health from rune shards` : ''}.`
            }
          />
        )}
        <div className="grid2">
          <label className="field">
            Current HP ({t.hpPercent}%)
            <input type="range" min={1} max={100} value={t.hpPercent} onChange={(e) => upd({ hpPercent: Number(e.target.value) })} />
          </label>
          <NumberField label="Damage reduction %" value={Math.round(t.damageReduction * 100)} min={0} max={90} onChange={(v) => upd({ damageReduction: v / 100 })} />
        </div>
      </div>
    </Card>
  );
}

/**
 * A preset's items: its typical build for the target's level, with the items it buys later shown
 * faded, or the build you made from it. Removing or adding an item makes it yours.
 */
function PresetItems({ preset, level, build, onChange }: { preset: TargetPreset; level: number; build?: (number | null)[]; onChange: (b: (number | null)[] | undefined) => void }) {
  const full = TARGET_PRESETS[preset].build.map((x) => (x === null ? null : findItem(DATA, x).id));
  const typical = full.slice(0, itemsAtLevel(level));
  const later = build ? [] : full.slice(typical.length).map((id, i) => ({ id, level: levelForItems(typical.length + i + 1)! }));
  return (
    <div className="target-field">
      <span className="small secondary">Items</span>
      <div className="stack" style={{ gap: 4 }}>
        <TargetItems slots={build ?? typical} later={later} onChange={onChange} />
        <div className="small muted">
          {build ? (
            <>
              Your build.{' '}
              <button className="btn ghost small inline" onClick={() => onChange(undefined)}>
                Use the typical build
              </button>
            </>
          ) : (
            <span title={`Items by level: ${ITEMS_BY_LEVEL_RULE}.`}>
              Typical build for lvl {level}
              {later.length ? `. The faded items come at lvl ${listJoin(later.map((x) => x.level).filter((x, i, a) => a.indexOf(x) === i).map(String))}.` : ': all six items.'}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

/** "a, b and c". */
const listJoin = (xs: string[]) => (xs.length > 1 ? `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}` : xs.join(''));

const NO_DEFENSE_TIP = 'Boots or a damage item: no health, armor or magic resist.';

/** An item slot that holds no health or resists. */
const PlainSlot = ({ faded }: { faded?: boolean }) => (
  <span className={`icon sm plain-slot${faded ? ' faded' : ''}`} aria-hidden>
    <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round">
      <path d="M7 9.5V3.2L8 1.8l1 1.4v6.3M5 10h6M8 10v4" />
    </svg>
  </span>
);

/** A target's items: click one to remove it; `later` (faded) are items it would buy at a higher level, a click adds one now. */
function TargetItems({ slots, later = [], onChange }: { slots: (number | null)[]; later?: { id: number | null; level: number }[]; onChange: (s: (number | null)[]) => void }) {
  const [open, setOpen] = useState(false);
  const hover = useHoverCard();
  const tip = (id: number | null, action: string) =>
    id === null ? (
      <div className="item-tip">
        <div>{NO_DEFENSE_TIP}</div>
        <div className="it-foot muted">{action}</div>
      </div>
    ) : (
      <ItemTip id={id} foot={`Only its stats count on a target. ${action}`} />
    );
  return (
    <div>
      <div className="row" style={{ gap: 4 }}>
        {slots.map((id, i) => (
          <button
            key={i}
            className="btn small target-item"
            aria-label={`Remove ${id === null ? 'item without health or resists' : DATA.items[id]?.name}`}
            onClick={() => {
              hover.hide();
              onChange(slots.filter((_, j) => j !== i));
            }}
            {...hover.bind(tip(id, 'Click to remove it.'))}
          >
            {id === null ? <PlainSlot /> : <ItemIcon id={id} size="sm" />}
            <span className="muted">✕</span>
          </button>
        ))}
        {later.map((x, i) => (
          <button
            key={`later-${i}`}
            className="btn small target-item later"
            aria-label={`Add ${x.id === null ? 'item without health or resists' : DATA.items[x.id]?.name}, bought around level ${x.level}`}
            disabled={slots.length >= 6}
            onClick={() => {
              hover.hide();
              onChange([...slots, x.id]);
            }}
            {...hover.bind(tip(x.id, `Bought around lvl ${x.level}; click to add it now.`))}
          >
            {x.id === null ? <PlainSlot faded /> : <ItemIcon id={x.id} size="sm" />}
          </button>
        ))}
        {hover.node}
        {slots.length < 6 && (
          <button className="btn small" onClick={() => setOpen(true)}>
            + item
          </button>
        )}
      </div>
      {open && (
        <ItemPicker
          onPick={(id) => {
            onChange([...slots, id]);
            setOpen(false);
          }}
          onClose={() => setOpen(false)}
        />
      )}
    </div>
  );
}

/** A number field that changes its value on Enter or when it loses focus, not on every keystroke. */
function CommitNumber({ value, onCommit, ...props }: { value: number; onCommit: (v: number) => void; step?: number; min?: number; 'aria-label': string }) {
  const [text, setText] = useState<string | null>(null);
  const commit = () => {
    if (text !== null && text.trim() !== '' && Number.isFinite(Number(text))) onCommit(Number(text));
    setText(null);
  };
  return (
    <input
      type="number"
      {...props}
      value={text ?? value}
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') commit();
        else if (e.key === 'Escape') setText(null);
      }}
    />
  );
}

/** Health, armor and MR as base + bonus = total; editable for custom numbers. */
function TargetStatsTable({ base, bonus, onChange, note }: { base: TargetStats; bonus: TargetStats; onChange?: (base: TargetStats, bonus: TargetStats) => void; note: string }) {
  const nonNeg = (v: number) => Math.max(0, Math.round(v) || 0);
  return (
    <div className="stack" style={{ gap: 4 }}>
      <table className={`target-stats${onChange ? ' editable' : ''}`}>
        <thead>
          <tr>
            <th />
            <th title="The champion's own stats at its level">Base</th>
            <th title="From items and runes. A few effects only count these, e.g. damage based on the target's bonus health.">Bonus</th>
            <th>Total</th>
          </tr>
        </thead>
        <tbody>
          {STAT_ROWS.map(({ key, label, step }) => (
            <tr key={key}>
              <th scope="row">{label}</th>
              {onChange ? (
                <>
                  <td>
                    <input type="number" aria-label={`Base ${label.toLowerCase()}`} min={0} step={step} value={base[key]} onChange={(e) => onChange({ ...base, [key]: nonNeg(Number(e.target.value)) }, bonus)} />
                  </td>
                  <td>
                    <input type="number" aria-label={`Bonus ${label.toLowerCase()}`} min={0} step={step} value={bonus[key]} onChange={(e) => onChange(base, { ...bonus, [key]: nonNeg(Number(e.target.value)) })} />
                  </td>
                  <td>
                    <CommitNumber
                      aria-label={`Total ${label.toLowerCase()}`}
                      min={0}
                      step={step}
                      value={base[key] + bonus[key]}
                      onCommit={(v) => {
                        const total = nonNeg(v);
                        const b = Math.min(base[key], total);
                        onChange({ ...base, [key]: b }, { ...bonus, [key]: total - b });
                      }}
                    />
                  </td>
                </>
              ) : (
                <>
                  <td className="num">{fmt(base[key])}</td>
                  <td className="num">+{fmt(bonus[key])}</td>
                  <td className="num">
                    <strong>{fmt(base[key] + bonus[key])}</strong>
                  </td>
                </>
              )}
            </tr>
          ))}
        </tbody>
      </table>
      <div className="small muted">{note}</div>
    </div>
  );
}

// -----------------------------------------------------------------------------

export function SettingsPanel({ state, set }: { state: UIState; set: Set }) {
  const st = state.settings;
  const upd = (p: Partial<UIState['settings']>) => set((s) => ({ ...s, settings: { ...s.settings, ...p } }));
  return (
    <Card title="Settings">
      <div className="stack">
        <label className="row small" style={{ justifyContent: 'space-between' }}>
          Let burns and bleeds finish after the combo
          <input type="checkbox" checked={st.finishDots} onChange={(e) => upd({ finishDots: e.target.checked })} />
        </label>
      </div>
    </Card>
  );
}

// -----------------------------------------------------------------------------

/** Moves step `from` to index `to` of the steps that remain without it. */
const moveStep = <T,>(steps: T[], from: number, to: number) => {
  const next = steps.filter((_, j) => j !== from);
  next.splice(to, 0, steps[from]);
  return next;
};

/** A step being pressed, then dragged once the pointer moves: where the pointer went down (x, y) and
 *  is (px, py), its offset in the step (ox, oy), the step's size, its transform, and the index it
 *  would drop at (null until it moves). */
type Grab = { from: number; x: number; y: number; px: number; py: number; ox: number; oy: number; w: number; h: number; tx: number; ty: number; to: number | null };
type Slot2D = { x: number; y: number; w: number; h: number };

export function ComboBuilder({ state, set, sim }: { state: UIState; set: Set; sim: Sim | null }) {
  const [text, setText] = useState(state.combo);
  // The combo shows as steps; the pencil (or a click on the box's empty space) turns it into its
  // shorthand, typed in place, until Enter, Escape or a click elsewhere.
  const [typing, setTyping] = useState(false);
  const startTyping = () => {
    setText(state.combo);
    setTyping(true);
  };
  const parsed = useMemo(() => {
    try {
      return { steps: parseCombo(state.combo), error: null as string | null };
    } catch (e) {
      return { steps: [] as ComboStep[], error: (e as Error).message };
    }
  }, [state.combo]);
  const textError = useMemo(() => {
    try {
      parseCombo(text);
      return null;
    } catch (e) {
      return (e as Error).message;
    }
  }, [text]);
  const steps = parsed.steps;
  const commit = (next: ComboStep[]) => {
    const c = formatCombo(next);
    setText(c);
    set((s) => ({ ...s, combo: c }));
  };
  const kit = getKit(DATA.champions[state.champion]);
  const champ = DATA.champions[state.champion];
  const spellName = (slot: Slot) => (slot === 'P' ? champ.passive.name : champ.abilities.find((a) => a.slot === slot)?.spells[0]?.name ?? slot);
  const actives = (sim?.effects ?? []).filter((e) => e.active && e.source === 'item');
  const hasP = !!(kit.abilities.P?.components?.length || Object.keys(kit.abilities.P?.variants ?? {}).length);
  // Crits aren't a setting: the buttons mark the steps that can crit (AA!, Q?), and show how they're
  // marked: none pressed when they differ, the last pick while no step can crit. New steps follow.
  const [lastCrits, setLastCrits] = useState<CritMode>('expected');
  const crits = critMarking(steps, kit) ?? lastCrits;
  const setCrits = (mode: CritMode) => {
    setLastCrits(mode);
    commit(steps.map((st) => markCrit(st, kit, mode)));
  };
  const follow = (st: ComboStep) => (crits === 'mixed' ? st : markCrit(st, kit, crits));
  const add = (st: ComboStep) => commit([...steps, follow(st)]);
  const label = (st: ComboStep) => formatCombo([st]);
  // A step's icon, as its damage shows it in the results; none for a wait or an item not found.
  const icon = (source: string, name: string, size: 'xs' | 'sm') => <Icon src={sourceMark(source, name, state.champion).icon} label={name} size={size} />;
  const stepIcon = (st: ComboStep) => {
    if (st.type === 'ability') return icon(st.slot, spellName(st.slot), 'xs');
    if (st.type === 'attack') return icon('AA', 'Basic attack', 'xs');
    if (st.type === 'summoner') return icon('summoner:ignite', 'Ignite', 'xs');
    if (st.type === 'item') {
      try {
        const it = findItem(DATA, st.item);
        return icon(`item:${it.id}`, it.name, 'xs');
      } catch {
        return null;
      }
    }
    return null;
  };
  // Arrow keys move a focused step, Delete removes it; focus stays on it, or on the next one.
  const refocus = useRef<number | null>(null);
  // A step is dragged to its new place (a pointer that moves a few pixels from where it went down on
  // the step, not on its buttons). It follows the pointer by its transform, set on each move without
  // rendering; the other steps slide aside to open the gap it will land in, and on release it glides
  // into it. While dragging, the steps are laid out by flex `order` rather than moved in the DOM, so
  // the dragged one keeps the pointer captured: a finger's drag doesn't scroll the page (styles.css)
  // and the step follows it outside the box. Escape puts it back.
  const seq = useRef<HTMLDivElement>(null);
  const chips = useRef<(HTMLElement | null)[]>([]);
  const grab = useRef<Grab | null>(null);
  const [drag, setDrag] = useState<{ from: number; to: number } | null>(null);
  /** The steps' places in the box as laid out (not as they slide), measured whenever they change. */
  const slots = useRef<Slot2D[]>([]);
  /** Where each step is on screen before a change that moves them, by its index after it; the
   *  change's render slides them from there. `settle`: a dropped step, which also loses its lift. */
  const glide = useRef<{ from: (DOMRect | undefined)[]; settle?: { at: number; lift: Keyframe } } | null>(null);
  const onScreen = (order: number[], skip?: number) => order.map((j) => (j === skip ? undefined : chips.current[j]?.getBoundingClientRect()));
  const indices = () => steps.map((_, j) => j);
  /** How a dragged step looks, to fade from as it lands; over the others meanwhile. */
  const lift = (el: Element): Keyframe => {
    const c = getComputedStyle(el);
    return { boxShadow: c.boxShadow, borderColor: c.borderColor, opacity: c.opacity, zIndex: 2 };
  };
  /** Where the dragged step lands with its middle at (x, y) in the box: before the first other step
   *  it is before in reading order (above its line, or on it and left of its middle). */
  const dropAt = (from: number, x: number, y: number) => {
    const others = steps.flatMap((_, j) => (j !== from && slots.current[j] ? [slots.current[j]] : []));
    const to = others.findIndex((r) => y < r.y || (y <= r.y + r.h && x < r.x + r.w / 2));
    return to < 0 ? others.length : to;
  };
  /** Moves the dragged step under the pointer, then the gap to where it would land. */
  const track = () => {
    const g = grab.current;
    const [el, home] = [g && chips.current[g.from], g && slots.current[g.from]];
    if (!g || g.to == null || !el || !home) return;
    const box = seq.current!.getBoundingClientRect();
    const [x, y] = [g.px - g.ox - box.left, g.py - g.oy - box.top];
    [g.tx, g.ty] = [x - home.x, y - home.y];
    el.style.transform = `translate(${g.tx}px, ${g.ty}px)`;
    const to = dropAt(g.from, x + g.w / 2, y + g.h / 2);
    if (to !== g.to) reorder(to);
  };
  const reorder = (to: number) => {
    const g = grab.current!;
    g.to = to;
    glide.current = { from: onScreen(indices(), g.from) };
    setDrag({ from: g.from, to });
  };
  /** Ends a drag: the step glides from where it was let go to its new place, or back on a cancel. */
  const drop = (keep: boolean) => {
    const g = grab.current;
    grab.current = null;
    const el = g && chips.current[g.from];
    if (g?.to == null || !el) return;
    const to = keep ? g.to : g.from;
    glide.current = { from: onScreen(moveStep(indices(), g.from, to)), settle: { at: to, lift: lift(el) } };
    el.style.transform = '';
    setDrag(null);
    if (to === g.from) return;
    if (document.activeElement === el) refocus.current = to;
    commit(moveStep(steps, g.from, to));
  };
  // After a render that moves steps: measure where they are now, and slide each from where it was.
  useLayoutEffect(() => {
    const g = glide.current;
    glide.current = null;
    if (!g || !seq.current) return;
    const box = seq.current.getBoundingClientRect();
    const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
    chips.current.forEach((el, k) => {
      if (!el) return;
      const f = g.from[k];
      if (f) el.getAnimations().forEach((a) => a.cancel());
      const r = el.getBoundingClientRect();
      const [tx, ty] = k === drag?.from ? [grab.current?.tx ?? 0, grab.current?.ty ?? 0] : [0, 0];
      slots.current[k] = { x: r.left - tx - box.left, y: r.top - ty - box.top, w: r.width, h: r.height };
      const [dx, dy] = f ? [f.left - r.left, f.top - r.top] : [0, 0];
      const settle = g.settle?.at === k;
      if (still || !f || (!settle && Math.abs(dx) + Math.abs(dy) < 0.5)) return;
      const [a, b] = settle ? [g.settle!.lift, lift(el)] : [{}, {}];
      el.animate([{ transform: `translate(${dx}px, ${dy}px)`, ...a }, { transform: 'none', ...b }], { duration: settle ? 180 : 160, easing: 'cubic-bezier(0.2, 0, 0, 1)' });
    });
    track();
  });
  useEffect(() => {
    if (refocus.current != null) chips.current[refocus.current]?.focus();
    refocus.current = null;
  }, [state.combo]);

  return (
    <Card
      title="Combo"
      right={
        <div className="row" style={{ gap: 6 }}>
          <span className="small secondary">Crits</span>
          <div className="segmented small" role="group" aria-label="Crits" title="Expected: hits that can crit deal their average damage. Always (!) or never (?): marks every step that can crit.">
            {(['expected', 'always', 'never'] as const).map((c) => (
              <button key={c} aria-pressed={crits === c} onClick={() => setCrits(c)}>
                {c}
              </button>
            ))}
          </div>
          <button className="btn small" onClick={() => commit([])}>
            Clear
          </button>
        </div>
      }
    >
      {/* While typing, the keys add to the text without taking the focus from it */}
      <div className="combo-palette" onMouseDown={typing ? (e) => e.preventDefault() : undefined}>
        {(['Q', 'W', 'E', 'R'] as Slot[]).map((s) => (
          <button key={s} className="combo-key" title={spellName(s)} onClick={() => add({ type: 'ability', slot: s })}>
            {icon(s, spellName(s), 'sm')}
            {s}
          </button>
        ))}
        {hasP && (
          <button className="combo-key" title={champ.passive.name} onClick={() => add({ type: 'ability', slot: 'P' })}>
            {icon('P', champ.passive.name, 'sm')}
            P
          </button>
        )}
        <button className="combo-key" title="Basic attack" onClick={() => add({ type: 'attack' })}>
          {icon('AA', 'Basic attack', 'sm')}
          AA
        </button>
        <button className="combo-key" title="Ignite" onClick={() => add({ type: 'summoner', spell: 'ignite' })}>
          {icon('summoner:ignite', 'Ignite', 'sm')}
          Ignite
        </button>
        {actives.map((e) => (
          <button key={e.id} className="combo-key" title={`${e.label} active`} onClick={() => add({ type: 'item', item: e.label })}>
            {icon(e.id, e.label, 'sm')}
            {e.active!.label}
          </button>
        ))}
        <button className="combo-key" title="Wait 1 second" onClick={() => add({ type: 'wait', seconds: 1 })}>
          +1s
        </button>
      </div>
      {!typing ? (
        <div className="combo-seq" ref={seq} style={{ marginTop: 10 }} role="list" aria-label="Combo sequence" onClick={(e) => e.target === e.currentTarget && startTyping()}>
          {!steps.length && (
            <span className="muted small" style={{ pointerEvents: 'none' }}>
              Click abilities above to build a combo.
            </span>
          )}
          {steps.map((st, i) => {
            const variants = st.type === 'ability' ? Object.entries(kit.abilities[st.slot]?.variants ?? {}) : [];
            const dragging = drag?.from === i;
            // While one is dragged: its place among the others, which keep their order around it.
            const rest = drag && i > drag.from ? i - 1 : i;
            const order = !drag ? undefined : dragging ? drag.to : rest >= drag.to ? rest + 1 : rest;
            return (
              <span
                key={i}
                ref={(el) => {
                  chips.current[i] = el;
                }}
                className={`chip ${dragging ? 'dragging' : ''}`}
                role="listitem"
                tabIndex={0}
                aria-label={`Step ${i + 1} of ${steps.length}: ${label(st)}. Arrow keys move it, Delete removes it.`}
                style={order != null ? { order } : undefined}
                onPointerDown={(e) => {
                  if (e.button !== 0 || (e.target as Element).closest('button, select')) return;
                  const r = e.currentTarget.getBoundingClientRect();
                  grab.current = { from: i, x: e.clientX, y: e.clientY, px: e.clientX, py: e.clientY, ox: e.clientX - r.left, oy: e.clientY - r.top, w: r.width, h: r.height, tx: 0, ty: 0, to: null };
                  e.currentTarget.setPointerCapture(e.pointerId);
                }}
                onPointerMove={(e) => {
                  const g = grab.current;
                  if (!g || g.from !== i) return;
                  [g.px, g.py] = [e.clientX, e.clientY];
                  if (g.to != null) return track();
                  if ((g.px - g.x) ** 2 + (g.py - g.y) ** 2 < 16) return;
                  // Picked up mid-glide: from where it is on screen.
                  e.currentTarget.getAnimations().forEach((a) => a.cancel());
                  reorder(i);
                }}
                onPointerUp={() => drop(true)}
                onPointerCancel={() => drop(false)}
                onLostPointerCapture={() => drop(false)}
                // The icon is an image, which the browser would drag itself (and cancel the pointer).
                onDragStart={(e) => e.preventDefault()}
                onKeyDown={(e) => {
                  if (e.key === 'Escape' && grab.current?.to != null) return drop(false);
                  if (e.target !== e.currentTarget) return;
                  const to = e.key === 'ArrowLeft' ? i - 1 : e.key === 'ArrowRight' ? i + 1 : null;
                  if (to != null && to >= 0 && to < steps.length) {
                    e.preventDefault();
                    refocus.current = to;
                    glide.current = { from: onScreen(moveStep(indices(), i, to)) };
                    commit(moveStep(steps, i, to));
                  } else if (e.key === 'Delete' || e.key === 'Backspace') {
                    e.preventDefault();
                    refocus.current = Math.min(i, steps.length - 2);
                    commit(steps.filter((_, j) => j !== i));
                  }
                }}
              >
                {stepIcon(st)}
                {variants.length > 0 && st.type === 'ability' ? (
                  <select
                    aria-label={`${st.slot} variant`}
                    value={st.variant ?? ''}
                    onChange={(e) => commit(steps.map((x, j) => (j === i ? follow({ ...st, variant: e.target.value || undefined }) : x)))}
                    style={{ padding: '1px 2px', fontWeight: 600, background: 'transparent', border: 0 }}
                  >
                    <option value="">{label({ ...st, variant: undefined })}</option>
                    {variants.map(([k, v]) => (
                      <option key={k} value={k}>
                        {label({ ...st, variant: undefined })}: {v.label}
                      </option>
                    ))}
                  </select>
                ) : (
                  <span title={st.type === 'ability' ? spellName(st.slot) : undefined}>{label(st)}</span>
                )}
                <button aria-label="Remove step" tabIndex={-1} onClick={() => commit(steps.filter((_, j) => j !== i))}>
                  ✕
                </button>
              </span>
            );
          })}
          <button className="combo-edit" style={drag ? { order: steps.length } : undefined} aria-label="Edit as text" title="Edit as text" onClick={startTyping}>
            <svg viewBox="0 0 16 16" aria-hidden>
              <path d="M10.5 2.5l3 3L5.5 13.5H2.5v-3z M9 4l3 3" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
            </svg>
          </button>
        </div>
      ) : (
        <input
          type="text"
          className="combo-text"
          aria-label="Combo shorthand"
          autoFocus
          value={text}
          onBlur={() => setTyping(false)}
          onKeyDown={(e) => (e.key === 'Enter' || e.key === 'Escape') && e.currentTarget.blur()}
          onChange={(e) => {
            setText(e.target.value);
            try {
              parseCombo(e.target.value);
              set((s) => ({ ...s, combo: e.target.value }));
            } catch {
              // keep editing
            }
          }}
        />
      )}
      {typing && textError && (
        <div className="small" style={{ marginTop: 4, color: 'var(--critical)' }}>
          {textError}
        </div>
      )}
      {parsed.error && <div className="notice warn small">{parsed.error}</div>}
    </Card>
  );
}
