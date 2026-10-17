// The Settings card.

import { Card } from './common.tsx';
import type { Set, UIState } from '../state.ts';

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
