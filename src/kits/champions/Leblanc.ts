import type { ChampionKit, DebuffSpec } from '../../engine/kit-types.ts';

// LeBlanc — patch 16.20.
// Sigil of Malice marks the target; LeBlanc's next damaging ability (from another cast) detonates it.
// The mimicked sigil (R:Q) is a separate mark with its own detonation damage.
const sigil: DebuffSpec = {
  id: 'sigil',
  label: 'Sigil of Malice',
  duration: 'dv.MarkDuration',
  consume: { by: 'ability', components: [{ id: 'detonate', label: 'Sigil of Malice (detonation)', type: 'magic', amount: 'Q.calc.MarkDamage' }] },
};
const mimicSigil: DebuffSpec = {
  id: 'mimicSigil',
  label: 'Mimic: Sigil of Malice',
  duration: 'dv.RQMarkDuration',
  consume: { by: 'ability', components: [{ id: 'detonate', label: 'Mimic: Sigil of Malice (detonation)', type: 'magic', amount: 'R.calc.RQ2Damage' }] },
};

const kit: ChampionKit = {
  id: 'Leblanc',
  status: 'curated',
  notes: [
    'Sigils are detonated by the next ability damage from a different cast (W, E, R, or the other sigil).',
    'Ethereal Chains: the root and second hit are on by default (tether not broken, 1.5s later). Disable the second hit with E{root:0}.',
    'Mimic copies the last basic ability: choose it with R:Q (default), R:W or R:E.',
  ],
  abilities: {
    Q: {
      debuff: sigil,
      components: [{ id: 'sigil', label: 'Sigil of Malice', type: 'magic', amount: 'calc.Damage', delay: 0.2 }],
    },
    W: {
      dash: true,
      components: [{ id: 'distortion', label: 'Distortion', type: 'magic', amount: 'calc.TotalDamage', aoe: true, delay: 0.3 }],
    },
    E: {
      cc: [{ kind: 'immobilize', duration: 'dv.RootDuration', delay: 'dv.TetherDuration' }],
      components: [
        { id: 'chain', label: 'Ethereal Chains', type: 'magic', amount: 'calc.InitialDamage', delay: 0.3 },
        { id: 'root', label: 'Ethereal Chains (root)', type: 'magic', amount: 'calc.DelayedDamage', delay: '0.3 + dv.TetherDuration' },
      ],
    },
    R: {
      defaultVariant: 'Q',
      variants: {
        Q: {
          label: 'Mimic: Sigil of Malice',
          debuff: mimicSigil,
          components: [{ id: 'sigil', label: 'Mimic: Sigil of Malice', type: 'magic', amount: 'calc.RQ1Damage', delay: 0.2 }],
        },
        W: {
          label: 'Mimic: Distortion',
          dash: true,
          components: [{ id: 'distortion', label: 'Mimic: Distortion', type: 'magic', amount: 'calc.RWDamage', aoe: true, delay: 0.3 }],
        },
        E: {
          label: 'Mimic: Ethereal Chains',
          cc: [{ kind: 'immobilize', duration: 'E.dv.RootDuration', delay: 'E.dv.TetherDuration' }],
          components: [
            { id: 'chain', label: 'Mimic: Ethereal Chains', type: 'magic', amount: 'calc.RE1Damage', delay: 0.3 },
            { id: 'root', label: 'Mimic: Ethereal Chains (root)', type: 'magic', amount: 'calc.RE2Damage', delay: '0.3 + E.dv.TetherDuration' },
          ],
        },
      },
      components: [],
    },
  },
};
export default kit;
