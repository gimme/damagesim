import type { ChampionKit } from '../../engine/kit-types.ts';
import type { Sim } from '../../engine/sim.ts';

// Master Yi — patch 16.20.
// Double Strike's second strike is a real attack (on-hit incl. Wuju Style, on-attack, own crit roll,
// adds a Double Strike stack), so it is fired from a hook through the attack pipeline.

// Second strike follows the first almost immediately (assumed 0.1s).
const SECOND_STRIKE_DELAY = 0.1;
// Alpha Strike marks a target every 0.231s (wiki).
const MARK = 0.231;
// Yi can act again 1.087s after Alpha Strike's cast starts (4 marks, game ticks; wiki).
const ALPHA_STRIKE_END = 1.087;

function reduceQCooldown(sim: Sim) {
  const ready = sim.cooldownReadyAt('ability:Q');
  if (ready > sim.time) sim.startCooldown('ability:Q', Math.max(0, ready - sim.time - sim.evalExpr('Q.dv.BasicAttackCDR', { slot: 'Q' })));
}

const kit: ChampionKit = {
  id: 'MasterYi',
  status: 'curated',
  notes: [
    'Double Strike: every P.dv.AttackCount-th attack is followed by a second strike for P.calc.TotalDamage that applies on-hit (incl. Wuju Style) and on-attack effects, rolls its own crit and counts toward the next Double Strike. Stacks expire after P.dv.StackDuration s without attacking.',
    'Basic attacks reduce Alpha Strike\'s cooldown by Q.dv.BasicAttackCDR s.',
    'Meditate (healing/damage reduction) is not modeled.',
  ],
  options: [{ key: 'doubleStrikeStacks', label: 'Double Strike stacks at start', default: 0, min: 0, max: 3 }],
  hooks: {
    onStart(sim) {
      sim.setCounter('yi:stacks', sim.opt.doubleStrikeStacks ?? 0);
      sim.setCounter('yi:lastAttack', sim.time);
    },
    onAttack(sim, atk) {
      if (atk.phantom || atk.fromAbility) return;
      const second = sim.counter('yi:second') > 0;
      if (!second) reduceQCooldown(sim);
      const keep = sim.time - sim.counter('yi:lastAttack') <= sim.evalExpr('P.dv.StackDuration', { slot: 'P' });
      let n = (keep ? sim.counter('yi:stacks') : 0) + 1;
      sim.setCounter('yi:lastAttack', sim.time);
      if (!second && n >= sim.evalExpr('P.dv.AttackCount', { slot: 'P' })) {
        n = 0;
        sim.schedule(SECOND_STRIKE_DELAY, () => {
          if (sim.target.hp <= 0) return;
          sim.setCounter('yi:second', 1);
          sim.performAttackHit({ castId: sim.newCastId(), amount: sim.evalExpr('P.calc.TotalDamage', { slot: 'P' }), label: 'Double Strike', sourceLabel: 'Double Strike' });
          sim.setCounter('yi:second', 0);
        });
      }
      sim.setCounter('yi:stacks', n);
    },
  },
  abilities: {
    Q: {
      // No cast time: Yi vanishes and marks the target every MARK s (dv.AlphaStrikeBounces marks), then
      // reappears. Until he can act again he can't attack or Meditate, but can cast Wuju Style and
      // Highlander (wiki).
      attackLockout: ALPHA_STRIKE_END,
      castLockout: { W: ALPHA_STRIKE_END },
      notes: [
        'Single target: dv.AlphaStrikeBounces marks; the first deals calc.TotalDamage when Yi reappears, the others dv.SubsequentHitMultiplier each. All can crit.',
        'On-hit effects: the game applies them at dv.BaseOnHitMultiplier (75%) on the first mark and 18.75% on each repeat; modeled as one application at the summed effectiveness (131.25%) on the main strike. Kit on-hits (Wuju Style) apply once at 100%.',
      ],
      components: [
        {
          id: 'repeat',
          label: 'Alpha Strike (repeat)',
          type: 'physical',
          amount: 'calc.SubesquentDamage',
          hits: 'dv.AlphaStrikeBounces - 1',
          maxHits: 'dv.AlphaStrikeBounces - 1',
          interval: MARK,
          // Marks after the first on the same target detonate as they're applied.
          delay: 2 * MARK,
          canCrit: true,
          aoe: true,
        },
        {
          id: 'strike',
          label: 'Alpha Strike',
          type: 'physical',
          amount: 'calc.TotalDamage',
          // The first mark detonates as Yi reappears, after the last mark.
          delay: `dv.AlphaStrikeBounces * ${MARK}`,
          canCrit: true,
          onHit: true,
          onHitEffectiveness: 'dv.BaseOnHitMultiplier * (1 + dv.SubsequentHitMultiplier * (dv.AlphaStrikeBounces - 1))',
          aoe: true,
          areaOnHit: true,
        },
      ],
    },
    W: { noTarget: true, components: [] },
    E: {
      noTarget: true,
      buff: { id: 'wujuStyle', label: 'Wuju Style', duration: 'dv.Duration', onHit: [{ id: 'wuju', label: 'Wuju Style', type: 'true', amount: 'E.calc.TotalDamage', proc: true }] },
      components: [],
    },
    R: {
      noTarget: true,
      buff: { id: 'highlander', label: 'Highlander', duration: 'dv.RDuration', stats: { attackSpeed: 'dv.RASBonus / 100', msPercent: 'dv.RMSBonus / 100' } },
      components: [],
    },
  },
};
export default kit;
