import type { ChampionKit } from '../../engine/kit-types.ts';

// Tahm Kench — patch 16.20.
// An Acquired Taste: attacks and Tongue Lash add a stack (max 3). At 3 stacks Tongue Lash stuns and
// Devour can be cast; both consume the stacks. A hook snapshots the stacks at the Q cast (the CC is
// evaluated after the Q hit has added its own stack) and spends them.

const kit: ChampionKit = {
  id: 'TahmKench',
  status: 'curated',
  notes: [
    'An Acquired Taste: attacks deal bonus magic damage on-hit; attacks and Tongue Lash add a stack (max 3, 5s).',
    'Tongue Lash on a target with 3 stacks stuns and consumes them (the Q hit then adds a fresh stack — assumption).',
    'Devour needs 3 stacks (not enforced) and consumes them; the target is devoured for the full duration and takes the damage when spat out. Tahm Kench waits until 0.4s after the spit (Regurgitate\'s lockout) before his next step, so nothing hits the untargetable target meanwhile.',
  ],
  marks: [{ id: 'taste', label: 'An Acquired Taste', maxStacks: 'P.dv.MaxStacks', duration: 'P.dv.Duration', appliedBy: ['attack', 'Q'] }],
  attack: {
    onHit: [{ id: 'taste', label: 'An Acquired Taste', type: 'magic', amount: 'P.calc.TotalDamage', proc: true }],
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
      // Wiki: unable to move, attack or cast Abyssal Dive while the tongue flies, which it does from the
      // start of the cast time ({{Effect at cast time start}}) to the target; Devour can be cast.
      attackLockout: 'max(castTime, reach / missileSpeed)',
      castLockout: { W: 'max(castTime, reach / missileSpeed)' },
      components: [
        { id: 'lash', label: 'Tongue Lash', type: 'magic', amount: 'calc.TotalDamage', travel: 'max(0, reach / missileSpeed - castTime)' },
        { id: 'taste', label: 'An Acquired Taste', type: 'magic', amount: 'P.calc.TotalDamage', travel: 'max(0, reach / missileSpeed - castTime)', proc: true },
      ],
    },
    W: {
      dash: true,
      castTime: 'dv.ChannelTime',
      // Wiki: unable to act for 0.65s after the blink at the end of the channel: ChannelTime + 0.65 = TotalTime.
      lockout: 'dv.TotalTime',
      cc: [{ kind: 'immobilize', duration: 'dv.KnockUpDuration' }],
      notes: ['Dives for 1.35s, the area erupts 1.5s after the channel starts.'],
      components: [{ id: 'dive', label: 'Abyssal Dive', type: 'magic', amount: 'calc.TotalDamage', aoe: true, delay: 'dv.AoEDelayFromChannelStart - dv.ChannelTime' }],
    },
    E: { noTarget: true, notes: ['Thick Skin (grey health / shield) deals no damage.'], components: [] },
    R: {
      castTime: 'dv.CastTime',
      // The target is untargetable until spat out, and Regurgitate leaves Tahm Kench unable to act for
      // 0.4s (wiki): busy until then.
      lockout: 'dv.CastTime + dv.EnemyDuration + 0.4',
      notes: ['Damage is dealt when the target is spat out (after the full devour duration).'],
      components: [{ id: 'devour', label: 'Devour', type: 'magic', amount: 'dv.BaseDamage + calc.PercentHPDamage * target.maxHp', delay: 'dv.EnemyDuration' }],
    },
  },
};
export default kit;
