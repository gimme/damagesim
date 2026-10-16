import type { ChampionKit } from '../../engine/kit-types.ts';
import type { Sim } from '../../engine/sim.ts';

// Gragas — patch 16.20.
// Hook: Body Slam's cooldown refund when it collides.
const kit: ChampionKit = {
  id: 'Gragas',
  status: 'curated',
  notes: [
    'Barrel Roll defaults to an early detonation (minimum damage); set the seconds it ferments (Q{2s} for the maximum damage).',
    'Explosive Cask knockback is treated as a 0.5s displacement (duration not in the data).',
    'Body Slam hitting reduces its current cooldown by E.dv.CooldownRefund.',
  ],
  abilities: {
    Q: {
      // The seconds the cask ferments after landing before Gragas detonates it: the damage grows to
      // ×1.5 over BarrelCookMaxTime, and the cask lasts BarrelMaxDuration.
      charge: { default: 0, max: 'dv.BarrelMaxDuration' },
      notes: ['Default: detonated as it lands. Set the seconds it ferments first (Q{2s} for the fully cooked ×1.5 damage).'],
      cc: [{ kind: 'slow', duration: 'dv.SlowDuration' }],
      components: [{ id: 'cask', label: 'Barrel Roll', type: 'magic', amount: 'lerp(calc.MinDamage, calc.MaxDamage, min(1, charge / dv.BarrelCookMaxTime))', aoe: true, delay: '0.5 + charge' }],
    },
    W: {
      notes: ['Empowers the next attack with bonus magic damage (target and nearby enemies). Follow with AA.'],
      // Wiki: he drinks for a 0.75s channel, unable to attack or cast meanwhile.
      lockout: 0.75,
      buff: {
        id: 'gragasW',
        label: 'Drunken Rage',
        duration: 'dv.AttackDuration',
        empowerAttacks: {
          count: 1,
          components: [{ id: 'rage', label: 'Drunken Rage', type: 'magic', amount: 'W.calc.TotalDamage + W.dv.MaxHPPercentDamage / 100 * target.maxHp' }],
        },
      },
    },
    E: {
      dash: true,
      cc: [{ kind: 'immobilize', duration: 'dv.StunDuration' }],
      components: [{ id: 'slam', label: 'Body Slam', type: 'magic', amount: 'calc.TotalDamage', aoe: true, delay: 0.2 }],
    },
    R: {
      cc: [{ kind: 'immobilize', duration: 0.5 }],
      components: [{ id: 'cask', label: 'Explosive Cask', type: 'magic', amount: 'calc.DamageDone', aoe: true, delay: 0.4 }],
    },
  },
  hooks: {
    afterDamage(sim: Sim, inst) {
      if (inst.flags.slot !== 'E' || inst.flags.kind !== 'ability' || inst.fromMark || sim.counter('gragasE.lastCast') === inst.castId) return;
      sim.setCounter('gragasE.lastCast', inst.castId);
      const remaining = sim.cooldownReadyAt('ability:E') - sim.time;
      if (remaining > 0) sim.startCooldown('ability:E', remaining * (1 - sim.evalExpr('E.dv.CooldownRefund', { slot: 'E' })));
    },
  },
};
export default kit;
