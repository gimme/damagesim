import type { ChampionKit } from '../../engine/kit-types.ts';

// Yuumi — patch 16.20.
const kit: ChampionKit = {
  id: 'Yuumi',
  status: 'curated',
  notes: [
    'Yuumi is assumed Attached (her usual state): Prowling Projectile is steered and accelerates for the empowered damage; Q:unattached is the plain missile. She cannot attack while Attached.',
    "Best Friend bonuses (ally on-hit, enhanced heals) and all healing/shielding are not modeled; You and Me!'s adaptive-stat sharing goes to the ally.",
  ],
  abilities: {
    Q: {
      variants: {
        unattached: {
          label: 'unattached',
          cc: [{ kind: 'slow', duration: 'dv.SlowDuration' }],
          components: [{ id: 'missile', label: 'Prowling Projectile', type: 'magic', amount: 'calc.TotalMissileDamage', delay: 0.6 }],
        },
      },
      cc: [{ kind: 'slow', duration: 'dv.EmpoweredSlowDuration' }],
      // The missile accelerates after TimeToAfterburners seconds of flight.
      components: [{ id: 'empowered', label: 'Prowling Projectile (empowered)', type: 'magic', amount: 'calc.TotalMissileDamageEmpowered', delay: 'dv.TimeToAfterburners + 0.2' }],
    },
    W: { noTarget: true, notes: ['Attach to an ally; no damage.'], components: [] },
    E: {
      noTarget: true,
      cooldown: 10, // missing from the data; wiki: 10s
      notes: ['Unattached: shields Yuumi and grants her attack speed (Attached: affects the ally instead).'],
      buff: { id: 'yuumiE', label: 'Zoomies', duration: 'dv.MSDuration', stats: { attackSpeed: 'calc.TotalAttackSpeed / 100' } },
    },
    R: {
      notes: ['Five waves; a target already hit takes 25% damage (MultiMissileReduction) from later waves.'],
      cc: [{ kind: 'slow', duration: 'dv.CCDuration' }],
      components: [
        { id: 'first', label: 'Final Chapter (first wave)', type: 'magic', amount: 'calc.TotalMissileDamage', aoe: true, delay: 0.3 },
        { id: 'waves', label: 'Final Chapter (later waves)', type: 'magic', amount: 'calc.MultiMissileTotal', hits: 'dv.NumberOfWaves - 1', maxHits: 'dv.NumberOfWaves - 1', interval: 'dv.TimeBetweenWaves', delay: '0.3 + dv.TimeBetweenWaves', aoe: true },
      ],
    },
  },
};
export default kit;
