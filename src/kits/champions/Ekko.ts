import type { ChampionKit } from '../../engine/kit-types.ts';

// Ekko — patch 16.20.
const kit: ChampionKit = {
  id: 'Ekko',
  status: 'curated',
  notes: [
    "Z-Drive Resonance: basic attacks and damaging ability hits add a stack (4s); the 3rd deals P.calc.ThreeHitDamage, then the target can't be procced again for P.dv.LockoutTime s. Timewinder's outgoing and return hits count separately.",
    'Timewinder: the return hit is assumed to connect.',
    "Parallel Convergence: the stun needs Ekko to enter the sphere (cast ~3s earlier); it is applied at cast for simplicity. Its passive adds % missing health magic damage to attacks against targets below 30% health.",
  ],
  marks: [
    {
      id: 'resonance',
      label: 'Z-Drive Resonance',
      maxStacks: 3,
      // Stacks last 4s (wiki), the same value as the lockout.
      duration: 'P.dv.LockoutTime',
      appliedBy: ['attack', 'ability'],
      atMax: {
        components: [{ id: 'resonance', label: 'Z-Drive Resonance', type: 'magic', amount: 'P.calc.ThreeHitDamage' }],
        consume: true,
        cooldown: 'P.dv.LockoutTime',
      },
    },
  ],
  attack: {
    onHit: [
      {
        id: 'convergence',
        label: 'Parallel Convergence',
        type: 'magic',
        amount: 'W.calc.MissingHealthPercent * target.missingHp',
        // Only procs below the health threshold (hits 0 = no instance).
        hits: 'W.rank > 0 && target.hpPct < W.dv.BelowHealthThreshold ? 1 : 0',
        condition: 'target below 30% health',
      },
    ],
  },
  abilities: {
    Q: {
      cc: [{ kind: 'slow', duration: 'dv.ExpandDuration' }],
      components: [
        { id: 'out', label: 'Timewinder (out)', type: 'magic', amount: 'calc.InitialDamage', aoe: true, delay: 0.3 },
        // Separate pass: its own Resonance stack.
        { id: 'back', label: 'Timewinder (return)', type: 'magic', amount: 'calc.RecallDamage', aoe: true, delay: 'dv.ExpandDuration', sameCast: false },
      ],
    },
    W: {
      cc: [{ kind: 'immobilize', duration: 'dv.StunDuration' }],
      components: [],
    },
    E: {
      dash: true,
      resetsAttack: true,
      buff: {
        id: 'phaseDive',
        label: 'Phase Dive',
        duration: 'dv.BuffDuration',
        empowerAttacks: {
          count: 1,
          resetsAttack: true,
          components: [{ id: 'dive', label: 'Phase Dive', type: 'magic', amount: 'E.calc.TotalDamage' }],
        },
      },
    },
    R: {
      dash: true,
      components: [{ id: 'chronobreak', label: 'Chronobreak', type: 'magic', amount: 'calc.TotalDamage', aoe: true, delay: 0.25 }],
    },
  },
};
export default kit;
