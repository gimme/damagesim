import type { ChampionKit } from '../../engine/kit-types.ts';

// Garen — patch 16.20.
const kit: ChampionKit = {
  id: 'Garen',
  status: 'curated',
  abilities: {
    Q: {
      resetsAttack: true,
      notes: ['Empowers the next attack: it deals Q damage instead of normal attack damage (follow Q with AA).'],
      buff: {
        id: 'garenQ',
        label: 'Decisive Strike',
        duration: 'dv.AttackWindow',
        empowerAttacks: {
          count: 1,
          replaceBase: true,
          resetsAttack: true,
          components: [{ id: 'strike', label: 'Decisive Strike', type: 'physical', amount: 'Q.calc.TotalDamage' }],
        },
      },
    },
    E: {
      notes: [
        'Spins 7 times plus 1 per 25% bonus attack speed; the nearest enemy (a single target always is) takes 25% more.',
        'Each spin can crit for +30% of bonus crit damage. 6 spins shred 25% armor for 6s.',
      ],
      // Wiki: unable to declare attacks while spinning (the full 3s; ending it early isn't modeled).
      attackLockout: 'dv.Duration',
      debuff: { id: 'garenE', label: 'Judgment shred', duration: 'dv.ShredDuration', armorReduction: 'dv.ShredAmount', afterHits: 6 },
      components: [
        {
          id: 'spin',
          label: 'Spin',
          type: 'physical',
          amount: 'calc.TotalDamage * (1 + dv.NearestEnemyBonus)',
          hits: 'dv.NumTicks + floor(bonusAs / dv.ASPerTick)',
          interval: 'dv.Duration / (dv.NumTicks + floor(bonusAs / dv.ASPerTick))',
          canCrit: true,
          critMultiplier: '1 + dv.CritMod * (critDamage - 1)',
          aoe: true,
        },
      ],
    },
    R: {
      components: [{ id: 'justice', label: 'Demacian Justice', type: 'true', amount: 'dv.BaseDamage + dv.ExecuteDamage * target.missingHp', delay: 0.1 }],
    },
  },
};
export default kit;
