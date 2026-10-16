import type { ChampionKit } from '../../engine/kit-types.ts';
import type { Sim } from '../../engine/sim.ts';

// Mordekaiser — patch 16.20.

// Darkness Rise aura tick used by the simulator (the game ticks every 0.125s; damage per second is
// the same, coarser ticks just keep the event list readable).
const AURA_TICK = 0.5;

/**
 * Starts the Darkness Rise aura once 3 stacks are reached; it ticks while the stacks are kept up.
 * Its ticks share the cast instance of the hit that activated it (wiki).
 */
function maybeStartAura(sim: Sim, castId: number) {
  if (sim.counter('morde:aura') || (sim.markStacks('darknessRise') ?? 0) < sim.evalExpr('P.dv.MaximumStacks', { slot: 'P' })) return;
  sim.setCounter('morde:aura', 1);
  const tick = () => {
    if ((sim.markStacks('darknessRise') ?? 0) < sim.evalExpr('P.dv.MaximumStacks', { slot: 'P' })) {
      sim.setCounter('morde:aura', 0);
      return;
    }
    sim.deal({
      source: 'P',
      sourceLabel: 'Darkness Rise',
      label: 'Darkness Rise (aura)',
      type: 'magic',
      amount: sim.evalExpr(`(P.calc.AuraDamagePerStack + P.calc.PercentHealthForAura / 100 * target.maxHp) * ${AURA_TICK}`, { slot: 'P' }),
      castId,
      flags: { kind: 'ability', slot: 'P', ability: true, aoe: true, dot: true },
    });
    sim.schedule(AURA_TICK, tick);
  };
  sim.schedule(AURA_TICK, tick);
}

const kit: ChampionKit = {
  id: 'Mordekaiser',
  status: 'curated',
  notes: [
    'Darkness Rise: attacks and Obliterate/Death\'s Grasp hits add a stack (4s, refreshed); at 3 stacks the aura deals (P.calc.AuraDamagePerStack + P.calc.PercentHealthForAura% max HP) per second while the stacks are kept up (simulated in 0.5s ticks).',
    'Indestructible (shield/heal) is not modeled.',
  ],
  marks: [
    {
      id: 'darknessRise',
      label: 'Darkness Rise',
      maxStacks: 'P.dv.MaximumStacks',
      duration: 'P.dv.CombatTrackingDuration',
      appliedBy: ['attack', 'Q', 'E'],
    },
  ],
  // The aura ticking needs state the declarative mark can't express (damage only at max stacks).
  hooks: {
    afterDamage(sim, inst) {
      // Marks update after afterDamage hooks run: check on the next event-queue step.
      if (!sim.counter('morde:aura')) sim.schedule(0, () => maybeStartAura(sim, inst.castId));
    },
  },
  attack: {
    // Darkness Rise: attacks deal bonus magic damage (40% AP); skipped when it would be 0. The wiki:
    // "the bonus damage on his basic attacks is proc damage" (the aura is ability damage).
    onHit: [{ id: 'nightfall', label: 'Darkness Rise', type: 'magic', amount: 'P.calc.BonusAPAuto', hits: 'ap > 0 ? 1 : 0', proc: true }],
  },
  stats: ({ ranks, evalExpr }) => (ranks.E > 0 ? { magicPenPercent: [evalExpr('E.dv.MagicPen')] } : {}),
  abilities: {
    Q: {
      notes: ['Use Q:isolated when Obliterate hits only the target (dv.IsolationScalar bonus).'],
      components: [{ id: 'obliterate', label: 'Obliterate', type: 'magic', amount: 'calc.QDamage', aoe: true }],
      variants: {
        isolated: {
          label: 'isolated',
          components: [{ id: 'obliterate', label: 'Obliterate (isolated)', type: 'magic', amount: 'calc.EmpoweredDamageTooltip', aoe: true }],
        },
      },
    },
    W: { noTarget: true, components: [] },
    E: {
      notes: ['Damage and pull 0.5s after the cast (wiki). The pull is a short airborne displacement (0.25s assumed).'],
      cc: [{ kind: 'immobilize', duration: 0.25 }],
      components: [{ id: 'grasp', label: "Death's Grasp", type: 'magic', amount: 'calc.TotalDamage', delay: 'dv.DelayBeforeMovement', aoe: true }],
    },
    R: {
      notes: [
        'Steals dv.StatStealPercentScalar of the target\'s stats for dv.SpiritRealmDuration: modeled as a 10% armor and MR reduction on the target.',
        'The stats Mordekaiser gains (target AD/AP/HP/resists) are not modeled.',
      ],
      debuff: {
        id: 'realmOfDeath',
        label: 'Realm of Death',
        duration: 'dv.SpiritRealmDuration',
        armorReduction: 'dv.StatStealPercentScalar',
        mrReduction: 'dv.StatStealPercentScalar',
      },
      components: [],
    },
  },
};
export default kit;
