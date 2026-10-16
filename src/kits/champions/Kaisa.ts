import type { ChampionKit } from '../../engine/kit-types.ts';
import type { DamageRequest } from '../../engine/effects.ts';
import type { Sim } from '../../engine/sim.ts';

// Kai'Sa — patch 16.20.
// Plasma (hooks): attacks deal P.calc.PBaseDamage + P.calc.PCurrentPerStackDamage × (stacks before the
// hit) and add a stack; the application that would make a 5th stack (P.dv.PMaxStacks + 1) bursts for
// P.calc.PExecutePercentage of missing health (computed before the triggering attack's damage) and
// leftover stacks roll over. Void Seeker adds W.dv.Effect4Amount stacks (Effect5Amount evolved) after its damage.
// Evolution thresholds: Q Q.dv.Effect6Amount bonus AD, W W.dv.Effect2Amount AP — or force them with
// the evolved* options.
const EVOLVED_Q = '(opt.evolvedQ || bonusAd >= Q.dv.Effect6Amount)';
const EVOLVED_W = '(opt.evolvedW || ap >= W.dv.Effect2Amount)';

const kit: ChampionKit = {
  id: 'Kaisa',
  status: 'curated',
  notes: [
    'Evolutions: automatic at 100 bonus AD (Q) / 100 AP (W) from items; in game AD growth from levels counts for Q, so force it with option evolvedQ when needed.',
    'Allies applying Plasma and Supercharge\'s cooldown refund are not modeled.',
  ],
  options: [
    { key: 'evolvedQ', label: 'Icathian Rain evolved', default: 0, toggle: true },
    { key: 'evolvedW', label: 'Void Seeker evolved', default: 0, toggle: true },
  ],
  abilities: {
    Q: {
      notes: ['All missiles hit an isolated target: the first deals full damage, the others (5, or 11 evolved) dv.ExtraHitReduction.'],
      components: [
        { id: 'first', label: 'Icathian Rain', type: 'physical', amount: 'calc.TotalIndividualMissileDamage', delay: 0.4 },
        {
          id: 'extra',
          label: 'Icathian Rain (extra missiles)',
          type: 'physical',
          amount: 'calc.TotalIndividualMissileDamage * dv.ExtraHitReduction',
          // Missiles beyond the first: Effect2Amount (6) or Effect7Amount (12 evolved) minus one.
          hits: `(${EVOLVED_Q} ? dv.Effect7Amount : dv.Effect2Amount) - 1`,
          interval: 0.08,
          delay: 0.48,
        },
      ],
    },
    W: {
      notes: ['Applies 2 Plasma stacks (3 evolved), which can trigger the Plasma burst.'],
      components: [{ id: 'blast', label: 'Void Seeker', type: 'magic', amount: 'calc.TotalDamage', delay: 0.4 }],
    },
    E: {
      // Charge time shrinks with attack speed (min 0.6s).
      castTime: 'calc.TotalCastTime',
      noTarget: true,
      notes: ['Attack speed buff (dv.Effect5Amount) for dv.Effect2Amount s after the charge.'],
      buff: { id: 'supercharge', label: 'Supercharge', duration: 'dv.Effect2Amount', stats: { attackSpeed: 'dv.Effect5Amount' } },
    },
    R: { dash: true, notes: ['Dash + shield, no damage.'], components: [] },
  },
  hooks: {
    onAttack(sim, atk) {
      if (atk.fromAbility || atk.phantom) return;
      const before = plasmaStacks(sim);
      atk.extra.push(req(sim, atk.castId, 'Plasma', 'P.calc.PBaseDamage + P.calc.PCurrentPerStackDamage * ' + before));
      addPlasma(sim, 1, (r) => atk.extra.push({ ...r, castId: atk.castId }));
    },
    afterDamage(sim, inst) {
      if (inst.fromMark || inst.flags.kind !== 'ability' || inst.flags.slot !== 'W' || inst.flags.onHit) return;
      const add = sim.evalExpr(`${EVOLVED_W} ? dv.Effect5Amount : dv.Effect4Amount`, { slot: 'W' });
      addPlasma(sim, add, (r) => sim.deal(r));
    },
  },
};

function plasmaStacks(sim: Sim): number {
  return sim.time <= sim.counter('kaisa.plasmaUntil') ? sim.counter('kaisa.plasma') : 0;
}

function req(sim: Sim, castId: number, label: string, expr: string): DamageRequest {
  return { source: 'P', sourceLabel: 'Second Skin', label, type: 'magic', amount: sim.evalExpr(expr, { slot: 'P' }), castId, flags: { kind: 'ability', slot: 'P', onHit: true, ability: false, proc: true } };
}

/** Add Plasma stacks; on reaching max + 1 the burst is emitted (amount computed now) and leftovers roll over. */
function addPlasma(sim: Sim, add: number, emit: (r: DamageRequest) => void) {
  const max = sim.evalExpr('P.dv.PMaxStacks', { slot: 'P' });
  let stacks = plasmaStacks(sim) + add;
  if (stacks > max) {
    emit(req(sim, sim.newCastId(), 'Plasma burst', 'P.calc.PExecutePercentage * target.missingHp'));
    stacks -= max + 1;
  }
  sim.setCounter('kaisa.plasma', stacks);
  sim.setCounter('kaisa.plasmaUntil', sim.time + sim.evalExpr('P.dv.PDuration', { slot: 'P' }));
}
export default kit;
