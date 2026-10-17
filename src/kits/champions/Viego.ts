import type { ChampionKit, ComponentSpec, DebuffSpec } from '../../engine/kit-types.ts';

// Viego — patch 16.20.
// Blade of the Ruined King (passive): attacks deal % current health physical on-hit. Abilities mark
// the target; Viego's next attack strikes a second time (a hook replays an attack hit dealing
// SecondAttackDamage, which applies on-hit effects and can crit — wiki). Heartbreaker's strike too;
// checked in game, after either the second hit can crit, applies on-hit effects, is a separate hit
// (Electrocute) and, after an attack, counts as one (Kraken Slayer).
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
      // Wiki: 140% of his attack windup.
      castTime: '1.4 * windup',
      debuff: MARK,
      notes: ['The active\'s damage already scales with crit chance in the game formula.'],
      components: [{ id: 'stab', label: 'Blade of the Ruined King', type: 'physical', amount: 'calc.TotalDamage', aoe: true }],
    },
    W: {
      dash: true,
      debuff: MARK,
      // Charged for up to MaxChargeTime; the stun grows by 0.25s per 0.25s over the first second (wiki).
      charge: { default: 0, max: 'dv.MaxChargeTime' },
      castTime: 'charge',
      // On release he dashes 300 units at 1000 speed (data); he can cast any ability during the dash
      // (wiki).
      attackLockout: 'charge + dv.DashDistance / dv.DashSpeed',
      notes: ['Default: quick release (minimum stun). Set the seconds held (W{1s} for the maximum stun).'],
      cc: [{ kind: 'immobilize', duration: 'lerp(dv.StunDuration, dv.MaxStunTT, min(1, floor(charge * 4) / 4))' }],
      // Wiki: the mist flies to the target, up to 500 units +100 per 0.25s charged (up to 1s), at 1300
      // speed (the data's speed is the dash's).
      components: [
        {
          id: 'maw',
          label: 'Spectral Maw',
          type: 'magic',
          amount: 'calc.TotalDamage',
          travel: 'min(distance, dv.MinMissileRange + dv.MaxBonusMissileRange * min(1, floor(charge * 4) / 4)) / 1300',
        },
      ],
    },
    E: {
      noTarget: true,
      notes: ['Assumes Viego fights inside the Mist for its whole duration (attack speed bonus).'],
      buff: { id: 'viegoE', label: 'Harrowed Path', duration: 'dv.MistDuration', stats: { attackSpeed: 'dv.AttackSpeed' } },
    },
    R: {
      dash: true,
      notes: [
        'Strike on arrival, as the 0.5s cast time ends (a blink): an attack that applies on-hit effects (incl. the Q passive), cannot crit (crit chance is in the formula) and consumes the Q mark; the second hit that follows can crit (R!).',
      ],
      followUpCrits: true,
      // Wiki: striking a champion puts him in a 0.25s cast time after the blink.
      lockout: 'castTime + 0.25',
      cc: [{ kind: 'slow', duration: 'dv.SlowDuration' }],
      components: [
        {
          id: 'strike',
          label: 'Heartbreaker',
          type: 'physical',
          amount: 'calc.TotalDamage + calc.TotalPercentHealth / 100 * target.missingHp',
          attack: true,
          canCrit: false,
        },
        BLADE_ON_HIT,
      ],
    },
  },
  hooks: {
    afterDamage(sim, inst) {
      const strike = inst.flags.attack || (inst.flags.slot === 'R' && inst.label === 'Heartbreaker');
      if (!strike || inst.fromMark) return;
      const mark = sim.getDebuff(MARK.id);
      if (!mark || mark.castId === inst.castId) return;
      sim.removeDebuff(MARK.id);
      sim.schedule(0.1, () =>
        sim.performAttackHit({
          castId: sim.newCastId(),
          amount: sim.evalExpr('Q.calc.SecondAttackDamage', { slot: 'Q' }),
          label: 'Second strike',
          sourceLabel: 'Blade of the Ruined King',
        }),
      );
    },
  },
};
export default kit;
