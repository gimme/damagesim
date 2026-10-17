import type { ChampionKit } from '../../engine/kit-types.ts';

// Darius — patch 16.20.
const kit: ChampionKit = {
  id: 'Darius',
  status: 'curated',
  notes: ['Noxian Guillotine is assumed not to apply Hemorrhage.'],
  marks: [
    {
      id: 'hemorrhage',
      label: 'Hemorrhage',
      maxStacks: 'P.dv.MaxStacks',
      duration: 'P.dv.BleedDuration',
      // While Noxian Might is active every hit applies max stacks.
      stacksPerHit: 'buff.noxianMight ? P.dv.MaxStacks : 1',
      appliedBy: ['attack', 'Q', 'W'],
      // Proc damage (wiki; in game the bleed adds no Conqueror stacks).
      dot: { interval: 1.25, components: [{ id: 'bleed', label: 'Bleed', type: 'physical', amount: 'P.calc.BleedDamagePerStack / 4 * stacks.hemorrhage', dot: true, proc: true }] },
      atMax: {
        components: [],
        buff: { id: 'noxianMight', label: 'Noxian Might', duration: 'P.dv.BleedDuration', stats: { ad: 'P.calc.NoxianMightBonusAD' } },
      },
    },
  ],
  stats: ({ ranks, evalExpr }) => (ranks.E > 0 ? { armorPenPercent: [evalExpr('E.dv.PassivePercentArmorPen') / 100] } : {}),
  abilities: {
    Q: {
      // Wiki: unable to declare attacks or cast E/R while he hefts the axe for 0.75s (W can be cast,
      // but its attack waits).
      attackLockout: 0.75,
      castLockout: { E: 0.75, R: 0.75 },
      variants: {
        handle: {
          label: 'handle',
          note: 'Hit only by the handle: 35% damage, no Hemorrhage stack.',
          components: [{ id: 'handle', label: 'Decimate (handle)', type: 'physical', amount: 'calc.HandleDamage', aoe: true, delay: 0.5, noProc: false }],
        },
      },
      components: [{ id: 'blade', label: 'Decimate (blade)', type: 'physical', amount: 'calc.BladeDamage', aoe: true, delay: 0.5 }],
    },
    W: {
      resetsAttack: true,
      buff: {
        id: 'dariusW',
        label: 'Crippling Strike',
        duration: 4,
        empowerAttacks: {
          count: 1,
          replaceBase: true,
          resetsAttack: true,
          components: [{ id: 'strike', label: 'Crippling Strike', type: 'physical', amount: 'W.calc.EmpoweredAttackDamage' }],
        },
      },
      notes: ['Empowers the next attack (replaces its damage); triggers spell effects.'],
    },
    E: {
      noTarget: false,
      // Wiki: unable to move or cast Q/R for 0.4s after the 0.25s cast time; he attacks once the
      // pull ends (wiki: he then attacks the pulled target), so attacks wait too.
      attackLockout: 0.65,
      castLockout: { Q: 0.65, R: 0.65 },
      cc: [{ kind: 'immobilize', duration: 0.5 }, { kind: 'slow', duration: 'dv.SlowDuration' }],
      components: [],
    },
    R: {
      dash: true,
      // Wiki: unable to cast Q/E for 0.25s after the 0.3667s cast time; attacks aren't held.
      castLockout: { Q: 0.6167, E: 0.6167 },
      components: [
        {
          id: 'guillotine',
          label: 'Noxian Guillotine',
          type: 'true',
          amount: 'min(calc.Damage * (1 + dv.RDamagePercentPerHemoStack * stacks.hemorrhage), calc.MaximumDamage)',
        },
      ],
    },
  },
};
export default kit;
