import { useEffect, useMemo, useState } from 'react';
import { DATA, loadBundledIcons } from './data.ts';
import { DEFAULT_STATE, decodeState, encodeState, loadSavedState, saveState, toScenario, type UIState } from './state.ts';
import { simulate, Sim, type SimResult } from '../engine/sim.ts';
import { AttackerPanel, ComboBuilder, ItemsPanel, RunesPanel, SettingsPanel, TargetPanel } from './components/panels.tsx';
import { Details, Summary } from './components/results.tsx';
import { ItemValueCard } from './components/item-value.tsx';

function useTheme() {
  const [theme, setTheme] = useState<'light' | 'dark' | null>(() => {
    try {
      return (localStorage.getItem('theme') as 'light' | 'dark' | null) ?? null;
    } catch {
      return null;
    }
  });
  useEffect(() => {
    if (theme) document.documentElement.setAttribute('data-theme', theme);
    else document.documentElement.removeAttribute('data-theme');
    try {
      if (theme) localStorage.setItem('theme', theme);
      else localStorage.removeItem('theme');
    } catch {
      // storage unavailable
    }
  }, [theme]);
  const dark = theme ? theme === 'dark' : typeof matchMedia !== 'undefined' && matchMedia('(prefers-color-scheme: dark)').matches;
  return { dark, toggle: () => setTheme(dark ? 'light' : 'dark') };
}

export function App() {
  const [state, setState] = useState<UIState>(() => {
    try {
      return decodeState(location.hash) ?? loadSavedState() ?? DEFAULT_STATE;
    } catch {
      return DEFAULT_STATE;
    }
  });
  const [pinned, setPinned] = useState<{ label: string; state: UIState }[]>([]);
  const [copied, setCopied] = useState<string | null>(null);
  const [, setIconsReady] = useState(false);
  const theme = useTheme();
  const embedded = typeof window !== 'undefined' && window.self !== window.top;

  useEffect(() => {
    loadBundledIcons().then((ok) => ok && setIconsReady(true));
  }, []);

  const copy = (text: string, what: string) => {
    const done = () => {
      setCopied(what);
      setTimeout(() => setCopied(null), 1500);
    };
    navigator.clipboard?.writeText(text).then(done, () => setCopied('Copy failed'));
  };

  useEffect(() => {
    saveState(state);
    const h = '#' + encodeState(state);
    try {
      if (location.hash !== h) history.replaceState(null, '', h);
    } catch {
      // Sandboxed frames may refuse history changes; the state just isn't mirrored to the URL.
    }
  }, [state]);

  const scenario = useMemo(() => toScenario(state), [state]);
  const { result, sim, error } = useMemo(() => {
    try {
      const sim = new Sim(DATA, { ...scenario, combo: [] });
      return { result: simulate(DATA, scenario) as SimResult, sim, error: null as string | null };
    } catch (e) {
      return { result: null, sim: null, error: (e as Error).message };
    }
  }, [scenario]);

  const pin = () => {
    const items = state.items.filter((x) => x != null).map((id) => DATA.items[id!]?.name);
    const label = `${DATA.champions[state.champion].name} ${state.level}${items.length ? ': ' + items.slice(0, 3).join(', ') + (items.length > 3 ? '…' : '') : ''} · ${state.combo}`;
    setPinned((p) => [...p, { label, state }]);
  };

  return (
    <div className="app">
      <header className="topbar">
        <h1>lolsim</h1>
        <span className="badge">patch {DATA.meta.patch}</span>
        <span className="muted small">Damage from the game's own formulas — champions, items, runes, combos.</span>
        <span className="spacer" />
        {!embedded && (
          <button className="btn small" onClick={() => copy(location.href, 'Link copied')}>
            {copied === 'Link copied' ? copied : 'Copy link'}
          </button>
        )}
        <button className="btn small" title="Scenario JSON for the CLI (--scenario) or the MCP simulate tool" onClick={() => copy(JSON.stringify(scenario, null, 2), 'Scenario copied')}>
          {copied && copied !== 'Link copied' ? copied : 'Copy scenario'}
        </button>
        <button className="btn small" onClick={() => setState(DEFAULT_STATE)}>
          Reset
        </button>
        <button className="btn small" onClick={theme.toggle} aria-label="Toggle dark mode">
          {theme.dark ? '☀' : '☾'}
        </button>
      </header>
      <div className="layout">
        <div>
          <AttackerPanel state={state} set={setState} sim={sim} />
          <ItemsPanel state={state} set={setState} gold={result?.gold ?? 0} />
          <RunesPanel state={state} set={setState} />
          <TargetPanel state={state} set={setState} resolved={result?.target} label={result ? `${result.target.label} · effective armor ${result.target.effectiveArmor.toFixed(0)}, MR ${result.target.effectiveMr.toFixed(0)}` : ''} />
          <SettingsPanel state={state} set={setState} />
        </div>
        <div style={{ minWidth: 0 }}>
          <ComboBuilder state={state} set={setState} sim={sim} />
          {error && <div className="notice warn">{error}</div>}
          {result && (
            <>
              <Summary r={result} />
              <ItemValueCard state={state} set={setState} scenario={scenario} />
              <Details r={result} scenario={scenario} sim={sim} state={state} pinned={pinned} onPin={pin} onUnpin={(i) => setPinned((p) => p.filter((_, j) => j !== i))} />
            </>
          )}
          <p className="muted small">
            Numbers come from the patch {DATA.meta.patch} game files ({DATA.meta.cdragonVersion}). Champions marked “auto kit” have abilities mapped from tooltips automatically: per-hit values are exact, hit counts and
            conditions may not be.
          </p>
          <p className="muted small">lolsim isn't endorsed by Riot Games and doesn't reflect the views or opinions of Riot Games or anyone officially involved in producing or managing League of Legends. League of Legends and Riot Games are trademarks or registered trademarks of Riot Games, Inc.</p>
        </div>
      </div>
    </div>
  );
}
