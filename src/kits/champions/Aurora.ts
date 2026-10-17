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
      // The recast needs a marked target: the bolt lands after flying to it.
      recastDelay: 'castTime + reach / missileSpeed',
      // The curse lasts MarkDuration; afterwards the recast fires automatically (not modeled) and the chain ends.
      recastWindow: 'dv.MarkDuration',
      notes: ['Recast damage = the first hit\'s damage increased by 0.5% per 1% missing health (up to +50%), computed when it hits.'],
      components: [
        { id: 'hex', label: 'Twofold Hex', type: 'magic', amount: 'calc.Damage', hits: 'recast == 1 ? 1 : 0', aoe: true, travel: true },
        {
          id: 'recall',
          label: 'Twofold Hex (recast)',
          type: 'magic',
          amount: "calc['{f7c018c7}'] * (1 + dv.MissingHealthPercentMod * target.missingHpPct)",
          max: 'calc.Q2DamageMax',
          hits: 'recast == 2 ? 1 : 0',
          aoe: true,
          // Wiki: the bolts fly back from the marked target at 2000 speed.
          travel: 'reach / 2000',
        },
      ],
    },
    W: {
      dash: true,
      noTarget: true,
      // Wiki: no abilities during the hop; its range at movement speed + DashBonusSpeed (the wiki's
      // speed, 350, is that bonus).
      lockout: 'castRange / (ms + dv.DashBonusSpeed)',
      notes: ['Hop and invisibility only.'],
    },
    E: {
      dash: true,
      cc: [{ kind: 'slow', duration: 'dv.SlowDuration' }],
      // Wiki: the blast hits as the cast time ends; she then recoils 250 units at 150 + 200% movement
      // speed, unable to cast during it.
      lockout: 'castTime + 250 / (150 + 2 * ms)',
      notes: ['Aurora hops backwards after the blast (marked as a dash).'],
      components: [{ id: 'blast', label: 'The Weirding', type: 'magic', amount: 'calc.DamageCalc', aoe: true }],
    },
    R: {
      dash: true,
      // Wiki: unable to act while she leaps over 0.4s, and her abilities stay locked out for another
      // 0.5s.
      lockout: 0.9,
      cc: [{ kind: 'slow', duration: 2 }],
      notes: ['Leap then a pulse on landing; the border only slows (no damage).'],
      // Wiki: the shockwave is unleashed after the 0.4s leap and expands over 0.75s.
      components: [{ id: 'pulse', label: 'Between Worlds', type: 'magic', amount: 'calc.DamageCalc', aoe: true, delay: 0.4, travel: 0.75 }],
    },
  },
};
export default kit;
