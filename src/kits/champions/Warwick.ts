import type { ChampionKit, ComponentSpec } from '../../engine/kit-types.ts';

// Warwick — patch 16.20.
// Eternal Hunger is an on-hit effect: Q and R's strikes apply on-hit effects in game, but the engine
// applies kit passive on-hits only to basic attacks, so those abilities list it explicitly.
const HUNGER: ComponentSpec = { id: 'hunger', label: 'Eternal Hunger', type: 'magic', amount: 'P.calc.OnHitDamage', noProc: true };

const kit: ChampionKit = {
  id: 'Warwick',
  status: 'curated',
  notes: [
    'Blood Hunt attack speed: active while the target is below 50% health (or for 8s after casting W), doubled below 25% (wiki: 70–110% → 140–220%; the tooltip says "increased by 200%"). The 1.25s refresh window is treated as always maintained in combat.',
    'Healing (Eternal Hunger, Q, R) is not modeled.',
  ],
  attack: { onHit: [HUNGER] },
  abilities: {
    Q: {
      dash: true,
      notes: ['Tap: bite applying on-hit effects. Hold deals the same damage.'],
      components: [
        { id: 'bite', label: 'Jaws of the Beast', type: 'magic', amount: 'calc.BaseBiteDamage + dv.TargetPercentHPDamage / 100 * target.maxHp', onHit: true, onAttack: true, delay: 0.15 },
        { ...HUNGER, delay: 0.15 },
      ],
    },
    W: {
      noTarget: true,
      buff: { id: 'warwickW', label: 'Blood Hunt (active)', duration: 'dv.Duration' },
    },
    E: {
      noTarget: true,
      notes: ['Assumes Primal Howl is recast as soon as possible (1s): the fear lands 1s after the cast (hook).'],
    },
    R: {
      dash: true,
      // Busy for the leap (~0.3s) plus the 1.5s channel.
      lockout: '0.3 + dv.RDuration',
      notes: [
        '6 strikes every 0.25s during the 1.5s suppression (wiki): strikes 1/3/5 deal 2/9 of the total and apply on-hit effects, 2/4/6 deal 1/9 without on-hit.',
      ],
      cc: [{ kind: 'immobilize', duration: 'dv.RDuration' }],
      components: [
        { id: 'strike', label: 'Infinite Duress', type: 'magic', amount: 'calc.DamageCumulative * 2 / 9', hits: 3, interval: 0.5, delay: 0.3, onHit: true, onAttack: true },
        { ...HUNGER, hits: 3, interval: 0.5, delay: 0.3 },
        { id: 'tick', label: 'Infinite Duress', type: 'magic', amount: 'calc.DamageCumulative / 9', hits: 3, interval: 0.5, delay: 0.55 },
      ],
    },
  },
  hooks: {
    onCast(sim, cast) {
      if (cast.slot !== 'E') return;
      const id = cast.castId;
      sim.schedule(0.25 + sim.evalExpr('E.dv.RecastDelay', { slot: 'E' }), () => sim.applyCC('immobilize', sim.evalExpr('E.dv.FearDuration', { slot: 'E' }), id, 'E'));
    },
    dynamicStats(sim) {
      const rank = sim.abilityRank('W');
      if (rank <= 0) return;
      const w = sim.spellFor('W');
      const pct = Math.max(0, sim.target.hp) / sim.target.maxHp;
      const active = pct < sim.dataValue(w, 'FirstHPThreshold', rank) || !!sim.getBuff('warwickW');
      if (!active) return;
      const mult = pct < sim.dataValue(w, 'SecondHPThreshold', rank) ? 2 : 1;
      return { attackSpeed: (sim.dataValue(w, 'PassiveASBonus', rank) / 100) * mult };
    },
  },
};
export default kit;
