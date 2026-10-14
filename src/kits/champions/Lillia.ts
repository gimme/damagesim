import type { ChampionKit } from '../../engine/kit-types.ts';

// Lillia — patch 16.20.
// Dream Dust: every ability hit applies (refreshes) a 3s burn of % max health magic damage in 6 ticks.
const kit: ChampionKit = {
  id: 'Lillia',
  status: 'curated',
  notes: [
    'Dream Dust is a mark refreshed by any ability hit; it ticks every 0.5s while active (6 ticks per application).',
    'Lilting Lullaby: the wake-up damage is dealt by the next attack/ability hit after R (Dream Dust ticks do not wake). The sleep starts 1.5s after the cast: add wait:1.5 before the waking hit. The Dream Dust requirement is not checked.',
  ],
  marks: [
    {
      id: 'dreamDust',
      label: 'Dream Dust',
      maxStacks: 1,
      duration: 'P.dv.Duration',
      appliedBy: ['ability'],
      dot: {
        interval: 'P.dv.Duration / P.dv.DotTicks',
        components: [{ id: 'dust', label: 'Dream Dust', type: 'magic', amount: 'P.calc.DotPercentTooltip * target.maxHp / P.dv.DotTicks', dot: true }],
      },
    },
  ],
  abilities: {
    Q: {
      notes: ['Outer edge adds the same amount as true damage: Q+edge.'],
      components: [
        { id: 'censer', label: 'Blooming Blows', type: 'magic', amount: 'calc.TotalDamage', aoe: true },
        { id: 'edge', label: 'Blooming Blows (edge)', type: 'true', amount: 'calc.BonusTrueDamage', aoe: true, optional: true, condition: 'target at the outer edge' },
      ],
    },
    W: {
      castTime: 0.767, // the strike lands 0.767s after the cast (wiki); Lillia can't act before
      components: [{ id: 'eep', label: 'Watch Out! Eep!', type: 'magic', amount: 'calc.FlatDamage', aoe: true }],
      variants: {
        center: {
          label: 'center',
          castTime: 0.767,
          components: [{ id: 'eep', label: 'Watch Out! Eep! (center)', type: 'magic', amount: 'calc.FlatDamageSweetSpot', aoe: true }],
        },
      },
    },
    E: {
      cc: [{ kind: 'slow', duration: 'dv.SlowDuration' }],
      components: [{ id: 'seed', label: 'Swirlseed', type: 'magic', amount: 'calc.ImpactDamageTotal', aoe: true, delay: 0.3 }],
    },
    R: {
      cc: [
        { kind: 'slow', duration: 'dv.DrowsyDuration' },
        { kind: 'immobilize', duration: 'dv.SleepDuration', delay: 'dv.DrowsyDuration' }, // sleep after the drowsy phase
      ],
      debuff: {
        id: 'lullaby',
        label: 'Lilting Lullaby',
        duration: 'dv.DrowsyDuration + dv.SleepDuration',
        consume: { by: 'any', components: [{ id: 'wake', label: 'Lilting Lullaby (wake)', type: 'magic', amount: 'R.calc.TotalDamage' }] },
      },
      components: [],
    },
  },
};
export default kit;
