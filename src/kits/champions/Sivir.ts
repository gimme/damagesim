import type { ChampionKit } from '../../engine/kit-types.ts';
import type { Sim } from '../../engine/sim.ts';

// Sivir — patch 16.20.

function reduceCooldown(sim: Sim, slot: 'Q' | 'W' | 'E' | 'R', seconds: number) {
  const key = `ability:${slot}`;
  const left = sim.cooldownReadyAt(key) - sim.time;
  if (left > 0) sim.startCooldown(key, Math.max(0, left - seconds));
}

const kit: ChampionKit = {
  id: 'Sivir',
  status: 'curated',
  notes: ['Fleet of Foot (move speed) and Spell Shield are not modeled beyond casting.'],
  abilities: {
    Q: {
      notes: ['Hits the target on the way out and again on the return (same damage). Crit scaling is part of the game formula (expected value).'],
      // Out to the target and on to max range, then back past the target at the returning 1200 speed (wiki).
      components: [{ id: 'blade', label: 'Boomerang Blade', type: 'physical', amount: 'calc.TotalDamage', hits: 2, maxHits: 2, interval: '(castRange - reach) / missileSpeed + (castRange - reach) / 1200', travel: true, aoe: true }],
    },
    W: {
      noTarget: true,
      notes: ['Bounces only hit other enemies; against a lone champion Ricochet is just the attack speed.'],
      buff: { id: 'ricochet', label: 'Ricochet', duration: 'dv.BuffDuration', stats: { attackSpeed: 'dv.RicochetAttackSpeed' } },
      components: [],
    },
    E: { noTarget: true, components: [] },
    R: {
      noTarget: true,
      notes: ['While On The Hunt, each attack reduces basic ability cooldowns by 0.5s (hook).'],
      buff: { id: 'onTheHunt', label: 'On The Hunt', duration: 'dv.UltDuration' },
      components: [],
    },
  },
  hooks: {
    onAttack(sim, atk) {
      if (atk.fromAbility || atk.phantom || !sim.getBuff('onTheHunt')) return;
      const s = sim.evalExpr('R.dv.AttackCooldownRefund', { slot: 'R' });
      for (const slot of ['Q', 'W', 'E'] as const) reduceCooldown(sim, slot, s);
    },
  },
};
export default kit;
