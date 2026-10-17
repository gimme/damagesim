import type { ChampionKit } from '../../engine/kit-types.ts';

// Briar — patch 16.20.
// Crimson Curse: P.calc['{15da76ad}'] is the bleed's damage per second for one stack
// (BleedDamageOverDurationTooltip = it × BleedDuration); each stack beyond the first adds BleedPercentAdd.
/** Chilling Scream's damage by the seconds charged: 2.5% of the full damage uncharged, all of it at 1s (wiki). */
const SCREAM = 'calc.Damage * lerp(0.025, 1, min(1, charge))';
/** The scream flies its range, 400 to 600 by the seconds charged (wiki), at its speed. */
const SCREAM_TRAVEL = 'lerp(dv.MinMissileRange, dv.MaxMissileRange, min(1, charge)) / missileSpeed';
// Certain Death: the hemolith is kicked after the 1s cast time; global (12000 range), so assumed
// fired from 1200 units. On the hit she takes 1.25s (wiki) before dashing over IdealDashTime.
const R_HIT = '1200 / missileSpeed';
const R_DASH = '1.25 + dv.IdealDashTime';

const kit: ChampionKit = {
  id: 'Briar',
  status: 'curated',
  notes: [
    'Crimson Curse: basic attacks and ability hits add a bleed stack (max 5, refreshes to 5s); ticks every P.dv.BleedTickRate s for (1 + 25% per extra stack) × the one-stack damage. Blood Frenzy splash does not stack it.',
    'Blood Frenzy (W, and the empowered one from R) gives attack speed; its splash only hits enemies around the target and is not modeled. Chilling Scream (E) ends Blood Frenzy.',
    'Snack Attack: use "W:snack" (the W recast) to empower the next attack with bonus physical damage + % missing health.',
    'Chilling Scream is assumed fully charged (1s, wiki): full damage + knockback. Use E:wall when the target is knocked into terrain.',
    'Healing, damage reduction, resists and life steal are not modeled.',
  ],
  marks: [
    {
      id: 'crimsonCurse',
      label: 'Crimson Curse',
      maxStacks: 'P.dv.MaxBleedStacks',
      duration: 'P.dv.BleedDuration',
      appliedBy: ['attack', 'ability'],
      dot: {
        interval: 'P.dv.BleedTickRate',
        components: [
          {
            id: 'bleed',
            label: 'Bleed',
            type: 'physical',
            amount: "P.calc['{15da76ad}'] * P.dv.BleedTickRate * (1 + P.dv.BleedPercentAdd * (stacks.crimsonCurse - 1))",
            dot: true,
            proc: true,
          },
        ],
      },
    },
  ],
  abilities: {
    Q: {
      dash: true,
      // Its range at 600 + 300 over the range (wiki: DashSpeedBase + ExtraDashSpeedBasedOnDistance).
      lockout: 'castRange / (dv.DashSpeedBase + dv.ExtraDashSpeedBasedOnDistance)',
      // Resets the attack timer; applies on-hit effects and triggers on-attack effects (wiki).
      resetsAttack: true,
      cc: [{ kind: 'immobilize', duration: 'dv.StunDuration' }],
      debuff: { id: 'briarQ', label: 'Head Rush shred', duration: 'dv.ShredDuration', armorReduction: 'dv.ShredPercent', mrReduction: 'dv.ShredPercent' },
      components: [{ id: 'headRush', label: 'Head Rush', type: 'physical', amount: 'calc.TotalDamage', onHit: true, onAttack: true, travel: 'castRange / (dv.DashSpeedBase + dv.ExtraDashSpeedBasedOnDistance)' }],
    },
    W: {
      dash: true,
      noTarget: true,
      // The dash: its range at its speed.
      lockout: 'castRange / missileSpeed',
      recasts: 2,
      buff: { id: 'briarFrenzy', label: 'Blood Frenzy', duration: 'dv.BerserkDuration', stats: { attackSpeed: 'dv.BerserkAS' } },
      variants: {
        snack: {
          label: 'Snack Attack',
          lockout: 0,
          resetsAttack: true,
          note: 'Recast: the next attack deals bonus physical damage + % missing health.',
          components: [],
          buff: {
            id: 'briarSnack',
            label: 'Snack Attack',
            duration: 'dv.BerserkDuration',
            empowerAttacks: {
              count: 1,
              resetsAttack: true,
              components: [
                {
                  id: 'snack',
                  label: 'Snack Attack',
                  type: 'physical',
                  amount: 'W.calc.TotalAttackBonusDamage + W.calc.TotalAttackPercentMissingHealth / 100 * target.missingHp',
                },
              ],
            },
          },
        },
      },
    },
    E: {
      // Charged for up to 1s (wiki): the damage grows from 2.5% to all of it, and only a full charge knocks back.
      charge: { default: 1 },
      castTime: 'charge',
      notes: ['Default: fully charged (1s, knocks back). Set the seconds held (E{0.5s}) for less damage and no knock back.'],
      cc: [
        { kind: 'slow', duration: 'dv.SlowDuration' },
        { kind: 'immobilize', duration: 'charge >= 1 ? dv.RKnockupDuration : 0' },
      ],
      // Chilling Scream removes Blood Frenzy: overwrite the buff with an instantly expiring one.
      buff: { id: 'briarFrenzy', label: 'Blood Frenzy (ended)', duration: 0 },
      components: [{ id: 'scream', label: 'Chilling Scream', type: 'magic', amount: SCREAM, aoe: true, travel: SCREAM_TRAVEL }],
      variants: {
        wall: {
          label: 'wall hit',
          note: 'Knocked into terrain (full charge only): extra damage and a stun.',
          buff: { id: 'briarFrenzy', label: 'Blood Frenzy (ended)', duration: 0 },
          cc: [{ kind: 'immobilize', duration: 'charge >= 1 ? dv.WallStunDuration : 0' }],
          components: [
            { id: 'scream', label: 'Chilling Scream', type: 'magic', amount: SCREAM, aoe: true, travel: SCREAM_TRAVEL },
            // ~0.25s knocked back into the wall (no distance in the data).
            { id: 'wall', label: 'Chilling Scream (wall)', type: 'magic', amount: 'calc.WallHitDamage', hits: 'charge >= 1 ? 1 : 0', delay: 0.25, travel: SCREAM_TRAVEL },
          ],
        },
      },
    },
    R: {
      // Busy until she lands (locked from the cast's start, though she may act while the hemolith flies).
      lockout: `castTime + ${R_HIT} + ${R_DASH}`,
      dash: true,
      notes: ['Empowered Blood Frenzy: gains Blood Frenzy (W attack speed) until the prey dies (HuntDuration from data, in ms).'],
      buff: { id: 'briarFrenzy', label: 'Blood Frenzy (Certain Death)', duration: 'dv.HuntDuration / 1000', stats: { attackSpeed: 'W.rank > 0 ? W.dv.BerserkAS : 0' } },
      components: [{ id: 'certainDeath', label: 'Certain Death', type: 'magic', amount: 'calc.Damage', aoe: true, delay: R_DASH, travel: R_HIT }],
    },
  },
};
export default kit;
