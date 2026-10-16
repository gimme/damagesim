import type { ChampionKit } from '../../engine/kit-types.ts';
import type { Sim } from '../../engine/sim.ts';

// Xayah — patch 16.20.
// Feathers are counted in hooks: Double Daggers leaves 2, Featherstorm 5, and each attack empowered by
// Clean Cuts (3 per ability cast, max 5 — data) leaves 1. Bladecaller recalls all of them through
// the target: each feather deals 5% less than the previous one, down to 10% (wiki).
const add = (sim: Sim, key: string, v: number) => sim.setCounter(key, sim.counter(key) + v);

const kit: ChampionKit = {
  id: 'Xayah',
  status: 'curated',
  notes: [
    'Feathers are assumed to lie in line with the target when recalled and are not expired (6s) in the simulation.',
    'Option "feathers" = feathers already on the ground at combo start.',
  ],
  options: [{ key: 'feathers', label: 'Feathers on the ground at start', default: 0, min: 0, max: 20, step: 1 }],
  abilities: {
    Q: {
      notes: ['Both daggers hit a single target for full damage.'],
      components: [
        { id: 'dagger1', label: 'Double Daggers', type: 'physical', amount: 'calc.TotalDamage', delay: 'dv.Missile1DelayTime' },
        { id: 'dagger2', label: 'Double Daggers', type: 'physical', amount: 'calc.TotalDamage', delay: 'dv.Missile2DelayTime' },
      ],
    },
    W: {
      noTarget: true,
      notes: ['Attacks fire a second blade dealing 25% of the attack\'s damage (scaled by the attack\'s crit, cannot crit itself; proc damage).'],
      buff: {
        id: 'xayahW',
        label: 'Deadly Plumage',
        duration: 'dv.WAttackSpeedDuration',
        stats: { attackSpeed: 'dv.WAttackSpeedAmount / 100' },
        onHit: [{ id: 'blade', label: 'Deadly Plumage', type: 'physical', amount: 'ad * W.dv.BonusDamagePercent / 100', canCrit: true, proc: true }],
      },
    },
    E: {
      notes: [
        'Hits once per feather on the ground (counted from Q, R and Clean Cuts attacks); 3+ feathers root. Damage already includes the game\'s crit-chance scaling.',
        'Override the feather count with E{feather:N}.',
      ],
      components: [
        {
          id: 'feather',
          label: 'Bladecaller',
          type: 'physical',
          amount: 'calc.FeatherDamage * max(0.1, 1 - dv.FeatherFalloff * hit)',
          hits: 'stacks.xayahEFeathers',
          maxHits: 20,
          interval: 0.03,
          delay: 'dv.FeatherReturnDelay + 0.2',
        },
      ],
    },
    R: {
      notes: ['Untargetable for 1.5s; daggers land after 1s and leave 5 feathers (wiki).'],
      // Wiki: unable to attack or cast during the 1.5s Featherstorm.
      lockout: 1.5,
      components: [{ id: 'storm', label: 'Featherstorm', type: 'physical', amount: 'calc.Damage', aoe: true, delay: 'dv.RAttackDelay' }],
    },
  },
  hooks: {
    onStart(sim) {
      sim.setCounter('xayahFeathers', sim.opt.feathers ?? 0);
    },
    onCast(sim, cast) {
      if (cast.slot === 'E') {
        sim.setCounter('xayahEFeathers', sim.counter('xayahFeathers'));
        sim.setCounter('xayahFeathers', 0);
        sim.setCounter('xayahECast', cast.castId);
        sim.setCounter('xayahEHits', 0);
      }
      if (cast.slot === 'Q') add(sim, 'xayahFeathers', 2);
      if (cast.slot === 'R') add(sim, 'xayahFeathers', 5);
      if (cast.slot !== 'P') {
        const max = sim.evalExpr('P.dv.PStackMax', { slot: 'P' });
        sim.setCounter('xayahCuts', Math.min(max, sim.counter('xayahCuts') + sim.evalExpr('P.dv.PStacksPerCast', { slot: 'P' })));
      }
    },
    onAttack(sim, atk) {
      if (atk.phantom || atk.fromAbility || sim.counter('xayahCuts') <= 0) return;
      add(sim, 'xayahCuts', -1);
      add(sim, 'xayahFeathers', 1);
    },
    afterDamage(sim, inst) {
      if (inst.flags.slot !== 'E' || inst.castId !== sim.counter('xayahECast')) return;
      add(sim, 'xayahEHits', 1);
      if (sim.counter('xayahEHits') === sim.evalExpr('E.dv.FeatherThreshold', { slot: 'E' }))
        sim.applyCC('immobilize', sim.evalExpr('E.dv.RootDuration', { slot: 'E' }), inst.castId, 'E');
    },
  },
};
export default kit;
