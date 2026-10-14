import type { ChampionKit } from '../../engine/kit-types.ts';

// Rakan — patch 16.20. Fey Feathers (self shield), the Q heal and E's ally shield are not modeled.
const kit: ChampionKit = {
  id: 'Rakan',
  status: 'curated',
  abilities: {
    Q: {
      components: [{ id: 'quill', label: 'Gleaming Quill', type: 'magic', amount: 'calc.TotalDamage', delay: 0.25 }],
    },
    W: {
      dash: true,
      notes: ['Dash, then a short delay before the knock-up lands.'],
      cc: [{ kind: 'immobilize', duration: 'dv.KnockupDuration' }],
      components: [{ id: 'entrance', label: 'Grand Entrance', type: 'magic', amount: 'calc.TotalDamage', aoe: true, delay: 0.35 }],
    },
    E: {
      dash: true,
      noTarget: true,
      recasts: 2,
      notes: ['Dash to an ally (shield not modeled); can be recast once.'],
      components: [],
    },
    R: {
      notes: ['Each enemy is damaged and charmed once, the first time Rakan touches it.'],
      cc: [{ kind: 'immobilize', duration: 'dv.CharmDuration' }],
      components: [{ id: 'touch', label: 'The Quickness', type: 'magic', amount: 'calc.TotalDamageTooltip', aoe: true, delay: 0.25 }],
    },
  },
};
export default kit;
