import type { ChampionKit } from '../../engine/kit-types.ts';

// Shen — patch 16.20.
const kit: ChampionKit = {
  id: 'Shen',
  status: 'curated',
  notes: ['Ki Barrier shield, Spirit\'s Refuge and Stand United deal no damage and are not modeled beyond casting.'],
  abilities: {
    Q: {
      notes: [
        'Default: the Spirit Blade passes through the enemy champion — next 3 attacks deal the empowered % max health damage and Shen gains attack speed for them. Use Q:miss when the blade does not hit. Write "Q AA AA AA".',
      ],
      cc: [{ kind: 'slow', duration: 'dv.SlowDuration' }],
      buff: {
        id: 'shenQ',
        label: 'Twilight Assault',
        duration: 'dv.AttackBuffDuration',
        stats: { attackSpeed: 'dv.SteroidAS / 100' },
        empowerAttacks: {
          count: 'dv.NumEnhancedAttacks',
          components: [{ id: 'assault', label: 'Twilight Assault', type: 'magic', amount: 'Q.calc.BaseFlatDamage + Q.calc.EmpPercentHealth * target.maxHp', proc: true }],
        },
      },
      components: [],
      variants: {
        miss: {
          label: 'miss',
          cc: [],
          buff: {
            id: 'shenQ',
            label: 'Twilight Assault',
            duration: 'dv.AttackBuffDuration',
            empowerAttacks: {
              count: 'dv.NumEnhancedAttacks',
              components: [{ id: 'assault', label: 'Twilight Assault', type: 'magic', amount: 'Q.calc.BaseFlatDamage + Q.calc.BasePercentHealth * target.maxHp', proc: true }],
            },
          },
          components: [],
        },
      },
    },
    W: { noTarget: true, components: [] },
    E: {
      dash: true,
      cc: [{ kind: 'immobilize', duration: 'dv.CCDuration' }],
      components: [{ id: 'dash', label: 'Shadow Dash', type: 'physical', amount: 'calc.TauntDamage', aoe: true, delay: 0.2 }],
    },
    R: { noTarget: true, components: [] },
  },
};
export default kit;
