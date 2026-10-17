import type { ChampionKit } from '../../engine/kit-types.ts';

// Vi — patch 16.20.

/** Vault Breaker's dash to the target, where she stops, at its speed; range and speed grow with the charge (wiki). */
const DASH = 'min(distance, dv.MinDashRange + dv.ExtraDashRangeAtMaxCharge * min(1, floor(charge * 8) / 10)) / (1450 + 90 * min(1, floor(charge * 8) / 10))';

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
      // Wiki: on release she dashes 250 to 725 units at 1450 to 1540 speed (not in the data), both
      // growing over the 1.25s charge; Relentless Force and Cease and Desist can be cast during it.
      attackLockout: `charge + ${DASH}`,
      notes: ['Default: fully charged (1.25s). Set the seconds held (Q{0.5s}): the damage grows from min to max over the first 1.25s.'],
      cc: [{ kind: 'immobilize', duration: 'dv.KnockbackDuration' }],
      components: [{ id: 'punch', label: 'Vault Breaker', type: 'physical', amount: 'lerp(calc.TotalDamage, calc.MaxDamageTooltip, min(1, floor(charge * 8) / 10))', aoe: true, travel: DASH }],
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
      // Wiki: she dashes to within 300 units of the target at 800 speed (it ramps up; not modeled), then
      // grabs it for 1.05s, the damage 0.75s into the grab. Unable to move or attack during the dash and
      // the grab: Relentless Force can be cast, but only readies the next attack.
      lockout: 'castTime + max(0, reach - 300) / missileSpeed + 1.05',
      cc: [{ kind: 'immobilize', duration: 'dv.RStunDuration' }],
      components: [{ id: 'cease', label: 'Cease and Desist', type: 'physical', amount: 'calc.Damage', delay: 0.75, travel: 'max(0, reach - 300) / missileSpeed' }],
    },
  },
};
export default kit;
