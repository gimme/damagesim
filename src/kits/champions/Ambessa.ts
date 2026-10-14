import type { BuffSpec, ChampionKit } from '../../engine/kit-types.ts';

// Ambessa — patch 16.20.
// Drakehound's Step: every ability cast grants a charge (max 3, 4s); each attack consumes one for
// bonus physical damage and has bonus attack speed. Charges are counted in 'ambessaCharges'
// (updated by the onCast hook before the cast's buff is applied with that many charges).
const drakehoundsStep: BuffSpec = {
  id: 'drakehoundsStep',
  label: "Drakehound's Step",
  duration: 'P.dv.Attack_Buff_Duration',
  stats: { attackSpeed: 'P.calc.Calc_Attack_Speed' },
  empowerAttacks: {
    count: 'stacks.ambessaCharges',
    components: [{ id: 'step', label: "Drakehound's Step", type: 'physical', amount: 'P.calc.Calc_OnHit_Damage_Flat', noProc: true }],
  },
};

const kit: ChampionKit = {
  id: 'Ambessa',
  status: 'curated',
  notes: [
    "Drakehound's Step: each ability cast stores an empowered attack (max 3); the bonus attack speed is active while charges are held.",
    "The passive's buffered dash after each ability is only marked as a dash on Lacerate (whose second strike needs it).",
    'Shields and Public Execution omnivamp are not modeled.',
  ],
  stats: ({ ranks, evalExpr }) => (ranks.R > 0 ? { armorPenPercent: [evalExpr('R.dv.Armor_Penetration')] } : {}),
  abilities: {
    P: { notes: ['See notes: empowered attacks from ability casts.'] },
    Q: {
      buff: drakehoundsStep,
      // Wiki: 0.225s lockout (data castTime is 0).
      castTime: 0.225,
      recasts: 2,
      recastDelay: 'dv.Swap_Static_Cooldown',
      recastWindow: 'dv.Swap_Duration',
      notes: [
        '"Q Q" = Cunning Sweep then Sundering Slam (within 4s). Default: the target is at the edge of the sweep (full damage).',
        'Q:inner = target inside the sweep (50% damage).',
      ],
      components: [
        { id: 'sweep', label: 'Cunning Sweep', type: 'physical', amount: 'calc.Calc_Damage_1_Max + calc.Calc_Damage_1_Percent_Max * target.maxHp', hits: 'recast == 1 ? 1 : 0', aoe: true },
        { id: 'slam', label: 'Sundering Slam', type: 'physical', amount: 'calc.Calc_Damage_2_Max + calc.Calc_Damage_2_Percent_Max * target.maxHp', hits: 'recast == 2 ? 1 : 0', aoe: true, delay: 0.1 },
      ],
      variants: {
        inner: {
          label: 'inner',
          components: [
            { id: 'sweep', label: 'Cunning Sweep (inner)', type: 'physical', amount: "calc['{a7907b77}'] + calc['{17768f39}'] * target.maxHp", hits: 'recast == 1 ? 1 : 0', aoe: true },
            { id: 'slam', label: 'Sundering Slam', type: 'physical', amount: 'calc.Calc_Damage_2_Max + calc.Calc_Damage_2_Percent_Max * target.maxHp', hits: 'recast == 2 ? 1 : 0', aoe: true, delay: 0.1 },
          ],
        },
      },
    },
    W: {
      buff: drakehoundsStep,
      notes: ['Default: not braced by champion damage. W:braced = braced (150% damage).'],
      components: [{ id: 'slam', label: 'Repudiation', type: 'physical', amount: 'calc.Calc_Damage_Low', aoe: true, delay: 'dv.Buff_Duration' }],
      variants: {
        braced: {
          label: 'braced',
          components: [{ id: 'slam', label: 'Repudiation (braced)', type: 'physical', amount: 'calc.Calc_Damage_High', aoe: true, delay: 'dv.Buff_Duration' }],
        },
      },
    },
    E: {
      buff: drakehoundsStep,
      dash: true,
      cc: [{ kind: 'slow', duration: 'dv.Slow_Duration' }],
      notes: ["The passive dash after Lacerate repeats the strike (same damage); E{second:0} without the dash."],
      components: [
        { id: 'whip', label: 'Lacerate', type: 'physical', amount: 'calc.Calc_Damage_Flat', aoe: true },
        { id: 'second', label: 'Lacerate (dash)', type: 'physical', amount: 'calc.Calc_Damage_Flat', aoe: true, delay: 'P.dv.Buffer_Dash_Time' },
      ],
    },
    R: {
      buff: drakehoundsStep,
      dash: true,
      cc: [{ kind: 'immobilize', duration: 'dv.Suppress_Duration + dv.Stun_Duration' }],
      notes: ['Suppression then slam (damage after the suppression) and a short stun. Passive: % armor penetration.'],
      components: [{ id: 'slam', label: 'Public Execution', type: 'physical', amount: 'calc.Calc_Damage', delay: 'dv.Suppress_Duration' }],
    },
  },
  hooks: {
    onCast(sim, cast) {
      if (cast.slot === 'P') return;
      const held = sim.getBuff('drakehoundsStep')?.charges ?? 0;
      sim.setCounter('ambessaCharges', Math.min(sim.evalExpr('P.dv.Attack_Buff_Max_Stacks', { slot: 'P' }), held + 1));
    },
  },
};
export default kit;
