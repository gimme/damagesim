import type { ChampionKit } from '../../engine/kit-types.ts';
import type { Sim } from '../../engine/sim.ts';
import type { DamageInstance } from '../../engine/effects.ts';

// Varus — patch 16.20.
// Blight: attacks add stacks (kit mark); any ability hit (Q/E/R) detonates all stacks for % max health
// magic damage, amplified by Piercing Arrow's charge. Detonation, the W-active bonus and R's delayed
// stacks are done in hooks because they read/clear the mark at hit time.

/** Seconds of charge for Piercing Arrow's full damage and detonation amp (wiki). */
const CHARGED = 1.25;

function addBlight(sim: Sim) {
  const max = sim.evalExpr('W.dv.MaxStacks', { slot: 'W' });
  let m = sim.marks.get('blight');
  if (!m || m.expires < sim.time) {
    m = { stacks: 0, expires: 0, castIds: new Set(), cooldownUntil: -Infinity, ticking: false };
    sim.marks.set('blight', m);
  }
  m.stacks = Math.min(max, m.stacks + 1);
  m.expires = sim.time + sim.evalExpr('W.dv.DebuffDuration', { slot: 'W' });
}

function detonate(sim: Sim, inst: DamageInstance, amp: number) {
  const stacks = sim.markStacks('blight') ?? 0;
  if (stacks <= 0 || sim.abilityRank('W') <= 0) return;
  sim.marks.get('blight')!.stacks = 0;
  sim.deal({
    source: inst.source,
    sourceLabel: 'Blighted Quiver',
    label: `Blight detonation (${stacks})`,
    type: 'magic',
    amount: sim.evalExpr('W.calc.PercentHPPerStack * target.maxHp', { slot: 'W' }) * stacks * amp,
    castId: inst.castId,
    flags: { kind: 'ability', slot: inst.flags.slot, ability: false, proc: true },
    markSource: 'blight',
  });
}

const kit: ChampionKit = {
  id: 'Varus',
  status: 'curated',
  notes: [
    'Living Vengeance (takedown stats) is not modeled.',
    'Blight detonations (Q/E/R) deal per-stack % max health magic damage; Piercing Arrow amplifies the detonation by its charge bonus (full charge by default).',
  ],
  marks: [
    {
      id: 'blight',
      label: 'Blight',
      slot: 'W',
      maxStacks: 'W.rank > 0 ? W.dv.MaxStacks : 0',
      duration: 'W.dv.DebuffDuration',
      appliedBy: ['attack'],
    },
  ],
  attack: {
    onHit: [{ id: 'quiver', label: 'Blighted Quiver', slot: 'W', type: 'magic', amount: 'W.rank > 0 ? W.calc.OnHitDamage : 0', proc: true }],
  },
  abilities: {
    Q: {
      // Charged for up to MaxChannelDuration; damage (and detonation amp) grows to its maximum over
      // the first 1.25s (wiki).
      charge: { default: CHARGED, max: 'dv.MaxChannelDuration' },
      castTime: 'charge',
      notes: [
        'Default: fully charged (1.25s charge, maximum damage, +50% Blight detonation). Set the seconds held (Q{0.5s}): damage and detonation amp grow over the first 1.25s.',
        'After W, the next Piercing Arrow adds % missing health magic damage (more the longer it was charged).',
      ],
      // Wiki: the arrow's range grows from 895 to 1595 over the first 1.5s of the charge; it pierces
      // the target on the way.
      components: [
        {
          id: 'arrow',
          label: 'Piercing Arrow',
          type: 'physical',
          amount: `lerp(calc.TotalDamageMinTooltip, calc.TotalDamageMax, min(1, charge / ${CHARGED}))`,
          travel: 'min(distance, 895 + 700 * min(1, charge / 1.5)) / missileSpeed',
        },
      ],
    },
    W: {
      noTarget: true,
      notes: ['Active: empowers the next Piercing Arrow within 5.5s (wiki) with % missing health magic damage.'],
      buff: { id: 'varusW', label: 'Blighted Quiver (active)', duration: 5.5 },
    },
    E: {
      cc: [{ kind: 'slow', duration: 'dv.GroundDuration' }],
      // Wiki: the arrows land 0.5s after they're fired.
      components: [{ id: 'hail', label: 'Hail of Arrows', type: 'physical', amount: 'calc.TotalDamage', aoe: true, delay: 0.5 }],
    },
    R: {
      cc: [{ kind: 'immobilize', duration: 'dv.RootDuration' }],
      notes: ['The hit detonates existing Blight; the rooted target then gains 3 Blight stacks, one every 0.5s.'],
      components: [{ id: 'chain', label: 'Chain of Corruption', type: 'magic', amount: 'calc.TotalDamage', travel: true }],
    },
  },
  hooks: {
    onCast(sim, cast) {
      if (cast.slot === 'Q') sim.setCounter('varus.qCharge', sim.evalExpr(`min(1, charge / ${CHARGED})`, { slot: 'Q' }));
    },
    afterDamage(sim, inst) {
      if (inst.fromMark || inst.flags.kind !== 'ability' || inst.flags.attack) return;
      const slot = inst.flags.slot;
      if (slot !== 'Q' && slot !== 'E' && slot !== 'R') return;
      const charge = slot === 'Q' ? sim.counter('varus.qCharge') : 0;
      if (slot === 'Q' && sim.getBuff('varusW')) {
        sim.removeBuff('varusW');
        const pct = sim.evalExpr(`lerp(W.calc.QEmpowerPercentHP, W.calc.MaxQEmpowerPercentHP, ${charge})`, { slot: 'W' });
        const missing = sim.target.maxHp - (inst.targetHpBefore ?? sim.target.hp);
        sim.deal({
          source: 'Q',
          sourceLabel: 'Blighted Quiver (active)',
          label: 'Empowered arrow',
          type: 'magic',
          amount: pct * missing,
          castId: inst.castId,
          flags: { kind: 'ability', slot: 'Q', ability: false, proc: true },
          markSource: 'varusW',
        });
      }
      detonate(sim, inst, 1 + charge * sim.evalExpr('Q.dv.MaxChargeAmp', { slot: 'Q' }));
      if (slot === 'R') {
        const n = sim.evalExpr('R.dv.PassiveStacksAdded', { slot: 'R' });
        const every = sim.evalExpr('R.dv.TimeBetweenStackAddition', { slot: 'R' });
        for (let i = 1; i <= n; i++) sim.schedule(every * i, () => addBlight(sim));
      }
    },
  },
};
export default kit;
