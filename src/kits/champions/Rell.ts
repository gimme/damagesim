import type { BuffSpec, ChampionKit } from '../../engine/kit-types.ts';

// Rell — patch 16.20.
// Break the Mold: attacks and ability hits steal 3% armor and MR per stack (max 5 stacks, 5s),
// modeled as a percent resist reduction on the target (the per-level flat floor is not modeled).
const dismounted: BuffSpec = {
  id: 'rellDismounted',
  label: 'Dismounted',
  duration: 600,
  stats: { attackSpeed: 'W.dv.DismountedASBoost', range: 'W.dv.DismountedRangeBoost' },
};

const kit: ChampionKit = {
  id: 'Rell',
  status: 'curated',
  notes: [
    'Break the Mold armor/MR steal is applied as a % reduction on the target (3% per stack, max 5); the per-level minimum steal and Rell\'s own resistance gain are not modeled.',
    'Full Tilt empowers the next attack or Shattering Strike within 5s (wiki) with a % max health explosion.',
    'Rell starts mounted: W is Crash Down by default; W:mountup empowers the next attack (its knock-up is not modeled as crowd control).',
  ],
  attack: {
    onHit: [{ id: 'mold', label: 'Break the Mold', type: 'magic', amount: 'P.calc.OnHitDamage', proc: true }],
  },
  marks: [
    {
      id: 'breakTheMold',
      label: 'Break the Mold',
      maxStacks: 'P.dv.MaxStacks',
      duration: 'P.dv.ShredDuration',
      appliedBy: ['attack', 'ability'],
      armorReductionPerStack: 'P.dv.StealPercent',
      mrReductionPerStack: 'P.dv.StealPercent',
    },
  ],
  abilities: {
    Q: {
      cc: [{ kind: 'immobilize', duration: 'dv.StunDuration' }],
      // Wiki: unable to act for 0.35s after the 0.4s cast time.
      lockout: 0.75,
      notes: ['Consumes Full Tilt\'s empowerment if active (explosion).'],
      components: [
        { id: 'strike', label: 'Shattering Strike', type: 'magic', amount: 'calc.Damage', aoe: true },
        { id: 'tilt', label: 'Full Tilt explosion', type: 'magic', amount: 'E.calc.MaxHealthDamageCalc * target.maxHp', aoe: true, hits: 'stacks.rellTiltQ' },
      ],
    },
    W: {
      dash: true,
      notes: ['Crash Down: leap, knock-up and damage; Rell then dismounts (+attack speed, +range).'],
      // Wiki: no attacks during the leap (0.625s cast time) and the ~0.5s slide after it; Q is
      // disabled, E and R can be cast. So no full cast-time lockout: the hit lands as the leap (its
      // 0.625s cast time) ends.
      castTime: 0,
      attackLockout: 1.125,
      castLockout: { Q: 1.125 },
      cc: [{ kind: 'immobilize', duration: 'dv.CrashDownKnockupDuration' }],
      buff: dismounted,
      components: [{ id: 'crash', label: 'Crash Down', type: 'magic', amount: 'calc.DismountDamage', aoe: true, delay: 0.625 }],
      variants: {
        mountup: {
          label: 'mount up',
          spell: 'RellW_MountUp',
          attackLockout: 0,
          cc: [],
          buff: {
            id: 'rellMountUp',
            label: 'Mount Up',
            duration: 'W.dv.MountUpSpeedDuration',
            empowerAttacks: { count: 1, components: [{ id: 'flip', label: 'Mount Up flip', type: 'magic', amount: 'W.calc.FlipDamage' }] },
          },
          components: [],
        },
      },
    },
    E: {
      noTarget: true,
      buff: {
        id: 'rellE',
        label: 'Full Tilt',
        // Empowerment window: 5s (wiki) = Duration + EmpowermentBuffer.
        duration: 'dv.Duration + dv.EmpowermentBuffer',
        empowerAttacks: {
          count: 1,
          components: [{ id: 'tilt', label: 'Full Tilt explosion', type: 'magic', amount: 'E.calc.MaxHealthDamageCalc * target.maxHp' }],
        },
      },
      components: [],
    },
    R: {
      notes: ['Pull, then damage every 0.25s for 2s (wiki tick rate).'],
      cc: [{ kind: 'immobilize', duration: 0.25 }],
      components: [
        {
          id: 'storm',
          label: 'Magnet Storm',
          type: 'magic',
          amount: 'calc.TotalDamage / (dv.Duration / 0.25)',
          hits: 'dv.Duration / 0.25',
          interval: 0.25,
          delay: 0.25,
          aoe: true,
          dot: true,
        },
      ],
    },
  },
  hooks: {
    // Shattering Strike consumes Full Tilt's empowerment (counter read by Q's "tilt" hit count).
    onCast(sim, cast) {
      if (cast.slot === 'W' && cast.variant === 'mountup') sim.removeBuff('rellDismounted');
      if (cast.slot !== 'Q') return;
      const empowered = !!sim.getBuff('rellE');
      sim.setCounter('rellTiltQ', empowered ? 1 : 0);
      if (empowered) sim.removeBuff('rellE');
    },
  },
};
export default kit;
