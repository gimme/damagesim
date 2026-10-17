import type { ChampionKit } from '../../engine/kit-types.ts';

// Vex — patch 16.20.
// Gloom: applied by Looming Darkness (and by enemy dashes, not modeled); Vex's next basic attack or
// basic ability (Q/W) hit consumes it for bonus magic damage (wiki: E applies but can't detonate it,
// R doesn't detonate). Doom: the next basic ability fears; modeled in hooks (Doom ready at start).
const kit: ChampionKit = {
  id: 'Vex',
  status: 'curated',
  notes: [
    'Doom is assumed ready at combo start (option "doom"): the first basic ability (Q/W/E) that hits fears; it then recharges on its data cooldown. Gloom refunds to Doom\'s cooldown are not modeled.',
    'Gloom from enemy dashes is not modeled; only Looming Darkness applies it.',
  ],
  options: [{ key: 'doom', label: 'Doom ready at start', default: 1, toggle: true }],
  abilities: {
    Q: {
      // Wiki: the wave flies 500 units at its 600 speed, then speeds up to 3200.
      components: [{ id: 'bolt', label: 'Mistral Bolt', type: 'magic', amount: 'calc.QDamageCalc', aoe: true, travel: 'min(reach, 500) / missileSpeed + max(0, reach - 500) / 3200' }],
    },
    W: {
      components: [{ id: 'wave', label: 'Personal Space', type: 'magic', amount: 'calc.WDamageCalc', aoe: true }],
    },
    E: {
      cc: [{ kind: 'slow', duration: 'dv.SlowDuration' }],
      debuff: {
        id: 'gloom',
        label: 'Gloom',
        duration: 'P.dv.GloomDuration',
        consume: { by: ['attack', 'Q', 'W'], components: [{ id: 'gloom', label: 'Gloom', type: 'magic', amount: 'P.calc.GloomProcCalc', proc: true }] },
      },
      components: [{ id: 'shadow', label: 'Looming Darkness', type: 'magic', amount: 'calc.EDamageCalc', aoe: true, travel: true }],
    },
    R: {
      dash: true,
      recasts: 2,
      notes: ['Two parts: "R" sends the shadow, "R R" also dashes to the marked target (the recast, once the shadow lands).'],
      // The recast needs the shadow's mark: it lands after flying to the target.
      recastDelay: 'castTime + reach / missileSpeed',
      // Wiki: the recast has no cast time and dashes to the target at ~2200 speed (the wiki's estimate,
      // not in the data), unable to attack or cast until she arrives.
      castTime: 'recast == 2 ? 0 : castTime',
      lockout: 'recast == 2 ? reach / 2200 : castTime',
      components: [
        { id: 'surge', label: 'Shadow Surge', type: 'magic', amount: 'calc.RDamageCalc', hits: 'recast == 1 ? 1 : 0', travel: true },
        { id: 'dash', label: 'Shadow Surge (dash)', type: 'magic', amount: 'calc.RecastDamageCalc', hits: 'recast == 2 ? 1 : 0', travel: 'reach / 2200' },
      ],
    },
  },
  hooks: {
    onStart(sim) {
      if (!sim.opt.doom) sim.startCooldown('vex.doom', sim.evalExpr('P.calc.DoomCD', { slot: 'P' }));
    },
    onCast(sim, cast) {
      if (!['Q', 'W', 'E'].includes(cast.slot) || !cast.hitsTarget || !sim.isReady('vex.doom')) return;
      // Doom's cooldown starts when the basic ability is cast (wiki).
      sim.startCooldown('vex.doom', sim.evalExpr('P.calc.DoomCD', { slot: 'P' }));
      sim.setCounter('vex.doomCast', cast.castId);
    },
    afterDamage(sim, inst) {
      if (inst.castId !== sim.counter('vex.doomCast') || !inst.flags.slot) return;
      sim.setCounter('vex.doomCast', 0);
      sim.applyCC('immobilize', sim.evalExpr('P.calc.FearDuration', { slot: 'P' }), inst.castId, inst.flags.slot);
    },
  },
};
export default kit;
