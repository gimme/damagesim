import type { ChampionKit } from '../../engine/kit-types.ts';
import type { Sim } from '../../engine/sim.ts';
import { effectiveResist, resistMultiplier } from '../../engine/damage.ts';

// Mel — patch 16.20.

const OVERWHELM = 'P.dv.OverwhelmDuration';
const PROJECTILE = 'Searing Brilliance (projectile)';
const STORED = "spell['MelR'].calc.PassiveFlatDamage + spell['MelR'].calc.PassiveStackDamage * stacks.overwhelm";

/** Overwhelm execute: once the stored damage (after MR) reaches the target's health, it is executed. */
function checkExecute(sim: Sim) {
  if (!sim.markStacks('overwhelm')) return;
  const stored = sim.evalExpr(STORED, { slot: 'P' });
  const s = sim.stats;
  const red = sim.targetReductions();
  const mr = effectiveResist({ base: sim.target.baseMr, bonus: sim.target.bonusMr }, { flat: red.mrFlat, percent: red.mrPercent }, { percent: s.magicPenPercent, bonusPercent: s.bonusMagicPenPercent, flat: s.magicPenFlat });
  const line = stored * resistMultiplier(mr) * (1 - sim.target.damageReduction);
  if (line < sim.target.hp) return;
  sim.deal({
    source: 'P',
    sourceLabel: 'Searing Brilliance',
    label: 'Overwhelm execute',
    type: 'true',
    amount: line,
    flags: { kind: 'ability', slot: 'P', execute: true },
  });
}

const kit: ChampionKit = {
  id: 'Mel',
  status: 'curated',
  notes: [
    'Overwhelm: every damage instance of Mel\'s attacks, passive projectiles and abilities adds a stack (5s, refreshed). When the stored damage (R.calc.PassiveFlatDamage + R.calc.PassiveStackDamage per stack, after MR) reaches the target\'s health, the target is executed.',
    'Each ability cast gives the next attack P.dv.PassiveBonusMissiles extra projectiles (max P.dv.MaxPassiveBonusMissiles, P.dv.BonusAttackDuration s); all are assumed to hit the target.',
    'Rebuttal (reflect, shield) is not modeled.',
  ],
  marks: [
    {
      id: 'overwhelm',
      label: 'Overwhelm',
      maxStacks: 999,
      duration: OVERWHELM,
      appliedBy: ['attack', 'onhit', 'ability'],
      oncePerCast: false,
    },
  ],
  hooks: {
    onCast(sim, cast) {
      if (cast.slot === 'P') return;
      // Searing Brilliance: each cast loads extra projectiles for the next attack.
      const active = sim.time <= sim.counter('melMissilesUntil');
      const max = sim.evalExpr('P.dv.MaxPassiveBonusMissiles', { slot: 'P' });
      sim.setCounter('melMissiles', Math.min(max, (active ? sim.counter('melMissiles') : 0) + sim.evalExpr('P.dv.PassiveBonusMissiles', { slot: 'P' })));
      sim.setCounter('melMissilesUntil', sim.time + sim.evalExpr('P.dv.BonusAttackDuration', { slot: 'P' }));
    },
    onAttack(sim, atk) {
      if (!atk.fromAbility && !atk.phantom) sim.setCounter('melMissiles', 0);
    },
    afterDamage(sim, inst) {
      // The projectiles are proc damage (no mark stacks from the engine) but still apply Overwhelm.
      if (inst.flags.proc && inst.label === PROJECTILE) sim.setMarkStacks('overwhelm', (sim.markStacks('overwhelm') ?? 0) + 1, sim.evalExpr(OVERWHELM, { slot: 'P' }));
      // Marks are updated after afterDamage hooks: check the execute once this hit's stack is in.
      if (!inst.fromMark && (inst.flags.kind === 'ability' || inst.flags.kind === 'attack')) sim.schedule(0, () => checkExecute(sim));
    },
  },
  attack: {
    onHit: [
      {
        id: 'radiance',
        label: PROJECTILE,
        type: 'magic',
        amount: 'P.calc.PassiveBonusMissileDamage',
        hits: 'time <= stacks.melMissilesUntil ? stacks.melMissiles : 0',
        proc: true,
      },
    ],
  },
  abilities: {
    Q: {
      notes: ['All dv.ExplosionCount explosions hit a target standing at the cast location (radius 200, offsets ≤ 50).'],
      components: [
        // Bolts fly to the target location at their speed, exploding as they land.
        { id: 'first', label: 'Radiant Volley', type: 'magic', amount: 'calc.InitialExplosionDamage', travel: true, aoe: true },
        {
          id: 'explosion',
          label: 'Radiant Volley (explosion)',
          type: 'magic',
          amount: 'calc.TotalExplosionDamage',
          hits: 'dv.ExplosionCount - 1',
          maxHits: 'dv.ExplosionCount - 1',
          interval: 'dv.ChannelDuration / dv.ExplosionCount',
          delay: 'dv.ChannelDuration / dv.ExplosionCount',
          travel: true,
          aoe: true,
        },
      ],
    },
    W: { noTarget: true, components: [] },
    E: {
      notes: ['The rooted target is assumed to take dv.DoTDuration seconds of the radiating area (dv.AreaTicksPerSecond ticks per second); raise with E{area:N}.'],
      cc: [
        { kind: 'immobilize', duration: 'dv.RootDuration' },
        { kind: 'slow', duration: 'dv.AreaSlowDuration' },
      ],
      components: [
        { id: 'orb', label: 'Solar Snare', type: 'magic', amount: 'calc.Damage', travel: true },
        {
          id: 'area',
          label: 'Solar Snare (area)',
          type: 'magic',
          amount: 'calc.AreaDamagePerSecond / dv.AreaTicksPerSecond',
          hits: 'dv.AreaTicksPerSecond * dv.DoTDuration',
          interval: '1 / dv.AreaTicksPerSecond',
          // From the orb's arrival.
          delay: '1 / dv.AreaTicksPerSecond',
          travel: true,
          aoe: true,
          dot: true,
        },
      ],
    },
    R: {
      notes: ['Damage per Overwhelm stack on the target at impact.'],
      components: [{ id: 'eclipse', label: 'Golden Eclipse', type: 'magic', amount: 'calc.UltFlatDamage + calc.UltStackDamage * stacks.overwhelm', aoe: true }],
    },
  },
};
export default kit;
