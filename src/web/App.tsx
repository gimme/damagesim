import { useEffect, useMemo, useRef, useState } from "react";
import { DATA, loadBundledIcons } from "./data.ts";
import { DEFAULT_STATE, decodeState, encodeState, loadSavedState, saveCode, toScenario, type UIState } from "./state.ts";
import { simulate, Sim, type SimResult } from "../engine/sim.ts";
import { clampCombo, formatCombo, parseCombo } from "../engine/combo.ts";
import { AttackerPanel } from "./components/attacker.tsx";
import { ItemsPanel } from "./components/items.tsx";
import { RunesPanel } from "./components/runes.tsx";
import { TargetPanel } from "./components/target.tsx";
import { SettingsPanel } from "./components/settings.tsx";
import { ComboBuilder } from "./components/combo.tsx";
import { Details, Summary } from "./components/results.tsx";
import { ItemValueCard } from "./components/item-value.tsx";
import { Share } from "./components/share.tsx";

function useTheme() {
  const [theme, setTheme] = useState<"light" | "dark" | null>(() => {
    try {
      return (localStorage.getItem("theme") as "light" | "dark" | null) ?? null;
    } catch {
      return null;
    }
  });
  useEffect(() => {
    if (theme) document.documentElement.setAttribute("data-theme", theme);
    else document.documentElement.removeAttribute("data-theme");
    try {
      if (theme) localStorage.setItem("theme", theme);
      else localStorage.removeItem("theme");
    } catch {
      // storage unavailable
    }
  }, [theme]);
  const dark = theme ? theme === "dark" : typeof matchMedia !== "undefined" && matchMedia("(prefers-color-scheme: dark)").matches;
  return { dark, toggle: () => setTheme(dark ? "light" : "dark") };
}

/** The combo with its numbers within what `sim`'s build allows (see clampCombo); unchanged, as typed, when they are. */
function clampShorthand(combo: string, sim: Sim): string {
  try {
    const steps = parseCombo(combo);
    const clamped = clampCombo(steps, (st) => sim.castSetting(st));
    return clamped.some((st, i) => st !== steps[i]) ? formatCombo(clamped) : combo;
  } catch {
    return combo;
  }
}

export function App() {
  const [state, setState] = useState<UIState>(() => decodeState(DATA, location.hash) ?? loadSavedState(DATA) ?? DEFAULT_STATE);
  const [pinned, setPinned] = useState<{ label: string; state: UIState }[]>([]);
  const [, setIconsReady] = useState(false);
  const theme = useTheme();
  const embedded = typeof window !== "undefined" && window.self !== window.top;

  useEffect(() => {
    loadBundledIcons().then((ok) => ok && setIconsReady(true));
  }, []);

  // The hash holds the state's code, so the address is a link to the scenario. Writing it with
  // replaceState fires no hashchange.
  const code = useMemo(() => encodeState(DATA, state), [state]);
  const shown = useRef(code);
  useEffect(() => {
    shown.current = code;
    saveCode(code);
    try {
      if (location.hash !== "#" + code) history.replaceState(null, "", "#" + code);
    } catch {
      // Sandboxed frames may refuse history changes; the state just isn't mirrored to the URL.
    }
  }, [code]);
  // A link pasted into the address bar on the page changes only the hash, which reloads nothing (nor
  // do Back and Forward between two): its scenario loads here. A hash without another one goes back
  // to this one's code.
  useEffect(() => {
    const follow = () => {
      const next = decodeState(DATA, location.hash);
      if (next && encodeState(DATA, next) !== shown.current) return setState(next);
      try {
        history.replaceState(null, "", "#" + shown.current);
      } catch {
        // As above.
      }
    };
    window.addEventListener("hashchange", follow);
    return () => window.removeEventListener("hashchange", follow);
  }, []);

  const scenario = useMemo(() => toScenario(DATA, state), [state]);
  const { result, sim, combo, error } = useMemo(() => {
    try {
      const sim = new Sim(DATA, { ...scenario, combo: [] });
      const combo = clampShorthand(state.combo, sim);
      return { result: simulate(DATA, { ...scenario, combo }) as SimResult, sim, combo, error: null as string | null };
    } catch (e) {
      return { result: null, sim: null, combo: state.combo, error: (e as Error).message };
    }
  }, [scenario]);
  // A number set in the combo that the build no longer allows (5 shots after Xerath's R rank drops)
  // becomes what is simulated.
  useEffect(() => {
    if (combo !== state.combo) setState((s) => ({ ...s, combo }));
  }, [combo, state.combo]);

  const pin = () => {
    const items = state.items.filter((x) => x != null).map((id) => DATA.items[id!]?.name);
    const label = `${DATA.champions[state.champion].name} ${state.level}${items.length ? ": " + items.slice(0, 3).join(", ") + (items.length > 3 ? "…" : "") : ""} · ${state.combo}`;
    setPinned((p) => [...p, { label, state }]);
  };

  return (
    <div className="app">
      <header className="topbar">
        <h1>damagesim</h1>
        <span className="badge">patch {DATA.meta.patch}</span>
        <span className="spacer" />
        <Share code={code} scenario={scenario} embedded={embedded} onLoad={setState} />
        <button className="btn small" onClick={() => setState(DEFAULT_STATE)}>
          Reset
        </button>
        <button className="btn small" onClick={theme.toggle} aria-label="Toggle dark mode">
          {theme.dark ? "☀" : "☾"}
        </button>
      </header>
      <div className="layout">
        <div>
          <AttackerPanel state={state} set={setState} sim={sim} />
          <ItemsPanel state={state} set={setState} gold={result?.gold ?? 0} sim={sim} />
          <RunesPanel state={state} set={setState} sim={sim} />
          <TargetPanel state={state} set={setState} resolved={result?.target} />
          <SettingsPanel state={state} set={setState} />
        </div>
        <div style={{ minWidth: 0 }}>
          <ComboBuilder state={state} set={setState} sim={sim} />
          {error && <div className="notice warn">{error}</div>}
          {result && (
            <>
              <Summary r={result} />
              <ItemValueCard state={state} set={setState} scenario={scenario} sim={sim} />
              <Details
                r={result}
                scenario={scenario}
                sim={sim}
                state={state}
                pinned={pinned}
                onPin={pin}
                onUnpin={(i) => setPinned((p) => p.filter((_, j) => j !== i))}
              />
            </>
          )}
          <p className="muted small">
            Numbers come from the patch {DATA.meta.patch} game files ({DATA.meta.cdragonVersion}). Champions marked “auto kit” have abilities mapped from
            tooltips automatically: per-hit values are exact, hit counts and conditions may not be.
          </p>
          <p className="muted small">
            damagesim isn't endorsed by Riot Games and doesn't reflect the views or opinions of Riot Games or anyone officially involved in producing or
            managing League of Legends. League of Legends and Riot Games are trademarks or registered trademarks of Riot Games, Inc.
          </p>
        </div>
      </div>
    </div>
  );
}
