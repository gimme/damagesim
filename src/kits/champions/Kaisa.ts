import type { ChampionKit } from '../../engine/kit-types.ts';
import type { DamageRequest } from '../../engine/effects.ts';
import type { Sim } from '../../engine/sim.ts';

// Kai'Sa — patch 16.20.
// Plasma (hooks): each stack applied deals Caustic Wounds, P.calc.PBaseDamage + P.calc.PCurrentPerStackDamage
// × (stacks before it); attacks apply one, Void Seeker W.dv.Effect4Amount (Effect5Amount evolved) after its
// damage. The application that would make a 5th stack (P.dv.PMaxStacks + 1) bursts for
// P.calc.PExecutePercentage of missing health (computed before the triggering attack's damage) and
// leftover stacks roll over.
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
      // Each missile hits 0.4s after it's released (wiki); the rest follow ~0.08s apart (estimate).
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
      notes: ['Applies 2 Plasma stacks (3 evolved), each dealing Caustic Wounds damage, which can trigger the Plasma burst.'],
      components: [{ id: 'blast', label: 'Void Seeker', type: 'magic', amount: 'calc.TotalDamage', travel: true }],
    },
    E: {
      // Charge time shrinks with attack speed (min 0.6s).
      castTime: 'calc.TotalCastTime',
      noTarget: true,
      notes: ['Attack speed buff (dv.Effect5Amount) for dv.Effect2Amount s after the charge.'],
      buff: { id: 'supercharge', label: 'Supercharge', duration: 'dv.Effect2Amount', stats: { attackSpeed: 'dv.Effect5Amount' } },
    },
    R: {
      dash: true,
      // She can cast any ability during the dash (wiki).
      attackLockout: 'castTime + castRange / missileSpeed',
      notes: ['Dash + shield, no damage.'],
      components: [],
    },
  },
  hooks: {
    onAttack(sim, atk) {
      if (atk.fromAbility || atk.phantom) return;
      addPlasma(sim, 1, atk.castId, true, (r) => atk.extra.push(r));
    },
    afterDamage(sim, inst) {
      if (inst.fromMark || inst.flags.kind !== 'ability' || inst.flags.slot !== 'W' || inst.flags.onHit) return;
      const add = sim.evalExpr(`${EVOLVED_W} ? dv.Effect5Amount : dv.Effect4Amount`, { slot: 'W' });
      addPlasma(sim, add, inst.castId, false, (r) => sim.deal(r));
    },
  },
};

function plasmaStacks(sim: Sim): number {
  return sim.time <= sim.counter('kaisa.plasmaUntil') ? sim.counter('kaisa.plasma') : 0;
}

function req(sim: Sim, castId: number, label: string, amount: number, onHit: boolean): DamageRequest {
  return { source: 'P', sourceLabel: 'Second Skin', label, type: 'magic', amount, castId, flags: { kind: 'ability', slot: 'P', onHit, ability: false, proc: true } };
}

/**
 * Apply Plasma stacks one after another (wiki): each deals Caustic Wounds damage for the stacks
 * before it (one hit per run of stacks), and the one that would make max + 1 bursts (amount computed
 * when emitted) and consumes them all; the rest roll over.
 */
function addPlasma(sim: Sim, add: number, castId: number, onHit: boolean, emit: (r: DamageRequest) => void) {
  const max = sim.evalExpr('P.dv.PMaxStacks', { slot: 'P' });
  const caustic = (before: number) => sim.evalExpr(`P.calc.PBaseDamage + P.calc.PCurrentPerStackDamage * ${before}`, { slot: 'P' });
  let stacks = plasmaStacks(sim);
  let damage = 0;
  for (let i = 0; i < add; i++) {
    damage += caustic(stacks);
    if (++stacks <= max) continue;
    emit(req(sim, castId, 'Plasma', damage, onHit));
    emit(req(sim, sim.newCastId(), 'Plasma burst', sim.evalExpr('P.calc.PExecutePercentage * target.missingHp', { slot: 'P' }), onHit));
    stacks = 0;
    damage = 0;
  }
  if (damage > 0) emit(req(sim, castId, 'Plasma', damage, onHit));
  sim.setCounter('kaisa.plasma', stacks);
  sim.setCounter('kaisa.plasmaUntil', sim.time + sim.evalExpr('P.dv.PDuration', { slot: 'P' }));
}
export default kit;
