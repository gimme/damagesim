import type { ChampionKit } from '../../engine/kit-types.ts';

// Ziggs — patch 16.20.
// Short Fuse: a 1-stack mark consumed by the next attack, with the passive's cooldown; each ability
// cast shortens the remaining cooldown by SpellCdr (hook — mark cooldowns can't be reduced declaratively).
const kit: ChampionKit = {
  id: 'Ziggs',
  status: 'curated',
  notes: [
    'Short Fuse is ready at combo start; each ability cast reduces its cooldown by SpellCdr seconds.',
    'Hexplosive Minefield: one full-damage mine plus 2 reduced mines by default (E{extra:N} for more, up to 10).',
    'Mega Inferno Bomb: center hit by default; R:edge for the outer ring.',
  ],
  marks: [
    {
      id: 'shortFuse',
      label: 'Short Fuse',
      maxStacks: 1,
      duration: 1,
      appliedBy: ['attack'],
      atMax: { components: [{ id: 'fuse', label: 'Short Fuse', type: 'magic', amount: 'P.calc.TotalDamage', proc: true }], consume: true, cooldown: 'P.cooldown' },
    },
  ],
  hooks: {
    onCast(sim, cast) {
      const m = sim.marks.get('shortFuse');
      if (m && cast.slot !== 'P') m.cooldownUntil -= sim.evalExpr('P.calc.SpellCdr', { slot: 'P' });
    },
  },
  abilities: {
    Q: { components: [{ id: 'bomb', label: 'Bouncing Bomb', type: 'magic', amount: 'calc.TotalDamage', aoe: true, delay: 0.5 }] },
    W: {
      // Knock-back lasts 0.5s (wiki).
      cc: [{ kind: 'immobilize', duration: 0.5 }],
      notes: ['Assumes an immediate recast to detonate (~0.5s after the throw).'],
      components: [{ id: 'charge', label: 'Satchel Charge', type: 'magic', amount: 'calc.TotalDamage', aoe: true, delay: 0.5 }],
    },
    E: {
      cc: [{ kind: 'slow', duration: 'dv.SlowDuration' }],
      components: [
        { id: 'mine', label: 'Hexplosive Minefield', type: 'magic', amount: 'calc.TotalDamage', aoe: true, delay: 0.6 },
        { id: 'extra', label: 'Hexplosive Minefield (extra mine)', type: 'magic', amount: 'calc.ReducedDamage', hits: 2, maxHits: 10, interval: 0.15, delay: 0.75, aoe: true },
      ],
    },
    R: {
      variants: {
        edge: { label: 'edge', components: [{ id: 'edge', label: 'Mega Inferno Bomb (edge)', type: 'magic', amount: 'calc.BlastDamage', aoe: true, delay: 1 }] },
      },
      components: [{ id: 'center', label: 'Mega Inferno Bomb', type: 'magic', amount: 'calc.EmpoweredDamage', aoe: true, delay: 1 }],
    },
  },
};
export default kit;
