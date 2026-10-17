import type { BuffSpec, ChampionKit } from '../../engine/kit-types.ts';

// Zoe — patch 16.20.
// Sleepy Trouble Bubble: after DrowsyDuration the target sleeps for SleepDuration with PercentPen
// magic resist reduction; the first damage instance that wakes it (or lands within BrittleLinger
// after the sleep ends) deals bonus true damage equal to its post-mitigation damage, capped at
// BreakDamageTooltip (wiki). Debuffs can't start delayed, so the sleep window is tracked by hooks.
const sparkles: BuffSpec = {
  id: 'zoeP',
  label: 'More Sparkles!',
  duration: 5, // wiki: the next attack within 5 seconds of an ability
  empowerAttacks: { count: 1, components: [{ id: 'sparkles', label: 'More Sparkles!', type: 'magic', amount: 'P.calc.PassiveDamage', proc: true }] },
};

const kit: ChampionKit = {
  id: 'Zoe',
  status: 'curated',
  notes: [
    'More Sparkles!: every ability cast empowers the next attack within 5s.',
    'Paddle Star: minimum damage by default (short travel); Q:max for a full-distance (redirected) star.',
    'Spell Thief: casting W (a picked-up shard) fires 3 bolts; the stolen spell itself and the bolts from summoner spell casts are not modeled.',
    'Sleepy Trouble Bubble: the target falls asleep DrowsyDuration after the hit — wait before the waking hit (e.g. "E wait{1.4s} Q:max") to get the MR reduction and the capped true-damage wake bonus.',
  ],
  hooks: {
    afterDamage(sim, inst) {
      if (inst.fromMark) return;
      if (inst.source === 'E' && inst.label === 'Sleepy Trouble Bubble') {
        const start = sim.time + sim.evalExpr('E.dv.DrowsyDuration', { slot: 'E' });
        sim.setCounter('zoeSleepStart', start);
        sim.setCounter('zoeSleepEnd', start + sim.evalExpr('E.dv.SleepDuration', { slot: 'E' }));
        sim.setCounter('zoeAsleep', 1);
        return;
      }
      if (!sim.counter('zoeAsleep') || inst.flags.dot) return;
      const start = sim.counter('zoeSleepStart');
      const end = sim.counter('zoeSleepEnd') + sim.evalExpr('E.dv.BrittleLinger', { slot: 'E' });
      if (sim.time < start - 1e-9) return;
      sim.setCounter('zoeAsleep', 0);
      if (sim.time > end + 1e-9) return;
      const cap = sim.evalExpr('E.calc.BreakDamageTooltip', { slot: 'E' });
      sim.deal({ source: 'E', sourceLabel: 'Sleepy Trouble Bubble', label: 'Wake-up bonus', type: 'true', amount: Math.min(inst.final ?? 0, cap), castId: inst.castId, flags: { kind: 'ability', slot: 'E', ability: false, proc: true }, markSource: 'zoeSleep' });
    },
    targetResist(sim) {
      if (!sim.counter('zoeAsleep')) return;
      if (sim.time < sim.counter('zoeSleepStart') - 1e-9 || sim.time > sim.counter('zoeSleepEnd') + 1e-9) return;
      return { mrPercent: sim.evalExpr('E.dv.PercentPen', { slot: 'E' }) };
    },
  },
  abilities: {
    Q: {
      buff: sparkles,
      variants: {
        // Wiki: the star flies its 800 range at 1200 speed, then, redirected (no cast time), at 2500 speed
        // on to the 2550 units travelled for full damage.
        max: {
          label: 'max distance',
          components: [{ id: 'star', label: 'Paddle Star! (max)', type: 'magic', amount: 'calc.MaxDamageTooltip', aoe: true, travel: 'castRange / missileSpeed + (2550 - castRange) / 2500' }],
        },
      },
      components: [{ id: 'star', label: 'Paddle Star!', type: 'magic', amount: 'calc.TotalDamageTooltip', aoe: true, travel: true }],
    },
    W: {
      buff: sparkles,
      // "tosses 3 missiles" (tooltip text; not a data value); no missile speed in the data or the wiki.
      components: [{ id: 'bolt', label: 'Spell Thief bolt', type: 'magic', amount: 'calc.MissileDamageTooltip', hits: 3, maxHits: 3, interval: 0.2, delay: 0.3 }],
    },
    E: {
      buff: sparkles,
      cc: [
        { kind: 'slow', duration: 'dv.DrowsyDuration' },
        { kind: 'immobilize', duration: 'dv.SleepDuration', delay: 'dv.DrowsyDuration' },
      ],
      components: [{ id: 'bubble', label: 'Sleepy Trouble Bubble', type: 'magic', amount: 'calc.TotalDamageTooltip', travel: true }],
    },
    R: {
      dash: true,
      noTarget: true,
      // Wiki: unable to act for a varied ~0.55-0.75s from the start of the cast time (bugged): the
      // shortest. The second lockout before she blinks back (~1s later) isn't modeled.
      lockout: 0.55,
      buff: sparkles,
      components: [],
    },
  },
};
export default kit;
