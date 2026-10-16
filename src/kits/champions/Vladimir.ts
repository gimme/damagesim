import type { ChampionKit } from '../../engine/kit-types.ts';

// Vladimir — patch 16.20.
const kit: ChampionKit = {
  id: 'Vladimir',
  status: 'curated',
  notes: [
    'Crimson Pact: AP from bonus health and bonus health from AP, each computed from pre-pact stats (does not stack with itself).',
    'Transfusion: every third cast is empowered (two casts fill Crimson Rush; assumes the empowered cast is used within its 2.5s window). Option "rush" = Crimson Rush points at combo start; "Q:empowered" forces it.',
    'Healing, Sanguine Pool\'s health cost and Tides of Blood\'s health cost are not modeled.',
  ],
  options: [{ key: 'rush', label: 'Crimson Rush points at start', default: 0, min: 0, max: 2, step: 1 }],
  stats: ({ evalExpr }) => ({
    conversions: [
      { from: 'bonusHp', to: 'ap', ratio: 1 / evalExpr('P.dv.HPforAP'), source: 'Crimson Pact' },
      { from: 'ap', to: 'hp', ratio: evalExpr('P.dv.APRatioBonusHP'), source: 'Crimson Pact' },
    ],
  }),
  abilities: {
    Q: {
      components: [
        { id: 'drain', label: 'Transfusion', type: 'magic', amount: 'stacks.vladQEmpowered ? calc.EmpoweredDamageTooltip : calc.BaseDamageTooltip', delay: 0.15 },
      ],
      variants: {
        empowered: {
          label: 'empowered',
          components: [{ id: 'drain', label: 'Transfusion (empowered)', type: 'magic', amount: 'calc.EmpoweredDamageTooltip', delay: 0.15 }],
        },
      },
    },
    W: {
      notes: ['4 ticks of 1/4 of the damage every 0.5s, the first immediately (wiki). Vladimir cannot act while in the pool.'],
      // 0.25s cast + 2s in the pool.
      lockout: 0.25 + 2,
      cc: [{ kind: 'slow', duration: 2 }],
      components: [{ id: 'pool', label: 'Sanguine Pool', type: 'magic', amount: 'calc.TotalDamage / 4', hits: 4, interval: 0.5, aoe: true, dot: true }],
    },
    E: {
      // Charged for up to MaxChannelTime; the damage grows over the first TimetoRampMaxDamage (1s), which also slows.
      charge: { default: 'dv.TimetoRampMaxDamage', max: 'dv.MaxChannelTime' },
      castTime: 'charge',
      notes: ['Default: charged 1s (maximum damage, slows). Set the seconds held (E{0.5s}): the damage grows from min to max over the first second.'],
      cc: [{ kind: 'slow', duration: 'charge >= dv.TimetoRampMaxDamage ? 0.5 : 0' }],
      components: [{ id: 'tides', label: 'Tides of Blood', type: 'magic', amount: 'lerp(calc.MinDamageTooltip, calc.MaxDamageTooltip, min(1, charge / dv.TimetoRampMaxDamage))', aoe: true, delay: 0.1 }],
    },
    R: {
      notes: ['Amplifies all damage the target takes by 10% for 4s, then detonates; the detonation is amplified by Hemoplague itself (wiki).'],
      debuff: {
        id: 'vladR',
        label: 'Hemoplague',
        duration: 'dv.Duration',
        damageTakenAmp: 'dv.DamageAmp / 100',
        detonate: { label: 'Hemoplague', components: [{ id: 'plague', label: 'Hemoplague', type: 'magic', amount: 'calc.Damage', aoe: true }] },
      },
    },
  },
  hooks: {
    onStart(sim) {
      sim.setCounter('vladRush', sim.opt.rush ?? 0);
    },
    onCast(sim, cast) {
      if (cast.slot !== 'Q') return;
      const empowered = cast.variant === 'empowered' || sim.counter('vladRush') >= 2;
      sim.setCounter('vladQEmpowered', empowered ? 1 : 0);
      sim.setCounter('vladRush', empowered ? 0 : sim.counter('vladRush') + 1);
    },
    beforeDamage(sim, inst) {
      // The plague's own detonation is amplified (the debuff is removed just before it is dealt).
      if (inst.fromMark === 'vladR') inst.amps.push({ id: 'R', source: 'Hemoplague', value: sim.evalExpr('R.dv.DamageAmp', { slot: 'R' }) / 100, kind: 'taken' });
    },
  },
};
export default kit;
