import type { ChampionKit, ComponentSpec, BuffSpec } from '../../engine/kit-types.ts';
import type { Sim } from '../../engine/sim.ts';

// Vel'Koz — patch 16.20.
// Organic Deconstruction: each ability hit adds a stack (Void Rift's two hits add one each); at 3
// stacks the target takes true damage and becomes "Researched" (7s, wiki), which makes Life Form
// Disintegration Ray deal true damage instead of magic.
const RESEARCH: BuffSpec = { id: 'velkozResearch', label: 'Researched (target)', duration: 'P.dv.Duration' };
const PROC: ComponentSpec = { id: 'deconstruct', label: 'Organic Deconstruction', type: 'true', amount: 'P.calc.TotalDamage', noProc: true };

/** The beam adds a stack every 0.7s (wiki) — done by hand since the mark counts every damage tick. */
function beamStack(sim: Sim) {
  let m = sim.marks.get('deconstruction');
  if (!m || m.expires < sim.time) {
    m = { stacks: 0, expires: 0, castIds: new Set(), cooldownUntil: -Infinity, ticking: false };
    sim.marks.set('deconstruction', m);
  }
  m.stacks += 1;
  m.expires = sim.time + sim.evalExpr('P.dv.Duration', { slot: 'P' });
  if (m.stacks < sim.evalExpr('P.dv.MaxStacks', { slot: 'P' })) return;
  m.stacks = 0;
  m.castIds.clear();
  sim.deal({
    source: 'P',
    sourceLabel: 'Organic Deconstruction',
    label: PROC.label,
    type: 'true',
    amount: sim.evalExpr(PROC.amount, { slot: 'P' }),
    flags: { kind: 'ability', slot: 'P', ability: false },
    markSource: 'deconstruction',
  });
  sim.applyBuff(RESEARCH, 'P', sim.spellFor('P'), 1);
}

const kit: ChampionKit = {
  id: 'Velkoz',
  status: 'curated',
  notes: [
    'Void Rift\'s initial hit and eruption each add a Deconstruction stack; the ray adds one every 0.7s of channel (wiki).',
    'Life Form Disintegration Ray deals true damage while the target is Researched (7s after a Deconstruction proc).',
  ],
  marks: [
    {
      id: 'deconstruction',
      label: 'Organic Deconstruction',
      maxStacks: 'P.dv.MaxStacks',
      duration: 'P.dv.Duration',
      appliedBy: ['Q', 'W', 'E'],
      oncePerCast: false,
      atMax: { consume: true, components: [PROC], buff: RESEARCH },
    },
  ],
  abilities: {
    Q: {
      cc: [{ kind: 'slow', duration: 'dv.SlowDuration' }],
      notes: ['A single target is hit by either the bolt or one split bolt (same damage).'],
      components: [{ id: 'bolt', label: 'Plasma Fission', type: 'magic', amount: 'calc.TotalDamage', delay: 0.25 }],
    },
    W: {
      notes: ['Rift opens 0.25s after the cast and erupts ~0.75s after it (wiki).'],
      components: [
        { id: 'initial', label: 'Void Rift', type: 'magic', amount: 'calc.InitialDamage', aoe: true, delay: 0.25 },
        { id: 'eruption', label: 'Void Rift (eruption)', type: 'magic', amount: 'calc.SecondaryDamage', aoe: true, delay: 0.75 },
      ],
    },
    E: {
      cc: [{ kind: 'immobilize', duration: 'dv.StunDuration' }],
      components: [{ id: 'disrupt', label: 'Tectonic Disruption', type: 'magic', amount: 'calc.TotalDamage', aoe: true, delay: 'dv.MaxDetonationTime' }],
    },
    R: {
      // Busy for the 0.25s cast, 0.2s delay and 2.6s channel (wiki).
      lockout: 0.25 + 0.2 + 2.6,
      cc: [{ kind: 'slow', duration: 2.6 }],
      notes: [
        'Full channel: 13 ticks every 0.2s after a 0.2s delay (wiki); total = tooltip damage. Use R{beam:N} for a partial channel.',
      ],
      components: [
        { id: 'beam', label: 'Disintegration Ray', type: 'magic', amount: 'calc.TotalDamage / 13', hits: 13, interval: 0.2, delay: 0.2, aoe: true, dot: true },
      ],
    },
  },
  hooks: {
    onCast(sim, cast) {
      if (cast.slot === 'R') sim.setCounter('velkoz.rStart', sim.time);
    },
    beforeDamage(sim, inst) {
      if (inst.flags.slot === 'R' && inst.flags.kind === 'ability' && sim.getBuff(RESEARCH.id)) inst.type = 'true';
    },
    afterDamage(sim, inst) {
      if (inst.flags.slot !== 'R' || inst.fromMark) return;
      const start = sim.counter('velkoz.rStart');
      const n = sim.counter('velkoz.rStacks.' + start);
      if (sim.time - start - 0.25 >= 0.7 * (n + 1) - 1e-6) {
        sim.setCounter('velkoz.rStacks.' + start, n + 1);
        beamStack(sim);
      }
    },
  },
};
export default kit;
