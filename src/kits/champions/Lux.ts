import type { ChampionKit, DebuffSpec } from '../../engine/kit-types.ts';

// Lux — patch 16.20.
// Illumination: damaging abilities mark the target; Lux's next attack (or Final Spark) detonates it.
const illumination: DebuffSpec = {
  id: 'illumination',
  label: 'Illumination',
  duration: 'P.dv.DebuffDuration',
  consume: { by: ['attack', 'R'], slot: 'P', components: [{ id: 'detonate', label: 'Illumination', type: 'magic', amount: 'P.calc.TotalDamage', noProc: true }] },
};

const kit: ChampionKit = {
  id: 'Lux',
  status: 'curated',
  abilities: {
    Q: {
      cc: [{ kind: 'immobilize', duration: 'dv.RootDuration' }],
      debuff: illumination,
      components: [{ id: 'bind', label: 'Light Binding', type: 'magic', amount: 'calc.TotalDamageTT', delay: 0.4 }],
    },
    W: { noTarget: true, components: [] },
    E: {
      cc: [{ kind: 'slow', duration: 'dv.SlowZoneDuration' }],
      debuff: illumination,
      notes: ['Detonation assumed recast immediately (≈0.5s after cast).'],
      components: [{ id: 'detonate', label: 'Lucent Singularity', type: 'magic', amount: 'calc.TotalDamageTT', aoe: true, delay: 0.5 }],
    },
    R: {
      debuff: illumination,
      components: [{ id: 'spark', label: 'Final Spark', type: 'magic', amount: 'calc.TotalDamage', aoe: true, delay: 0.1 }],
    },
  },
};
export default kit;
