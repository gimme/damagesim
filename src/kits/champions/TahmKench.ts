import type { ChampionKit } from '../../engine/kit-types.ts';

// Tahm Kench — patch 16.20.
// An Acquired Taste: attacks and Tongue Lash add a stack (max 3). At 3 stacks Tongue Lash stuns and
// Devour can be cast; both consume the stacks. A hook snapshots the stacks at the Q cast (the CC is
// evaluated after the Q hit has added its own stack) and spends them.
const Q_DELAY = 0.25; // tongue travel time (not in data)

const kit: ChampionKit = {
  id: 'TahmKench',
  status: 'curated',
  notes: [
    'An Acquired Taste: attacks deal bonus magic damage on-hit; attacks and Tongue Lash add a stack (max 3, 5s).',
    'Tongue Lash on a target with 3 stacks stuns and consumes them (the Q hit then adds a fresh stack — assumption).',
    'Devour needs 3 stacks (not enforced) and consumes them; the target is devoured for the full duration and takes the damage when spat out. The target is untargetable meanwhile — put Devour last or add wait:3.',
  ],
  marks: [{ id: 'taste', label: 'An Acquired Taste', maxStacks: 'P.dv.MaxStacks', duration: 'P.dv.Duration', appliedBy: ['attack', 'Q'] }],
  attack: {
    onHit: [{ id: 'taste', label: 'An Acquired Taste', type: 'magic', amount: 'P.calc.TotalDamage' }],
  },
  hooks: {
    onCast(sim, cast) {
      if (cast.slot === 'Q') {
        const stun = (sim.markStacks('taste') ?? 0) >= sim.evalExpr('P.dv.MaxStacks', { slot: 'P' });
        sim.setCounter('tahmQStun', stun ? 1 : 0);
        if (stun) sim.setMarkStacks('taste', 0);
      } else if (cast.slot === 'R') {
        // Devour suppresses from the cast; its damage only lands at spit-out, so the CC can't ride on the hit.
        const castTime = sim.evalExpr('R.dv.CastTime', { slot: 'R' });
        sim.schedule(castTime, () => {
          sim.setMarkStacks('taste', 0);
          sim.applyCC('immobilize', sim.evalExpr('R.dv.EnemyDuration', { slot: 'R' }), cast.castId, 'R');
        });
      }
    },
  },
  abilities: {
    Q: {
      cc: [
        { kind: 'immobilize', duration: 'stacks.tahmQStun ? dv.StunDuration : 0' },
        { kind: 'slow', duration: 'dv.SlowDuration' },
      ],
      notes: ['Deals Tongue Lash damage plus An Acquired Taste damage; stuns if the target already had 3 stacks.'],
      components: [
        { id: 'lash', label: 'Tongue Lash', type: 'magic', amount: 'calc.TotalDamage', delay: Q_DELAY },
        { id: 'taste', label: 'An Acquired Taste', type: 'magic', amount: 'P.calc.TotalDamage', delay: Q_DELAY },
      ],
    },
    W: {
      dash: true,
      castTime: 'dv.ChannelTime',
      cc: [{ kind: 'immobilize', duration: 'dv.KnockUpDuration' }],
      notes: ['Dives for 1.35s, the area erupts 1.5s after the channel starts.'],
      components: [{ id: 'dive', label: 'Abyssal Dive', type: 'magic', amount: 'calc.TotalDamage', aoe: true, delay: 'dv.AoEDelayFromChannelStart - dv.ChannelTime' }],
    },
    E: { noTarget: true, notes: ['Thick Skin (grey health / shield) deals no damage.'], components: [] },
    R: {
      castTime: 'dv.CastTime',
      notes: ['Damage is dealt when the target is spat out (after the full devour duration).'],
      components: [{ id: 'devour', label: 'Devour', type: 'magic', amount: 'dv.BaseDamage + calc.PercentHPDamage * target.maxHp', delay: 'dv.EnemyDuration' }],
    },
  },
};
export default kit;
