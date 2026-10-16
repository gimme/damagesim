import type { ChampionKit } from '../../engine/kit-types.ts';
import type { Sim } from '../../engine/sim.ts';

// Kalista — patch 16.20.
// Rend spears (mark): every attack and Pierce that hits adds a spear; spears last 4s (tooltip text),
// refreshed by each new spear. Rend deals calc.NormalDamage + calc.AdditionalDamage per spear beyond
// the first and removes them (hook).
// Soul-Marked: dealt on-attack of the attack that applies the second mark (wiki): as Kalista's attack
// goes off, before it lands; as the Oathsworn's lands. Tagged proc on the wiki, but a note says it
// benefits from her spell effects: ability damage. The "P" step procs it (not a W cast); the damage
// is Sentinel's (W).

const ARMED = 'kalistaSoulMark';

function soulMark(sim: Sim, castId: number) {
  sim.deal({
    source: 'W',
    sourceLabel: 'Sentinel',
    label: 'Soul-Marked',
    type: 'magic',
    amount: sim.evalExpr('W.dv.MaxHealthDamage * target.maxHp', { slot: 'W' }),
    castId,
    flags: { kind: 'ability', slot: 'W', ability: true },
  });
}

const kit: ChampionKit = {
  id: 'Kalista',
  status: 'curated',
  notes: [
    'Rend only deals damage if the target has spears (attacks and Pierce add one each).',
    'Soul-Marked (Sentinel passive) needs the Oathsworn ally attacking the same target (10s per-target cooldown): "P AA" when Kalista\'s attack procs it (it lands as the attack goes off), "P:ally" when the Oathsworn\'s does (right away).',
    'Martial Poise hops and the Oathsworn\'s own damage are not modeled.',
  ],
  marks: [{ id: 'rend', label: 'Rend spears', slot: 'E', maxStacks: 'E.rank > 0 ? dv.MaxSpears : 0', duration: 4, appliedBy: ['attack', 'Q'] }],
  abilities: {
    P: {
      name: 'Soul-Marked',
      notes: ['Sentinel passive: Kalista and her Oathsworn both hit the target → W.dv.MaxHealthDamage of its max health as magic damage. P: on her next attack (within the 4s mark); P:ally: the Oathsworn\'s attack, now.'],
      // Her next attack within the Oathsworn's 4s mark procs it; P:ally deals it now (hooks).
      buff: { id: ARMED, label: 'Soul-Marked (next attack)', duration: 4 },
      components: [],
      variants: { ally: { label: 'Oathsworn', note: "The Oathsworn's attack procs it.", buff: [], components: [] } },
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
    onCast(sim, cast) {
      if (cast.slot === 'P' && cast.variant?.toLowerCase() === 'ally') soulMark(sim, cast.castId);
    },
    preAttack(sim, atk) {
      if (atk.fromAbility || atk.phantom || !sim.getBuff(ARMED)) return;
      sim.removeBuff(ARMED);
      soulMark(sim, atk.castId);
    },
    // Rend rips out all spears.
    afterDamage(sim, inst) {
      if (!inst.fromMark && inst.flags.kind === 'ability' && inst.flags.slot === 'E') sim.setMarkStacks('rend', 0);
    },
  },
};

export default kit;
