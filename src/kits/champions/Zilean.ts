import type { ChampionKit } from '../../engine/kit-types.ts';

// Zilean — patch 16.20.
// Time Bomb sticks to the target as a debuff that detonates after FuseDuration; a second bomb
// (Q:double) detonates both at once and stuns. Rewind (W) reduces Q/E cooldowns — a hook, because
// cooldowns can't be changed declaratively.
const kit: ChampionKit = {
  id: 'Zilean',
  status: 'curated',
  notes: [
    'Time Bomb: write "Q W Q:double" for the double bomb — the second bomb detonates the first immediately (both deal damage) and stuns. A lone bomb detonates after 3s.',
    'Rewind reduces the remaining cooldowns of Time Bomb and Time Warp by CooldownReduction seconds.',
    'Chronoshift and the passive (experience) are not modeled.',
  ],
  hooks: {
    onCast(sim, cast) {
      if (cast.slot !== 'W') return;
      const cdr = sim.evalExpr('W.dv.CooldownReduction', { slot: 'W' });
      for (const key of ['ability:Q', 'ability:E']) {
        const remaining = sim.cooldownReadyAt(key) - sim.time;
        if (remaining > 0) sim.startCooldown(key, Math.max(0, remaining - cdr));
      }
    },
  },
  abilities: {
    Q: {
      debuff: {
        id: 'zileanBomb',
        label: 'Time Bomb',
        duration: 'dv.FuseDuration',
        detonate: { components: [{ id: 'bomb', label: 'Time Bomb', type: 'magic', amount: 'calc.TotalDamage' }] },
        consume: { by: 'Q', components: [{ id: 'bomb', label: 'Time Bomb (first bomb)', type: 'magic', amount: 'Q.calc.TotalDamage' }] },
      },
      variants: {
        double: {
          label: 'second bomb',
          note: 'Placed on a target already carrying a bomb: both detonate now and stun.',
          cc: [{ kind: 'immobilize', duration: 'dv.StunDuration' }],
          // The second bomb explodes at once: it must not stick as a new (delayed) bomb. No missile
          // speed in the data or the wiki: ~0.4s flight.
          debuff: null,
          components: [{ id: 'bomb2', label: 'Time Bomb (second bomb)', type: 'magic', amount: 'calc.TotalDamage', aoe: true, delay: 0.4 }],
        },
      },
      components: [],
    },
    W: { noTarget: true, components: [] },
    E: { cc: [{ kind: 'slow', duration: 'dv.Duration' }], components: [] },
    R: { noTarget: true, components: [] },
  },
};
export default kit;
