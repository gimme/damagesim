import type { ChampionKit } from '../../engine/kit-types.ts';
import type { Sim } from '../../engine/sim.ts';

// Urgot — patch 16.20.
// Echoing Flames: each of the 6 legs covers a fixed 60° arc (legs never rotate, wiki) and fires on
// the next attack / Purge shot whose target is in its arc; each leg has its own cooldown. Modeled in
// hooks: `opt.legs` legs face the target (1 = stationary trade); Disdain throws the target behind
// Urgot, so a landed E points a fresh (opposite) leg at it.
const legKey = (i: number) => `urgot.leg${((i % 6) + 6) % 6}`;

function fireLeg(sim: Sim): number | undefined {
  const facing = sim.counter('urgot.facing');
  const legs = Math.min(6, Math.max(1, Math.round(sim.opt.legs ?? 1)));
  for (let i = 0; i < legs; i++) {
    const key = legKey(facing + i);
    if (!sim.isReady(key)) continue;
    sim.startCooldown(key, sim.evalExpr('P.calc.PerLegCD', { slot: 'P' }));
    return sim.evalExpr('P.calc.ADDamage + P.calc.PercentHPRatio * target.maxHp', { slot: 'P' });
  }
  return undefined;
}

const kit: ChampionKit = {
  id: 'Urgot',
  status: 'curated',
  notes: [
    'Echoing Flames: one leg cannon per attack/Purge shot when the leg facing the target is off cooldown (per-leg cooldown from data). Option "legs" = how many different legs face the target during the fight (1 = stationary); each landed Disdain flips the target to a fresh leg.',
    'Leg cannon damage counts as ability damage (applies spell effects, wiki) and is not an on-hit effect.',
    'Purge shots are attacks at a fixed 3/s that apply on-hit effects at 50% effectiveness and cannot crit.',
    'Urgot cannot use normal basic attacks while Purge is firing — do not put AA steps inside the Purge window.',
  ],
  options: [{ key: 'legs', label: 'Legs facing the target', default: 1, min: 1, max: 6, step: 1, description: 'Different legs (60° arcs) the target is in during the fight; moving around the target uses more legs.' }],
  abilities: {
    Q: {
      cc: [{ kind: 'slow', duration: 'dv.SlowDuration' }],
      components: [{ id: 'charge', label: 'Corrosive Charge', type: 'physical', amount: 'calc.TotalDamage', aoe: true, delay: 'dv.DelayOnMissileLaunch + dv.ExplosionDelayPostMissile' }],
    },
    W: {
      notes: [
        'Fires 3 shots per second for 4 seconds (13 shots, wiki) at ranks 1–4; at max rank Purge is a toggle, modeled as the same 4-second window (override with W{shot:N}).',
      ],
      components: [
        {
          id: 'shot',
          label: 'Purge shot',
          type: 'physical',
          amount: 'calc.DamagePerShot',
          attack: true,
          onAttack: true,
          canCrit: false,
          onHitEffectiveness: 0.5,
          hits: 'floor(min(dv.Duration, 4) * dv.WAttacksPerSecond) + 1',
          interval: '1 / dv.WAttacksPerSecond',
        },
      ],
    },
    E: {
      dash: true,
      notes: ['The first champion hit is stunned and thrown behind Urgot (a different leg then faces it).'],
      cc: [{ kind: 'immobilize', duration: 'dv.StunDuration' }],
      components: [{ id: 'charge', label: 'Disdain', type: 'physical', amount: 'calc.EDamage', delay: 0.2 }],
    },
    R: {
      recasts: 2,
      recastDelay: 0.25,
      notes: [
        'R: chem-drill hit + slow. "R:execute" is the recast (Mercy): suppresses and kills a target below the health threshold (modeled as true damage equal to its remaining health).',
      ],
      cc: [{ kind: 'slow', duration: 'dv.RSlowDuration' }],
      components: [{ id: 'drill', label: 'Fear Beyond Death', type: 'physical', amount: 'calc.RCalculatedDamage', delay: 0.2 }],
      variants: {
        execute: {
          label: 'execute',
          note: 'Recast on a target below the health threshold: suppress, reel in and kill.',
          cc: [{ kind: 'immobilize', duration: 'dv.RChannelTimeReel' }],
          components: [
            {
              id: 'execute',
              label: 'Mercy (execute)',
              type: 'true',
              amount: 'target.hpPct <= dv.RHealthThreshold / 100 ? target.hp : 0',
              delay: 'dv.RChannelTimeReel',
              noProc: true,
              condition: 'target below the health threshold',
            },
          ],
        },
      },
    },
  },
  hooks: {
    onCast(sim, cast) {
      // Disdain throws the stunned champion behind Urgot: the opposite leg now faces it.
      if (cast.slot === 'E' && cast.hitsTarget) sim.setCounter('urgot.facing', sim.counter('urgot.facing') + 3);
    },
    onAttack(sim, atk) {
      if (atk.phantom) return;
      if (atk.fromAbility && atk.fromAbility !== 'W') return;
      const amount = fireLeg(sim);
      if (amount === undefined) return;
      atk.extra.push({
        source: 'P',
        sourceLabel: 'Echoing Flames',
        label: 'Leg cannon',
        type: 'physical',
        amount,
        castId: atk.castId,
        flags: { kind: 'ability', slot: 'P', ability: true, aoe: true },
      });
    },
  },
};
export default kit;
