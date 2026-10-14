import type { ChampionKit } from '../../engine/kit-types.ts';

// Kalista — patch 16.20.
// Rend spears (mark): every attack and Pierce that hits adds a spear; spears last 4s (tooltip text),
// refreshed by each new spear. Rend deals calc.NormalDamage + calc.AdditionalDamage per spear beyond
// the first and removes them (hook).

const kit: ChampionKit = {
  id: 'Kalista',
  status: 'curated',
  notes: [
    'Rend only deals damage if the target has spears (attacks and Pierce add one each).',
    'Soul-Marked (Sentinel passive) needs the Oathsworn ally attacking the same target: use the "P" step when it procs (10s per-target cooldown).',
    'Martial Poise hops and the Oathsworn\'s own damage are not modeled.',
  ],
  marks: [{ id: 'rend', label: 'Rend spears', slot: 'E', maxStacks: 'E.rank > 0 ? dv.MaxSpears : 0', duration: 4, appliedBy: ['attack', 'Q'] }],
  abilities: {
    P: {
      name: 'Soul-Marked',
      notes: ['Sentinel passive: Kalista and her Oathsworn both hit the target → W.dv.MaxHealthDamage of its max health as magic damage.'],
      components: [{ id: 'soulmark', label: 'Soul-Marked', type: 'magic', amount: 'W.dv.MaxHealthDamage * target.maxHp' }],
    },
    Q: {
      components: [{ id: 'pierce', label: 'Pierce', type: 'physical', amount: 'calc.TotalDamage', delay: 0.25 }],
    },
    W: { noTarget: true, notes: ['Active: scouting ghost (no damage). The passive is the "P" step.'], components: [] },
    E: {
      cc: [{ kind: 'slow', duration: 'dv.SlowDuration' }],
      components: [
        {
          id: 'rend',
          label: 'Rend',
          type: 'physical',
          amount: 'calc.NormalDamage + calc.AdditionalDamage * max(0, stacks.rend - 1)',
          hits: 'stacks.rend > 0 ? 1 : 0',
        },
      ],
    },
    R: {
      noTarget: true,
      notes: ['The Oathsworn is launched; enemies hit are knocked up for dv.KnockupDuration s.'],
      cc: [{ kind: 'immobilize', duration: 'dv.KnockupDuration' }],
      components: [],
    },
  },
  hooks: {
    // Rend rips out all spears.
    afterDamage(sim, inst) {
      if (!inst.fromMark && inst.flags.kind === 'ability' && inst.flags.slot === 'E') sim.setMarkStacks('rend', 0);
    },
  },
};

export default kit;
