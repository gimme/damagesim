import type { ChampionKit } from '../../engine/kit-types.ts';

// Corki — patch 16.20.
// Valkyrie's dash: its range at 650 + movement speed (DashSpeedBase, DashSpeedRatio).
const W_DASH = 'castRange / (dv.DashSpeedBase + dv.DashSpeedRatio * ms)';
const kit: ChampionKit = {
  id: 'Corki',
  status: 'curated',
  options: [{ key: 'rCycle', label: 'Missiles fired since the last Big One', default: 0, min: 0, max: 2 }],
  notes: [
    'Hextech Munitions: attacks deal P.calc.BasicAttackTOOLTIP bonus true damage (affected by crits). The Spellblade part is not modeled.',
    'Valkyrie: the target is assumed to stand in the fire for 3 of the 5 half-second ticks (W{burn:5} for the full "up to" damage). Special Delivery (the Package) is not modeled.',
    'Gatling Gun: 16 ticks over 4s; the full armor/MR shred (4 stacks) is applied from the 4th tick and lasts 2s after the spray.',
    'Missile Barrage: every third cast is a Big One (counts casts; option rCycle sets the starting point). Ammo recharge is not modeled.',
  ],
  attack: {
    onHit: [{ id: 'munitions', label: 'Hextech Munitions', type: 'true', amount: 'P.calc.BasicAttackTOOLTIP', canCrit: true }],
  },
  hooks: {
    // Big One every third Missile Barrage cast: count casts (kit expressions can't count casts themselves).
    onStart(sim) {
      sim.setCounter('corkiMissile', sim.opt.rCycle ?? 0);
    },
    onCast(sim, cast) {
      if (cast.slot === 'R') sim.setCounter('corkiMissile', sim.counter('corkiMissile') + 1);
    },
  },
  abilities: {
    Q: {
      components: [{ id: 'bomb', label: 'Phosphorus Bomb', type: 'magic', amount: 'calc.TotalDamage', aoe: true, travel: true }],
    },
    W: {
      dash: true,
      // Wiki: Gatling Gun can be cast during the dash.
      attackLockout: W_DASH,
      castLockout: { Q: W_DASH, R: W_DASH },
      components: [
        {
          id: 'burn',
          label: 'Valkyrie burn',
          type: 'magic',
          amount: 'calc.MaximumDamage / dv.MaximumTicks',
          hits: 3,
          maxHits: 'dv.MaximumTicks',
          interval: '1 / dv.TicksPerSecond',
          // The patch under the target is dropped as the dash ends.
          delay: W_DASH,
          aoe: true,
          dot: true,
        },
      ],
    },
    E: {
      debuff: {
        id: 'corkiShred',
        label: 'Gatling Gun shred',
        afterHits: 4, // = E.dv.ShredCap stacks at one stack per tick
        duration: 'dv.SprayDuration - dv.ShredCap / dv.TicksPerSecond + dv.ShredDuration',
        armorReductionFlat: '-dv.ShredMax',
        mrReductionFlat: '-dv.ShredMax',
      },
      components: [
        {
          id: 'spray',
          label: 'Gatling Gun',
          type: 'physical',
          amount: 'calc.TotalDamage / (dv.SprayDuration * dv.TicksPerSecond)',
          hits: 'dv.SprayDuration * dv.TicksPerSecond',
          maxHits: 'dv.SprayDuration * dv.TicksPerSecond',
          interval: '1 / dv.TicksPerSecond',
          aoe: true,
        },
      ],
    },
    R: {
      components: [
        {
          id: 'missile',
          label: 'Missile Barrage',
          type: 'physical',
          amount: 'stacks.corkiMissile % 3 == 0 ? calc.RBigMissileDamage : calc.RSmallMissileDamage',
          aoe: true,
          // Fired as the cast time starts (wiki: {{Effect at cast time start}}); the Big One flies 1500.
          travel: 'max(0, (stacks.corkiMissile % 3 == 0 ? 1500 : castRange) / missileSpeed - castTime)',
        },
      ],
    },
  },
};
export default kit;
