import type { ChampionKit, ComponentSpec, DebuffSpec } from '../../engine/kit-types.ts';

// Viego — patch 16.20.
// Blade of the Ruined King (passive): attacks deal % current health physical on-hit. Abilities mark
// the target; Viego's next attack strikes a second time (a hook replays an attack hit dealing
// SecondAttackDamage, which applies on-hit effects and can crit — wiki).
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
      debuff: MARK,
      notes: ['The active\'s damage already scales with crit chance in the game formula.'],
      components: [{ id: 'stab', label: 'Blade of the Ruined King', type: 'physical', amount: 'calc.TotalDamage', aoe: true, delay: 0.1 }],
    },
    W: {
      dash: true,
      debuff: MARK,
      notes: ['Default: quick release (minimum stun). "W:charged" = charged for 1s (maximum stun, wiki).'],
      cc: [{ kind: 'immobilize', duration: 'dv.StunDuration' }],
      components: [{ id: 'maw', label: 'Spectral Maw', type: 'magic', amount: 'calc.TotalDamage', delay: 0.2 }],
      variants: {
        charged: {
          label: 'charged',
          castTime: 1,
          dash: true,
          debuff: MARK,
          cc: [{ kind: 'immobilize', duration: 'dv.MaxStunTT' }],
          components: [{ id: 'maw', label: 'Spectral Maw', type: 'magic', amount: 'calc.TotalDamage', delay: 0.2 }],
        },
      },
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
      components: [
        {
          id: 'strike',
          label: 'Heartbreaker',
          type: 'physical',
          amount: 'calc.TotalDamage + calc.TotalPercentHealth / 100 * target.missingHp',
          attack: true,
          canCrit: false,
          delay: 0.5,
        },
        { ...BLADE_ON_HIT, delay: 0.5 },
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
