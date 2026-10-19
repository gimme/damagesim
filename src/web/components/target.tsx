// The Target card: a preset, a champion with items, or your own numbers, as base + bonus = total.

import { useState } from "react";
import { DATA } from "../data.ts";
import { ItemIcon } from "./icons.tsx";
import { ChampionPicker, ItemPicker } from "./pickers.tsx";
import { ItemTip, useHoverCard } from "./hover.tsx";
import { Card, NumberField, fmt } from "./common.tsx";
import { TARGET_MODES, isQuestBoots, type Set, type TargetMode, type TargetState, type TargetStats, type UIState } from "../state.ts";
import { ITEMS_BY_LEVEL_RULE, TARGET_PRESETS, isTargetPreset, itemsAtLevel, levelForItems, presetShardHp, type TargetPreset } from "../../engine/presets.ts";
import type { SimResult } from "../../engine/sim.ts";
import { findItem } from "../../engine/gamedata.ts";

const MODE_LABEL: Record<TargetMode, string> = { squishy: "Squishy", bruiser: "Bruiser", tank: "Tank", champion: "Champion", custom: "Custom" };
const MODE_TITLE: Record<TargetMode, string> = {
  squishy: TARGET_PRESETS.squishy.description,
  bruiser: TARGET_PRESETS.bruiser.description,
  tank: TARGET_PRESETS.tank.description,
  champion: "A champion at a level, with the items you pick",
  custom: "Your own numbers, starting from the target you had",
};

const STAT_ROWS: { key: keyof TargetStats; label: string; step: number }[] = [
  { key: "hp", label: "Health", step: 50 },
  { key: "armor", label: "Armor", step: 5 },
  { key: "mr", label: "Magic resist", step: 5 },
];

/** A resolved target's base and bonus stats, whole numbers that add up to its rounded totals. */
function splitStats(t: SimResult["target"]): { base: TargetStats; bonus: TargetStats } {
  const total = { hp: Math.round(t.maxHp), armor: Math.round(t.armor), mr: Math.round(t.mr) };
  const bonus = { hp: Math.round(t.bonusHp), armor: Math.round(t.bonusArmor), mr: Math.round(t.bonusMr) };
  return { base: { hp: total.hp - bonus.hp, armor: total.armor - bonus.armor, mr: total.mr - bonus.mr }, bonus };
}

export function TargetPanel({ state, set, resolved }: { state: UIState; set: Set; resolved?: SimResult["target"] }) {
  const t = state.target;
  const upd = (p: Partial<TargetState>) => set((s) => ({ ...s, target: { ...s.target, ...p } }));
  const preset = isTargetPreset(t.mode) ? t.mode : null;
  const targetLevel = Math.max(1, Math.min(20, state.level + t.levelDiff));
  // Custom starts from the numbers of the target you had.
  const pick = (mode: TargetMode) => upd(mode === "custom" && t.mode !== "custom" && resolved ? { mode, ...splitStats(resolved) } : { mode });
  const stats = t.mode === "custom" ? { base: t.base, bonus: t.bonus } : resolved && splitStats(resolved);
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
        {t.mode === "champion" && <ChampionPicker label="Target champion" value={t.champion} onChange={(id) => upd({ champion: id })} />}
        {t.mode !== "custom" && (
          <div className="target-field">
            <span className="small secondary">Level</span>
            <div className="row" style={{ flexWrap: "nowrap" }}>
              <input
                type="range"
                min={-5}
                max={5}
                value={t.levelDiff}
                aria-label="Target level relative to yours"
                onChange={(e) => upd({ levelDiff: Number(e.target.value) })}
              />
              <strong className="num" style={{ minWidth: 92, textAlign: "right", whiteSpace: "nowrap" }} title="Target level minus your level">
                {t.levelDiff === 0 ? "same" : t.levelDiff > 0 ? `+${t.levelDiff}` : `−${-t.levelDiff}`} <span className="muted">(lvl {targetLevel})</span>
              </strong>
            </div>
          </div>
        )}
        {preset && (
          <PresetItems
            preset={preset}
            level={targetLevel}
            build={t.builds[preset]}
            questBoots={state.settings.questBoots}
            onChange={(b) => upd({ builds: { ...t.builds, [preset]: b } })}
          />
        )}
        {t.mode === "champion" && (
          <div className="target-field">
            <span className="small secondary">Items</span>
            <TargetItems
              slots={t.items}
              questBoots={state.settings.questBoots}
              onChange={(items) => upd({ items: items.filter((x): x is number => x !== null) })}
            />
          </div>
        )}
        {stats && (
          <TargetStatsTable
            base={stats.base}
            bonus={stats.bonus}
            onChange={t.mode === "custom" ? (base, bonus) => upd({ base, bonus }) : undefined}
            note={
              t.mode === "custom"
                ? "Total = base + bonus. A total you type keeps the base and sets the bonus."
                : `Base: ${t.mode === "champion" ? DATA.champions[t.champion]?.name : `the average ${TARGET_PRESETS[preset!].label.toLowerCase()}`} at lvl ${targetLevel}. Bonus: the items' stats${shardHp ? ` and ${shardHp} health from rune shards` : ""}.`
            }
          />
        )}
        <div className="grid2">
          <label className="field">
            Current HP ({t.hpPercent}%)
            <input type="range" min={1} max={100} value={t.hpPercent} onChange={(e) => upd({ hpPercent: Number(e.target.value) })} />
          </label>
          <NumberField
            label="Damage reduction %"
            value={Math.round(t.damageReduction * 100)}
            min={0}
            max={90}
            onChange={(v) => upd({ damageReduction: v / 100 })}
          />
        </div>
      </div>
    </Card>
  );
}

