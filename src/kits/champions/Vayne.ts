import type { ChampionKit } from '../../engine/kit-types.ts';

// Vayne — patch 16.20.
const kit: ChampionKit = {
  id: 'Vayne',
  status: 'curated',
  notes: [
    'Silver Bolts: basic attacks and Condemn apply a stack (wiki); the third stack deals % max health true damage (with the data\'s minimum) and consumes the stacks.',
    'Final Hour\'s Tumble cooldown reduction and invisibility are not modeled (only the bonus AD).',
  ],
  marks: [
    {
      id: 'silverBolts',
      label: 'Silver Bolts',
      slot: 'W',
      maxStacks: 3, // "every third consecutive Attack or Ability" (tooltip)
      duration: 'W.dv.DebuffDuration',
      appliedBy: ['attack', 'E'],
      atMax: {
        consume: true,
        components: [
          {
            id: 'bolt',
            label: 'Silver Bolts',
            type: 'true',
            amount: 'W.rank > 0 ? max(W.dv.DamageFloor, W.calc.TotalDamage * target.maxHp) : 0',
            proc: true,
          },
        ],
      },
    },
  ],
  abilities: {
    Q: {
      dash: true,
      resetsAttack: true,
      // Wiki: she dashes 300 units at 500 + her movement speed (not in the data) and can't attack until
      // it's done; Final Hour can be cast during it.
      attackLockout: 'castRange / (500 + ms)',
      notes: ['Empowers the next attack within 3s with bonus physical damage (assumed not to crit); write "Q AA".'],
      buff: {
        id: 'vayneQ',
        label: 'Tumble',
        duration: 'dv.Duration',
        empowerAttacks: {
          count: 1,
          resetsAttack: true,
          // The wiki: the attack is basic and spell damage, the bonus spell damage.
          spell: true,
          components: [{ id: 'tumble', label: 'Tumble', type: 'physical', amount: 'Q.calc.ADRatioBonus' }],
        },
      },
    },
    W: { noTarget: true, components: [] },
    E: {
      // Knockback of 475 units at 2000 speed ≈ 0.24s (wiki).
      cc: [{ kind: 'immobilize', duration: 0.24 }],
      components: [{ id: 'bolt', label: 'Condemn', type: 'physical', amount: 'calc.TotalDamage', travel: true }],
      variants: {
        wall: {
          label: 'wall',
          note: 'Target knocked into terrain: bonus damage and stun.',
          cc: [{ kind: 'immobilize', duration: 'dv.StunDuration' }],
          components: [
            { id: 'bolt', label: 'Condemn', type: 'physical', amount: 'calc.TotalDamage', travel: true },
            // The bolt, then the full knockback into the wall (475 units at 2000 speed, wiki).
            { id: 'wall', label: 'Condemn (wall)', type: 'physical', amount: 'calc.EmpoweredDamageTT', travel: 'reach / missileSpeed + dv.KnockbackDistance / 2000' },
          ],
        },
      },
    },
    R: {
      noTarget: true,
      buff: { id: 'vayneR', label: 'Final Hour', duration: 'dv.BaseDuration', stats: { ad: 'dv.BonusAttackDamage' } },
    },
  },
};
export default kit;
