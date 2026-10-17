import type { ChampionKit } from '../../engine/kit-types.ts';
import type { Sim } from '../../engine/sim.ts';

// Milio — patch 16.20.
// Fired Up! is consumed by the next attack OR ability hit, so it is tracked in hooks.

const FIRED_UP = 'milio:firedUpUntil';
// Fired Up! enchantment duration and burn tick rate (wiki: 4s, ticks every 0.25s).
const ENCHANT_DURATION = 4;
const BURN_TICK = 0.25;

function firedUpActive(sim: Sim) {
  return sim.time <= sim.counter(FIRED_UP) + 1e-9;
}

/** Fired Up! burst (% of AD as magic damage) plus the burn, dealt by the consuming hit. Returns the burst. */
function consumeFiredUp(sim: Sim, castId: number): Parameters<Sim['deal']>[0] {
  sim.setCounter(FIRED_UP, -1);
  const ticks = Math.round(sim.evalExpr(`P.dv.BurnDuration / ${BURN_TICK}`, { slot: 'P' }));
  const burnId = sim.newCastId();
  for (let i = 1; i <= ticks; i++)
    sim.schedule(i * BURN_TICK, () =>
      sim.deal({
        source: 'P',
        sourceLabel: 'Fired Up!',
        label: 'Fired Up! (burn)',
        type: 'magic',
        amount: sim.evalExpr(`P.calc.BurnDamage / ${ticks}`, { slot: 'P' }),
        castId: burnId,
        flags: { kind: 'ability', slot: 'P', ability: false, dot: true },
      }),
    );
  return {
    source: 'P',
    sourceLabel: 'Fired Up!',
    label: 'Fired Up!',
    type: 'magic',
    amount: sim.evalExpr('P.calc.ADBurstRatio * ad', { slot: 'P' }),
    castId,
    flags: { kind: 'ability', slot: 'P', ability: false },
  };
}

const kit: ChampionKit = {
  id: 'Milio',
  status: 'curated',
  notes: [
    'Fired Up!: Warm Hugs (E) on himself or Cozy Campfire (W) following him enchant Milio for 4s; his next attack or ability hit deals P.calc.ADBurstRatio of his AD as magic damage plus P.calc.BurnDamage over P.dv.BurnDuration.',
    'Shields, healing, range and move speed buffs are not modeled.',
  ],
  hooks: {
    onCast(sim, cast) {
      if (cast.slot === 'E' || cast.slot === 'W') sim.setCounter(FIRED_UP, sim.time + ENCHANT_DURATION);
    },
    onAttack(sim, atk) {
      if (atk.phantom || atk.fromAbility || !firedUpActive(sim)) return;
      atk.extra.push(consumeFiredUp(sim, atk.castId));
    },
    afterDamage(sim, inst) {
      if (inst.fromMark || inst.flags.slot !== 'Q' || inst.flags.kind !== 'ability' || !firedUpActive(sim)) return;
      sim.deal(consumeFiredUp(sim, inst.castId));
    },
  },
  abilities: {
    Q: {
      notes: ['The kicked target is knocked back (stunned ~1s, wiki) and takes the explosion dv.FallTime later.'],
      // No cast time: Milio kicks the fireball after a 0.25s delay, unable to cast other abilities
      // until then (wiki). It flies to the target, then the explosion comes dv.FallTime later.
      castLockout: 0.25,
      cc: [
        { kind: 'immobilize', duration: 1 },
        { kind: 'slow', duration: 'dv.SlowDuration' },
      ],
      components: [{ id: 'kick', label: 'Ultra Mega Fire Kick', type: 'magic', amount: 'calc.Damage', delay: '0.25 + dv.FallTime', travel: true, aoe: true }],
    },
    W: { noTarget: true, notes: ['Cast on/following Milio himself: grants Fired Up!.'], components: [] },
    E: { noTarget: true, notes: ['Cast on Milio himself: grants Fired Up!.'], components: [] },
    // Milio can't cast his other abilities for 0.75s after activating it (wiki).
    R: { noTarget: true, castLockout: 0.75, components: [] },
  },
};
export default kit;
