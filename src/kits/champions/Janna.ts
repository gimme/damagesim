import type { ChampionKit } from '../../engine/kit-types.ts';

// Janna — patch 16.20.
// Tailwind: attacks and Zephyr deal P.calc.BonusDamage (30% of bonus move speed) bonus magic damage
// (proc damage). Zephyr's passive move speed (W.calc.TotalMS) is added as a passive stat.
const kit: ChampionKit = {
  id: 'Janna',
  status: 'curated',
  notes: ['Zephyr\'s passive move speed counts toward Tailwind\'s bonus damage; the Tailwind ally aura is ignored.'],
  stats: ({ ranks, evalExpr }) => (ranks.W > 0 ? { msPercent: evalExpr('W.calc.TotalMS', 'W') } : {}),
  attack: {
    onHit: [{ id: 'tailwind', label: 'Tailwind', type: 'magic', amount: 'P.calc.BonusDamage', proc: true }],
  },
  abilities: {
    Q: {
      // The seconds the tornado grows before Janna sends it (she acts meanwhile): the damage and
      // knock-up grow by the second (dv.BonusDamage, dv.ChargeKnockup) for up to MaxDuration.
      charge: { default: 0, max: 'dv.MaxDuration' },
      notes: [
        'Default: sent immediately (minimum damage and knock-up). Set the seconds it grows first (Q{3s} for the maximum damage and knock-up).',
        'Travel time to the target assumed ≈0.5s.',
      ],
      cc: [{ kind: 'immobilize', duration: 'lerp(dv.BaseKnockup, calc.MaxKnockup, min(1, charge / dv.MaxDuration))' }],
      components: [{ id: 'gale', label: 'Howling Gale', type: 'magic', amount: 'lerp(calc.MinimumDamage, calc.MaxDamage, min(1, charge / dv.MaxDuration))', aoe: true, delay: '0.5 + charge' }],
    },
    W: {
      cc: [{ kind: 'slow', duration: 'dv.SlowDuration' }],
      components: [
        { id: 'zephyr', label: 'Zephyr', type: 'magic', amount: 'calc.TotalDamage', delay: 0.1 },
        { id: 'tailwind', label: 'Tailwind', type: 'magic', amount: 'P.calc.BonusDamage', delay: 0.1, proc: true },
      ],
    },
    E: {
      noTarget: true,
      notes: ['Self-cast: Janna gains calc.TotalAD attack damage while shielded (dv.ShieldDuration s).'],
      buff: { id: 'jannaE', label: 'Eye of the Storm', duration: 'dv.ShieldDuration', stats: { ad: 'calc.TotalAD' } },
    },
    R: {
      notes: ['Knocks back nearby enemies, then heals allies (no damage).'],
      cc: [{ kind: 'immobilize', duration: 'dv.KnockbackDuration' }],
      components: [],
    },
  },
};
export default kit;
