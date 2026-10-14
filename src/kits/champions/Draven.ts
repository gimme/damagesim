import type { ChampionKit } from '../../engine/kit-types.ts';

// Draven — patch 16.20.
const kit: ChampionKit = {
  id: 'Draven',
  status: 'curated',
  options: [
    { key: 'axeCatches', label: 'Spinning Axes caught per Q', default: 2, min: 0, max: 20, description: 'Each catch re-empowers one more attack.' },
    { key: 'adoration', label: 'League of Draven (Adoration) stacks', default: 0, min: 0, max: 2000, description: 'Whirling Death executes champions below this much health.' },
  ],
  buffStacks: { '{577427b5}': 'opt.adoration' },
  notes: [
    'Spinning Axe: Q empowers 1 + axeCatches attacks (option) with bonus physical damage on top of the attack; the bonus is assumed not to crit.',
    'Whirling Death hits a lone champion twice (out and back, full damage each — the per-enemy reduction resets on reversal) and executes it if left below the Adoration stacks (option adoration).',
  ],
  abilities: {
    Q: {
      buff: {
        id: 'spinningAxe',
        label: 'Spinning Axe',
        duration: 'dv.AxeDuration * (1 + opt.axeCatches)',
        empowerAttacks: {
          count: '1 + opt.axeCatches',
          components: [{ id: 'axe', label: 'Spinning Axe', type: 'physical', amount: 'Q.calc.TotalDamage' }],
        },
      },
      noTarget: true,
    },
    W: {
      noTarget: true,
      buff: { id: 'bloodRush', label: 'Blood Rush', duration: 'dv.AttackSpeedDuration', stats: { attackSpeed: 'dv.AttackSpeed' } },
    },
    E: {
      cc: [
        { kind: 'immobilize', duration: 'dv.KnockbackDuration' },
        { kind: 'slow', duration: 'dv.SlowDuration' },
      ],
      components: [{ id: 'standAside', label: 'Stand Aside', type: 'physical', amount: 'calc.TotalDamage', aoe: true, delay: 0.25 }],
    },
    R: {
      components: [
        { id: 'out', label: 'Whirling Death (out)', type: 'physical', amount: 'calc.RCalculatedDamage', aoe: true, delay: 0.5 },
        { id: 'back', label: 'Whirling Death (return)', type: 'physical', amount: 'calc.RCalculatedDamage', aoe: true, delay: 1.0 },
        {
          id: 'execute',
          label: 'Whirling Death (execute)',
          type: 'true',
          amount: 'target.hp < calc.RPassiveTrueDamage ? target.hp : 0',
          hits: 'opt.adoration > 0 ? 1 : 0',
          delay: 1.0,
          condition: 'target below Adoration stacks',
          note: 'Execute after the return hit',
        },
      ],
    },
  },
};
export default kit;
