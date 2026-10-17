import type { ChampionKit } from '../../engine/kit-types.ts';

// Azir — patch 16.20.
// Sand Soldiers replace Azir's attacks while one is near the target: the stab deals W damage instead
// of the attack; each additional soldier stabs for SubsequentDamageMod% (no on-hit). The number of
// active soldiers is tracked by the hook in counter 'azirSoldiers' (expiry times in 'azirSoldier0..2').
const MAX_SOLDIERS = 3; // two W charges + the charge from Shifting Sands

const kit: ChampionKit = {
  id: 'Azir',
  status: 'curated',
  notes: [
    'Soldier stabs replace the attack while a soldier is up (they count as the attack; item on-hit effects at 50%).',
    'Soldiers are assumed to be in range of the target. The Sun Disc is not modeled.',
  ],
  abilities: {
    P: { notes: ['Sun Disc (turret) not modeled.'] },
    Q: {
      cc: [{ kind: 'slow', duration: 1 }],
      notes: ['Needs a soldier; the target takes damage once even if several soldiers pass through it.'],
      // The soldiers dash to the target at SoldierDashSpeed.
      components: [{ id: 'sands', label: 'Conquering Sands', type: 'magic', amount: 'calc.TotalDamage', aoe: true, travel: 'reach / dv.SoldierDashSpeed' }],
    },
    W: {
      notes: ['Summons a soldier (10s). "W W AA" = two soldiers stabbing (second at 25%).'],
      buff: {
        id: 'sandSoldiers',
        label: 'Sand Soldiers',
        duration: 'dv.SoldierDuration',
        empowerAttacks: {
          count: 99,
          replaceBase: true,
          otherAttacker: true,
          components: [
            { id: 'stab', label: 'Sand Soldier', type: 'magic', amount: 'W.calc.TotalDamage', aoe: true, onHitEffectiveness: 0.5 },
            {
              id: 'extra',
              label: 'Sand Soldier (extra)',
              type: 'magic',
              amount: 'W.calc.TotalDamage * W.dv.SubsequentDamageMod / 100',
              hits: 'max(0, stacks.azirSoldiers - 1)',
              aoe: true,
            },
          ],
        },
      },
    },
    E: {
      dash: true,
      // To the target at DashSpeed. Wiki: he can cast any ability during the dash, but not attack.
      attackLockout: 'reach / dv.DashSpeed',
      notes: ['Dash to a soldier; stops on the first champion hit. Shield not modeled.'],
      components: [{ id: 'dash', label: 'Shifting Sands', type: 'magic', amount: 'calc.TotalDamage', aoe: true, travel: 'reach / dv.DashSpeed' }],
    },
    R: {
      // Knock-back duration is not in the data (≈0.5s).
      cc: [{ kind: 'immobilize', duration: 0.5 }],
      // Wiki: the knock-back missiles start 325 units behind him as the cast time starts
      // ({{Effect at cast time start}}) and fly to its range in front, through the target.
      components: [{ id: 'wall', label: "Emperor's Divide", type: 'magic', amount: 'calc.TotalDamage', aoe: true, travel: '(reach + 325) / missileSpeed - castTime' }],
    },
  },
  hooks: {
    onCast(sim, cast) {
      if (cast.slot !== 'W') return;
      const duration = sim.evalExpr('W.dv.SoldierDuration', { slot: 'W' });
      const alive = [0, 1, 2].map((i) => sim.counter(`azirSoldier${i}`)).filter((t) => t > sim.time);
      alive.push(sim.time + duration);
      alive.sort((a, b) => b - a);
      const kept = alive.slice(0, MAX_SOLDIERS);
      for (let i = 0; i < MAX_SOLDIERS; i++) sim.setCounter(`azirSoldier${i}`, kept[i] ?? 0);
      sim.setCounter('azirSoldiers', kept.length);
    },
    // Keep the soldier count current before the stab components are evaluated.
    onStart(sim) {
      sim.setCounter('azirSoldiers', 0);
    },
    afterDamage(sim) {
      const n = [0, 1, 2].filter((i) => sim.counter(`azirSoldier${i}`) > sim.time).length;
      if (n !== sim.counter('azirSoldiers')) sim.setCounter('azirSoldiers', n);
    },
  },
};
export default kit;
