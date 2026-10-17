import type { ChampionKit, DebuffSpec } from '../../engine/kit-types.ts';
import type { Sim } from '../../engine/sim.ts';

// Ornn — patch 16.20.
// Brittle (from W's last tick and each pass of R) is consumed by Ornn's next attack or by an
// immobilizing effect (E knock-up, R recast knock-up), dealing % max health magic damage. The hook
// detonates it.

const brittle: DebuffSpec = { id: 'brittle', label: 'Brittle', duration: 'W.dv.BrittleDuration' };
const brittleR: DebuffSpec = { ...brittle, duration: 'R.dv.BrittleDurationTOOLTIPONLY' };

// Seconds from R's cast start until the elemental has run `run` units toward Ornn: it rises
// dv.RCastRange away as the cast starts ({{Effect at cast time start}}) and charges at 450 speed,
// reaching its max speed in ~0.6s (wiki), then runs the rest at dv.RMissileMaxSpeed.
const elementalAfter = (run: string) => `0.6 + (${run} - 0.6 * (450 + dv.RMissileMaxSpeed) / 2) / dv.RMissileMaxSpeed`;
/** Until it reaches Ornn. */
const ELEMENTAL = elementalAfter('dv.RCastRange');

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
      // {{Effect at cast time start}} (wiki): the fissure runs to the target from the start of the cast.
      components: [{ id: 'fissure', label: 'Volcanic Rupture', type: 'physical', amount: 'calc.TotalDamage', aoe: true, travel: 'max(0, reach / missileSpeed - castTime)' }],
    },
    W: {
      // Wiki: unable to act while he marches for the breath's 0.75s.
      lockout: 'dv.BreathDuration',
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
      // Charges at the dash speed in the target direction, up to his 650 dash distance (dv.DashRange;
      // the data's range is the 800 targeting range), passing through the target; terrain stops him,
      // here just behind it. Wiki: unable to act for 0.5s after the dash ends.
      lockout: 'castTime + min(distance, dv.DashRange) / missileSpeed + 0.5',
      cc: [{ kind: 'immobilize', duration: 'dv.KnockupDuration' }],
      notes: ['Default: Ornn rams terrain (e.g. his Q pillar) and knocks up. Variant "noWall": no terrain, no knock-up. The target takes the damage once either way.'],
      variants: {
        noWall: {
          label: 'no terrain',
          dash: true,
          // The whole dash distance.
          lockout: 'castTime + dv.DashRange / missileSpeed + 0.5',
          cc: [],
          components: [{ id: 'charge', label: 'Searing Charge', type: 'physical', amount: 'calc.TotalDamage', aoe: true, travel: 'min(distance, dv.DashRange) / missileSpeed' }],
        },
      },
      components: [{ id: 'charge', label: 'Searing Charge', type: 'physical', amount: 'calc.TotalDamage', aoe: true, travel: 'min(distance, dv.DashRange) / missileSpeed' }],
    },
    R: {
      recasts: 2,
      // The recast is possible once the elemental has passed.
      recastDelay: ELEMENTAL,
      defaultVariant: 'pass',
      notes: [
        'R: the elemental passes through the target, next to Ornn: damage + Brittle + slow.',
        'R:recast: Ornn headbutts the elemental back through the target: damage, knock-up (consumes Brittle) and Brittle again. Combo: "R R:recast".',
      ],
      variants: {
        pass: {
          label: 'first pass',
          cc: [{ kind: 'slow', duration: 'dv.RSlowDuration' }],
          debuff: brittleR,
          components: [{ id: 'elemental', label: 'Call of the Forge God', type: 'magic', amount: 'calc.RDamageCalc', aoe: true, travel: `${elementalAfter('dv.RCastRange - distance')} - castTime` }],
        },
        recast: {
          label: 'recast',
          dash: true,
          // Wiki: locked out of all actions during the dash (its 300 range at the dash speed) and for
          // 0.5s afterwards. The elemental is struck next to the target.
          lockout: 'castTime + castRange / missileSpeed + 0.5',
          cc: [{ kind: 'immobilize', duration: 'dv.RStunDuration' }],
          components: [{ id: 'elemental', label: 'Call of the Forge God (recast)', type: 'magic', amount: 'calc.RDamageCalc', aoe: true, travel: true }],
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
    flags: { kind: 'ability', slot: 'W', ability: false, proc: true },
    markSource: 'brittle',
  });
}

export default kit;
