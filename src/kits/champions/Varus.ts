import type { ChampionKit } from '../../engine/kit-types.ts';
import type { Sim } from '../../engine/sim.ts';
import type { DamageInstance } from '../../engine/effects.ts';

// Varus — patch 16.20.
// Blight: attacks add stacks (kit mark); any ability hit (Q/E/R) detonates all stacks for % max health
// magic damage, amplified by Piercing Arrow's charge. Detonation, the W-active bonus and R's delayed
// stacks are done in hooks because they read/clear the mark at hit time.

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
    flags: { kind: 'ability', slot: inst.flags.slot, ability: true },
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
    onHit: [{ id: 'quiver', label: 'Blighted Quiver', source: 'Blighted Quiver', type: 'magic', amount: 'W.rank > 0 ? W.calc.OnHitDamage : 0' }],
  },
  abilities: {
    Q: {
      // Damage (and detonation amp) reaches its maximum after 1.25s of charging (wiki).
      castTime: 1.25,
      notes: [
        'Default: fully charged (1.25s charge, maximum damage, +50% Blight detonation). "Q:quick" = uncharged release.',
        'After W, the next Piercing Arrow adds % missing health magic damage (more when fully charged).',
      ],
      components: [{ id: 'arrow', label: 'Piercing Arrow (charged)', type: 'physical', amount: 'calc.TotalDamageMax', delay: 0.25 }],
      variants: {
        quick: {
          label: 'quick',
          castTime: 0,
          note: 'Released immediately: minimum damage, no detonation amp.',
          components: [{ id: 'arrow', label: 'Piercing Arrow', type: 'physical', amount: 'calc.TotalDamageMinTooltip', delay: 0.25 }],
        },
      },
    },
    W: {
      noTarget: true,
      notes: ['Active: empowers the next Piercing Arrow within 5.5s (wiki) with % missing health magic damage.'],
      buff: { id: 'varusW', label: 'Blighted Quiver (active)', duration: 5.5 },
    },
    E: {
      cc: [{ kind: 'slow', duration: 'dv.GroundDuration' }],
      notes: ['Arrows land ~0.25s after the cast (approximation).'],
      components: [{ id: 'hail', label: 'Hail of Arrows', type: 'physical', amount: 'calc.TotalDamage', aoe: true, delay: 0.25 }],
    },
    R: {
      cc: [{ kind: 'immobilize', duration: 'dv.RootDuration' }],
      notes: ['The hit detonates existing Blight; the rooted target then gains 3 Blight stacks, one every 0.5s.'],
      components: [{ id: 'chain', label: 'Chain of Corruption', type: 'magic', amount: 'calc.TotalDamage', delay: 0.25 }],
    },
  },
  hooks: {
    onCast(sim, cast) {
      if (cast.slot === 'Q') sim.setCounter('varus.qCharged', cast.variant === 'quick' ? 0 : 1);
    },
    afterDamage(sim, inst) {
      if (inst.fromMark || inst.flags.kind !== 'ability' || inst.flags.attack) return;
      const slot = inst.flags.slot;
      if (slot !== 'Q' && slot !== 'E' && slot !== 'R') return;
      const charged = slot === 'Q' && sim.counter('varus.qCharged') > 0;
      if (slot === 'Q' && sim.getBuff('varusW')) {
        sim.removeBuff('varusW');
        const pct = sim.evalExpr(charged ? 'W.calc.MaxQEmpowerPercentHP' : 'W.calc.QEmpowerPercentHP', { slot: 'W' });
        const missing = sim.target.maxHp - (inst.targetHpBefore ?? sim.target.hp);
        sim.deal({
          source: 'Q',
          sourceLabel: 'Blighted Quiver (active)',
          label: 'Empowered arrow',
          type: 'magic',
          amount: pct * missing,
          castId: inst.castId,
          flags: { kind: 'ability', slot: 'Q', ability: true },
          markSource: 'varusW',
        });
      }
      detonate(sim, inst, charged ? 1 + sim.evalExpr('Q.dv.MaxChargeAmp', { slot: 'Q' }) : 1);
      if (slot === 'R') {
        const n = sim.evalExpr('R.dv.PassiveStacksAdded', { slot: 'R' });
        const every = sim.evalExpr('R.dv.TimeBetweenStackAddition', { slot: 'R' });
        for (let i = 1; i <= n; i++) sim.schedule(every * i, () => addBlight(sim));
      }
    },
  },
};
export default kit;
