import { useEffect, useMemo, useRef, useState } from "react";
import { DATA } from "./data.ts";
import { DEMO_STATE, decodePage, encodePage, encodeState, pickChampion, scenarioKey, toScenario, type UIState } from "./state.ts";
import { single, type Page } from "./tabs.ts";
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
import { BuildTabs, useTabs } from "./components/tabs.tsx";

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

// The page's address is its builds' (the champion on screen in the path, the rest in the hash): the
// server serves the app at any path under its own (the dev server, GitHub Pages by its 404.html).
const BASE = import.meta.env.BASE_URL;

/** The page at the page's address: the demo at the app's root, else the one the address holds, or null where it holds none. */
function atAddress(): { state: UIState; page: Page } | null {
  if (!location.pathname.startsWith(BASE)) return null;
  const at = location.pathname.slice(BASE.length) + location.hash;
  return at === "" ? { state: DEMO_STATE, page: single(DEMO_STATE) } : decodePage(DATA, at);
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
  const [initial] = useState(atAddress);
  return initial ? <Main initial={initial} /> : <BadLink />;
}

/** The title, a link to the app's first page, and the patch. */
const Title = () => (
  <>
    <h1>
      <a href={BASE}>damagesim</a>
    </h1>
    <span className="badge">patch {DATA.meta.patch}</span>
  </>
);

/** For an address that isn't a page's: it stays in the address bar, to be looked at; the title leads home. */
function BadLink() {
  return (
    <div className="app">
      <header className="topbar">
        <Title />
      </header>
      <div className="layout">
        <div className="notice warn" role="alert">
          This link couldn't be read. It may be cut short, or from another version of damagesim. <a href={BASE}>Start afresh</a>.
        </div>
      </div>
    </div>
  );
}

function Main({ initial }: { initial: { state: UIState; page: Page } }) {
  const [state, setState] = useState(initial.state);
  const theme = useTheme();
  const tabs = useTabs(state, setState, initial.page);
  const build = tabs.page.builds[tabs.page.active];
  const buildName = tabs.many ? build.name : undefined;

  // The address is a link to the builds, written over as they change (no history entry for each
  // change), with replaceState, which fires no hashchange; a change Back should undo (Reset, a tab
  // closed, another champion) gets an entry of its own.
  const address = useMemo(() => BASE + encodePage(DATA, state, tabs.page), [state, tabs.page]);
  const shown = useRef(address);
  useEffect(() => {
    shown.current = address;
    const push = tabs.push.current;
    tabs.push.current = false;
    if (location.href !== new URL(address, location.href).href) history[push ? "pushState" : "replaceState"](null, "", address);
  });
  // A link entered in the address bar on the page with only its hash different reloads nothing, nor
  // do Back and Forward between two such: its builds load here. An address that isn't a page's
  // goes back to this one's.
  const { load } = tabs;
  useEffect(() => {
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

  // Each champion's page from the picker: a fresh build of theirs with what this page shares (see
  // pickChampion), a link to it for the browser, and opened here on a click.
  const championPage = (id: string) => pickChampion(DATA, state, id);

  return (
    <div className="app">
      <header className="topbar">
        <Title />
        <BuildTabs tabs={tabs} />
        <span className="spacer" />
        <button
          className="btn small"
          title={`Reset ${DATA.champions[state.champion].name}: a fresh page, one build with no items, runes or combo (Back undoes it)`}
          onClick={tabs.reset}
        >
          Reset
        </button>
        <button className="btn small" onClick={theme.toggle} aria-label="Toggle dark mode">
          {theme.dark ? "☀" : "☾"}
        </button>
      </header>
      <div className="layout">
        <div>
          <AttackerPanel
            state={state}
            set={setState}
            sim={sim}
            pick={(id) => tabs.pick(championPage(id))}
            linkTo={(id) => BASE + encodeState(DATA, championPage(id))}
          />
          {/* A build's items come and go with it: their undo starts afresh with each */}
          <ItemsPanel key={`${state.champion}#${build.id}`} state={state} set={setState} gold={result?.gold ?? 0} sim={sim} buildName={buildName} />
          <RunesPanel state={state} set={setState} sim={sim} buildName={buildName} />
          <TargetPanel state={state} set={setState} resolved={result?.target} />
          <SettingsPanel state={state} set={setState} setQuestBoots={tabs.setQuestBoots} />
        </div>
        <div style={{ minWidth: 0 }}>
          <ComboBuilder
            state={state}
            set={setState}
            sim={sim}
            result={result}
            builds={tabs.many ? { name: build.name, own: tabs.page.ownCombos, setOwn: tabs.setOwnCombos } : undefined}
          />
          {error && <div className="notice warn">{error}</div>}
          {result && (
            <>
              <Summary r={result} tabs={tabs} state={state} />
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
