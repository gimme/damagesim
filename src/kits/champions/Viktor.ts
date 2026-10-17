import type { ChampionKit } from '../../engine/kit-types.ts';

// Viktor — patch 16.20.
const kit: ChampionKit = {
  id: 'Viktor',
  status: 'curated',
  notes: [
    'Hex Core upgrades: only Hextech Ray\'s upgrade adds damage (aftershock); option "augE" (default on — usually one of the first upgrades by mid game). Other upgrades only change shields, slows and storm speed.',
  ],
  options: [{ key: 'augE', label: 'Hextech Ray upgraded', default: 1, toggle: true, description: 'Adds the aftershock 1s after the laser.' }],
  abilities: {
    Q: {
      notes: ['The next attack within 4s (tooltip) deals the listed magic damage instead of normal attack damage and cannot crit (wiki). Write "Q AA".'],
      components: [{ id: 'missile', label: 'Siphon Power', type: 'magic', amount: 'calc.TotalMissileDamage', travel: true }],
      buff: {
        id: 'viktorQ',
        label: 'Siphon Power (discharge)',
        duration: 4,
        empowerAttacks: {
          count: 1,
          replaceBase: true,
          components: [{ id: 'discharge', label: 'Siphon Power (attack)', type: 'magic', amount: 'Q.calc.AttackTotalDMG', canCrit: false }],
        },
      },
    },
    W: {
      notes: ['Slows on cast; stuns 2s after the cast (0.75s arming + 1.25s inside the field), applied by a hook. No damage.'],
      cc: [{ kind: 'slow', duration: 'dv.FieldDuration' }],
    },
    E: {
      // The beam sweeps its 500 range at its speed; the path explodes 1s (dv.Delay) after it passes (wiki).
      components: [
        { id: 'laser', label: 'Hextech Ray', type: 'magic', amount: 'calc.LaserDamage', aoe: true, travel: true },
        { id: 'aftershock', label: 'Hextech Ray (aftershock)', type: 'magic', amount: 'calc.AftershockDamage', aoe: true, hits: 'opt.augE', maxHits: 1, delay: 'dv.Delay', travel: true },
      ],
    },
    R: {
      notes: ['Initial burst plus 6 bolts, one per second, for a target that stays in the storm (it follows champions it damaged). Use R{bolt:N} for fewer.'],
      components: [
        { id: 'burst', label: 'Arcane Storm', type: 'magic', amount: 'calc.InitialBurstDamage', aoe: true },
        { id: 'bolt', label: 'Arcane Storm (bolt)', type: 'magic', amount: 'calc.SubsequentBurstDamage', aoe: true, dot: true, hits: 'dv.MaxTicks', interval: 'dv.TickCadence', delay: 'dv.TickCadence' },
      ],
    },
  },
  hooks: {
    onCast(sim, cast) {
      if (cast.slot !== 'W' || !cast.hitsTarget) return;
      const id = cast.castId;
      sim.schedule(0.25 + 0.75 + 1.25, () => sim.applyCC('immobilize', sim.evalExpr('W.dv.StunDuration', { slot: 'W' }), id, 'W'));
    },
  },
};
export default kit;
