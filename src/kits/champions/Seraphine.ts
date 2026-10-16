import type { CCSpec, ChampionKit, ComponentSpec } from '../../engine/kit-types.ts';
import type { Sim } from '../../engine/sim.ts';
import type { Slot } from '../../engine/effects.ts';

// Seraphine — patch 16.20.
// Stage Presence: every third basic ability is echoed (cast again for free), and every ability cast
// gives Seraphine a Note; her next attack fires all Notes for bonus magic damage. Both are
// counters, so they are handled by hooks.

const highNote: ComponentSpec = {
  id: 'note',
  label: 'High Note',
  type: 'magic',
  // +7.5% damage per 7.5% missing health (wiki: stepped), up to +DamageAmp% at ExecuteThreshold health.
  amount: 'calc.ExplosionDamage * (1 + dv.DamageAmp / 100 * min(1, floor(target.missingHpPct / 0.075 + 1e-6) * 0.075 / (1 - dv.ExecuteThreshold)))',
  aoe: true,
  delay: 0.4,
};
const beatDrop: ComponentSpec = { id: 'wave', label: 'Beat Drop', type: 'magic', amount: 'calc.FinalDamage', aoe: true, delay: 0.25 };

// Already slowed → rooted, already immobilized → stunned (both immobilize); otherwise slowed.
// The immobilize entry is evaluated before this cast's own slow lands.
const beatDropCC: CCSpec[] = [
  { kind: 'immobilize', duration: 'target.slowed || target.immobilized ? dv.SlowDuration : 0' },
  { kind: 'slow', duration: 'target.immobilized ? 0 : dv.SlowDuration' },
];

/** Each ability cast creates a Note (max MaxNotes, NoteDuration refreshes). */
function addNote(sim: Sim) {
  const max = sim.evalExpr('P.dv.MaxNotes', { slot: 'P' });
  const live = sim.counter('seraNotesUntil') >= sim.time ? sim.counter('seraNotes') : 0;
  sim.setCounter('seraNotes', Math.min(max, live + 1));
  sim.setCounter('seraNotesUntil', sim.time + sim.evalExpr('P.dv.NoteDuration', { slot: 'P' }));
}

/** The echo: a free second cast of the same ability EchoCastDelay after the first. */
function echo(sim: Sim, slot: Slot, castTime: number) {
  const delay = castTime + sim.evalExpr('P.dv.EchoCastDelay', { slot: 'P' });
  const castId = sim.newCastId();
  sim.schedule(delay, () => addNote(sim));
  const comp = slot === 'Q' ? highNote : slot === 'E' ? beatDrop : undefined;
  if (!comp) return; // Surround Sound: shield only
  sim.schedule(delay + Number(comp.delay ?? 0), () => {
    sim.deal({
      source: slot,
      sourceLabel: `${comp.label} (echo)`,
      label: comp.label,
      type: 'magic',
      amount: sim.evalExpr(comp.amount, { slot }),
      castId,
      flags: { kind: 'ability', slot, ability: true, aoe: true },
    });
    if (slot === 'E') for (const cc of beatDropCC) sim.applyCC(cc.kind, sim.evalExpr(cc.duration, { slot: 'E' }), castId, 'E');
  });
}

const kit: ChampionKit = {
  id: 'Seraphine',
  status: 'curated',
  notes: [
    'Echo: every third basic ability (Q/W/E) is automatically cast a second time (free) — e.g. "Q E Q" echoes the second Q.',
    'Notes: each ability cast (echoes included) gives Seraphine one Note (max 4, 6s); her next attack fires all of them for bonus magic damage each. Ally notes are not modeled.',
    'Beat Drop roots targets that are already slowed (e.g. by the first Beat Drop when it is echoed) and stuns immobilized targets.',
  ],
  abilities: {
    Q: {
      notes: ['Damage increases by 7.5% per 7.5% missing health of the target, up to +75% below 25% health.'],
      components: [highNote],
    },
    W: { noTarget: true, components: [] },
    E: {
      cc: beatDropCC,
      components: [beatDrop],
    },
    R: {
      // Wiki: two 0.5s cast times; the wave goes out after the first, the second only locks Seraphine out.
      lockout: 1,
      cc: [{ kind: 'immobilize', duration: 'dv.RChannelDuration' }],
      components: [{ id: 'encore', label: 'Encore', type: 'magic', amount: 'calc.R1TotalDamage', aoe: true, delay: 0.3 }],
    },
  },
  hooks: {
    onCast(sim, cast) {
      if (cast.slot === 'P') return;
      const castTime = sim.spellFor(cast.slot).castTime ?? 0;
      sim.schedule(castTime, () => addNote(sim));
      if (cast.slot === 'R') return;
      const n = sim.counter('seraEcho') + 1;
      if (n >= 3) {
        sim.setCounter('seraEcho', 0);
        if (cast.hitsTarget || cast.slot === 'W') echo(sim, cast.slot, castTime);
      } else sim.setCounter('seraEcho', n);
    },
    onAttack(sim, atk) {
      if (atk.fromAbility || atk.phantom) return;
      const notes = sim.counter('seraNotesUntil') >= sim.time ? sim.counter('seraNotes') : 0;
      if (notes <= 0) return;
      sim.setCounter('seraNotes', 0);
      const amount = sim.evalExpr('P.calc.AutoDamage', { slot: 'P' });
      for (let i = 0; i < notes; i++)
        atk.extra.push({ source: 'P', sourceLabel: 'Stage Presence', label: 'Note', type: 'magic', amount, castId: atk.castId, flags: { kind: 'ability', slot: 'P', onHit: true, ability: false, proc: true } });
    },
  },
};
export default kit;
