import type { ChampionKit } from '../../engine/kit-types.ts';

// Aurora — patch 16.20.
const kit: ChampionKit = {
  id: 'Aurora',
  status: 'curated',
  notes: [
    'Spirit Abjuration: every 3rd damaging attack or ability cast on the target deals % max Health magic damage (one stack per cast). The heal is not modeled.',
    'Twofold Hex: "Q Q" = first cast then the recast (the recast also happens automatically after 3.5s in game).',
  ],
  marks: [
    {
      id: 'spiritAbjuration',
      label: 'Spirit Abjuration',
      maxStacks: 3,
      duration: 'P.dv.DebuffDuration',
      appliedBy: ['attack', 'ability'],
      atMax: { consume: true, components: [{ id: 'exorcise', label: 'Spirit Abjuration', type: 'magic', amount: 'P.calc.ProcDamage * target.maxHp', proc: true }] },
    },
  ],
  abilities: {
    P: { notes: ['3-hit proc (mark).'] },
    Q: {
      recasts: 2,
      // The curse lasts MarkDuration; afterwards the recast fires automatically (not modeled) and the chain ends.
      recastWindow: 'dv.MarkDuration',
      notes: ['Recast damage = the first hit\'s damage increased by 0.5% per 1% missing health (up to +50%), computed when it hits.'],
      components: [
        { id: 'hex', label: 'Twofold Hex', type: 'magic', amount: 'calc.Damage', hits: 'recast == 1 ? 1 : 0', aoe: true, delay: 0.25 },
        {
          id: 'recall',
          label: 'Twofold Hex (recast)',
          type: 'magic',
          amount: "calc['{f7c018c7}'] * (1 + dv.MissingHealthPercentMod * target.missingHpPct)",
          max: 'calc.Q2DamageMax',
          hits: 'recast == 2 ? 1 : 0',
          aoe: true,
          delay: 0.3,
        },
      ],
    },
    W: { dash: true, noTarget: true, notes: ['Hop and invisibility only.'] },
    E: {
      dash: true,
      cc: [{ kind: 'slow', duration: 'dv.SlowDuration' }],
      notes: ['Aurora hops backwards after the blast (marked as a dash).'],
      components: [{ id: 'blast', label: 'The Weirding', type: 'magic', amount: 'calc.DamageCalc', aoe: true, delay: 0.1 }],
    },
    R: {
      dash: true,
      // Wiki: unable to act while she leaps over 0.4s, and her abilities stay locked out for another
      // 0.5s.
      lockout: 0.9,
      cc: [{ kind: 'slow', duration: 2 }],
      notes: ['Leap then a pulse on landing; the border only slows (no damage).'],
      components: [{ id: 'pulse', label: 'Between Worlds', type: 'magic', amount: 'calc.DamageCalc', aoe: true, delay: 0.4 }],
    },
  },
};
export default kit;
