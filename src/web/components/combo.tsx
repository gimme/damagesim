// The Combo card: the steps as chips, dragged into order, with their variants and numbers; or typed as shorthand.

import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { DATA } from "../data.ts";
import { Icon, sourceMark } from "./icons.tsx";
import { useDragOrder } from "./drag.tsx";
import { Card, mergeProps } from "./common.tsx";
import type { Set, UIState } from "../state.ts";
import type { CastSetting, Sim, SimResult } from "../../engine/sim.ts";
import {
  critMarking,
  formatCombo,
  hasPassiveStep,
  markCrit,
  parseCombo,
  settingKey,
  type AbilityStep,
  type ComboStep,
  type CritMode,
} from "../../engine/combo.ts";
import { findItem } from "../../engine/gamedata.ts";
import { ENERGIZED_ITEMS } from "../../engine/items.ts";
import { getKit } from "../../kits/index.ts";
import type { Slot } from "../../engine/effects.ts";

/** Moves step `from` to index `to` of the steps that remain without it. */
const moveStep = <T,>(steps: T[], from: number, to: number) => {
  const next = steps.filter((_, j) => j !== from);
  next.splice(to, 0, steps[from]);
  return next;
};

/**
 * A number a step sets (seconds a cast lasts or charges, the shots it fires, seconds to wait), typed
 * in its chip. Unset, the field is empty with the default as its placeholder, so a click types a
 * number from scratch; emptying it goes back to the default. A number outside what there can be
 * (the first hit, the most) counts as the nearest, and shows as it once the field is left.
 */
function StepNumber({
  value,
  placeholder,
  min = 0,
  max,
  step,
  unit,
  label,
  title,
  onChange,
}: {
  value?: number;
  placeholder: number;
  min?: number;
  max?: number;
  step: number;
  unit: string;
  label: string;
  title: string;
  onChange: (v?: number) => void;
}) {
  const [text, setText] = useState<string | null>(null);
  // Room for the most it takes (1500 units).
  const digits = String(Math.round(max ?? 0)).length;
  return (
    <span className="step-number" title={title}>
      <input
        type="number"
        aria-label={label}
        style={digits > 3 ? { width: `${digits + 1.5}ch` } : undefined}
        value={text ?? value ?? ""}
        placeholder={String(Math.round(placeholder * 100) / 100)}
        min={min}
        max={max}
        step={step}
        onChange={(e) => {
          setText(e.target.value);
          const v = Number(e.target.value);
          if (e.target.value.trim() !== "" && Number.isFinite(v)) onChange(Math.max(min, Math.min(step === 1 ? Math.round(v) : v, max ?? Infinity)));
        }}
        onBlur={() => {
          if (text?.trim() === "") onChange(undefined);
          setText(null);
        }}
        onKeyDown={(e) => (e.key === "Enter" || e.key === "Escape") && e.currentTarget.blur()}
      />
      {unit}
    </span>
  );
}

const SETTING_TITLE: Record<CastSetting["kind"], string> = {
  lasts: "How long it lasts, in seconds",
  held: "How long it charges, in seconds",
  count: "How many it fires",
  distance: "How far the target stands, in units",
};

/** A cast's setting in its step (see CastSetting). */
function CastSettingField({ step, setting, onChange }: { step: AbilityStep; setting: CastSetting; onChange: (s: AbilityStep) => void }) {
  const key = settingKey(setting.kind);
  const num = (x: number) => String(Math.round(x * 100) / 100);
  const { duration: _d, count: _c, distance: _x, ...rest } = step;
  return (
    <StepNumber
      value={step[key]}
      placeholder={setting.value}
      min={setting.min}
      max={setting.max}
      step={setting.kind === "count" ? 1 : setting.kind === "distance" ? 25 : 0.25}
      unit={setting.unit}
      label={`${step.slot} ${setting.unit === "s" ? "seconds" : setting.unit === "u" ? "distance" : setting.unit}`}
      title={`${SETTING_TITLE[setting.kind]}: ${num(setting.min)} to ${num(setting.max)}`}
      onChange={(v) => onChange(v === undefined ? rest : { ...rest, [key]: v })}
    />
  );
}

/**
 * A step's variant: the one it casts, tinted and with a chevron, opening the ability's variants to
 * pick from. A press on it that moves drags its step instead, as anywhere on the step.
 */
