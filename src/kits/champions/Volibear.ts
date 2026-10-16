import type { ChampionKit } from '../../engine/kit-types.ts';
import type { Sim } from '../../engine/sim.ts';

// Volibear — patch 16.20.
// The Relentless Storm: every attack/ability that deals damage adds a stack (tracked as a kit mark);
// each stack grants attack speed, and at max stacks attacks (and W, which applies on-hit) deal chain
// lightning — including the hit that reaches max stacks (wiki).
const STORM = 'storm';

function maxStorm(sim: Sim) {
  return sim.dataValue(sim.spellFor('P'), 'BounceCounterMax', 1);
}

const kit: ChampionKit = {
  id: 'Volibear',
  status: 'curated',
  notes: [
    'Relentless Storm stacks are tracked on the target as a proxy for Volibear\'s own buff. The per-stack attack speed omits its small AP ratio.',
    'Stormbringer\'s damage only hits enemies at the center of the landing (wiki); the default assumes Volibear lands on the target (disable with R{slam:0}).',
  ],
  marks: [
    {
      id: STORM,
      label: 'The Relentless Storm (stacks)',
      maxStacks: 'P.dv.BounceCounterMax',
      duration: 'P.dv.BuffDuration',
      appliedBy: ['attack', 'ability'],
    },
  ],
  abilities: {
    Q: {
      resetsAttack: true,
      notes: [
        'Empowers the next attack within 4s: it deals Q damage instead of normal attack damage and stuns. Only the attack\'s AD part can crit (expected value used). Write "Q AA".',
      ],
      buff: {
        id: 'voliQ',
        label: 'Thundering Smash',
        duration: 'dv.Duration',
        empowerAttacks: {
          count: 1,
          replaceBase: true,
          resetsAttack: true,
          components: [{ id: 'smash', label: 'Thundering Smash', type: 'physical', amount: 'Q.calc.CalculatedDamage + critChance * ad * (critDamage - 1)' }],
        },
      },
    },
    W: {
      notes: ['Applies on-hit effects. A second W on a marked target (within 8s) deals the empowered damage.'],
      debuff: { id: 'voliW', label: 'Frenzied Maul (mark)', duration: 'dv.MarkDuration' },
      components: [{ id: 'maul', label: 'Frenzied Maul', type: 'physical', amount: 'debuff.voliW ? calc.EmpoweredDamage : calc.TotalDamage', onHit: true, onAttack: true }],
    },
    E: {
      notes: ['Lightning strikes 2s after the cast (wiki).'],
      cc: [{ kind: 'slow', duration: 'dv.SlowDuration' }],
      components: [{ id: 'bolt', label: 'Sky Splitter', type: 'magic', amount: 'calc.TotalDamageTooltip + dv.PercentDamage * target.maxHp', aoe: true, delay: 2 }],
    },
    R: {
      dash: true,
      notes: ['Lands ≈0.75s after the cast (approximation); grants bonus health and attack range for the transform duration.'],
      buff: { id: 'voliR', label: 'Stormbringer', duration: 'dv.TransformDuration', stats: { hp: 'dv.HealthAmount', range: 'dv.BonusAttackRange' } },
      cc: [{ kind: 'slow', duration: 'dv.SlowDuration' }],
      components: [{ id: 'slam', label: 'Stormbringer', type: 'physical', amount: 'calc.SweetSpotDamageTooltip', aoe: true, delay: 0.75 }],
    },
  },
  hooks: {
    dynamicStats(sim) {
      const stacks = sim.markStacks(STORM) ?? 0;
      if (stacks <= 0) return;
      return { attackSpeed: stacks * sim.dataValue(sim.spellFor('P'), 'PAttackSpeed', 1) };
    },
    onAttack(sim, atk) {
      if (atk.phantom) return;
      if (atk.extra.some((x) => x.sourceLabel === 'Thundering Smash')) {
        sim.applyCC('immobilize', sim.evalExpr('Q.dv.StunDuration', { slot: 'Q' }), atk.castId, 'Q');
      }
      // A basic attack's own stack is added after this hook runs; W's already counted.
      const stacks = (sim.markStacks(STORM) ?? 0) + (atk.fromAbility ? 0 : 1);
      if (stacks < maxStorm(sim)) return;
      atk.extra.push({
        source: 'P',
        sourceLabel: 'The Relentless Storm',
        label: 'Chain lightning',
        type: 'magic',
        amount: sim.evalExpr('P.calc.ChainLightningDamage', { slot: 'P' }),
        castId: atk.castId,
        flags: { kind: 'ability', slot: 'P', onHit: true, ability: false, proc: true, aoe: true },
      });
    },
  },
};
export default kit;
