import type { ChampionKit } from '../../engine/kit-types.ts';

// Maokai — patch 16.20.
const kit: ChampionKit = {
  id: 'Maokai',
  status: 'curated',
  notes: ['Sap Magic (self heal and its cooldown refunds) is not modeled.'],
  abilities: {
    Q: {
      // Wiki: locked out for 0.075s after the 0.375s cast time.
      lockout: 0.45,
      cc: [{ kind: 'slow', duration: 'dv.SlowDuration' }],
      components: [{ id: 'smash', label: 'Bramble Smash', type: 'magic', amount: 'calc.TotalDamage + calc.TotalPercentHealth * target.maxHp', aoe: true }],
      variants: {
        close: {
          label: 'point-blank',
          note: 'Target is next to Maokai: also knocked back (dv.KnockbackDistance / dv.KnockbackSpeed seconds airborne).',
          cc: [
            { kind: 'immobilize', duration: 'dv.KnockbackDistance / dv.KnockbackSpeed' },
            { kind: 'slow', duration: 'dv.SlowDuration' },
          ],
          components: [{ id: 'smash', label: 'Bramble Smash', type: 'magic', amount: 'calc.TotalDamage + calc.TotalPercentHealth * target.maxHp', aoe: true }],
        },
      },
    },
    W: {
      dash: true,
      cc: [{ kind: 'immobilize', duration: 'dv.RootDuration' }],
      components: [{ id: 'advance', label: 'Twisted Advance', type: 'magic', amount: 'calc.TotalDamage', delay: 0.3 }],
    },
    E: {
      notes: [
        'Default: sapling thrown at the target (outside brush), detonating after it grows (dv.GrowthDuration).',
        'Variant E:brush: empowered brush sapling, damage spread evenly over dv.EmpoweredDoTDuration (assumed 4 ticks per second).',
      ],
      cc: [{ kind: 'slow', duration: 'dv.SlowDuration' }],
      components: [{ id: 'sapling', label: 'Sapling Toss', type: 'magic', amount: 'calc.TotalDamage', delay: 'dv.GrowthDuration', aoe: true }],
      variants: {
        brush: {
          label: 'brush',
          cc: [{ kind: 'slow', duration: 'dv.EmpoweredDoTDuration' }],
          components: [
            {
              id: 'sapling',
              label: 'Sapling Toss (brush)',
              type: 'magic',
              amount: 'calc.TotalEmpoweredDamage / (dv.EmpoweredDoTDuration * 4)',
              hits: 'dv.EmpoweredDoTDuration * 4',
              interval: 0.25,
              delay: 'dv.GrowthDuration',
              aoe: true,
              dot: true,
            },
          ],
        },
      },
    },
    R: {
      notes: ['Root duration grows with distance travelled (dv.MinRootDuration–dv.MaxRootDuration); the midpoint is assumed.'],
      cc: [{ kind: 'immobilize', duration: '(dv.MinRootDuration + dv.MaxRootDuration) / 2' }],
      components: [{ id: 'grasp', label: "Nature's Grasp", type: 'magic', amount: 'calc.TotalDamage', delay: 0.5, aoe: true }],
    },
  },
};
export default kit;
