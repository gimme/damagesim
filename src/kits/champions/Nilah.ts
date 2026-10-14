import type { ChampionKit } from '../../engine/kit-types.ts';

// Nilah — patch 16.20.
const kit: ChampionKit = {
  id: 'Nilah',
  status: 'curated',
  notes: [
    'Formless Blade passive: armor penetration equal to 30% of crit chance (from items; temporary crit buffs are not counted).',
    "Formless Blade's damage already includes crit chance (the game formula), so it does not crit separately.",
  ],
  stats: ({ ranks, evalExpr }) => (ranks.Q > 0 ? { armorPenPercent: [evalExpr('Q.calc.CritArmorPen')] } : {}),
  abilities: {
    Q: {
      notes: ['On hit: bonus attack speed and attack range for 4 s (attacks hit in a cone).'],
      buff: { id: 'nilahQ', label: 'Formless Blade', duration: 'dv.BuffDuration', stats: { attackSpeed: 'calc.BonusAttackSpeedCalc / 100' } },
      components: [{ id: 'whip', label: 'Formless Blade', type: 'physical', amount: 'calc.DamageCalc', aoe: true, delay: 0.1 }],
    },
    W: {
      noTarget: true,
      notes: ['Defensive (dodges attacks, magic damage reduction); no damage.'],
      components: [],
    },
    E: {
      dash: true,
      notes: ['Slipstream has 2 charges (ammo from the data).'],
      components: [{ id: 'dash', label: 'Slipstream', type: 'physical', amount: 'calc.DashDamage' }],
    },
    R: {
      // Busy for the cast time (0.25 s) + the 1 s spin.
      lockout: 1.25,
      cc: [{ kind: 'immobilize', duration: 0.5 }],
      notes: ['Four spin ticks every 0.25 s during the 1 s spin, then the burst (and pull). Pull duration is not in the data; 0.5 s assumed.'],
      components: [
        { id: 'spin', label: 'Apotheosis (spin)', type: 'physical', amount: 'calc.DamagePerTickCalc', hits: 'calc.DamagePerTickCalcTooltip / calc.DamagePerTickCalc', interval: 0.25, delay: 0.25, aoe: true },
        { id: 'burst', label: 'Apotheosis (burst)', type: 'physical', amount: 'calc.DamageCalc', aoe: true, delay: 1.05 },
      ],
    },
  },
};
export default kit;
