import type { ChampionKit } from '../../engine/kit-types.ts';

// Vi — patch 16.20.
const kit: ChampionKit = {
  id: 'Vi',
  status: 'curated',
  notes: [
    'Denting Blows: basic attacks and Vault Breaker add a stack (wiki; Cease and Desist does not). The third stack deals % max health physical damage, shreds armor and grants attack speed.',
  ],
  marks: [
    {
      id: 'dent',
      label: 'Denting Blows',
      slot: 'W',
      maxStacks: 'W.rank > 0 ? W.dv.StacksBeforeEffect + 1 : 99',
      duration: 'W.dv.MarkerBuffDuration',
      appliedBy: ['attack', 'Q'],
      atMax: {
        consume: true,
        components: [{ id: 'dent', label: 'Denting Blows', type: 'physical', amount: 'W.calc.TotalDamageTooltip * target.maxHp', proc: true }],
        buff: { id: 'viW', label: 'Denting Blows', duration: 'W.dv.SharedBuffsDuration', stats: { attackSpeed: 'W.dv.AttackSpeed / 100' } },
        debuff: { id: 'viShred', label: 'Denting Blows (armor shred)', duration: 'W.dv.SharedBuffsDuration', armorReduction: 'W.dv.ShredAmount / 100' },
      },
    },
  ],
  abilities: {
    Q: {
      dash: true,
      // Charged for up to 4s; damage, range and speed grow over the first 1.25s, the damage by 15%
      // per 0.125s (wiki).
      charge: { default: 1.25, max: 4 },
      castTime: 'charge',
      notes: ['Default: fully charged (1.25s). Set the seconds held (Q{0.5s}): the damage grows from min to max over the first 1.25s.'],
      cc: [{ kind: 'immobilize', duration: 'dv.KnockbackDuration' }],
      components: [{ id: 'punch', label: 'Vault Breaker', type: 'physical', amount: 'lerp(calc.TotalDamage, calc.MaxDamageTooltip, min(1, floor(charge * 8) / 10))', aoe: true, delay: 0.2 }],
    },
    W: { noTarget: true, components: [] },
    E: {
      resetsAttack: true,
      notes: [
        'Empowers the next attack: it deals E damage instead of normal attack damage (write "E AA").',
        'A crit adds 100% AD (+ crit damage bonuses) on top (wiki); included as its expected value from crit chance.',
      ],
      buff: {
        id: 'viE',
        label: 'Relentless Force',
        duration: 'dv.AttackBuffDuration',
        empowerAttacks: {
          count: 1,
          replaceBase: true,
          resetsAttack: true,
          components: [
            { id: 'force', label: 'Relentless Force', type: 'physical', amount: 'E.calc.TotalDamageTooltip + critChance * ad * (critDamage - 1)', aoe: true },
          ],
        },
      },
    },
    R: {
      dash: true,
      // Wiki: unable to move or attack during the dash and the 1.05s grab (Relentless Force can be
      // cast): 0.25s cast time + the grab, cast from up close.
      attackLockout: 1.3,
      cc: [{ kind: 'immobilize', duration: 'dv.RStunDuration' }],
      components: [{ id: 'cease', label: 'Cease and Desist', type: 'physical', amount: 'calc.Damage', delay: 0.4 }],
    },
  },
};
export default kit;
