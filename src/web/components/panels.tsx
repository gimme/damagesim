import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { DATA, abilityIcon, championIcon } from '../data.ts';
import { Card, ChampIcon, ChampionPicker, Icon, ItemIcon, ItemPicker, ItemTip, Markup, NumberField, RuneIcon, RuneTip, fmt, sourceMark, useHoverCard } from './common.tsx';
import { SHARD_ROWS, type UIState, type TargetState } from '../state.ts';
import { TARGET_PRESETS, type TargetPreset } from '../../engine/presets.ts';
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

export function TargetPanel({ state, set, resolved, label }: { state: UIState; set: Set; resolved?: SimResult['target']; label: string }) {
  const t = state.target;
  const upd = (p: Partial<TargetState>) => set((s) => ({ ...s, target: { ...s.target, ...p } }));
  // Editing a number while a preset is active switches to custom numbers, starting from the preset's.
  const edit = (p: Partial<TargetState>) =>
    t.preset && resolved
      ? upd({ preset: null, maxHp: Math.round(resolved.maxHp), bonusHp: Math.round(resolved.bonusHp), armor: Math.round(resolved.armor), bonusArmor: Math.round(resolved.bonusArmor), mr: Math.round(resolved.mr), bonusMr: Math.round(resolved.bonusMr), ...p })
      : upd(p);
  const shown = t.preset && resolved ? { maxHp: resolved.maxHp, bonusHp: resolved.bonusHp, armor: resolved.armor, bonusArmor: resolved.bonusArmor, mr: resolved.mr, bonusMr: resolved.bonusMr } : t;
  const r = (v: number) => Math.round(v);
  const usesLevel = t.mode === 'champion' || !!t.preset;
  const targetLevel = Math.max(1, Math.min(20, state.level + t.levelDiff));
  return (
    <Card
      title="Target"
      right={
        <div className="segmented">
          <button aria-pressed={t.mode === 'stats'} onClick={() => upd({ mode: 'stats' })}>
            Stats
          </button>
          <button aria-pressed={t.mode === 'champion'} onClick={() => upd({ mode: 'champion' })}>
            Champion
          </button>
        </div>
      }
    >
      {t.mode === 'stats' ? (
        <div className="stack">
          <div className="segmented" role="group" aria-label="Target preset" style={{ alignSelf: 'flex-start' }}>
            {(Object.keys(TARGET_PRESETS) as TargetPreset[]).map((k) => (
              <button key={k} aria-pressed={t.preset === k} title={TARGET_PRESETS[k].description} onClick={() => upd({ preset: k })}>
                {TARGET_PRESETS[k].label}
              </button>
            ))}
            <button aria-pressed={!t.preset} title="Your own HP, armor and MR" onClick={() => edit({})}>
              Custom
            </button>
          </div>
          <div className="grid3">
            <NumberField label="Max HP" value={r(shown.maxHp)} step={50} min={1} onChange={(v) => edit({ maxHp: v })} />
            <NumberField label="Armor" value={r(shown.armor)} step={5} onChange={(v) => edit({ armor: v })} />
            <NumberField label="Magic resist" value={r(shown.mr)} step={5} onChange={(v) => edit({ mr: v })} />
            <NumberField label="of which bonus HP" value={r(shown.bonusHp)} step={50} min={0} onChange={(v) => edit({ bonusHp: v })} />
            <NumberField label="bonus armor" value={r(shown.bonusArmor)} step={5} min={0} onChange={(v) => edit({ bonusArmor: v })} />
            <NumberField label="bonus MR" value={r(shown.bonusMr)} step={5} min={0} onChange={(v) => edit({ bonusMr: v })} />
          </div>
        </div>
      ) : (
        <div className="stack">
          <ChampionPicker label="Target champion" value={t.champion} onChange={(id) => upd({ champion: id })} />
          <TargetItems items={t.items} onChange={(items) => upd({ items })} />
        </div>
      )}
      {usesLevel && (
        <div className="row" style={{ flexWrap: 'nowrap', marginTop: 8 }}>
          <span className="small secondary" style={{ width: 44 }}>
            Level
          </span>
          <input type="range" min={-5} max={5} value={t.levelDiff} aria-label="Target level relative to yours" onChange={(e) => upd({ levelDiff: Number(e.target.value) })} />
          <strong className="num" style={{ minWidth: 92, textAlign: 'right', whiteSpace: 'nowrap' }} title="Target level minus your level">
            {t.levelDiff === 0 ? 'same' : t.levelDiff > 0 ? `+${t.levelDiff}` : `−${-t.levelDiff}`} <span className="muted">(lvl {targetLevel})</span>
          </strong>
        </div>
      )}
      <div className="grid2" style={{ marginTop: 8 }}>
        <label className="field">
          Current HP ({t.hpPercent}%)
          <input type="range" min={1} max={100} value={t.hpPercent} onChange={(e) => upd({ hpPercent: Number(e.target.value) })} />
        </label>
        <NumberField label="Damage reduction %" value={Math.round(t.damageReduction * 100)} min={0} max={90} onChange={(v) => upd({ damageReduction: v / 100 })} />
      </div>
      <div className="muted small" style={{ marginTop: 6 }}>
        {label}
      </div>
    </Card>
  );
}

function TargetItems({ items, onChange }: { items: number[]; onChange: (i: number[]) => void }) {
  const [open, setOpen] = useState(false);
  const hover = useHoverCard();
  return (
    <div>
      <div className="row" style={{ gap: 4 }}>
        {items.map((id, i) => (
          <button
            key={i}
            className="btn small"
            aria-label={`Remove ${DATA.items[id]?.name}`}
            onClick={() => {
              hover.hide();
              onChange(items.filter((_, j) => j !== i));
            }}
            style={{ display: 'inline-flex', gap: 4, alignItems: 'center', padding: 2 }}
            {...hover.bind(<ItemTip id={id} />)}
          >
            <ItemIcon id={id} size="sm" />
            <span className="muted">✕</span>
          </button>
        ))}
        {hover.node}
        {items.length < 6 && (
          <button className="btn small" onClick={() => setOpen(true)}>
            + item
          </button>
        )}
      </div>
      {open && (
        <ItemPicker
          onPick={(id) => {
            onChange([...items, id]);
            setOpen(false);
          }}
          onClose={() => setOpen(false)}
        />
      )}
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
