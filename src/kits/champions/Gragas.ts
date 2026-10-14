import type { ChampionKit } from '../../engine/kit-types.ts';
import type { Sim } from '../../engine/sim.ts';

// Gragas — patch 16.20.
// Hook: Body Slam's cooldown refund when it collides.
const kit: ChampionKit = {
  id: 'Gragas',
  status: 'curated',
  notes: [
    'Barrel Roll defaults to an early detonation (minimum damage); Q:max lets it cook for dv.BarrelCookMaxTime s (maximum damage).',
    'Explosive Cask knockback is treated as a 0.5s displacement (duration not in the data).',
    'Body Slam hitting reduces its current cooldown by E.dv.CooldownRefund.',
  ],
  abilities: {
    Q: {
      cc: [{ kind: 'slow', duration: 'dv.SlowDuration' }],
      components: [{ id: 'cask', label: 'Barrel Roll', type: 'magic', amount: 'calc.MinDamage', aoe: true, delay: 0.5 }],
      variants: {
        max: {
          label: 'max',
          note: 'Fully cooked cask (×1.5 damage).',
          cc: [{ kind: 'slow', duration: 'dv.SlowDuration' }],
          components: [{ id: 'cask', label: 'Barrel Roll', type: 'magic', amount: 'calc.MaxDamage', aoe: true, delay: 'dv.BarrelCookMaxTime' }],
        },
      },
    },
    W: {
      notes: ['Empowers the next attack with bonus magic damage (target and nearby enemies). Follow with AA.'],
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
