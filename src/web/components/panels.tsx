import { useMemo, useState } from 'react';
import { DATA } from '../data.ts';
import { Card, ChampionPicker, ItemIcon, ItemPicker, ItemTip, NumberField, RuneIcon, RuneTip, fmt, useHoverCard } from './common.tsx';
import { SHARD_ROWS, type UIState, type TargetState } from '../state.ts';
import { TARGET_PRESETS, type TargetPreset } from '../../engine/presets.ts';
import { maxRanks, resolveRanks, type Sim, type SimResult } from '../../engine/sim.ts';
import { runeText } from '../../engine/tooltip.ts';
import { NOT_LIVE_RUNES, bonusSkillPoints } from '../../engine/runes.ts';
import { critMarking, formatCombo, markCrit, parseCombo, type ComboStep, type CritMode } from '../../engine/combo.ts';
import { conflicts } from '../../engine/analysis.ts';
import { getKit } from '../../kits/index.ts';
import type { Effect, Slot } from '../../engine/effects.ts';

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
              <span className="kbd">{k}</span>
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
    </Card>
  );
}

function OptionsEditor({ state, set, sim }: { state: UIState; set: Set; sim: Sim | null }) {
  const kit = getKit(DATA.champions[state.champion]);
  const effectOpts = (sim?.effects ?? []).flatMap((e: Effect) => (e.options ?? []).map((o) => ({ ...o, from: e.label })));
  const opts = [...(kit.options ?? []).map((o) => ({ ...o, from: DATA.champions[state.champion].name })), ...effectOpts].filter((o, i, a) => a.findIndex((x) => x.key === o.key) === i);
  if (!opts.length) return null;
  return (
    <details>
      <summary>Champion, item & rune parameters ({opts.length})</summary>
      <div className="stack" style={{ marginTop: 8 }}>
        {opts.map((o) => {
          const v = state.options[o.key] ?? o.default;
          const isToggle = (o as any).toggle || (o.max === 1 && (o.min ?? 0) === 0 && o.step === 1);
          return (
            <div key={o.key} className="row" style={{ justifyContent: 'space-between', flexWrap: 'nowrap' }}>
              <span className="small" title={(o as any).description ?? o.key}>
                {o.label} <span className="muted">· {o.from}</span>
              </span>
              {isToggle ? (
                <input type="checkbox" checked={!!v} onChange={(e) => set((s) => ({ ...s, options: { ...s.options, [o.key]: e.target.checked ? 1 : 0 } }))} />
              ) : (
                <input
                  type="number"
                  value={v}
                  min={o.min}
                  max={o.max}
                  step={o.step ?? 1}
                  style={{ width: 80 }}
                  onChange={(e) => set((s) => ({ ...s, options: { ...s.options, [o.key]: Number(e.target.value) } }))}
                />
              )}
            </div>
          );
        })}
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <span className="small">
            Your current HP <span className="muted">· Last Stand, Absolute Focus…</span>
          </span>
          <input
            type="number"
            min={1}
            max={100}
            value={Math.round((state.options['self.hpPercent'] ?? 1) * 100)}
            style={{ width: 80 }}
            onChange={(e) => set((s) => ({ ...s, options: { ...s.options, 'self.hpPercent': Number(e.target.value) / 100 } }))}
          />
        </div>
      </div>
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
          Current HP ({Math.round(t.hpPercent * 100)}%)
          <input type="range" min={1} max={100} value={Math.round(t.hpPercent * 100)} onChange={(e) => upd({ hpPercent: Number(e.target.value) / 100 })} />
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
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <span className="small" title="Since patch 26.9 damage-dealt amplifiers add together; before, they multiplied.">
            Damage amplifiers
          </span>
          <div className="segmented">
            {(['additive', 'multiplicative'] as const).map((c) => (
              <button key={c} aria-pressed={st.ampStacking === c} onClick={() => upd({ ampStacking: c })}>
                {c}
              </button>
            ))}
          </div>
        </div>
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <span className="small">Seconds already in combat</span>
          {/* Nothing ramps longer: Riftmaker and Grasp take 4s, Liandry's and Haunting Guise 3s. */}
          <input type="number" min={0} max={4} step={1} style={{ width: 80 }} value={st.priorCombatTime} onChange={(e) => upd({ priorCombatTime: Number(e.target.value) })} />
        </div>
        <label className="row small" style={{ justifyContent: 'space-between' }}>
          Let burns and bleeds finish after the combo
          <input type="checkbox" checked={st.finishDots} onChange={(e) => upd({ finishDots: e.target.checked })} />
        </label>
      </div>
    </Card>
  );
}

// -----------------------------------------------------------------------------

export function ComboBuilder({ state, set, sim }: { state: UIState; set: Set; sim: Sim | null }) {
  const [text, setText] = useState(state.combo);
  const [editing, setEditing] = useState(false);
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
      <div className="combo-palette">
        {(['Q', 'W', 'E', 'R'] as Slot[]).map((s) => (
          <button key={s} className="combo-key" title={spellName(s)} onClick={() => add({ type: 'ability', slot: s })}>
            {s}
          </button>
        ))}
        {hasP && (
          <button className="combo-key" title={champ.passive.name} onClick={() => add({ type: 'ability', slot: 'P' })}>
            P
          </button>
        )}
        <button className="combo-key" title="Basic attack" onClick={() => add({ type: 'attack' })}>
          AA
        </button>
        <button className="combo-key" title="Ignite" onClick={() => add({ type: 'summoner', spell: 'ignite' })}>
          Ignite
        </button>
        {actives.map((e) => (
          <button key={e.id} className="combo-key" title={`${e.label} active`} onClick={() => add({ type: 'item', item: e.label })}>
            {e.active!.label}
          </button>
        ))}
        <button className="combo-key" title="Wait 1 second" onClick={() => add({ type: 'wait', seconds: 1 })}>
          +1s
        </button>
      </div>
      <div className="combo-seq" style={{ marginTop: 10 }} aria-label="Combo sequence">
        {!steps.length && <span className="muted small">Click abilities above to build a combo.</span>}
        {steps.map((st, i) => {
          const variants = st.type === 'ability' ? Object.entries(kit.abilities[st.slot]?.variants ?? {}) : [];
          return (
            <span key={i} className="chip">
              {i > 0 && <span className="arrow">›</span>}
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
              {i > 0 && (
                <button aria-label="Move left" onClick={() => commit(steps.map((x, j) => (j === i - 1 ? steps[i] : j === i ? steps[i - 1] : x)))}>
                  ‹
                </button>
              )}
              <button aria-label="Remove step" onClick={() => commit(steps.filter((_, j) => j !== i))}>
                ✕
              </button>
            </span>
          );
        })}
      </div>
      <div className="row" style={{ marginTop: 8 }}>
        <input
          type="text"
          aria-label="Combo shorthand"
          value={editing ? text : state.combo}
          onFocus={() => {
            setEditing(true);
            setText(state.combo);
          }}
          onBlur={() => setEditing(false)}
          onChange={(e) => {
            setText(e.target.value);
            try {
              parseCombo(e.target.value);
              set((s) => ({ ...s, combo: e.target.value }));
            } catch {
              // keep editing
            }
          }}
          style={{ flex: 1, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' }}
        />
      </div>
      {editing && textError && (
        <div className="small" style={{ marginTop: 4, color: 'var(--critical)' }}>
          {textError}
        </div>
      )}
      {parsed.error && <div className="notice warn small">{parsed.error}</div>}
    </Card>
  );
}
