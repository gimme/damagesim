import type { ChampionKit } from '../../engine/kit-types.ts';
import type { DamageInstance } from '../../engine/effects.ts';
import type { Sim } from '../../engine/sim.ts';

// Fiora — patch 16.20.
// Hooks: Grand Challenge's four vitals (struck one per later hit), Bladework's two attacks (first
// can't crit and slows, second always crits for a fixed multiplier) and Lunge's cooldown refund.

const R_VITAL_DELAY = 0.5; // wiki: the four vitals appear after a 0.5s delay (not in the data)

function vitalHit(inst: DamageInstance): boolean {
  if (inst.fromMark || inst.flags.proc) return false;
  return inst.flags.attack || (inst.flags.kind === 'ability' && !!inst.flags.slot && inst.flags.slot !== 'P');
}

const kit: ChampionKit = {
  id: 'Fiora',
  status: 'curated',
  notes: [
    'Duelist\'s Dance: write "P" right after the hit that strikes a vital (e.g. "Q P AA E AA AA"); a new vital becomes targetable ~1.75s later.',
    'Grand Challenge: the next 4 attack/ability hits within dv.MarkDuration each strike one vital (one per cast); no "P" steps needed while it is active.',
    'Bladework: the second attack crits for exactly E.dv.AttackTwoPercentTAD × AD (crit damage items assumed not to change it); the first attack cannot crit.',
    'Lunge hitting reduces its remaining cooldown by Q.dv.CDRefundPercent.',
  ],
  abilities: {
    P: {
      notes: ['Use as a combo step when a vital is struck.'],
      components: [{ id: 'vital', label: 'Vital', type: 'true', amount: 'calc.PassiveDamageTotal * target.maxHp', proc: true }],
    },
    Q: {
      dash: true,
      castTime: 0, // the data's cast time is negative (-0.375)
      notes: ['Applies on-hit effects; cannot crit.'],
      components: [{ id: 'lunge', label: 'Lunge', type: 'physical', amount: 'calc.TotalDamage', onHit: true }],
    },
    W: {
      notes: ['The stab fires 0.5s into the parry. Variant W:stun if an immobilizing effect was parried.'],
      // Wiki: unable to act during the whole 0.75s stance.
      lockout: 'dv.ParryDuration',
      cc: [{ kind: 'slow', duration: 'dv.CCDuration' }],
      components: [{ id: 'stab', label: 'Riposte', type: 'magic', amount: 'calc.StabDamage', delay: 0.5 }],
      variants: {
        stun: {
          label: 'stun',
          note: 'Parried an immobilizing effect: stuns instead of slowing.',
          cc: [{ kind: 'immobilize', duration: 'dv.CCDuration' }],
          components: [{ id: 'stab', label: 'Riposte', type: 'magic', amount: 'calc.StabDamage', delay: 0.5 }],
        },
      },
    },
    E: {
      resetsAttack: true,
      notes: ['Attack reset; the next two attacks gain attack speed. Follow with "AA AA".'],
      buff: {
        id: 'bladework',
        label: 'Bladework',
        duration: 'dv.BuffDuration',
        stats: { attackSpeed: 'dv.ASPercent' },
        empowerAttacks: { count: 2, resetsAttack: true, components: [] },
      },
    },
    R: {
      notes: ['Reveals 4 vitals (calc via P: 4 × PassiveDamageTotal = spell FioraPassive RDamageTotal).'],
      components: [],
    },
  },
  hooks: {
    onCast(sim: Sim, cast) {
      if (cast.slot === 'E') {
        sim.setCounter('bladework.left', 2);
        sim.setCounter('bladework.until', sim.time + sim.evalExpr('E.dv.BuffDuration', { slot: 'E' }));
      } else if (cast.slot === 'R' && cast.hitsTarget) {
        sim.setCounter('grandChallenge', 4);
        sim.setCounter('grandChallenge.castId', cast.castId);
        sim.setCounter('grandChallenge.from', sim.time + R_VITAL_DELAY);
        sim.setCounter('grandChallenge.until', sim.time + R_VITAL_DELAY + sim.evalExpr('R.dv.MarkDuration', { slot: 'R' }));
      }
    },
    preAttack(sim: Sim, atk) {
      if (atk.fromAbility || atk.phantom) return;
      const left = sim.counter('bladework.left');
      if (left <= 0 || sim.time > sim.counter('bladework.until')) return;
      sim.setCounter('bladework.left', left - 1);
      if (left === 2) {
        atk.crit = false;
        atk.canCrit = false;
        atk.critFactor = 1;
        sim.applyCC('slow', sim.evalExpr('E.dv.SlowDuration', { slot: 'E' }), atk.castId, 'E');
      } else {
        atk.crit = true;
        atk.critFactor = sim.evalExpr('E.dv.AttackTwoPercentTAD', { slot: 'E' });
      }
    },
    afterDamage(sim: Sim, inst) {
      if (inst.flags.slot === 'Q' && inst.flags.kind === 'ability' && !inst.fromMark && sim.counter('fioraQ.lastCast') !== inst.castId) {
        sim.setCounter('fioraQ.lastCast', inst.castId);
        const remaining = sim.cooldownReadyAt('ability:Q') - sim.time;
        if (remaining > 0) sim.startCooldown('ability:Q', remaining * (1 - sim.evalExpr('Q.dv.CDRefundPercent', { slot: 'Q' })));
      }
      if (!vitalHit(inst) || sim.counter('grandChallenge') <= 0) return;
      if (sim.time < sim.counter('grandChallenge.from') || sim.time > sim.counter('grandChallenge.until') || inst.castId === sim.counter('grandChallenge.castId')) return;
      if (sim.counter('grandChallenge.lastCast') === inst.castId) return;
      sim.setCounter('grandChallenge.lastCast', inst.castId);
      sim.setCounter('grandChallenge', sim.counter('grandChallenge') - 1);
      sim.deal({
        source: 'R',
        sourceLabel: 'Grand Challenge',
        label: 'Vital',
        type: 'true',
        amount: sim.evalExpr('P.calc.PassiveDamageTotal * target.maxHp', { slot: 'P' }),
        castId: inst.castId,
        flags: { kind: 'ability', slot: 'P', ability: false, proc: true },
        markSource: 'grandChallenge',
      });
    },
  },
};
export default kit;
