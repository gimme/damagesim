import type { ChampionKit } from '../../engine/kit-types.ts';

// Ahri — patch 16.20. Numbers come from the game formulas (calc.*); this file maps them to hits.
const kit: ChampionKit = {
  id: 'Ahri',
  status: 'curated',
  abilities: {
    Q: {
      components: [
        { id: 'out', label: 'Orb of Deception (out)', type: 'magic', amount: 'calc.TotalDamage', aoe: true, delay: 0.3 },
        { id: 'back', label: 'Orb of Deception (return)', type: 'true', amount: 'calc.TotalDamage', aoe: true, delay: 0.9 },
      ],
    },
    W: {
      notes: ['Against a single target: the first fox-fire deals full damage, the other two 40%.'],
      components: [
        { id: 'first', label: 'Fox-Fire', type: 'magic', amount: 'calc.SingleFireDamage', delay: 0.25 },
        { id: 'extra', label: 'Fox-Fire (repeat)', type: 'magic', amount: 'calc.MultiFireDamage', hits: 2, maxHits: 2, interval: 0.15, delay: 0.4 },
      ],
    },
    E: {
      cc: [{ kind: 'immobilize', duration: 'dv.CharmDuration' }],
      components: [{ id: 'charm', label: 'Charm', type: 'magic', amount: 'calc.TotalDamage', delay: 0.2 }],
    },
    R: {
      dash: true,
      recasts: 3,
      recastDelay: 'dv.RDashCooldown',
      notes: ['Each cast fires bolts at up to 3 targets; a single target is hit once per cast. Use "R R R" for all three dashes.'],
      components: [{ id: 'bolt', label: 'Essence bolt', type: 'magic', amount: 'calc.RCalculatedDamage', delay: 0.2 }],
    },
  },
};
export default kit;
