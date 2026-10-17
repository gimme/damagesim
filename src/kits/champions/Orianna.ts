import type { ChampionKit } from '../../engine/kit-types.ts';

// Orianna — patch 16.20.
const kit: ChampionKit = {
  id: 'Orianna',
  status: 'curated',
  notes: [
    'Clockwork Windup: attacks on the same target within 4 s stack up to 2 times; each stack adds StackDamage to the on-hit damage.',
    'The Ball is assumed to be positioned on/near the target for W and R.',
  ],
  marks: [{ id: 'windup', label: 'Clockwork Windup', maxStacks: 'P.dv.StackCount', duration: 'P.dv.StackDuration', appliedBy: ['attack'] }],
  attack: {
    // Stacks are counted before this attack adds its own: 1st attack base, 2nd +1 stack, 3rd+ +2 stacks.
    onHit: [{ id: 'windup', label: 'Clockwork Windup', type: 'magic', amount: 'P.calc.TotalDamage + P.calc.StackDamage * stacks.windup', proc: true }],
  },
  abilities: {
    Q: {
      // The Ball flies its max range at the missile's speed. Wiki: she can't cast Command: Protect
      // while it's in transit, and Dissonance and Shockwave wait until it arrives (she can move and attack).
      castLockout: { W: 'castRange / missileSpeed', E: 'castRange / missileSpeed', R: 'castRange / missileSpeed' },
      components: [{ id: 'ball', label: 'Command: Attack', type: 'magic', amount: 'calc.TotalDamageTooltip', aoe: true, travel: true }],
    },
    W: {
      cc: [{ kind: 'slow', duration: 'dv.SlowAndHasteDuration' }],
      components: [{ id: 'pulse', label: 'Command: Dissonance', type: 'magic', amount: 'calc.TotalDamage', aoe: true }],
    },
    E: {
      notes: ['Shields an ally (or Orianna). Damage only if the Ball passes through the enemy on its way: optional component "pass" (E+pass).'],
      // The Ball flies its max range at the missile's speed; she can't cast her other abilities while
      // it moves (wiki).
      castLockout: { Q: 'castRange / missileSpeed', W: 'castRange / missileSpeed', R: 'castRange / missileSpeed' },
      components: [{ id: 'pass', label: 'Command: Protect', type: 'magic', amount: 'calc.TotalDamageTooltip', optional: true, condition: 'if the Ball passes through the enemy', travel: true }],
    },
    R: {
      cc: [{ kind: 'immobilize', duration: 'dv.StunDuration' }],
      components: [{ id: 'shockwave', label: 'Command: Shockwave', type: 'magic', amount: 'calc.TotalDamage', aoe: true }],
    },
  },
};
export default kit;
