import type { ChampionKit } from '../../engine/kit-types.ts';

// Malphite — patch 16.20.
const kit: ChampionKit = {
  id: 'Malphite',
  status: 'curated',
  notes: [
    'Thunderclap (W) passive: +dv.BonusArmorPassive of Malphite\'s armor, ×dv.BonusArmorPassiveMultiplier while Granite Shield is up (option). Modeled as a total-armor multiplier; it feeds the armor ratios of W and E.',
    'Granite Shield (the shield itself) is not modeled.',
  ],
  options: [
    { key: 'graniteShield', label: 'Granite Shield up', default: 1, toggle: true, description: 'Triples Thunderclap\'s passive armor bonus (shield not broken yet, e.g. when engaging).' },
  ],
  stats: ({ ranks, opt, evalExpr }) =>
    ranks.W > 0 ? { armorMult: [1 + evalExpr('W.dv.BonusArmorPassive') * (opt.graniteShield ? evalExpr('W.dv.BonusArmorPassiveMultiplier') : 1)] } : {},
  abilities: {
    Q: {
      cc: [{ kind: 'slow', duration: 'dv.SlowDuration' }],
      components: [{ id: 'shard', label: 'Seismic Shard', type: 'magic', amount: 'calc.QDamageCalc', travel: true }],
    },
    W: {
      notes: [
        'Empowers the next attack (within 6s, wiki) with bonus physical damage (follow W with AA).',
        'The aftershock cone does not damage the primary target (wiki), so it is not modeled for a single target.',
      ],
      buff: {
        id: 'thunderclap',
        label: 'Thunderclap',
        duration: 6,
        empowerAttacks: {
          count: 1,
          components: [{ id: 'bonus', label: 'Thunderclap', type: 'physical', amount: 'W.calc.TotalBonusDamage' }],
        },
      },
    },
    E: {
      notes: ['The attack speed reduction is not crowd control and is not modeled.'],
      components: [{ id: 'slam', label: 'Ground Slam', type: 'magic', amount: 'calc.EDamageCalc', aoe: true }],
    },
    R: {
      dash: true,
      // Dashes to the target at 1500 + movement speed (wiki; no dash speed in the data).
      lockout: 'reach / (1500 + ms)',
      cc: [{ kind: 'immobilize', duration: 'dv.KnockupDuration' }],
      components: [{ id: 'force', label: 'Unstoppable Force', type: 'magic', amount: 'calc.TotalDamage', delay: 'reach / (1500 + ms)', aoe: true }],
    },
  },
};
export default kit;
