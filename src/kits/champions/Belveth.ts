import type { BuffSpec, ChampionKit } from '../../engine/kit-types.ts';
import type { Sim } from '../../engine/sim.ts';
import type { DamageInstance } from '../../engine/effects.ts';

// Bel'Veth — patch 16.20.
// Death in Lavender: after any ability, bonus attack speed for a few seconds; Lavender stacks give
// permanent attack speed (option). Endless Banquet (R passive): every on-hit against the target adds a
// stack and deals R.calc.FinalOnHitDamage × stacks true damage (stacks expire after
// RPassiveStackDuration); Royal Maelstrom strikes apply it at their reduced on-hit effectiveness.
const lavenderRush: BuffSpec = { id: 'lavenderRush', label: 'Death in Lavender', duration: 'P.dv.SheenDuration', stats: { attackSpeed: 'P.calc.SheenSpeedPerStack' } };

/** On-hit effectiveness of a hit for Endless Banquet (0 = not an on-hit). */
const banquetEffectiveness = (sim: Sim, inst: DamageInstance): number => {
  if (inst.flags.attack) return 1;
  if (inst.flags.kind !== 'ability' || inst.flags.onHit) return 0;
  if (inst.flags.slot === 'Q') return 1;
  if (inst.flags.slot === 'E') return sim.evalExpr('E.dv.OnHitRatio * (1 + E.dv.MissingHealthMult * target.missingHpPct)', { slot: 'E' });
  return 0;
};

const kit: ChampionKit = {
  id: 'Belveth',
  status: 'curated',
  options: [{ key: 'lavender', label: 'Lavender stacks', default: 20, min: 0, max: 200, step: 1, description: 'Permanent attack speed stacks (large monsters, champion takedowns).' }],
  buffStacks: { '{7f3c01cf}': 'opt.lavender' },
  notes: [
    'Bel\'Veth may exceed the attack speed cap.',
    'Endless Banquet passive needs R rank 1+; true damage grows by one step per on-hit on the target. Royal Maelstrom strikes apply on-hit effects (and Banquet stacks) at 12–24% effectiveness.',
    'Endless Banquet (R active) requires a Void Coral from a takedown.',
  ],
  // Wiki: Bel'Veth is not limited by the attack speed cap.
  stats: ({ evalExpr }) => ({ attackSpeed: evalExpr('P.calc.TotalAttackSpeedFromStacks') / 100, attackSpeedCap: 100 }),
  abilities: {
    P: { notes: ['Attack speed after abilities (hook) and from Lavender stacks (option).'] },
    Q: {
      dash: true,
      // Its fixed 400 range at 850 + movement speed (wiki; BaseDashSpeed).
      lockout: 'castRange / (dv.BaseDashSpeed + ms)',
      notes: ['Each of the 4 directions has its own cooldown; applies on-hit and can crit against the first target.'],
      components: [{ id: 'surge', label: 'Void Surge', type: 'physical', amount: 'calc.BaseDamage', canCrit: true, onHit: true, travel: 'castRange / (dv.BaseDashSpeed + ms)' }],
    },
    W: {
      cc: [
        { kind: 'immobilize', duration: 'dv.Duration' },
        { kind: 'slow', duration: 'dv.SlowDuration' },
      ],
      components: [{ id: 'slam', label: 'Above and Below', type: 'magic', amount: 'calc.Damage', aoe: true }],
    },
    E: {
      lockout: 'dv.TotalDuration',
      // Another ability or a recast ends it early (tooltip).
      variableDuration: true,
      notes: [
        'Channel: floor(calc.TotalStrikes) strikes over 1.5s, each +1% damage per 1% missing health (up to 2×); Bel\'Veth is busy for the whole channel.',
        'Set the seconds to end it early (E{0.5s}), as another ability or a recast does in the game: the strikes so far land.',
        'Strikes can crit; life steal and damage reduction are not modeled.',
      ],
      components: [
        {
          id: 'strike',
          label: 'Royal Maelstrom',
          type: 'physical',
          amount: 'calc.DamagePerStrike * (1 + dv.MissingHealthMult * target.missingHpPct)',
          max: 'calc.MaxDamagePerStrikeTooltip',
          hits: 'floor(calc.TotalStrikes)',
          maxHits: 30,
          interval: 'dv.TotalDuration / floor(calc.TotalStrikes)',
          canCrit: true,
          onHit: true,
          onAttack: true,
          onHitEffectiveness: 'dv.OnHitRatio * (1 + dv.MissingHealthMult * target.missingHpPct)',
        },
      ],
    },
    R: {
      // Wiki: locked out of moving and attacking for 0.25s after the 1s cast time (no casting either).
      lockout: 'castTime + 0.25',
      cc: [{ kind: 'slow', duration: 1 }],
      notes: ['Explosion (true damage + % missing health) after the 1s cast, then true form: bonus HP, range and total attack speed.'],
      buff: {
        id: 'trueForm',
        label: 'True form',
        duration: 'dv.SteroidDuration',
        stats: { hp: 'calc.MaxHealthOnDevour', range: 'dv.BonusAARange', attackSpeedMult: 'dv.TotalASMod' },
      },
      components: [{ id: 'explosion', label: 'Endless Banquet', type: 'true', amount: 'calc.TotalExplosionDamage + dv.MissingHealthDamage * target.missingHp', aoe: true }],
    },
  },
  hooks: {
    onCast(sim, cast) {
      if (cast.slot === 'P') return;
      sim.applyBuff(lavenderRush, 'P', sim.spellFor('P'), 1);
    },
    afterDamage(sim, inst) {
      if (inst.fromMark || sim.rankOf('R') <= 0) return;
      const eff = banquetEffectiveness(sim, inst);
      if (eff <= 0) return;
      const active = sim.time <= sim.counter('banquetExpires');
      const stacks = (active ? sim.counter('banquet') : 0) + 1;
      sim.setCounter('banquet', stacks);
      sim.setCounter('banquetExpires', sim.time + sim.evalExpr('R.dv.RPassiveStackDuration', { slot: 'R' }));
      sim.deal({
        source: 'R',
        sourceLabel: 'Endless Banquet',
        label: 'Endless Banquet (on-hit)',
        type: 'true',
        amount: sim.evalExpr('R.calc.FinalOnHitDamage', { slot: 'R' }) * stacks * eff,
        castId: inst.castId,
        // The wiki: "Applies proc damage on the bonus true damage" (the explosion is area damage).
        flags: { kind: 'ability', slot: 'R', onHit: true, ability: false, proc: true },
        markSource: 'banquet',
      });
    },
  },
};
export default kit;
