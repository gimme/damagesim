import type { ChampionKit } from '../../engine/kit-types.ts';

// Lulu — patch 16.20.
const kit: ChampionKit = {
  id: 'Lulu',
  status: 'curated',
  notes: [
    'Pix is assumed to be on Lulu (not on an ally): Pix\'s bolts follow Lulu\'s attacks and Pix fires the second Glitterlance bolt.',
    'Whimsy (ally buff), Help, Pix! shield and Wild Growth\'s bonus health are not modeled.',
  ],
  attack: {
    onHit: [
      // Pix fires 3 homing bolts at the attack target; a single champion takes all three.
      { id: 'pix', label: 'Pix bolt', type: 'magic', amount: 'P.calc.TotalDamage', hits: 'P.dv.NumberOfBolts', proc: true, note: 'Pix, Faerie Companion' },
    ],
  },
  abilities: {
    Q: {
      notes: ['Lulu\'s and Pix\'s bolts both hit a target in line: the first deals full damage, the additional bolt deals dv.DoubleHitBonus (50%). Disable the second with Q{pix:0}.'],
      cc: [{ kind: 'slow', duration: 'dv.SlowDuration' }],
      components: [
        { id: 'lance', label: 'Glitterlance', type: 'magic', amount: 'calc.TotalDamage', travel: true },
        { id: 'pix', label: 'Glitterlance (Pix)', type: 'magic', amount: 'calc.BonusMissileDamage', travel: true },
      ],
    },
    W: {
      notes: ['Cast on the enemy: polymorph (no damage).'],
      // The polymorph flies to the target at its speed (wiki).
      cc: [{ kind: 'impair', duration: 'dv.CCDuration', delay: 'reach / missileSpeed' }],
      components: [],
    },
    E: {
      notes: ['Cast on the enemy champion.'],
      components: [{ id: 'hamper', label: 'Help, Pix!', type: 'magic', amount: 'calc.TotalDamage' }],
    },
    R: {
      notes: ['Cast on Lulu (or an ally) next to the target: knocks up then slows; no damage.'],
      cc: [
        { kind: 'immobilize', duration: 'dv.KnockbackDuration' },
        { kind: 'slow', duration: 'dv.BuffDuration' },
      ],
      components: [],
    },
  },
};
export default kit;
