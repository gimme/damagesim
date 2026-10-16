import type { ChampionKit } from '../../engine/kit-types.ts';

// Camille — patch 16.20.
const kit: ChampionKit = {
  id: 'Camille',
  status: 'curated',
  notes: [
    'Precision Protocol attacks cannot crit (wiki); they replace the attack with AD + bonus damage and trigger spell effects.',
    'Q recast: "Q:empowered" assumes the ramp-up was waited (the recast is held until Q.dv.QRampUpTime after the first cast): Q.calc.DamageConversionPercentage of the whole attack (AD + empowered bonus) becomes true damage. A plain second "Q" is the un-ramped recast.',
    'Tactical Sweep: default is the inner hit only; "W:outer" adds the outer-edge % max health damage and slow.',
    'Hookshot is modeled as one cast that lands immediately (wall travel/hang time ignored).',
  ],
  abilities: {
    Q: {
      resetsAttack: true,
      recasts: 2,
      recastDelay: 'dv.QRampUpTime',
      buff: {
        id: 'camilleQ',
        label: 'Precision Protocol',
        duration: 'dv.QTotalRecastTime',
        empowerAttacks: {
          count: 1,
          replaceBase: true,
          resetsAttack: true,
          components: [{ id: 'q', label: 'Precision Protocol', type: 'physical', amount: 'ad + Q.calc.BonusDamage', canCrit: false }],
        },
      },
      variants: {
        empowered: {
          label: 'empowered recast',
          resetsAttack: true,
          components: [],
          buff: {
            id: 'camilleQ',
            label: 'Precision Protocol (empowered)',
            duration: 'dv.Q2Duration',
            empowerAttacks: {
              count: 1,
              replaceBase: true,
              resetsAttack: true,
              // The true portion is dealt just before the physical portion (wiki).
              components: [
                { id: 'qTrue', label: 'Precision Protocol (true)', type: 'true', amount: 'Q.calc.DamageConversionPercentage * (ad + Q.calc.EmpoweredBonusDamage)', canCrit: false },
                { id: 'qPhys', label: 'Precision Protocol (physical)', type: 'physical', amount: '(1 - Q.calc.DamageConversionPercentage) * (ad + Q.calc.EmpoweredBonusDamage)', canCrit: false },
              ],
            },
          },
        },
      },
    },
    W: {
      components: [{ id: 'sweep', label: 'Tactical Sweep', type: 'physical', amount: 'calc.BaseDamageTotal', aoe: true, delay: 'dv.ChargeDuration' }],
      variants: {
        outer: {
          label: 'outer edge',
          cc: [{ kind: 'slow', duration: 'dv.SlowDuration' }],
          components: [
            { id: 'sweep', label: 'Tactical Sweep', type: 'physical', amount: 'calc.BaseDamageTotal', aoe: true, delay: 'dv.ChargeDuration' },
            { id: 'outer', label: 'Tactical Sweep (outer)', type: 'physical', amount: 'calc.OuterEdgeTooltip * target.maxHp', aoe: true, delay: 'dv.ChargeDuration' },
          ],
        },
      },
    },
    E: {
      dash: true,
      cc: [{ kind: 'immobilize', duration: 'dv.KnockupDuration' }],
      buff: { id: 'camilleE', label: 'Wall Dive', duration: 'dv.ASDuration', stats: { attackSpeed: 'dv.ASBuff' } },
      components: [{ id: 'wallDive', label: 'Wall Dive', type: 'physical', amount: 'calc.TotalDamage', aoe: true }],
    },
    R: {
      dash: true,
      notes: ['Attacks on the trapped target deal % current health magic damage for R.dv.RDuration seconds.'],
      buff: {
        id: 'camilleR',
        label: 'The Hextech Ultimatum',
        duration: 'dv.RDuration',
        onHit: [{ id: 'ultimatum', label: 'Hextech Ultimatum', type: 'magic', amount: 'R.dv.RPercentCurrentHPDamage / 100 * target.hp', proc: true }],
      },
      components: [],
    },
  },
};
export default kit;
