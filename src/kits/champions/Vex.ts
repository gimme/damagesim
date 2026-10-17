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
      components: [{ id: 'bolt', label: 'Mistral Bolt', type: 'magic', amount: 'calc.QDamageCalc', aoe: true, travel: '500 / missileSpeed + (castRange - 500) / 3200' }],
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
      notes: ['Default: Shadow\'s surge plus the recast dash as soon as it lands. "R:surge" = first part only.'],
      // The shadow flies its range; the recast (no cast time) then dashes back over it at ~2200 speed
      // (the wiki's estimate, not in the data). Wiki: unable to attack or cast during the dash: busy
      // until it lands.
      lockout: 'castTime + castRange / missileSpeed + castRange / 2200',
      components: [
        { id: 'surge', label: 'Shadow Surge', type: 'magic', amount: 'calc.RDamageCalc', travel: true },
        { id: 'dash', label: 'Shadow Surge (dash)', type: 'magic', amount: 'calc.RecastDamageCalc', travel: 'castRange / missileSpeed + castRange / 2200', sameCast: false },
      ],
      variants: {
        surge: { label: 'surge', lockout: 0, components: [{ id: 'surge', label: 'Shadow Surge', type: 'magic', amount: 'calc.RDamageCalc', travel: true }] },
      },
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
