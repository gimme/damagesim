import { useEffect, useMemo, useRef, useState } from "react";
import { DATA, loadBundledIcons } from "./data.ts";
import { DEFAULT_STATE, decodePage, encodePage, loadSavedPage, resetState, saveState, scenarioKey, toScenario, type UIState } from "./state.ts";
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
import { ScenarioBar, useScenarios } from "./components/scenarios.tsx";
import { CompareCard } from "./components/compare.tsx";

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

// The page's address is its scenarios' (the champion on screen in the path, the rest in the hash) where the
// server serves the app at any path under its own (the dev server, GitHub Pages by its 404.html), not
// in the artifact build, which can't choose its page's address.
const ROUTED = typeof __ARTIFACT__ === "undefined" || !__ARTIFACT__;
const BASE = import.meta.env.BASE_URL;

/** The page at the page's address, or null. */
const atAddress = () => (location.pathname.startsWith(BASE) ? decodePage(DATA, location.pathname.slice(BASE.length) + location.hash) : null);

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
  const [initial] = useState(() => (ROUTED ? atAddress() : null) ?? loadSavedPage(DATA));
  const [state, setState] = useState<UIState>(initial?.state ?? DEFAULT_STATE);
  const [, setIconsReady] = useState(false);
  const theme = useTheme();
  const scenarios = useScenarios(state, setState, initial?.page ?? null);

  useEffect(() => {
    loadBundledIcons().then((ok) => ok && setIconsReady(true));
  }, []);

  // The address is a link to the scenarios, written over as they change (no history entry for each
  // change), with replaceState, which fires no hashchange.
  const address = useMemo(() => BASE + encodePage(DATA, state, scenarios.page), [state, scenarios.page]);
  const shown = useRef(address);
  useEffect(() => saveState(DATA, state, address.slice(BASE.length)), [state, address]);
  useEffect(() => {
    shown.current = address;
    if (ROUTED && location.href !== new URL(address, location.href).href) history.replaceState(null, "", address);
  }, [address]);
  // A link entered in the address bar on the page with only its hash different reloads nothing, nor
  // do Back and Forward between two such: its scenarios load here. An address that isn't a page's
  // goes back to this one's.
  const { load } = scenarios;
  useEffect(() => {
    if (!ROUTED) return;
    const follow = () => {
      const next = atAddress();
      if (next && BASE + encodePage(DATA, next.state, next.page) !== shown.current) {
        setState(next.state);
        return load(next.page);
      }
      history.replaceState(null, "", shown.current);
    };
    window.addEventListener("hashchange", follow);
    window.addEventListener("popstate", follow);
    return () => {
      window.removeEventListener("hashchange", follow);
      window.removeEventListener("popstate", follow);
    };
  }, [load]);

  // The scenario stays as it was, with what's worked out from it, while what it simulates does
  // (scenarioKey): items moved between slots, a space typed in the combo.
  const next = toScenario(DATA, state);
  const scenario = useMemo(() => next, [scenarioKey(next)]);
  const { result, sim, combo, error } = useMemo(() => {
    try {
      const sim = new Sim(DATA, { ...scenario, combo: [] });
      const combo = clampShorthand(scenario.combo as string, sim);
      return { result: simulate(DATA, { ...scenario, combo }) as SimResult, sim, combo, error: null as string | null };
    } catch (e) {
      return { result: null, sim: null, combo: scenario.combo as string, error: (e as Error).message };
    }
  }, [scenario]);
  // A number set in the combo that the build no longer allows (5 shots after Xerath's R rank drops)
  // becomes what is simulated. A combo typed since with the same steps is left as typed.
  useEffect(() => {
    if (combo !== scenario.combo) setState((s) => ({ ...s, combo }));
  }, [combo, scenario.combo]);

  return (
    <div className="app">
      <header className="topbar">
        <h1>damagesim</h1>
        <span className="badge">patch {DATA.meta.patch}</span>
        <ScenarioBar scenarios={scenarios} />
        <span className="spacer" />
        <button
          className="btn small"
          title={`Reset ${DATA.champions[state.champion].name}: no items, runes or combo, and the rest as on a fresh page`}
          onClick={() => setState(resetState)}
        >
          Reset
        </button>
        <button className="btn small" onClick={theme.toggle} aria-label="Toggle dark mode">
          {theme.dark ? "☀" : "☾"}
        </button>
      </header>
      <div className="layout">
        <div>
          <AttackerPanel state={state} set={setState} sim={sim} />
          {/* A champion's items come and go with it: their undo starts afresh with each */}
          <ItemsPanel key={state.champion} state={state} set={setState} gold={result?.gold ?? 0} sim={sim} />
          <RunesPanel state={state} set={setState} sim={sim} />
          <TargetPanel state={state} set={setState} resolved={result?.target} />
          <SettingsPanel state={state} set={setState} />
        </div>
        <div style={{ minWidth: 0 }}>
          <CompareCard scenarios={scenarios} state={state} result={result} />
          <ComboBuilder state={state} set={setState} sim={sim} result={result} />
          {error && <div className="notice warn">{error}</div>}
          {result && (
            <>
              <Summary r={result} />
              <ItemValueCard state={state} set={setState} scenario={scenario} sim={sim} />
              <Details r={result} scenario={scenario} sim={sim} />
            </>
          )}
          <p className="muted small">Numbers come from the patch {DATA.meta.patch} game files.</p>
          <p className="muted small">
            damagesim isn't endorsed by Riot Games and doesn't reflect the views or opinions of Riot Games or anyone officially involved in producing or
            managing League of Legends. League of Legends and Riot Games are trademarks or registered trademarks of Riot Games, Inc.
          </p>
        </div>
      </div>
    </div>
  );
}
