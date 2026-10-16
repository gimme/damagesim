import type { ChampionKit } from '../../engine/kit-types.ts';

// Nami — patch 16.20.
// Tidecaller's Blessing is modeled self-cast: it empowers Nami's next 3 attacks *or* abilities
// (shared charges). Attacks use the buff's empowerAttacks; abilities are handled by a small hook.
const kit: ChampionKit = {
  id: 'Nami',
  status: 'curated',
  notes: [
    "Tidecaller's Blessing is assumed cast on Nami herself; its 3 charges are shared by attacks and Q/W/R casts (one charge and one bonus hit per ability cast).",
    'The 33–66% area reduction of the blessing only applies to non-champions, so champions take the full bonus.',
  ],
  abilities: {
    Q: {
      cc: [{ kind: 'immobilize', duration: 'dv.StunDuration' }],
      notes: ['Bubble assumed to land 0.5 s after the cast (distance dependent).'],
      components: [{ id: 'bubble', label: 'Aqua Prison', type: 'magic', amount: 'calc.TotalDamageTT', aoe: true, delay: 0.5 }],
    },
    W: {
      notes: ['Default: cast directly on the enemy (full damage). Variant "bounced": the enemy is the second target after an ally (−20% +15% per 100 AP).'],
      variants: {
        bounced: {
          label: 'after bouncing off an ally',
          components: [{ id: 'bounce', label: 'Ebb and Flow (bounce)', type: 'magic', amount: 'calc.TotalDamage * (1 + calc.BounceScaling)', delay: 0.3 }],
        },
      },
      components: [{ id: 'stream', label: 'Ebb and Flow', type: 'magic', amount: 'calc.TotalDamage', delay: 0.1 }],
    },
    E: {
      noTarget: true,
      notes: ['Self-cast. Empowered attacks and abilities also slow.'],
      buff: {
        id: 'namiE',
        label: "Tidecaller's Blessing",
        duration: 'dv.BuffDuration',
        empowerAttacks: {
          count: 'dv.HitCount',
          cc: [{ kind: 'slow', duration: 'E.dv.SlowDuration' }],
          components: [{ id: 'blessing', label: 'Blessing', type: 'magic', amount: 'E.calc.TotalDamage', proc: true }],
        },
      },
    },
    R: {
      cc: [{ kind: 'immobilize', duration: 'dv.KnockupDuration' }, { kind: 'slow', duration: 'dv.MaxSlowDuration' }],
      notes: ['Wave assumed to reach the target 0.5 s after the cast; slow assumed at max duration (long travel).'],
      components: [{ id: 'wave', label: 'Tidal Wave', type: 'magic', amount: 'calc.TotalDamage', aoe: true, delay: 0.5 }],
    },
  },
  hooks: {
    // Blessing charges are also spent by Nami's damaging abilities (once per cast).
    afterDamage(sim, inst) {
      if (inst.flags.kind !== 'ability' || inst.flags.attack || inst.fromMark) return;
      if (inst.flags.slot !== 'Q' && inst.flags.slot !== 'W' && inst.flags.slot !== 'R') return;
      const b = sim.getBuff('namiE');
      if (!b || (b.charges ?? 0) <= 0 || sim.counter('namiE.lastCast') === inst.castId) return;
      sim.setCounter('namiE.lastCast', inst.castId);
      b.charges = (b.charges ?? 1) - 1;
      if (b.charges <= 0) sim.removeBuff('namiE');
      sim.deal({
        source: 'E',
        sourceLabel: "Tidecaller's Blessing",
        label: 'Blessing (ability)',
        type: 'magic',
        amount: sim.evalExpr('E.calc.TotalDamage', { slot: 'E' }),
        castId: inst.castId,
        flags: { kind: 'ability', slot: 'E', ability: false, proc: true },
      });
      sim.applyCC('slow', sim.evalExpr('E.dv.SlowDuration', { slot: 'E' }), inst.castId, 'E');
    },
  },
};
export default kit;
