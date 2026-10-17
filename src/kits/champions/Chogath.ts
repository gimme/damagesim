import type { ChampionKit } from '../../engine/kit-types.ts';

// Cho'Gath — patch 16.20.
// Some Rupture/Feral Scream values only exist as spell "effects" (Effect5Amount etc.), which kit
// expressions can't read; those are hard-coded below with their effect index.
const kit: ChampionKit = {
  id: 'Chogath',
  status: 'curated',
  options: [{ key: 'feastStacks', label: 'Feast stacks', default: 0, min: 0, max: 100, description: 'Bonus health per stack (current R rank) and Vorpal Spikes % health.' }],
  buffStacks: { '{8682fc00}': 'opt.feastStacks' },
  notes: [
    'Feast stacks (option feastStacks) grant R.dv.RHealthPerStack max health each at the current R rank (retroactivity assumed) and raise Vorpal Spikes % max health damage.',
    'Vorpal Spikes damage is dealt in addition to the attack.',
  ],
  stats: ({ opt, ranks, evalExpr }) => (ranks.R > 0 && opt.feastStacks > 0 ? { hp: opt.feastStacks * evalExpr('R.dv.RHealthPerStack', 'R') } : {}),
  abilities: {
    Q: {
      cc: [
        { kind: 'immobilize', duration: 1 }, // Effect5Amount
        { kind: 'slow', duration: 1.5 }, // Effect3Amount
      ],
      components: [{ id: 'rupture', label: 'Rupture', type: 'magic', amount: 'calc.TotalDamageTooltip', aoe: true, delay: 0.625 /* Effect4Amount: eruption delay */ }],
    },
    W: {
      cc: [{ kind: 'impair', duration: '1.5 + 0.1 * rank' }], // Effect2Amount = 1.6/1.7/1.8/1.9/2
      components: [{ id: 'scream', label: 'Feral Scream', type: 'magic', amount: 'calc.TotalDamageTooltip', aoe: true }],
    },
    E: {
      resetsAttack: true,
      cc: [{ kind: 'slow', duration: 'dv.SlowDuration' }],
      notes: ['Empowers the next 3 attacks (follow with AA*3).'],
      buff: {
        id: 'vorpalSpikes',
        label: 'Vorpal Spikes',
        duration: 'dv.BuffDuration',
        empowerAttacks: {
          count: 'dv.MaximumAttacks',
          resetsAttack: true,
          // Wiki: the spikes are launched as the attack completes and fly their range.
          components: [{ id: 'spikes', label: 'Vorpal Spikes', type: 'magic', amount: 'E.calc.FlatDamageCalc + E.calc.MaxHealthPercentCalc * target.maxHp', travel: 'E.castRange / E.missileSpeed' }],
        },
      },
    },
    R: {
      components: [{ id: 'feast', label: 'Feast', type: 'true', amount: 'calc.RDamage' }],
    },
  },
};
export default kit;