function VariantMenu({
  label,
  value,
  options,
  onPick,
}: {
  label: string;
  value: string;
  options: { value: string; label: string }[];
  onPick: (v: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const button = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const id = useId();
  // A press anywhere but in the list closes it, and on the button doesn't open it again.
  const wasOpen = useRef(false);
  useEffect(() => {
    if (!open) return;
    list.current?.focus();
    const close = (e: globalThis.PointerEvent) => !list.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [open]);
  const at = Math.max(
    0,
    options.findIndex((o) => o.value === value),
  );
  const show = () => {
    setActive(at);
    setOpen(true);
  };
  const done = (v?: string) => {
    setOpen(false);
    button.current?.focus();
    if (v != null && v !== value) onPick(v);
  };
  return (
    <span className="step-variant">
      <button
        ref={button}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={`${label}: ${options[at].label}`}
        title="Variant"
        onPointerDown={() => (wasOpen.current = open)}
        onClick={() => {
          const was = wasOpen.current;
          wasOpen.current = false;
          if (was) setOpen(false);
          else show();
        }}
        onKeyDown={(e) => {
          if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
          e.preventDefault();
          show();
        }}
      >
        {options[at].label}
        <svg viewBox="0 0 10 10" aria-hidden>
          <path d="M2 3.5l3 3 3-3" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      {open && (
        <div
          ref={list}
          className="step-variant-list"
          role="listbox"
          tabIndex={-1}
          aria-label={label}
          aria-activedescendant={`${id}-${active}`}
          onKeyDown={(e) => {
            if (e.key === "Tab") return setOpen(false);
            if (e.key === "ArrowDown") setActive((a) => Math.min(options.length - 1, a + 1));
            else if (e.key === "ArrowUp") setActive((a) => Math.max(0, a - 1));
            else if (e.key === "Home") setActive(0);
            else if (e.key === "End") setActive(options.length - 1);
            else if (e.key === "Enter" || e.key === " ") done(options[active].value);
            else if (e.key === "Escape") done();
            else return;
            e.preventDefault();
            e.stopPropagation();
          }}
        >
          {options.map((o, k) => (
            <div
              key={o.value}
              id={`${id}-${k}`}
              role="option"
              aria-selected={k === at}
              className={k === active ? "active" : undefined}
              onPointerEnter={() => setActive(k)}
              onClick={() => done(o.value)}
            >
              {o.label}
            </div>
          ))}
        </div>
      )}
    </span>
  );
}

export function ComboBuilder({ state, set, sim, result }: { state: UIState; set: Set; sim: Sim | null; result: SimResult | null }) {
  const [text, setText] = useState(state.combo);
  // The combo shows as steps; the pencil turns it into its shorthand, typed in place, until Enter,
  // Escape or a click elsewhere.
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
  const spellName = (slot: Slot) => (slot === "P" ? champ.passive.name : (champ.abilities.find((a) => a.slot === slot)?.spells[0]?.name ?? slot));
  const actives = (sim?.effects ?? []).filter((e) => e.active && e.source === "item");
  // Energize steps show the build's first Energized item, and are offered with one.
  const energizer = sim?.items.find((i) => ENERGIZED_ITEMS.includes(i.id));
  const hasP = hasPassiveStep(kit);
  // Crits aren't a setting: the buttons mark the steps that can crit (AA!, Q?), and show how they're
  // marked: none pressed when they differ, the last pick while no step can crit. New steps follow.
  const [lastCrits, setLastCrits] = useState<CritMode>("expected");
  const crits = critMarking(steps, kit) ?? lastCrits;
  const setCrits = (mode: CritMode) => {
    setLastCrits(mode);
    commit(steps.map((st) => markCrit(st, kit, mode)));
  };
  const follow = (st: ComboStep) => (crits === "mixed" ? st : markCrit(st, kit, crits));
  const add = (st: ComboStep) => commit([...steps, follow(st)]);
  // An item step's item; none when it isn't found.
  const stepItem = (st: ComboStep) => {
    if (st.type !== "item") return null;
    try {
      return findItem(DATA, st.item);
    } catch {
      return null;
    }
  };
  // A step as its shorthand, or for an item's active as its key names it: the active's name, the
  // item's while it isn't bought.
  const label = (st: ComboStep) => {
    const it = stepItem(st);
    return it ? (actives.find((e) => e.id === `item:${it.id}`)?.active?.label ?? it.name) : formatCombo([st]);
  };
  // A step's label in its chip, without the number its field shows.
  const chipLabel = (st: ComboStep) =>
    st.type === "ability" ? label({ ...st, duration: undefined, count: undefined, distance: undefined }) : st.type === "wait" ? "wait" : label(st);
  // A step's icon, as its damage shows it in the results; none for a wait or an item not found.
  const icon = (source: string, name: string, size: "xs" | "sm", castPath?: string) => (
    <Icon src={sourceMark(source, name, state.champion, castPath).icon} label={name} size={size} />
  );
  // How each ability step was cast, by its index: in the form or state it was in (W:ruin in
  // Transcendent State), its icon and setting that one's. A key's step being dragged in looks like
  // the key, cast at the end of the combo. Nothing changes until a step is let go: one that changed
  // as it moved (Nidalee's Q gaining its distance field) would move what it's over, and its spot.
  const casts = new Map((result?.timeline ?? []).flatMap((t) => (t.index !== undefined ? [[t.index, t] as const] : [])));
  const castAt = (st: ComboStep, i: number) =>
    st.type !== "ability" ? undefined : i === steps.length ? result?.keyCasts[steps.length]?.[st.slot as Exclude<Slot, "P">] : casts.get(i);
  const asCast = (st: ComboStep, i: number) => {
    const variant = castAt(st, i)?.variant;
    return st.type === "ability" && !st.variant && variant ? { ...st, variant } : st;
  };
  const stepIcon = (st: ComboStep, i: number) => {
    if (st.type === "ability") return icon(st.slot, spellName(st.slot), "xs", castAt(st, i)?.icon ?? sim?.slotIcon(st.slot));
    if (st.type === "attack") return icon("AA", "Basic attack", "xs");
    if (st.type === "summoner") return icon("summoner:ignite", "Ignite", "xs");
    if (st.type === "energize") return energizer && icon(`item:${energizer.id}`, "Energize", "xs");
    const it = stepItem(st);
    return it && icon(`item:${it.id}`, it.name, "xs");
  };
  // A key adds its step at the end, or dragged into the steps, where it's let go: meanwhile its step
  // is the last one shown, and lands among the others like a step moved there.
  const [incoming, setIncoming] = useState<ComboStep | null>(null);
  const shown = incoming ? [...steps, incoming] : steps;
  // A step is dragged to its new place, the others sliding aside to open the gap it will land in.
  // Arrow keys move a focused step, Delete removes it; focus stays on it, or on the next one.
  const order = useDragOrder({
    count: shown.length,
    arrange: (from, to) =>
      moveStep(
        shown.map((_, j) => j),
        from,
        to,
      ),
    // Where it's nearest: on the line nearest its middle, however the pointer drifts up or down, after
    // the steps there whose middle its left edge is past, or its right edge for a step after the gap
    // it leaves on its own line. So a step it's dragged over makes way once half covered, either way.
    landAt: (x, y, cells, at) => {
      const d = cells[at];
      // The cells by line, as laid out: one left of the one before it starts a new line.
      const lines: number[][] = [];
      cells.forEach((c, k) => (k && c.x >= cells[k - 1].x ? lines[lines.length - 1].push(k) : lines.push([k])));
      const top = (l: number[]) => Math.min(...l.map((k) => cells[k].y));
      const bottom = (l: number[]) => Math.max(...l.map((k) => cells[k].y + cells[k].h));
      let n = 0;
      while (n < lines.length - 1 && y > (bottom(lines[n]) + top(lines[n + 1])) / 2) n++;
      const own = lines[n].includes(at);
      const above = lines
        .slice(0, n)
        .flat()
        .filter((k) => k !== at).length;
      return above + lines[n].filter((k) => k !== at && (own && k > at ? x + d.w / 2 : x - d.w / 2) > cells[k].x + cells[k].w / 2).length;
    },
    move: (from, to) => {
      setIncoming(null);
      commit(moveStep(shown, from, to));
    },
  });
  const drag = order.drag;
  // What the keys cast added at the end (Elise's Q after her R: Venomous Bite).
  const atEnd = result?.keyCasts[steps.length];
  const keys: { key: string; step: ComboStep; title: string; icon?: ReactNode; text: string }[] = [
    ...(["Q", "W", "E", "R"] as Slot[]).map((s) => ({
      key: s,
      step: { type: "ability", slot: s } as ComboStep,
      title: atEnd?.[s]?.name ?? spellName(s),
      icon: icon(s, atEnd?.[s]?.name ?? spellName(s), "sm", atEnd?.[s]?.icon ?? sim?.slotIcon(s)),
      text: s,
    })),
    ...(hasP
      ? [{ key: "P", step: { type: "ability", slot: "P" } as ComboStep, title: champ.passive.name, icon: icon("P", champ.passive.name, "sm"), text: "P" }]
      : []),
    { key: "AA", step: { type: "attack" }, title: "Basic attack", icon: icon("AA", "Basic attack", "sm"), text: "AA" },
    { key: "ignite", step: { type: "summoner", spell: "ignite" }, title: "Ignite", icon: icon("summoner:ignite", "Ignite", "sm"), text: "Ignite" },
    ...(energizer
      ? [
          {
            key: "energize",
            step: { type: "energize" } as ComboStep,
            title: "Energize: charges full, as moving and attacking make them, so the next attack fires your Energized items",
            icon: icon(`item:${energizer.id}`, "Energize", "sm"),
            text: "Energize",
          },
        ]
      : []),
    ...actives.map((e) => ({
      key: e.id,
      step: { type: "item", item: e.label } as ComboStep,
      title: `${e.label} active`,
      icon: icon(e.id, e.label, "sm"),
      text: e.active!.label,
    })),
    { key: "wait", step: { type: "wait" }, title: "Wait, 1 second unless you set it", text: "Wait" },
  ];

  return (
    <Card
      title="Combo"
      right={
        <div className="row" style={{ gap: 6 }}>
          <span className="small secondary">Crits</span>
          <div
            className="segmented small"
            role="group"
            aria-label="Crits"
            title="Expected: hits that can crit deal their average damage. Always (!) or never (?): marks every step that can crit."
          >
            {(["expected", "always", "never"] as const).map((c) => (
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
        {keys.map((k) => (
          <button
            key={k.key}
            className="combo-key"
            title={k.title}
            {...order.source((on) => setIncoming(on ? follow(k.step) : null))}
            onClick={() => add(k.step)}
          >
            {k.icon}
            {k.text}
          </button>
        ))}
      </div>
      {!typing ? (
        <div
          className={`combo-seq ${incoming ? "receiving" : ""} ${incoming && !drag?.away ? "over" : ""}`}
          ref={order.box}
          style={{ marginTop: 10 }}
          role="list"
          aria-label="Combo sequence"
        >
          {shown.map((st, i) => {
            // Not those cast by themselves in a state (Yunara's W and E in Transcendent State).
            const variants = st.type === "ability" ? Object.entries(kit.abilities[st.slot]?.variants ?? {}).filter(([, v]) => v.when === undefined) : [];
            const cast = asCast(st, i);
            const setting = cast.type === "ability" ? sim?.castSetting(cast) : null;
            const replace = (next: ComboStep) => commit(steps.map((x, j) => (j === i ? next : x)));
            // A step that does nothing now (its item sold, a P the champion hasn't) stays, muted, for when it applies again.
            const skip = sim?.skipReason(st);
            return (
              <span
                key={i}
                className={`chip ${drag?.from === i ? "dragging" : ""} ${drag?.from === i && drag.away ? "away" : ""} ${skip ? "inert" : ""}`}
                title={skip ? `Skipped: ${skip}` : undefined}
                role="listitem"
                tabIndex={0}
                aria-label={`Step ${i + 1} of ${steps.length}: ${label(st)}${skip ? `, skipped: ${skip}` : ""}. Arrow keys move it, Delete removes it.`}
                {...mergeProps(order.item(i), {
                  onKeyDown: (e: KeyboardEvent) => {
                    if (e.target !== e.currentTarget || (e.key !== "Delete" && e.key !== "Backspace")) return;
                    e.preventDefault();
                    order.focusLater(Math.min(i, steps.length - 2));
                    commit(steps.filter((_, j) => j !== i));
                  },
                })}
              >
                {stepIcon(st, i)}
                {variants.length > 0 && st.type === "ability" ? (
                  <VariantMenu
                    label={`${st.slot} variant`}
                    value={st.variant ?? ""}
                    options={[
                      { value: "", label: chipLabel({ ...st, variant: undefined }) },
                      ...variants.map(([k, v]) => ({ value: k, label: `${chipLabel({ ...st, variant: undefined })}: ${v.label}` })),
                    ]}
                    onPick={(v) => replace(follow({ ...st, variant: v || undefined }))}
                  />
                ) : (
                  <span
                    title={
                      skip
                        ? `Skipped: ${skip}`
                        : st.type === "ability"
                          ? spellName(st.slot)
                          : st.type === "item"
                            ? `${stepItem(st)?.name ?? st.item} active`
                            : undefined
                    }
                  >
                    {chipLabel(st)}
                  </span>
                )}
                {st.type === "ability" && setting && <CastSettingField step={st} setting={setting} onChange={replace} />}
                {st.type === "wait" && (
                  <StepNumber
                    value={st.seconds}
                    placeholder={1}
                    step={0.25}
                    unit="s"
                    label="Seconds to wait"
                    title="Seconds to wait"
                    onChange={(v) => replace(v === undefined ? { type: "wait" } : { ...st, seconds: v })}
                  />
                )}
                <button className="step-remove" aria-label="Remove step" tabIndex={-1} onClick={() => commit(steps.filter((_, j) => j !== i))}>
                  ✕
                </button>
              </span>
            );
          })}
          {!steps.length && !(incoming && !drag?.away) && <span className="muted small">Click or drag abilities here to build a combo.</span>}
          <button
            className="combo-edit"
            style={drag ? { order: shown.length } : undefined}
            aria-label="Edit as text"
            title="Edit as text"
            onClick={startTyping}
          >
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
          onKeyDown={(e) => (e.key === "Enter" || e.key === "Escape") && e.currentTarget.blur()}
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
        <div className="small" style={{ marginTop: 4, color: "var(--critical)" }}>
          {textError}
        </div>
      )}
      {parsed.error && <div className="notice warn small">{parsed.error}</div>}
    </Card>
  );
}
