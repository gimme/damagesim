import type { ChampionKit } from '../../engine/kit-types.ts';

// Maokai — patch 16.20.
const kit: ChampionKit = {
  id: 'Maokai',
  status: 'curated',
  notes: ['Sap Magic (self heal and its cooldown refunds) is not modeled.'],
  abilities: {
    Q: {
      // Wiki: locked out for 0.075s after the cast time.
      lockout: 'castTime + 0.075',
      cc: [{ kind: 'slow', duration: 'dv.SlowDuration' }],
      components: [{ id: 'smash', label: 'Bramble Smash', type: 'magic', amount: 'calc.TotalDamage + calc.TotalPercentHealth * target.maxHp', aoe: true, travel: true }],
      variants: {
        close: {
          label: 'point-blank',
          note: 'Target is next to Maokai: also knocked back (dv.KnockbackDistance / dv.KnockbackSpeed seconds airborne).',
          cc: [
            { kind: 'immobilize', duration: 'dv.KnockbackDistance / dv.KnockbackSpeed' },
            { kind: 'slow', duration: 'dv.SlowDuration' },
          ],
          // Next to Maokai: the shockwave hits at once.
          components: [{ id: 'smash', label: 'Bramble Smash', type: 'magic', amount: 'calc.TotalDamage + calc.TotalPercentHealth * target.maxHp', aoe: true }],
        },
      },
    },
    W: {
      dash: true,
      // Busy for the dash; the damage on arrival.
      lockout: 'castTime + castRange / missileSpeed',
      cc: [{ kind: 'immobilize', duration: 'dv.RootDuration' }],
      components: [{ id: 'advance', label: 'Twisted Advance', type: 'magic', amount: 'calc.TotalDamage', travel: true }],
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
      notes: ['Root duration grows with distance travelled (dv.MinRootDuration–dv.MaxRootDuration, the most from 1000 units): fired from 1200 units, the longest.'],
      cc: [{ kind: 'immobilize', duration: 'dv.MaxRootDuration' }],
      // Its 3000 range is treated like a global ability's: fired from 1200 units, as the cast starts
      // (wiki: {{Effect at cast time start}}). The brambles speed up from 100 by 300/s to 750 (wiki):
      // 650 / 300 s accelerating at an average (100 + 750) / 2, then 750 for the rest, ~2.54s.
      components: [{ id: 'grasp', label: "Nature's Grasp", type: 'magic', amount: 'calc.TotalDamage', aoe: true, travel: 'max(0, 650 / 300 + (1200 - (100 + 750) / 2 * 650 / 300) / 750 - castTime)' }],
    },
  },
};
export default kit;
