import type { ChampionKit, DebuffSpec } from '../../engine/kit-types.ts';
import type { Sim } from '../../engine/sim.ts';

// Ornn — patch 16.20.
// Brittle (from W's last tick and each pass of R) is consumed by Ornn's next attack or by an
// immobilizing effect (E knock-up, R recast knock-up), dealing % max health magic damage. The hook
// detonates it.

const brittle: DebuffSpec = { id: 'brittle', label: 'Brittle', duration: 'W.dv.BrittleDuration' };
const brittleR: DebuffSpec = { ...brittle, duration: 'R.dv.BrittleDurationTOOLTIPONLY' };

const kit: ChampionKit = {
  id: 'Ornn',
  status: 'curated',
  notes: [
    'Living Forge: +10% bonus armor, magic resist and health (BaseStatAmp); masterwork upgrades are not modeled.',
    'Brittle is consumed by Ornn\'s next attack or an immobilizing effect from another cast (E knock-up, R recast), dealing the Brittle % max health magic damage.',
  ],
  stats: ({ evalExpr }) => {
    const amp = evalExpr('P.dv.BaseStatAmp');
    return {
      conversions: [
        { from: 'bonusArmor', to: 'armor', ratio: amp, source: 'Living Forge' },
        { from: 'bonusMr', to: 'mr', ratio: amp, source: 'Living Forge' },
        { from: 'bonusHp', to: 'hp', ratio: amp, source: 'Living Forge' },
      ],
    };
  },
  abilities: {
    Q: {
      cc: [{ kind: 'slow', duration: 'dv.SlowDuration' }],
      components: [{ id: 'fissure', label: 'Volcanic Rupture', type: 'physical', amount: 'calc.TotalDamage', aoe: true, delay: 0.2 }],
    },
    W: {
      // Busy for the cast time (0.25 s) + the breath.
      lockout: '0.25 + dv.BreathDuration',
      notes: ['5 ticks over 0.75 s, each the larger of PercentHPPerTick × max health and MinimumDamagePerTick; the last tick applies Brittle.'],
      debuff: { ...brittle, afterHits: 5 }, // after the last of dv.NumberOfTicks ticks
      components: [
        {
          id: 'breath',
          label: 'Bellows Breath',
          type: 'magic',
          amount: 'max(dv.PercentHPPerTick * target.maxHp, dv.MinimumDamagePerTick)',
          hits: 'dv.NumberOfTicks',
          interval: 'dv.BreathDuration / dv.NumberOfTicks',
          delay: 'dv.BreathDuration / dv.NumberOfTicks',
          aoe: true,
        },
      ],
    },
    E: {
      dash: true,
      cc: [{ kind: 'immobilize', duration: 'dv.KnockupDuration' }],
      notes: ['Default: Ornn rams terrain (e.g. his Q pillar) and knocks up. Variant "noWall": no terrain, no knock-up. The target takes the damage once either way.'],
      variants: {
        noWall: {
          label: 'no terrain',
          dash: true,
          cc: [],
          components: [{ id: 'charge', label: 'Searing Charge', type: 'physical', amount: 'calc.TotalDamage', aoe: true, delay: 0.3 }],
        },
      },
      components: [{ id: 'charge', label: 'Searing Charge', type: 'physical', amount: 'calc.TotalDamage', aoe: true, delay: 0.3 }],
    },
    R: {
      recasts: 2,
      // The recast is possible once the elemental has passed (cast time 0.5 s + 1 s travel).
      recastDelay: 1.5,
      defaultVariant: 'pass',
      notes: [
        'R: the elemental passes through the target (assumed 1 s after the cast): damage + Brittle + slow.',
        'R:recast: Ornn headbutts the elemental back through the target: damage, knock-up (consumes Brittle) and Brittle again. Combo: "R R:recast".',
      ],
      variants: {
        pass: {
          label: 'first pass',
          cc: [{ kind: 'slow', duration: 'dv.RSlowDuration' }],
          debuff: brittleR,
          components: [{ id: 'elemental', label: 'Call of the Forge God', type: 'magic', amount: 'calc.RDamageCalc', aoe: true, delay: 1 }],
        },
        recast: {
          label: 'recast',
          dash: true,
          cc: [{ kind: 'immobilize', duration: 'dv.RStunDuration' }],
          components: [{ id: 'elemental', label: 'Call of the Forge God (recast)', type: 'magic', amount: 'calc.RDamageCalc', aoe: true, delay: 0.5 }],
        },
      },
    },
  },
  hooks: {
    afterDamage(sim, inst) {
      if (inst.flags.attack && !inst.fromMark) detonate(sim, inst.castId);
    },
    onCrowdControl(sim, cc) {
      if (cc.kind !== 'immobilize') return;
      detonate(sim, cc.castId);
      // The redirected elemental reapplies Brittle after its knock-up consumed the previous one.
      if (cc.slot === 'R') sim.applyDebuff(brittleR, 'R', sim.spellFor('R'), sim.rankOf('R'), cc.castId);
    },
  },
};

/** Consume Brittle applied by another cast: % max health magic damage. */
function detonate(sim: Sim, castId: number) {
  const d = sim.getDebuff('brittle');
  if (!d || d.castId === castId) return;
  sim.removeDebuff('brittle');
  sim.deal({
    source: 'W',
    sourceLabel: 'Brittle',
    label: 'Brittle',
    type: 'magic',
    amount: sim.evalExpr('W.calc.BrittlePercentMaxHPCalc * target.maxHp', { slot: 'W' }),
    flags: { kind: 'ability', slot: 'W', ability: true },
    markSource: 'brittle',
  });
}

export default kit;
