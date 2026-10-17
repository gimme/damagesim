import type { ChampionKit } from '../../engine/kit-types.ts';

// Rek'Sai — patch 16.20.
// Fury is tracked as a counter-style mark: +25 per attack / ability hit (oncePerCast), max 100
// (wiki: healing scales over 0-100 Fury). Furious Bite deals true damage at max Fury.
const kit: ChampionKit = {
  id: 'RekSai',
  status: 'curated',
  notes: [
    'Default forms: Q/E are the unburrowed versions; W is Un-burrow (knock-up), since the burrow cast deals no damage. Use Q:burrowed, E:tunnel, W:burrow for the other forms.',
    'Fury: +25 per attack and per ability hit, max 100 (option "fury" sets the starting Fury). Furious Bite deals true damage if Fury is full when it is cast, and then spends all Fury.',
    'Void Rush: the leap lands ~1.1s after the cast (CastBuffDuration).',
  ],
  options: [{ key: 'fury', label: 'Starting Fury', default: 0, min: 0, max: 100, step: 25 }],
  marks: [
    {
      id: 'fury',
      label: 'Fury',
      // Max Fury 100 (not in the data; wiki).
      maxStacks: 100,
      duration: 'P.dv.PauseDuration',
      stacksPerHit: 'P.dv.FuryFromAttacks',
      appliedBy: ['attack', 'ability'],
    },
  ],
  abilities: {
    Q: {
      resetsAttack: true,
      notes: ['Next 3 attacks gain attack speed and deal bonus physical damage (the main target\'s bonus can crit). Write combos as "Q AA AA AA".'],
      buff: {
        id: 'reksaiQ',
        label: "Queen's Wrath",
        duration: 'dv.BuffDuration',
        stats: { attackSpeed: 'dv.AttackSpeed' },
        empowerAttacks: {
          count: 3,
          resetsAttack: true,
          components: [{ id: 'wrath', label: "Queen's Wrath", type: 'physical', amount: 'Q.calc.TotalDamageTooltip', canCrit: true }],
        },
      },
      variants: {
        burrowed: {
          label: 'burrowed (Prey Seeker)',
          spell: 'RekSaiQBurrowed',
          // The bolt flies 1500 units at 1950 speed (wiki; not in the data for the burrowed spell).
          components: [{ id: 'seeker', label: 'Prey Seeker', type: 'magic', amount: 'Q.calc.BurrowDamageTooltip', aoe: true, travel: '1500 / 1950' }],
        },
      },
    },
    W: {
      spell: 'RekSaiWBurrowed',
      name: 'Burrow / Un-burrow',
      notes: ['Un-burrow: damage around Rek\'Sai and knock-up on the primary target.'],
      cc: [{ kind: 'immobilize', duration: "spell['RekSaiW'].dv.KnockupDuration" }],
      // Wiki: unable to move or attack for 0.15s (LockoutTime) after hitting an enemy, which happens at
      // the end of the cast time.
      lockout: "castTime + spell['RekSaiW'].dv.LockoutTime",
      components: [{ id: 'unburrow', label: 'Un-burrow', type: 'magic', amount: "spell['RekSaiW'].calc.UnburrowDamage", aoe: true }],
      variants: {
        burrow: { label: 'burrow', spell: 'RekSaiW', cc: [], lockout: 0, components: [] },
      },
    },
    E: {
      notes: ['Physical damage, or true damage (×1.2) at 100 Fury.'],
      components: [
        { id: 'bite', label: 'Furious Bite', type: 'physical', amount: 'calc.BaseDamageCalculation', hits: 'stacks.fury >= 100 ? 0 : 1' },
        { id: 'fury', label: 'Furious Bite (max Fury)', type: 'true', amount: 'calc.EmpoweredDamageCalculation', hits: 'stacks.fury >= 100 ? 1 : 0' },
      ],
      variants: {
        tunnel: {
          label: 'tunnel (burrowed)',
          spell: 'RekSaiEBurrowed',
          dash: true,
          // Dashes 850 units at 500 + her movement speed (wiki; Furious Bite's spell holds the values).
          lockout: "castTime + spell['RekSaiE'].dv.DashDistance / (spell['RekSaiE'].dv.DashSpeedBase + spell['RekSaiE'].dv.DashSpeedMod * ms)",
          components: [],
        },
      },
    },
    R: {
      dash: true,
      // Wiki: unable to act from the cast until the pounce lands: vanished for 0.9s after the cast time,
      // then the pounce (dv.CastBuffDuration in all).
      lockout: 'castTime + dv.CastBuffDuration',
      components: [
        { id: 'rush', label: 'Void Rush', type: 'physical', amount: 'calc.RBaseDamageCalc + dv.PercentHealthDamage / 100 * target.maxHp', delay: 'dv.CastBuffDuration' },
      ],
    },
  },
  hooks: {
    onStart(sim) {
      const fury = Math.min(100, sim.opt.fury ?? 0);
      if (fury > 0) sim.setMarkStacks('fury', fury, sim.evalExpr('P.dv.PauseDuration', { slot: 'P' }));
    },
    // The max-Fury Furious Bite spends all Fury (after the bite's own Fury gain is processed).
    afterDamage(sim, inst) {
      if (inst.source === 'E' && inst.type === 'true' && !inst.fromMark) sim.schedule(0, () => sim.setMarkStacks('fury', 0));
    },
  },
};
export default kit;
