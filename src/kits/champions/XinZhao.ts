import type { ChampionKit } from '../../engine/kit-types.ts';
import type { Sim } from '../../engine/sim.ts';
import type { DamageInstance } from '../../engine/effects.ts';

// Xin Zhao — patch 16.20.
// Determination counts basic attacks and Wind Becomes Lightning strikes (first slash + thrust); the
// declarative everyNth only counts attacks, so a hook feeds W strikes into the same counter.
// Three Talon Strike's knock-up lands on the 3rd empowered attack (hook counts the empowered hits).
const NTH = 'kit.nth'; // the engine's everyNth counter

function passiveFromW(sim: Sim, inst: DamageInstance) {
  if (inst.source !== 'W' || inst.fromMark) return;
  if (inst.label === 'Slash') {
    // Only the first of the four slashes counts.
    if (inst.castId === sim.counter('xinLastSlash')) return;
    sim.setCounter('xinLastSlash', inst.castId);
  } else if (inst.label !== 'Thrust') return;
  const n = sim.counter(NTH) + 1;
  if (n < 3) {
    sim.setCounter(NTH, n);
    return;
  }
  sim.setCounter(NTH, 0);
  sim.deal({
    source: 'P',
    sourceLabel: 'Determination',
    label: 'Determination',
    type: 'physical',
    amount: sim.evalExpr('P.calc.TotalDamage', { slot: 'P' }),
    castId: inst.castId,
    flags: { kind: 'ability', slot: 'P', ability: false, onHit: true },
  });
}

const kit: ChampionKit = {
  id: 'XinZhao',
  status: 'curated',
  notes: [
    'Determination: every 3rd attack or Wind Becomes Lightning strike (first slash and thrust, max 2 per cast) deals bonus damage (cannot crit).',
    'Three Talon Strike: the 1s cooldown reduction per empowered attack is not modeled.',
    'Crescent Guard: assumes the target is Challenged (hit by W/E/attacks), so it is not knocked back.',
  ],
  attack: {
    everyNth: {
      n: 3,
      label: 'Determination',
      components: [{ id: 'determination', label: 'Determination', type: 'physical', amount: 'P.calc.TotalDamage', noProc: true }],
    },
  },
  hooks: {
    onCast(sim, cast) {
      if (cast.slot === 'Q') sim.setCounter('xinQHits', 0);
    },
    afterDamage(sim, inst) {
      passiveFromW(sim, inst);
      // Knock-up on the third empowered attack.
      if (inst.source === 'Q' && inst.label === 'Three Talon Strike') {
        const n = sim.counter('xinQHits') + 1;
        sim.setCounter('xinQHits', n);
        if (n === 3) sim.applyCC('immobilize', sim.evalExpr('Q.dv.KnockUpDuration', { slot: 'Q' }), inst.castId, 'Q');
      }
    },
  },
  abilities: {
    Q: {
      resetsAttack: true,
      notes: ['Next 3 attacks within 5s (wiki; refreshed per attack) deal bonus damage (crit-affected); the 3rd knocks up. Write "Q AA AA AA".'],
      buff: {
        id: 'xinQ',
        label: 'Three Talon Strike',
        duration: 5,
        empowerAttacks: {
          count: 3,
          resetsAttack: true,
          components: [{ id: 'talon', label: 'Three Talon Strike', type: 'physical', amount: 'Q.calc.BonusDamage', canCrit: true }],
        },
      },
    },
    W: {
      notes: ['Four slashes (tooltip value split evenly) then the thrust; ThrustDamage already includes the crit-chance amplification.'],
      cc: [{ kind: 'slow', duration: 'calc.TotalSlowDuration' }],
      components: [
        { id: 'slash', label: 'Slash', type: 'physical', amount: 'calc.SlashDamage / dv.HitNum', hits: 'dv.HitNum', maxHits: 'dv.HitNum', interval: 'dv.DelayTime', aoe: true },
        { id: 'thrust', label: 'Thrust', type: 'physical', amount: 'calc.ThrustDamage', delay: 0.2, aoe: true },
      ],
    },
    E: {
      dash: true,
      notes: ['Attack speed: base + AP ratio + 1% per 5% bonus attack speed (PermanentASToASRatio).'],
      cc: [{ kind: 'slow', duration: 'dv.SlowDuration' }],
      buff: {
        id: 'xinE',
        label: 'Audacious Charge',
        duration: 'dv.ASDuration',
        stats: { attackSpeed: 'dv.ASMod + dv.APToASRatio * ap + bonusAs / dv.PermanentASToASRatio' },
      },
      components: [{ id: 'charge', label: 'Audacious Charge', type: 'magic', amount: 'calc.ChargeDamage', aoe: true, delay: 0.1 }],
    },
    R: {
      components: [{ id: 'sweep', label: 'Crescent Guard', type: 'physical', amount: 'calc.TotalDamage + dv.PercentCurrentHealthDamage * target.hp', aoe: true }],
    },
  },
};
export default kit;
