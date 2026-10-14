import type { ChampionKit } from '../../engine/kit-types.ts';
import type { Sim } from '../../engine/sim.ts';

// Fiddlesticks — patch 16.20.
// Hooks: Terrify's passive fear (first ability hit while unseen) and the "recently feared" state that
// doubles Terrify's damage; Bountiful Harvest's cooldown refund after a full channel.

const W_REFUND = 0.6; // tooltip: "the remaining Cooldown is reduced by 60%"

const kit: ChampionKit = {
  id: 'Fiddlesticks',
  status: 'curated',
  options: [
    {
      key: 'unseen',
      label: 'Start unseen (passive fear)',
      default: 0,
      toggle: true,
      description: 'The combo starts unseen/out of combat (or as an Effigy): the first ability hit fears the target, so a later Terrify deals double damage.',
    },
  ],
  notes: [
    'Terrify deals % current health with a minimum (dv.MinimumDamage); both are doubled if the target was already feared by Fiddlesticks (passive fear with the "unseen" option, or Q:feared). Terrify\'s own fear does not double its damage.',
    'Bountiful Harvest (dv.DrainDuration) and Crowstorm\'s channel (dv.ChannelTime) lock Fiddlesticks out of other actions. A full Bountiful Harvest channel cuts its remaining cooldown by 60%.',
  ],
  abilities: {
    Q: {
      cc: [{ kind: 'immobilize', duration: 'dv.FearDuration' }],
      components: [
        {
          id: 'terrify',
          label: 'Terrify',
          type: 'magic',
          amount: '(stacks.fiddleFeared > 0 ? 2 : 1) * max(dv.MinimumDamage, calc.TotalPercentHealthDamage * target.hp)',
          delay: 0.35,
        },
      ],
      variants: {
        feared: {
          label: 'feared',
          note: 'Target was recently feared by Fiddlesticks (passive fear, Effigy): doubled damage and minimum.',
          cc: [{ kind: 'immobilize', duration: 'dv.FearDuration' }],
          components: [
            { id: 'terrify', label: 'Terrify (feared)', type: 'magic', amount: '2 * max(dv.MinimumDamage, calc.TotalPercentHealthDamage * target.hp)', delay: 0.35 },
          ],
        },
      },
    },
    W: {
      lockout: 'dv.DrainDuration',
      notes: ['Drain ticks every 1/dv.TicksPerSecond s for dv.DrainDuration s; the last tick adds dv.PercentMultiplier × missing health (uninterrupted channel).'],
      components: [
        {
          id: 'drain',
          label: 'Bountiful Harvest',
          type: 'magic',
          amount: 'calc.DrainDamageCalc / dv.TicksPerSecond',
          hits: 'dv.DrainDuration * dv.TicksPerSecond',
          interval: '1 / dv.TicksPerSecond',
          delay: '1 / dv.TicksPerSecond',
          dot: true,
          aoe: true,
        },
        { id: 'harvest', label: 'Bountiful Harvest (final)', type: 'magic', amount: 'dv.PercentMultiplier * target.missingHp', delay: 'dv.DrainDuration', aoe: true },
      ],
    },
    E: {
      notes: ['Assumes the target is in the center (silenced).'],
      cc: [
        { kind: 'slow', duration: 'dv.SilenceDuration' },
        { kind: 'impair', duration: 'dv.SilenceDuration' },
      ],
      components: [{ id: 'reap', label: 'Reap', type: 'magic', amount: 'calc.Damage', aoe: true }],
    },
    R: {
      dash: true,
      lockout: 'dv.ChannelTime',
      notes: ['Channels dv.ChannelTime s, blinks, then ticks every 0.25s (calc.DamageDone) for dv.Duration s — target assumed to stay inside.'],
      components: [
        {
          id: 'crows',
          label: 'Crowstorm',
          type: 'magic',
          amount: 'calc.DamageDone',
          hits: 'dv.Duration / 0.25',
          interval: 0.25,
          delay: 'dv.ChannelTime + 0.25',
          dot: true,
          aoe: true,
        },
      ],
    },
  },
  hooks: {
    afterDamage(sim: Sim, inst) {
      if (inst.flags.slot === 'W' && inst.label === 'Bountiful Harvest (final)') {
        const remaining = sim.cooldownReadyAt('ability:W') - sim.time;
        if (remaining > 0) sim.startCooldown('ability:W', remaining * (1 - W_REFUND));
      }
      if (inst.fromMark || inst.flags.kind !== 'ability' || !inst.flags.slot || inst.flags.slot === 'P') return;
      // Passive: the first ability hit while unseen fears the target (and counts as "recently feared").
      if (sim.opt.unseen && !sim.counter('fiddle.opened')) {
        sim.setCounter('fiddle.opened', 1);
        sim.applyCC('immobilize', sim.evalExpr('Q.dv.FearDuration', { slot: 'Q' }), inst.castId, inst.flags.slot);
        // Terrify's own damage is not doubled by its own fear.
        if (inst.flags.slot !== 'Q') sim.setCounter('fiddleFeared', 1);
      }
    },
  },
};
export default kit;
