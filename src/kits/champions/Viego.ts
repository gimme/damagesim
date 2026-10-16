import type { ChampionKit, ComponentSpec, DebuffSpec } from '../../engine/kit-types.ts';

// Viego — patch 16.20.
// Blade of the Ruined King (passive): attacks deal % current health physical on-hit. Abilities mark
// the target; Viego's next attack strikes a second time (a hook replays an attack hit dealing
// SecondAttackDamage, which applies on-hit effects and can crit — wiki). Heartbreaker's strike
// consumes the mark too, and its second hit is part of the strike, not an attack: like the strike,
// it applies on-hit effects and can't crit (R's damage scales with crits instead).
const BLADE_ON_HIT: ComponentSpec = {
  id: 'blade',
  label: 'Blade of the Ruined King',
  source: 'Blade of the Ruined King',
  type: 'physical',
  // Crits raise the % current health part by HealthCritMod of the crit bonus (expected value).
  amount: 'Q.rank > 0 ? max(Q.dv.MinDamageOnHit, Q.calc.TotalPercentHealthOnHit * target.hp) * (1 + critChance * Q.dv.HealthCritMod * (critDamage - 1)) : 0',
  // The wiki: proc damage for the on-hit bonus damage (the thrust is area damage).
  proc: true,
};
const MARK: DebuffSpec = { id: 'viegoMark', label: 'Blade of the Ruined King (mark)', duration: 'Q.dv.MarkDuration' };
const HEARTBREAKER: ComponentSpec = {
  id: 'strike',
  label: 'Heartbreaker',
  type: 'physical',
  amount: 'calc.TotalDamage + calc.TotalPercentHealth / 100 * target.missingHp',
  attack: true,
  canCrit: false,
  delay: 0.5,
};

const kit: ChampionKit = {
  id: 'Viego',
  status: 'curated',
  notes: [
    'The % current health on-hit uses the expected crit bonus (crit chance × 70% of the crit bonus), also in forced-crit modes.',
    'Possession (Sovereign\'s Domination) is not modeled.',
  ],
  attack: { onHit: [BLADE_ON_HIT] },
  abilities: {
    Q: {
      debuff: MARK,
      notes: ['The active\'s damage already scales with crit chance in the game formula.'],
      components: [{ id: 'stab', label: 'Blade of the Ruined King', type: 'physical', amount: 'calc.TotalDamage', aoe: true, delay: 0.1 }],
    },
    W: {
      dash: true,
      debuff: MARK,
      // Charged for up to MaxChargeTime; the stun grows by 0.25s per 0.25s over the first second (wiki).
      charge: { default: 0, max: 'dv.MaxChargeTime' },
      castTime: 'charge',
      notes: ['Default: quick release (minimum stun). Set the seconds held (W{1s} for the maximum stun).'],
      cc: [{ kind: 'immobilize', duration: 'lerp(dv.StunDuration, dv.MaxStunTT, min(1, floor(charge * 4) / 4))' }],
      components: [{ id: 'maw', label: 'Spectral Maw', type: 'magic', amount: 'calc.TotalDamage', delay: 0.2 }],
    },
    E: {
      noTarget: true,
      notes: ['Assumes Viego fights inside the Mist for its whole duration (attack speed bonus).'],
      buff: { id: 'viegoE', label: 'Harrowed Path', duration: 'dv.MistDuration', stats: { attackSpeed: 'dv.AttackSpeed' } },
    },
    R: {
      dash: true,
      notes: [
        'Strike on arrival (≈0.5s, approximation): an attack that applies on-hit effects (incl. the Q passive), cannot crit (crit chance is in the formula) and consumes the Q mark.',
      ],
      cc: [{ kind: 'slow', duration: 'dv.SlowDuration' }],
      components: [HEARTBREAKER, { ...BLADE_ON_HIT, delay: 0.5 }],
    },
  },
  hooks: {
    afterDamage(sim, inst) {
      const heartbreaker = inst.flags.slot === 'R' && inst.label === HEARTBREAKER.label;
      if (!(inst.flags.attack || heartbreaker) || inst.fromMark) return;
      const mark = sim.getDebuff(MARK.id);
      if (!mark || mark.castId === inst.castId) return;
      sim.removeDebuff(MARK.id);
      sim.schedule(0.1, () => {
        const second = { amount: sim.evalExpr('Q.calc.SecondAttackDamage', { slot: 'Q' }), label: 'Second strike', sourceLabel: 'Blade of the Ruined King' };
        if (!heartbreaker) return sim.performAttackHit({ ...second, castId: sim.newCastId() });
        // After Heartbreaker, a second hit of R's strike rather than an attack: like the strike, it
        // applies on-hit effects, Viego's own included, and can't crit.
        sim.performAttackHit({ ...second, castId: inst.castId, comp: HEARTBREAKER, fromAbility: 'R' });
        const amount = sim.evalExpr(BLADE_ON_HIT.amount, { slot: 'R' });
        sim.deal({ source: 'R', sourceLabel: BLADE_ON_HIT.source!, label: BLADE_ON_HIT.label, type: 'physical', amount, castId: inst.castId, flags: { kind: 'ability', slot: 'R', ability: true } });
      });
    },
  },
};
export default kit;
