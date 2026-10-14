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
        components: [{ id: 'dent', label: 'Denting Blows', type: 'physical', amount: 'W.calc.TotalDamageTooltip * target.maxHp', noProc: true }],
        buff: { id: 'viW', label: 'Denting Blows', duration: 'W.dv.SharedBuffsDuration', stats: { attackSpeed: 'W.dv.AttackSpeed / 100' } },
        debuff: { id: 'viShred', label: 'Denting Blows (armor shred)', duration: 'W.dv.SharedBuffsDuration', armorReduction: 'W.dv.ShredAmount / 100' },
      },
    },
  ],
  abilities: {
    Q: {
      dash: true,
      // Damage, range and speed max out after 1.25s of charging (wiki).
      castTime: 1.25,
      notes: ['Default: fully charged (1.25s). "Q:quick" = released immediately (minimum damage).'],
      cc: [{ kind: 'immobilize', duration: 'dv.KnockbackDuration' }],
      components: [{ id: 'punch', label: 'Vault Breaker (charged)', type: 'physical', amount: 'calc.MaxDamageTooltip', aoe: true, delay: 0.2 }],
      variants: {
        quick: {
          label: 'quick',
          castTime: 0,
          dash: true,
          cc: [{ kind: 'immobilize', duration: 'dv.KnockbackDuration' }],
          components: [{ id: 'punch', label: 'Vault Breaker', type: 'physical', amount: 'calc.TotalDamage', aoe: true, delay: 0.2 }],
        },
      },
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
      cc: [{ kind: 'immobilize', duration: 'dv.RStunDuration' }],
      components: [{ id: 'cease', label: 'Cease and Desist', type: 'physical', amount: 'calc.Damage', delay: 0.4 }],
    },
  },
};
export default kit;
