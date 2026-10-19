// The Settings card.

import { Card } from "./common.tsx";
import type { Set, UIState } from "../state.ts";

/** `setQuestBoots` turns the tier 3 boots on or off for every build, its boots with it (Tabs). */
export function SettingsPanel({ state, set, setQuestBoots }: { state: UIState; set: Set; setQuestBoots: (on: boolean) => void }) {
  const st = state.settings;
  const upd = (p: Partial<UIState["settings"]>) => set((s) => ({ ...s, settings: { ...s.settings, ...p } }));
  return (
    <Card title="Settings">
      <div className="stack">
        <label className="row small" style={{ justifyContent: "space-between" }}>
          Let burns and bleeds finish after the combo
          <input type="checkbox" checked={st.finishDots} onChange={(e) => upd({ finishDots: e.target.checked })} />
        </label>
        <label className="row small" style={{ justifyContent: "space-between" }}>
          Executes kill below their health line
          <input type="checkbox" checked={st.executes} onChange={(e) => upd({ executes: e.target.checked })} />
        </label>
        <label className="row small" style={{ justifyContent: "space-between" }}>
          Tier 3 boots (mid lane quest)
          <input type="checkbox" checked={st.questBoots} onChange={(e) => setQuestBoots(e.target.checked)} />
        </label>
        <label className="row small" style={{ justifyContent: "space-between" }}>
          Components in Item value
          <input type="checkbox" checked={st.components} onChange={(e) => upd({ components: e.target.checked })} />
        </label>
      </div>
    </Card>
  );
}
