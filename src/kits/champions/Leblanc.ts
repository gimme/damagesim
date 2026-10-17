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
      components: [{ id: 'sigil', label: 'Sigil of Malice', type: 'magic', amount: 'calc.Damage', travel: true }],
    },
    W: {
      dash: true,
      // Busy for the dash; the damage on arrival.
      lockout: 'castTime + reach / missileSpeed',
      components: [{ id: 'distortion', label: 'Distortion', type: 'magic', amount: 'calc.TotalDamage', aoe: true, travel: true }],
    },
    E: {
      cc: [{ kind: 'immobilize', duration: 'dv.RootDuration', delay: 'dv.TetherDuration' }],
      components: [
        { id: 'chain', label: 'Ethereal Chains', type: 'magic', amount: 'calc.InitialDamage', travel: true },
        // TetherDuration after the chain lands.
        { id: 'root', label: 'Ethereal Chains (root)', type: 'magic', amount: 'calc.DelayedDamage', delay: 'dv.TetherDuration', travel: true },
      ],
    },
    R: {
      defaultVariant: 'Q',
      // Mimic casts the same ability (wiki): its range and speed are the copied ability's.
      variants: {
        Q: {
          label: 'Mimic: Sigil of Malice',
          debuff: mimicSigil,
          components: [{ id: 'sigil', label: 'Mimic: Sigil of Malice', type: 'magic', amount: 'calc.RQ1Damage', travel: 'Q.reach / Q.missileSpeed' }],
        },
        W: {
          label: 'Mimic: Distortion',
          dash: true,
          lockout: 'castTime + W.reach / W.missileSpeed',
          components: [{ id: 'distortion', label: 'Mimic: Distortion', type: 'magic', amount: 'calc.RWDamage', aoe: true, travel: 'W.reach / W.missileSpeed' }],
        },
        E: {
          label: 'Mimic: Ethereal Chains',
          cc: [{ kind: 'immobilize', duration: 'E.dv.RootDuration', delay: 'E.dv.TetherDuration' }],
          components: [
            { id: 'chain', label: 'Mimic: Ethereal Chains', type: 'magic', amount: 'calc.RE1Damage', travel: 'E.reach / E.missileSpeed' },
            { id: 'root', label: 'Mimic: Ethereal Chains (root)', type: 'magic', amount: 'calc.RE2Damage', delay: 'E.dv.TetherDuration', travel: 'E.reach / E.missileSpeed' },
          ],
        },
      },
      components: [],
    },
  },
};
export default kit;
