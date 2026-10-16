import type { ChampionKit } from '../../engine/kit-types.ts';

// Kassadin — patch 16.20.
// Nether Blade: attacks deal W.calc.OnHitDamage bonus magic damage (proc). The active empowers the
// next attack to deal W.calc.ActiveDamage instead (assumed to replace the passive bonus).
// Riftwalk stacks (mark): each cast adds a stack after its damage (R.dv.RStackDuration s, refreshed,
// max R.dv.MaxStacks); each stack adds R.calc.BonusDamage.
const kit: ChampionKit = {
  id: 'Kassadin',
  status: 'curated',
  notes: [
    'Nether Blade\'s empowered attack is assumed to replace the passive on-hit bonus (the tooltip calls it "increased" damage).',
    'Riftwalk: the first cast deals base damage; each following cast within 15s deals one more stack of R.calc.BonusDamage (max 4). Option "riftStacks" sets the stacks at combo start.',
    'Void Stone (magic damage reduction taken) is defensive and not modeled.',
    'Riftwalk stacks are tracked as a mark, so a Riftwalk that misses the target does not add one (in game it does).',
  ],
  options: [{ key: 'riftStacks', label: 'Riftwalk stacks at combo start', default: 0, min: 0, max: 4 }],
  marks: [{ id: 'riftwalk', label: 'Riftwalk stacks', slot: 'R', maxStacks: 'dv.MaxStacks', duration: 'dv.RStackDuration', appliedBy: ['R'] }],
  abilities: {
    Q: {
      components: [{ id: 'sphere', label: 'Null Sphere', type: 'magic', amount: 'calc.TotalDamage', delay: 0.25 }],
    },
    W: {
      castTime: 0,
      resetsAttack: true,
      buff: {
        id: 'netherBlade',
        label: 'Nether Blade',
        // No data value for the window; the empowered attack is assumed to follow within 5s.
        duration: 5,
        empowerAttacks: { count: 1, resetsAttack: true, components: [{ id: 'active', label: 'Nether Blade (active)', type: 'magic', amount: 'W.calc.ActiveDamage' }] },
      },
    },
    E: {
      cc: [{ kind: 'slow', duration: 'dv.SlowDuration' }],
      components: [{ id: 'pulse', label: 'Force Pulse', type: 'magic', amount: 'calc.TotalDamage', aoe: true }],
    },
    R: {
      dash: true,
      components: [{ id: 'rift', label: 'Riftwalk', type: 'magic', amount: 'calc.BaseDamage + calc.BonusDamage * stacks.riftwalk', aoe: true }],
    },
  },
  hooks: {
    // Nether Blade passive on-hit, skipped when the empowered attack (pushed by the W buff, source 'W') replaces it.
    onAttack(sim, atk) {
      if (atk.fromAbility || sim.rankOf('W') <= 0 || atk.extra.some((x) => x.source === 'W')) return;
      atk.extra.push({ source: 'W', sourceLabel: 'Nether Blade', label: 'Nether Blade', type: 'magic', amount: sim.evalExpr('W.calc.OnHitDamage', { slot: 'W' }), castId: atk.castId, flags: { kind: 'ability', slot: 'W', onHit: true, ability: false, proc: true } });
    },
    onStart(sim) {
      const stacks = sim.opt.riftStacks ?? 0;
      if (stacks > 0) sim.setMarkStacks('riftwalk', stacks, sim.evalExpr('R.dv.RStackDuration', { slot: 'R' }));
    },
  },
};
export default kit;
