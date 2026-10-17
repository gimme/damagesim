import type { ChampionKit, BuffSpec } from '../../engine/kit-types.ts';
import type { Sim } from '../../engine/sim.ts';

// Lucian — patch 16.20.
// Lightslinger's second shot is a real attack (on-hit, on-attack, life steal, own crit roll), so it is
// launched from a hook through the simulator's attack pipeline 0.25s after the first shot (wiki).

const SECOND_SHOT_DELAY = 0.25;
/** Lightslinger shots in flight: each refunds Relentless Pursuit's cooldown as it hits. */
const SHOTS = 'lucian:shots';

const vigilance: BuffSpec = {
  id: 'vigilance',
  label: 'Vigilance',
  duration: 'P.dv.OnhitPassiveDuration',
  empowerAttacks: { count: 'P.dv.NumAuto', components: [{ id: 'overcharged', label: 'Vigilance', type: 'magic', amount: 'P.calc.PassiveTotalDamage' }] },
};

/** Expected (or forced) crit factor for a crit multiplier under the current crit mode. */
function critFactor(sim: Sim, mult: number) {
  if (sim.critMode() === 'always') return mult;
  if (sim.critMode() === 'never') return 1;
  return 1 + Math.min(1, sim.stats.critChance) * (mult - 1);
}

/** Relentless Pursuit: each Lightslinger shot that hits a champion refunds cooldown. */
function refundE(sim: Sim) {
  const ready = sim.cooldownReadyAt('ability:E');
  if (ready > sim.time) sim.startCooldown('ability:E', Math.max(0, ready - sim.time - sim.evalExpr('E.dv.CDRefundChampion', { slot: 'E' })));
}

const kit: ChampionKit = {
  id: 'Lucian',
  status: 'curated',
  notes: [
    'Lightslinger: after any ability cast (Q/W/E/R) the next attack within P.dv.PassiveDuration fires a second shot 0.25s later for P.calc.TotalDamage. It is a full attack (on-hit, on-attack, life steal) and crits for 175% + bonus crit damage (from the passive\'s CritDamage formula).',
    'Each Lightslinger shot refunds E.dv.CDRefundChampion s of Relentless Pursuit\'s cooldown.',
    'Vigilance (ally heal/shield or ally immobilize) is an option: the first P.dv.NumAuto shots deal bonus magic damage; the second Lightslinger shot uses a charge.',
  ],
  options: [{ key: 'vigilance', label: 'Vigilance at start', default: 0, toggle: true, description: 'An ally healed/shielded Lucian or immobilized the target just before the combo.' }],
  hooks: {
    onStart(sim) {
      if (sim.opt.vigilance) sim.applyBuff(vigilance, 'P', sim.spellFor('P'), 1);
    },
    onCast(sim, cast) {
      if (cast.slot === 'P') return;
      // The shot is available after the cast ends (R: after the channel).
      const castTime = cast.slot === 'R' ? sim.evalExpr('R.dv.Duration', { slot: 'R' }) : (sim.spellFor(cast.slot).castTime ?? 0);
      sim.setCounter('lucian:lightslingerUntil', sim.time + castTime + sim.evalExpr('P.dv.PassiveDuration', { slot: 'P' }));
    },
    // The double shot is decided as the attack is launched: a cast while its missile flies grants the
    // next attack's.
    onLaunch(sim, launch) {
      if (launch.fromAbility || sim.counter('lucian:secondShot')) return;
      if (sim.time > sim.counter('lucian:lightslingerUntil') + 1e-9) return;
      sim.setCounter('lucian:lightslingerUntil', -1);
      sim.setCounter(`${SHOTS}:${launch.castId}`, 1);
      sim.schedule(SECOND_SHOT_DELAY, () => {
        if (sim.target.hp <= 0) return;
        const st = sim.stats;
        // Pre-scale so that the pipeline's crit factor (critDamage) becomes the passive's own (CritDamage formula: 175% + bonus crit damage).
        const scale = critFactor(sim, sim.evalExpr('P.calc.CritDamage / P.calc.TotalDamage', { slot: 'P' })) / critFactor(sim, st.critDamage);
        const castId = sim.newCastId();
        sim.setCounter(`${SHOTS}:${castId}`, 1);
        sim.setCounter('lucian:secondShot', 1);
        sim.launchAttack({
          castId,
          amount: sim.evalExpr('P.calc.TotalDamage', { slot: 'P' }) * scale,
          label: 'Lightslinger (2nd shot)',
          sourceLabel: 'Lightslinger',
        });
        sim.setCounter('lucian:secondShot', 0);
      });
    },
    onAttack(sim, atk) {
      if (atk.phantom || !sim.counter(`${SHOTS}:${atk.castId}`)) return;
      sim.setCounter(`${SHOTS}:${atk.castId}`, 0);
      refundE(sim);
    },
  },
  abilities: {
    Q: {
      components: [{ id: 'light', label: 'Piercing Light', type: 'physical', amount: 'calc.TotalDamage', aoe: true }],
    },
    W: {
      notes: ['The move speed on marked targets is not modeled.'],
      components: [{ id: 'blaze', label: 'Ardent Blaze', type: 'magic', amount: 'calc.TotalDamage', travel: true, aoe: true }],
    },
    E: {
      dash: true,
      noTarget: true,
      // Resets the attack timer; he can cast any ability during the dash (wiki), not attack.
      resetsAttack: true,
      attackLockout: 'castTime + castRange / missileSpeed',
      components: [],
    },
    R: {
      // Channel: no attacks or Q/W while firing (Relentless Pursuit is usable but blocked here too).
      lockout: 'dv.Duration',
      variableDuration: true,
      notes: [
        'Channelled for dv.Duration (blocks the next combo step). All calc.TotalNumShots shots (crit chance adds shots) are assumed to hit; shots can\'t crit or apply on-hit.',
        'Set the seconds (R{1s}) to cancel it early.',
      ],
      components: [
        {
          id: 'shot',
          label: 'The Culling',
          type: 'physical',
          amount: 'calc.DamagePerBullet',
          hits: 'calc.TotalNumShots',
          interval: 'dv.Duration / calc.TotalNumShots',
          delay: 'dv.Duration / calc.TotalNumShots',
          travel: true,
          aoe: true,
          dot: true,
        },
      ],
    },
  },
};
export default kit;
