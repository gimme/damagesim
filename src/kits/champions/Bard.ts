import type { ChampionKit } from '../../engine/kit-types.ts';
import type { Sim } from '../../engine/sim.ts';

// Bard — patch 16.20.
// Traveler's Call: each attack consumes a Meep for bonus magic damage (+ per 5 Chimes). Meeps
// available are tracked in counter 'bardMeeps'; a new one arrives every BaseMeepSpawnCD seconds.
const regenMeeps = (sim: Sim) => {
  const max = sim.opt.meeps ?? 1;
  const cd = sim.evalExpr('P.dv.BaseMeepSpawnCD', { slot: 'P' });
  let meeps = sim.counter('bardMeeps');
  let next = sim.counter('bardNextMeep');
  while (meeps < max && sim.time >= next) {
    meeps++;
    next += cd;
  }
  if (meeps >= max) next = Infinity;
  sim.setCounter('bardMeeps', meeps);
  sim.setCounter('bardNextMeep', next);
};

const kit: ChampionKit = {
  id: 'Bard',
  status: 'curated',
  options: [
    { key: 'chimes', label: 'Chimes collected', default: 25, min: 0, max: 200, step: 1, description: 'Meep damage +6 per 5 Chimes.' },
    { key: 'meeps', label: 'Meeps (max, all ready at start)', default: 2, min: 0, max: 9, step: 1, description: 'Wiki: 1 Meep at 0 Chimes, 2 at 10, 3 at 30, 4 at 50…' },
  ],
  notes: [
    'Meeps: all ready at combo start; each attack consumes one; one respawns every P.dv.BaseMeepSpawnCD seconds (faster with many Chimes in game — not modeled).',
    "Caretaker's Shrine, Magical Journey and Tempered Fate (stasis) do not deal damage.",
  ],
  abilities: {
    P: { notes: ['Meep damage on attacks (see options).'] },
    Q: {
      cc: [{ kind: 'slow', duration: 'dv.SlowDuration' }],
      notes: ['Default: slow only. Q:stun = the bolt also hits a wall or second enemy (stun).'],
      components: [{ id: 'bolt', label: 'Cosmic Binding', type: 'magic', amount: 'calc.TotalDamage', delay: 0.3 }],
      variants: {
        stun: {
          label: 'stun',
          cc: [{ kind: 'immobilize', duration: 'dv.StunDuration' }],
          components: [{ id: 'bolt', label: 'Cosmic Binding', type: 'magic', amount: 'calc.TotalDamage', delay: 0.3 }],
        },
      },
    },
    W: { noTarget: true, notes: ['Health shrines only.'] },
    E: { noTarget: true, notes: ['Portal only.'] },
    R: { noTarget: true, notes: ['Stasis makes the target invulnerable; it deals no damage.'] },
  },
  hooks: {
    onStart(sim) {
      sim.setCounter('bardMeeps', sim.opt.meeps ?? 1);
      sim.setCounter('bardNextMeep', Infinity);
    },
    onAttack(sim, atk) {
      if (atk.fromAbility || atk.phantom) return;
      regenMeeps(sim);
      const meeps = sim.counter('bardMeeps');
      if (meeps <= 0) return;
      atk.extra.push({
        source: 'P',
        sourceLabel: "Traveler's Call",
        label: 'Meep',
        type: 'magic',
        amount: sim.evalExpr('P.calc.MeepDamageNoChime + P.dv.DamagePerCheckpoint * floor(opt.chimes / P.dv.TooltipChimeDamageCheckpoint)', { slot: 'P' }),
        castId: atk.castId,
        flags: { kind: 'ability', slot: 'P', onHit: true, ability: false },
      });
      sim.setCounter('bardMeeps', meeps - 1);
      if (sim.counter('bardNextMeep') === Infinity) sim.setCounter('bardNextMeep', sim.time + sim.evalExpr('P.dv.BaseMeepSpawnCD', { slot: 'P' }));
      // Meeps slow once 5 Chimes are collected.
      if ((sim.opt.chimes ?? 0) >= sim.evalExpr('P.calc.ChimesForSlowUpgrade', { slot: 'P' })) sim.applyCC('slow', sim.evalExpr('P.dv.SlowDuration', { slot: 'P' }), atk.castId, 'P');
    },
  },
};
export default kit;