/**
 * A preset's items: its typical build for the target's level, with the items it buys later shown
 * faded, or the build you made from it. Removing or adding an item makes it yours.
 */
function PresetItems({
  preset,
  level,
  build,
  questBoots,
  onChange,
}: {
  preset: TargetPreset;
  level: number;
  build?: (number | null)[];
  questBoots: boolean;
  onChange: (b: (number | null)[] | undefined) => void;
}) {
  const full = TARGET_PRESETS[preset].build.map((x) => (x === null ? null : findItem(DATA, x).id));
  const typical = full.slice(0, itemsAtLevel(level));
  const later = build ? [] : full.slice(typical.length).map((id, i) => ({ id, level: levelForItems(typical.length + i + 1)! }));
  return (
    <div className="target-field">
      <span className="small secondary">Items</span>
      <div className="stack" style={{ gap: 4 }}>
        <TargetItems slots={build ?? typical} later={later} questBoots={questBoots} onChange={onChange} />
        <div className="small muted">
          {build ? (
            <>
              Your build.{" "}
              <button className="btn ghost small inline" onClick={() => onChange(undefined)}>
                Use the typical build
              </button>
            </>
          ) : (
            <span title={`Items by level: ${ITEMS_BY_LEVEL_RULE}.`}>
              Typical build for lvl {level}
              {later.length
                ? `. The faded items come at lvl ${listJoin(
                    later
                      .map((x) => x.level)
                      .filter((x, i, a) => a.indexOf(x) === i)
                      .map(String),
                  )}.`
                : ": all six items."}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

/** "a, b and c". */
const listJoin = (xs: string[]) => (xs.length > 1 ? `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}` : xs.join(""));

const NO_DEFENSE_TIP = "Boots or a damage item: no health, armor or magic resist.";

/** An item slot that holds no health or resists. */
const PlainSlot = ({ faded }: { faded?: boolean }) => (
  <span className={`icon sm plain-slot${faded ? " faded" : ""}`} aria-hidden>
    <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round">
      <path d="M7 9.5V3.2L8 1.8l1 1.4v6.3M5 10h6M8 10v4" />
    </svg>
  </span>
);

/** A target's items: click one to remove it; `later` (faded) are items it would buy at a higher level, a click adds one now. */
function TargetItems({
  slots,
  later = [],
  questBoots,
  onChange,
}: {
  slots: (number | null)[];
  later?: { id: number | null; level: number }[];
  questBoots: boolean;
  onChange: (s: (number | null)[]) => void;
}) {
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
    <div className="picker-host">
      <div className="row" style={{ gap: 4 }}>
        {slots.map((id, i) => (
          <button
            key={i}
            className="btn small target-item"
            aria-label={`Remove ${id === null ? "item without health or resists" : DATA.items[id]?.name}`}
            onClick={() => {
              hover.hide();
              onChange(slots.filter((_, j) => j !== i));
            }}
            {...hover.bind(tip(id, "Click to remove it."))}
          >
            {id === null ? <PlainSlot /> : <ItemIcon id={id} size="sm" />}
            <span className="muted">✕</span>
          </button>
        ))}
        {later.map((x, i) => (
          <button
            key={`later-${i}`}
            className="btn small target-item later"
            aria-label={`Add ${x.id === null ? "item without health or resists" : DATA.items[x.id]?.name}, bought around level ${x.level}`}
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
          <button className="btn small" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
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
          // Both tiers with the setting: the quest is yours, the enemy may not have done it.
          offers={(id) => questBoots || !isQuestBoots(DATA, id)}
        />
      )}
    </div>
  );
}

/** A number field that changes its value on Enter or when it loses focus, not on every keystroke. */
function CommitNumber({ value, onCommit, ...props }: { value: number; onCommit: (v: number) => void; step?: number; min?: number; "aria-label": string }) {
  const [text, setText] = useState<string | null>(null);
  const commit = () => {
    if (text !== null && text.trim() !== "" && Number.isFinite(Number(text))) onCommit(Number(text));
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
        if (e.key === "Enter") commit();
        else if (e.key === "Escape") setText(null);
      }}
    />
  );
}

/** Health, armor and MR as base + bonus = total; editable for custom numbers. */
function TargetStatsTable({
  base,
  bonus,
  onChange,
  note,
}: {
  base: TargetStats;
  bonus: TargetStats;
  onChange?: (base: TargetStats, bonus: TargetStats) => void;
  note: string;
}) {
  const nonNeg = (v: number) => Math.max(0, Math.round(v) || 0);
  return (
    <div className="stack" style={{ gap: 4 }}>
      <table className={`target-stats${onChange ? " editable" : ""}`}>
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
                    <input
                      type="number"
                      aria-label={`Base ${label.toLowerCase()}`}
                      min={0}
                      step={step}
                      value={base[key]}
                      onChange={(e) => onChange({ ...base, [key]: nonNeg(Number(e.target.value)) }, bonus)}
                    />
                  </td>
                  <td>
                    <input
                      type="number"
                      aria-label={`Bonus ${label.toLowerCase()}`}
                      min={0}
                      step={step}
                      value={bonus[key]}
                      onChange={(e) => onChange(base, { ...bonus, [key]: nonNeg(Number(e.target.value)) })}
                    />
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
