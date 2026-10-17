import type { ChampionKit } from '../../engine/kit-types.ts';

// Lissandra — patch 16.20.
const kit: ChampionKit = {
  id: 'Lissandra',
  status: 'curated',
  notes: ['Iceborn Subjugation needs another enemy champion to die nearby: cast "P" to add a Frozen Thrall shatter (4s later).'],
  abilities: {
    P: {
      notes: ['A Frozen Thrall (a dead enemy champion) shatters next to the target 4s later.'],
      components: [{ id: 'thrall', label: 'Frozen Thrall', type: 'magic', amount: 'calc.TotalDamage', aoe: true, delay: 'dv.ExplosionDelay' }],
    },
    Q: {
      cc: [{ kind: 'slow', duration: 'dv.SlowDuration' }],
      components: [{ id: 'shard', label: 'Ice Shard', type: 'magic', amount: 'calc.TotalDamage', aoe: true, travel: true }],
    },
    W: {
      castTime: 0, // no cast time (wiki)
      cc: [{ kind: 'immobilize', duration: 'dv.SnareDuration' }],
      components: [{ id: 'ring', label: 'Ring of Frost', type: 'magic', amount: 'calc.TotalDamage', aoe: true }],
    },
    E: {
      recasts: 2,
      notes: ['The claw damages enemies it passes through; recast (E:blink) teleports Lissandra to it.'],
      // No speed in the data: the claw decelerates from 1200 to 640 over its range (wiki), taken at
      // their average.
      components: [{ id: 'claw', label: 'Glacial Path', type: 'magic', amount: 'calc.TotalDamage', aoe: true, travel: 'reach / ((1200 + 640) / 2)' }],
      variants: { blink: { label: 'teleport', dash: true, components: [] } },
    },
    R: {
      cc: [
        { kind: 'immobilize', duration: 'dv.EnemyCastDuration' },
        { kind: 'slow', duration: 'dv.SlowDuration' },
      ],
      notes: ['Default: cast on the enemy (stun). R:self = self-cast stasis, the ice still damages and slows nearby enemies.'],
      components: [{ id: 'tomb', label: 'Frozen Tomb', type: 'magic', amount: 'calc.CalculatedDamage', aoe: true }],
      variants: {
        self: {
          label: 'self-cast',
          castTime: 0, // no cast time when self-cast (wiki)
          cc: [{ kind: 'slow', duration: 'dv.SlowDuration' }],
          components: [{ id: 'tomb', label: 'Frozen Tomb (self)', type: 'magic', amount: 'calc.CalculatedDamage', aoe: true }],
        },
      },
    },
  },
};
export default kit;
