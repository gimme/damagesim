import type { ChampionKit } from '../../engine/kit-types.ts';
import type { Sim } from '../../engine/sim.ts';

// Senna — patch 16.20.
// Absolution: attacks and abilities mark an enemy champion; the next hit consumes the mark for
// % current health physical damage, then the target is immune to marks for 6/5/4s (by level).
// Mist stacks are an option (AD, and every 20 stacks attack range + crit chance).

/** Shorten the remaining cooldown of an ability (no-op if it is ready). */
function reduceCooldown(sim: Sim, slot: 'Q' | 'W' | 'E' | 'R', seconds: number) {
  const key = `ability:${slot}`;
  const left = sim.cooldownReadyAt(key) - sim.time;
  if (left > 0) sim.startCooldown(key, Math.max(0, left - seconds));
}

const kit: ChampionKit = {
  id: 'Senna',
  status: 'curated',
  notes: [
    'Mist stacks (option "mist") grant AD; every 20 stacks +20 range and +10% crit chance. Stacks gained during the combo are ignored.',
    "Senna's critical strikes deal 80% of normal crit damage (Absolution CritDamageMod).",
    'Absolution: the first attack/ability hit marks the target for 4s; the next hit consumes it for % current health physical damage. Afterwards the target is immune to marks for 6/5/4s (by level).',
    'Every attack deals an extra 20% AD physical damage (Relic Cannon) and reduces Piercing Darkness cooldown by 1s.',
  ],
  options: [{ key: 'mist', label: 'Mist stacks', default: 40, min: 0, max: 400, step: 1, description: 'Absolution stacks collected so far.' }],
  buffStacks: { '{e88568f8}': 'opt.mist' },
  stats: ({ opt, evalExpr }) => {
    const tiers = Math.floor(opt.mist / evalExpr('P.dv.StacksForBonus'));
    return {
      ad: opt.mist * evalExpr('P.dv.ADPerStack'),
      critChance: (tiers * evalExpr('P.dv.BonusCritChance')) / 100,
      range: tiers * evalExpr('P.dv.BonusRange'),
    };
  },
  attack: {
    critMultiplier: 'critDamage * P.dv.CritDamageMod',
    onHit: [{ id: 'relic', label: 'Relic Cannon', type: 'physical', amount: 'P.calc.BonusOnHitDamage' }],
  },
  marks: [
    {
      id: 'absolution',
      label: 'Absolution',
      maxStacks: 2,
      duration: 'P.dv.MarkDuration',
      appliedBy: ['attack', 'Q', 'W', 'R'],
      atMax: {
        consume: true,
        // Per-target immunity after a proc (6/5/4s by level).
        cooldown: 'P.calc.DebuffDuration',
        components: [{ id: 'siphon', label: 'Absolution', type: 'physical', amount: 'P.calc.BonusCurentHealthDamage / 100 * target.hp', noProc: true }],
      },
    },
  ],
  abilities: {
    Q: {
      cc: [{ kind: 'slow', duration: 'dv.SlowDuration' }],
      notes: ['Applies on-hit effects and triggers on-attack effects on the target (wiki).'],
      components: [{ id: 'bolt', label: 'Piercing Darkness', type: 'physical', amount: 'calc.TotalDamage', aoe: true, onHit: true, onAttack: true }],
    },
    W: {
      notes: ['The root lands DelayTime (1s) after the hit.'],
      cc: [{ kind: 'immobilize', duration: 'dv.RootDuration', delay: 'dv.DelayTime' }],
      components: [{ id: 'mist', label: 'Last Embrace', type: 'physical', amount: 'calc.Damage', delay: 0.3 }],
    },
    E: { noTarget: true, components: [] },
    R: {
      components: [{ id: 'beam', label: 'Dawning Shadow', type: 'physical', amount: 'calc.TotalDamage', aoe: true, delay: 0.25 }],
    },
  },
  hooks: {
    onAttack(sim, atk) {
      if (atk.fromAbility || atk.phantom) return;
      if (sim.rankOf('Q') > 0) reduceCooldown(sim, 'Q', sim.evalExpr('Q.dv.CDReductionOnHit', { slot: 'Q' }));
    },
  },
};
export default kit;
