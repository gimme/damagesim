import type { ChampionKit } from '../../engine/kit-types.ts';

// Alistar — patch 16.20.
const kit: ChampionKit = {
  id: 'Alistar',
  status: 'curated',
  notes: ['Triumphant Roar (healing) and Unbreakable Will (damage reduction) do not deal damage.'],
  marks: [
    {
      // Each Trample pulse that damages a champion grants a stack; at 5 the next attack stuns.
      id: 'trample',
      label: 'Trample',
      slot: 'E',
      maxStacks: 'dv.MaxStacks',
      duration: 'dv.Duration',
      appliedBy: ['E'],
      oncePerCast: false,
      atMax: {
        components: [],
        consume: true,
        // Only one empowered attack per Trample cast.
        cooldown: 'dv.Duration',
        buff: {
          id: 'trampleCharged',
          label: 'Trample (charged)',
          duration: 'dv.FullChargeDuration',
          empowerAttacks: {
            count: 1,
            cc: [{ kind: 'immobilize', duration: 'E.dv.StunDuration' }],
            components: [{ id: 'stun', label: 'Trample (stun)', type: 'magic', amount: 'E.calc.AttackBonusDamage' }],
          },
        },
      },
    },
  ],
  abilities: {
    Q: {
      cc: [{ kind: 'immobilize', duration: 'dv.KnockupDuration' }],
      components: [{ id: 'pulverize', label: 'Pulverize', type: 'magic', amount: 'calc.TotalDamage', aoe: true }],
    },
    W: {
      dash: true,
      cc: [{ kind: 'immobilize', duration: 'dv.StunDuration' }],
      components: [{ id: 'headbutt', label: 'Headbutt', type: 'magic', amount: 'calc.TotalDamage' }],
    },
    E: {
      notes: [
        '10 pulses every 0.5s over 5s, each dealing 1/10 of the total (E{pulse:N} for fewer). After 5 pulses on a champion the next attack stuns and deals bonus magic damage.',
      ],
      components: [
        { id: 'pulse', label: 'Trample', type: 'magic', amount: 'calc.TotalDamage / (dv.Duration / 0.5)', hits: 'dv.Duration / 0.5', interval: 0.5, aoe: true, dot: true },
      ],
    },
    R: { noTarget: true, notes: ['Cleanse and damage reduction only.'] },
  },
};
export default kit;
