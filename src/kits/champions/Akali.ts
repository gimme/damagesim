import type { BuffSpec, ChampionKit } from '../../engine/kit-types.ts';

// Akali — patch 16.20.
// Assassin's Mark: ability damage creates a ring; leaving it empowers the next attack. Modeled as a
// self buff from every damaging ability (ring 4s + empowered 4s), consumed by the next attack.
const assassinsMark: BuffSpec = {
  id: 'assassinsMark',
  label: "Assassin's Mark",
  duration: 8,
  empowerAttacks: {
    count: 1,
    components: [{ id: 'mark', label: "Assassin's Mark", type: 'magic', amount: 'P.calc.Damage' }],
  },
};

const kit: ChampionKit = {
  id: 'Akali',
  status: 'curated',
  notes: [
    "Assassin's Mark: every damaging ability arms the next attack (the walk out of the ring is not simulated — the attack is assumed to happen after leaving it).",
    'E and R are two-part abilities: "E E" / "R R" cast the first part then the recast.',
  ],
  abilities: {
    P: { notes: ["Empowered attack damage uses the passive's tooltip formula (P.calc.Damage)."] },
    Q: {
      buff: assassinsMark,
      cc: [{ kind: 'slow', duration: 'dv.SlowDuration' }],
      components: [{ id: 'kunai', label: 'Five Point Strike', type: 'magic', amount: 'calc.Damage', aoe: true, delay: 0.15 }],
    },
    W: { noTarget: true, notes: ['Shroud: invisibility and energy only.'] },
    E: {
      buff: assassinsMark,
      dash: true,
      recasts: 2,
      recastDelay: 0.4,
      notes: ['First cast: shuriken (30% of the total); recast: dash to the marked target (70%).'],
      components: [
        { id: 'shuriken', label: 'Shuriken Flip', type: 'magic', amount: 'calc.E1Damage', hits: 'recast == 1 ? 1 : 0', delay: 0.25 },
        { id: 'dash', label: 'Shuriken Flip (recast)', type: 'magic', amount: 'calc.E2DamageCalc', hits: 'recast == 2 ? 1 : 0', delay: 0.2 },
      ],
    },
    R: {
      buff: assassinsMark,
      dash: true,
      recasts: 2,
      recastDelay: 'dv.CooldownBetweenCasts',
      notes: [
        'First cast: vault; recast (after 2.5s): execute dash dealing up to 3× damage, scaling linearly with missing health until the target is at 30% health or less (computed when it lands).',
      ],
      components: [
        { id: 'vault', label: 'Perfect Execution', type: 'magic', amount: 'calc.Cast1Damage', hits: 'recast == 1 ? 1 : 0', aoe: true, delay: 0.1 },
        {
          id: 'execute',
          label: 'Perfect Execution (recast)',
          type: 'magic',
          amount: 'calc.Cast2DamageMin * (1 + (calc.Cast2DamageMax / calc.Cast2DamageMin - 1) * min(1, target.missingHpPct / (1 - dv.MaxExecuteThreshold)))',
          max: 'calc.Cast2DamageMax',
          hits: 'recast == 2 ? 1 : 0',
          aoe: true,
          delay: 0.1,
        },
      ],
    },
  },
};
export default kit;
