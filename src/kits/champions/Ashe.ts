import type { ChampionKit } from '../../engine/kit-types.ts';

// Ashe — patch 16.20.
// Frost Shot: Ashe's attacks can't crit; instead they deal P.calc.DamageBonus × AD
// (1 + (1 + bonus crit damage) × crit chance) and slow.
const kit: ChampionKit = {
  id: 'Ashe',
  status: 'curated',
  notes: [
    "Frost Shot: attacks never crit; crit chance raises every attack's damage instead (P.calc.DamageBonus). Attacks and abilities slow.",
    "Ranger's Focus is assumed ready (4 Focus stacks from previous attacks).",
  ],
  attack: { canCrit: false, damageMult: 'P.calc.DamageBonus' },
  abilities: {
    P: { notes: ['Damage bonus from crit chance is applied to every attack (attack.damageMult).'] },
    Q: {
      noTarget: true,
      notes: [
        "Attacks deal Q.calc.EmpoweredDamage (× Frost Shot's crit bonus) as a flurry of 5 arrows: on-hit effects apply once, the other 4 arrows are non-reactive hits.",
        'The first flurry of each cast firing a 6th arrow (+20%, wiki) is not modeled.',
      ],
      buff: {
        id: 'rangersFocus',
        label: "Ranger's Focus",
        duration: 'dv.BuffDuration',
        stats: { attackSpeed: 'dv.BonusAS / 100' },
        empowerAttacks: {
          count: 99,
          replaceBase: true,
          components: [
            { id: 'arrow', label: "Ranger's Focus", type: 'physical', amount: 'Q.calc.EmpoweredDamage * P.calc.DamageBonus / Q.dv.ShotsPerStrike' },
            {
              id: 'flurry',
              label: "Ranger's Focus (flurry)",
              type: 'physical',
              amount: 'Q.calc.EmpoweredDamage * P.calc.DamageBonus / Q.dv.ShotsPerStrike',
              hits: 'Q.dv.ShotsPerStrike - 1',
              noProc: true,
            },
          ],
        },
      },
    },
    W: {
      cc: [{ kind: 'slow', duration: 'P.dv.SlowDuration' }],
      notes: ['A target takes damage from only one arrow.'],
      components: [{ id: 'volley', label: 'Volley', type: 'physical', amount: 'calc.TotalDamage', aoe: true, delay: 0.25 }],
    },
    E: { noTarget: true, notes: ['Hawkshot: vision only.'] },
    R: {
      cc: [{ kind: 'immobilize', duration: 'dv.MinStunDuration' }],
      notes: ['Stun 1–3.5s depending on distance travelled; the minimum is used.'],
      components: [{ id: 'arrow', label: 'Enchanted Crystal Arrow', type: 'magic', amount: 'calc.RMainDamage', delay: 0.5 }],
    },
  },
  hooks: {
    // Frost Shot slow on every attack.
    onAttack(sim, atk) {
      if (!atk.phantom && !atk.fromAbility) sim.applyCC('slow', sim.evalExpr('P.dv.SlowDuration', { slot: 'P' }), atk.castId, 'P');
    },
  },
};
export default kit;
