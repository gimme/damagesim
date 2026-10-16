import type { ChampionKit, DebuffSpec } from '../../engine/kit-types.ts';

// Irelia — patch 16.20.
// Ionian Fervor: one stack per ability hit on a champion (max P.dv.MaxStacks, P.dv.BuffDuration s),
// P.calc.SingleStackAS % attack speed per stack (hook) and P.calc.OnHitBonus on-hit at max stacks.
// Unsteady (E/R) refreshes Bladesurge's cooldown when Q hits the target (hook).
const unsteady: DebuffSpec = { id: 'unsteady', label: 'Unsteady', duration: 'dv.MarkDuration' };

const kit: ChampionKit = {
  id: 'Irelia',
  status: 'curated',
  notes: [
    'Ionian Fervor stacks come from ability hits only; attacks refreshing the stack duration is not modeled (6s is long enough for a normal combo).',
    'Bladesurge on an Unsteady target consumes the mark and refreshes Q\'s cooldown.',
  ],
  marks: [
    {
      id: 'fervor',
      label: 'Ionian Fervor',
      maxStacks: 'P.dv.MaxStacks',
      duration: 'P.dv.BuffDuration',
      appliedBy: ['ability'],
      atMax: {
        components: [],
        buff: {
          id: 'fervorMax',
          label: 'Ionian Fervor (max)',
          duration: 'P.dv.BuffDuration',
          onHit: [{ id: 'fervor', label: 'Ionian Fervor', type: 'magic', amount: 'P.calc.OnHitBonus', proc: true }],
        },
      },
    },
  ],
  abilities: {
    Q: {
      dash: true,
      notes: ['Applies on-hit effects (wiki); cannot crit.'],
      components: [{ id: 'surge', label: 'Bladesurge', type: 'physical', amount: 'calc.ChampionDamage', onHit: true, delay: 0.15 }],
    },
    W: {
      // Charged for up to MaxDuration; the damage grows to its maximum over ChargeTimeForMax.
      charge: { default: 'dv.ChargeTimeForMax', max: 'dv.MaxDuration' },
      castTime: 'charge',
      notes: ['Default: charged for dv.ChargeTimeForMax seconds (max damage). Set the seconds held (W{0s} for an instant release): the damage grows from min to max until then.'],
      components: [{ id: 'dance', label: 'Defiant Dance', type: 'physical', amount: 'lerp(calc.MinDamageCalc, calc.MaxDamageCalc, min(1, charge / dv.ChargeTimeForMax))', aoe: true }],
    },
    E: {
      // One step = both casts. The step lasts until the blades meet (recast delay + blade travel) so the
      // next step sees the stun and Unsteady.
      castTime: 'dv.CDBetweenCast + dv.RevTime',
      notes: ['One step = both casts (recast after dv.CDBetweenCast, blades meet dv.RevTime later).'],
      cc: [{ kind: 'immobilize', duration: 'dv.StunDuration' }],
      debuff: unsteady,
      components: [{ id: 'duet', label: 'Flawless Duet', type: 'magic', amount: 'calc.TotalDamage', aoe: true }],
    },
    R: {
      notes: ['The cage damages and slows only an enemy that walks through the blades: R+cage.'],
      debuff: unsteady,
      components: [
        { id: 'barrage', label: "Vanguard's Edge", type: 'magic', amount: 'calc.MissileDamage', aoe: true, delay: 0.2 },
        { id: 'cage', label: "Vanguard's Edge (cage)", type: 'magic', amount: 'calc.ZoneDamage', aoe: true, optional: true, delay: 1, condition: 'target crosses the blade wall' },
      ],
    },
  },
  hooks: {
    onStart(sim) {
      // Per-stack attack speed (percent units in the data). Read once: dynamicStats must not evaluate expressions.
      sim.setCounter('irelia.asPerStack', sim.evalExpr('P.calc.SingleStackAS', { slot: 'P' }) / 100);
    },
    dynamicStats(sim) {
      const stacks = sim.markStacks('fervor') ?? 0;
      return stacks > 0 ? { attackSpeed: stacks * sim.counter('irelia.asPerStack') } : undefined;
    },
    onCast(sim, cast) {
      if (cast.slot !== 'Q' || !cast.hitsTarget || !sim.getDebuff('unsteady')) return;
      sim.removeDebuff('unsteady');
      // The cast sets Q's cooldown after this hook; refresh it from an event at the cast time.
      sim.schedule(0, () => sim.startCooldown('ability:Q', 0));
    },
  },
};
export default kit;
