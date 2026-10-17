import type { ChampionKit } from '../../engine/kit-types.ts';

// Rammus — patch 16.20.
const kit: ChampionKit = {
  id: 'Rammus',
  status: 'curated',
  notes: [
    'Spiked Shell: bonus AD = 15% armor + 15% MR (static, from level and item stats); Defensive Ball Curl\'s extra resistances add their share while active.',
    'Defensive Ball Curl\'s damage to enemies that attack Rammus is not modeled (the target does not attack).',
    'For Soaring Slam during Powerball use "Q:roll R:powerball" (the roll does not collide when Soaring Slam ends it).',
  ],
  // Spiked Shell bonus AD from total armor and MR.
  stats: ({ evalExpr }) => ({ ad: evalExpr('P.calc.TotalDamage') }),
  abilities: {
    Q: {
      notes: ['Default: Rammus rolls into the target (collision damage, knock-back, slow). Time spent rolling is not modeled.'],
      cc: [{ kind: 'immobilize', duration: 'dv.StunDuration' }, { kind: 'slow', duration: 'dv.SlowDuration' }],
      // Wiki: free to move, but no attacks or Frenzying Taunt while rolling, which stops at the
      // collision (Defensive Ball Curl and Soaring Slam can be cast).
      attackLockout: 0.5,
      castLockout: { E: 0.5 },
      components: [{ id: 'ball', label: 'Powerball', type: 'magic', amount: 'calc.PowerBallDamage', aoe: true, delay: 0.5 }],
      variants: {
        roll: { label: 'roll (no collision)', cc: [], components: [], note: 'Start rolling without colliding (used before R:powerball).' },
      },
    },
    W: {
      noTarget: true,
      // Spiked Shell also counts the bonus resistances.
      buff: {
        id: 'rammusW',
        label: 'Defensive Ball Curl',
        duration: 'dv.BuffDuration',
        stats: {
          armor: 'calc.BonusArmorTooltip',
          mr: 'calc.BonusMRTooltip',
          ad: 'P.dv.ArmorRatio * calc.BonusArmorTooltip + P.dv.MagicResistRatio * calc.BonusMRTooltip',
        },
      },
      components: [],
    },
    E: {
      cc: [{ kind: 'immobilize', duration: 'dv.Duration' }],
      notes: ['Taunt only; the damage applies to monsters.'],
      components: [],
    },
    R: {
      dash: true,
      cc: [{ kind: 'slow', duration: 'dv.SlowDuration' }],
      notes: ['Aftershocks only re-apply the slow (no damage).'],
      // Leaps to the target (dv.BaseCastRange at most; no range in the data) at the dash speed, unable
      // to act meanwhile (wiki).
      lockout: 'castTime + min(distance, dv.BaseCastRange) / missileSpeed',
      components: [{ id: 'slam', label: 'Soaring Slam', type: 'magic', amount: 'calc.InitialDamageCalc', aoe: true, travel: 'min(distance, dv.BaseCastRange) / missileSpeed' }],
      variants: {
        powerball: {
          label: 'during Powerball',
          dash: true,
          note: 'Cast during Powerball: the target in the center also takes Powerball damage and is knocked up.',
          cc: [{ kind: 'immobilize', duration: 'dv.KnockupDuration' }, { kind: 'slow', duration: 'dv.SlowDuration' }],
          components: [
            { id: 'slam', label: 'Soaring Slam', type: 'magic', amount: 'calc.InitialDamageCalc', aoe: true, travel: 'min(distance, dv.BaseCastRange) / missileSpeed' },
            { id: 'center', label: 'Soaring Slam (Powerball)', type: 'magic', amount: 'Q.calc.PowerBallDamage', aoe: true, travel: 'min(distance, dv.BaseCastRange) / missileSpeed' },
          ],
        },
      },
    },
  },
};
export default kit;
