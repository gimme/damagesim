// What every card shares: its frame, a number field, number formatting, prop merging, undo and a
// chevron. Icons, pickers, hover cards and drag and drop have their own files.

import { useState, type ReactNode } from "react";

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

/** A card's title, with the name of the build what's in it is the own of, while there are several. */
export const BuildTitle = ({ title, build }: { title: string; build?: string }) => (
  <>
    {title} {build && <span className="build-of">{build}</span>}
  </>
);

/** A chevron pointing down: Show more's and the comparison's fold's, turned by their CSS as they open, and a sorted column's. */
export const Chevron = () => (
  <svg className="chevron" viewBox="0 0 10 10" aria-hidden>
    <path d="M2 3.5 5 6.5 8 3.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

export function NumberField({
  label,
  value,
  onChange,
  step = 1,
  min,
  max,
  width,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  step?: number;
  min?: number;
  max?: number;
  width?: number;
}) {
  return (
    <label className="field">
      {label}
      <input
        type="number"
        value={Number.isFinite(value) ? value : 0}
        step={step}
        min={min}
        max={max}
        style={width ? { width } : undefined}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </label>
  );
}

export const fmt = (v: number, d = 0) => (Number.isFinite(v) ? v.toLocaleString(undefined, { maximumFractionDigits: d, minimumFractionDigits: d }) : "–");

/** One element's props from several sources: the handlers for the same event all run, in order. */
export function mergeProps(...all: Record<string, unknown>[]) {
  const out: Record<string, unknown> = {};
  for (const props of all)
    for (const [k, v] of Object.entries(props)) {
      const was = out[k];
      out[k] = /^on[A-Z]/.test(k) && typeof was === "function" && typeof v === "function" ? (...a: unknown[]) => (was(...a), v(...a)) : v;
    }
  return out;
}

/**
 * Undo and redo for a value, whatever changes it: each change that isn't an undo or redo is a step
 * back, and drops the steps forward. `set` puts a value back. The last 100 steps are kept.
 */
export function useHistory<T>(value: T, set: (v: T) => void, same: (a: T, b: T) => boolean) {
  const [h, setH] = useState({ past: [] as T[], future: [] as T[], at: value });
  if (h.at !== value) setH(same(h.at, value) ? { ...h, at: value } : { past: [...h.past, h.at].slice(-100), future: [], at: value });
  const go = (from: T[], to: T[], back: boolean) => {
    const v = from[from.length - 1];
    const rest = { from: from.slice(0, -1), to: [...to, h.at] };
    setH(back ? { past: rest.from, future: rest.to, at: v } : { past: rest.to, future: rest.from, at: v });
    set(v);
  };
  return {
    canUndo: h.past.length > 0,
    canRedo: h.future.length > 0,
    undo: () => h.past.length && go(h.past, h.future, true),
    redo: () => h.future.length && go(h.future, h.past, false),
  };
}
