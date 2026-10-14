import type { ChampionKit } from '../../engine/kit-types.ts';
import type { Sim } from '../../engine/sim.ts';

// Malzahar — patch 16.20.

// Voidling attack speed (not in the spell data): 0.665 at level 1 → 0.891 at level 18 (wiki).
const VOIDLING_AS = '(0.665 + (0.891 - 0.665) * (min(level, 18) - 1) / 17)';

/** Malefic Visions refresh: a Q/R hit on a target with visions restarts the full duration. */
function refreshVisions(sim: Sim) {
  const last = sim.counter('malzE:lastTick');
  if (sim.time > last + 1e-9) return; // no visions active
  const step = sim.evalExpr('E.dv.SecondsPerTick', { slot: 'E' });
  const newLast = sim.time + sim.evalExpr('E.dv.Duration', { slot: 'E' });
  // Extra ticks continue the existing tick grid up to the new end.
  let lastTick = last;
  for (let t = last + step; t <= newLast + 1e-9; t += step) {
    lastTick = t;
    sim.scheduleAt(t, () =>
      sim.deal({
        source: 'E',
        sourceLabel: 'Malefic Visions',
        label: 'Malefic Visions (refreshed)',
        type: 'magic',
        amount: sim.evalExpr('E.calc.TotalDamage * E.dv.SecondsPerTick / E.dv.Duration', { slot: 'E' }),
        flags: { kind: 'ability', slot: 'E', ability: true, dot: true },
      }),
    );
  }
  sim.setCounter('malzE:lastTick', lastTick);
}

const kit: ChampionKit = {
  id: 'Malzahar',
  status: 'curated',
  notes: [
    'Void Swarm stacks: casting Q/E/R adds a stack (max W.dv.StackCap); W summons 1 Voidling + 1 per stack. Starting stacks are an option (stacks never expire, so Malzahar usually enters a fight with 2).',
    'Voidlings attack the target for the "Voidling uptime" option (default 4s) at 0.665–0.891 attacks/s by level (wiki).',
    'Malefic Visions is refreshed to its full duration whenever Call of the Void or Nether Grasp damages the target while it is active.',
  ],
  options: [
    { key: 'wStacks', label: 'Void Swarm stacks at start', default: 2, min: 0, max: 2 },
    { key: 'voidlingUptime', label: 'Voidling uptime (s)', default: 4, min: 0, max: 10, step: 0.5, description: 'Seconds each Voidling spends attacking the target.' },
  ],
  hooks: {
    onStart(sim) {
      sim.setCounter('malzW:stacks', sim.opt.wStacks ?? 2);
      sim.setCounter('malzE:lastTick', -1);
    },
    onCast(sim, cast) {
      const cap = sim.evalExpr('W.dv.StackCap', { slot: 'W' });
      if (cast.slot === 'W') {
        sim.setCounter('malzVoidlings', 1 + Math.min(cap, sim.counter('malzW:stacks')));
        sim.setCounter('malzW:stacks', 0);
      } else if (cast.slot !== 'P') {
        sim.setCounter('malzW:stacks', Math.min(cap, sim.counter('malzW:stacks') + 1));
      }
      if (cast.slot === 'E' && cast.hitsTarget) {
        // Last tick of the default cast: cast time + Duration (ticks every SecondsPerTick after landing).
        sim.setCounter('malzE:lastTick', sim.time + (sim.spellFor('E').castTime ?? 0) + sim.evalExpr('E.dv.Duration', { slot: 'E' }));
      }
    },
    afterDamage(sim, inst) {
      if (inst.fromMark || (inst.flags.slot !== 'Q' && inst.flags.slot !== 'R')) return;
      refreshVisions(sim);
    },
  },
  abilities: {
    Q: {
      cc: [{ kind: 'impair', duration: 'dv.SilenceDuration' }],
      components: [{ id: 'void', label: 'Call of the Void', type: 'magic', amount: 'calc.TotalDamageTooltip', delay: 'dv.DelayPostCast', aoe: true }],
    },
    W: {
      notes: ['Voidlings spawn dv.SummonDelay apart; modeled as all of them attacking in parallel after dv.SummonDelay.'],
      components: [
        {
          id: 'voidling',
          label: 'Voidling',
          type: 'magic',
          amount: 'calc.VoidlingBonusDamageTooltip',
          hits: `max(1, stacks.malzVoidlings) * floor(min(opt.voidlingUptime, dv.VoidlingDuration) * ${VOIDLING_AS})`,
          interval: `1 / (${VOIDLING_AS} * max(1, stacks.malzVoidlings))`,
          delay: 'dv.SummonDelay',
          pet: true,
        },
      ],
    },
    E: {
      components: [
        {
          id: 'visions',
          label: 'Malefic Visions',
          type: 'magic',
          amount: 'calc.TotalDamage * dv.SecondsPerTick / dv.Duration',
          hits: 'dv.Duration / dv.SecondsPerTick',
          interval: 'dv.SecondsPerTick',
          delay: 'dv.SecondsPerTick',
          dot: true,
        },
      ],
    },
    R: {
      // Channel: Malzahar can't act during the suppression.
      lockout: 'dv.CCDuration',
      notes: [
        'Channelled for dv.CCDuration (blocks the next combo step). Beam: dv.BeamDamageTicks ticks every 0.25s.',
        'Null Zone ticks every 0.5s for dv.PoolDuration; by default only the ticks during the suppression count (the target walks out afterwards). Use R{zone:10} for the full zone.',
      ],
      cc: [{ kind: 'immobilize', duration: 'dv.CCDuration' }],
      components: [
        { id: 'beam', label: 'Nether Grasp', type: 'magic', amount: 'calc.TotalDamageTooltip / dv.BeamDamageTicks', hits: 'dv.BeamDamageTicks', interval: 'dv.CCDuration / dv.BeamDamageTicks', delay: 'dv.CCDuration / dv.BeamDamageTicks', dot: true },
        {
          id: 'zone',
          label: 'Null Zone',
          type: 'magic',
          amount: 'calc.ZoneDamageTooltip * target.maxHp * 0.5 / dv.PoolDuration',
          hits: 'dv.CCDuration / 0.5',
          maxHits: 'dv.PoolDuration / 0.5',
          interval: 0.5,
          delay: 0.5,
          aoe: true,
          dot: true,
        },
      ],
    },
  },
};
export default kit;
