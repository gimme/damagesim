import type { BuffSpec, ChampionKit } from '../../engine/kit-types.ts';

// Sylas — patch 16.20.
// Petricite Burst: every ability cast grants a charge (max 3, 4s); each attack spends one for bonus
// magic damage. Charges are counted by a small hook (re-applying a buff resets its charges).
const petricite: BuffSpec = {
  id: 'petricite',
  label: 'Petricite Burst',
  duration: 'P.dv.PassiveDuration',
  stats: { attackSpeed: 'P.dv.PassiveAttackSpeed' },
  empowerAttacks: {
    count: 'stacks.petricite',
    components: [{ id: 'burst', label: 'Petricite Burst', type: 'magic', amount: 'P.calc.PassiveDamage', noProc: true }],
  },
};

const kit: ChampionKit = {
  id: 'Sylas',
  status: 'curated',
  notes: [
    'Petricite Burst: each ability cast grants a charge (max 3, refreshes to 4s); attacks spend one for bonus magic damage on top of the attack. +125% attack speed while a charge is held.',
    'The passive splash damage (to other enemies) is not modeled — single target.',
    'Hijack (R) is modeled as a non-damaging cast; the stolen ultimate is not simulated.',
  ],
  hooks: {
    // Add a Petricite charge before the cast's buff is (re)applied with `count: stacks.petricite`.
    onCast(sim, cast) {
      if (cast.slot === 'P') return;
      const held = sim.getBuff('petricite')?.charges ?? 0;
      const gained = cast.slot === 'E' ? 2 : 1; // E step = Abscond + Abduct (two casts)
      sim.setCounter('petricite', Math.min(sim.evalExpr('P.dv.PassiveCharges', { slot: 'P' }), held + gained));
    },
  },
  abilities: {
    Q: {
      buff: petricite,
      cc: [{ kind: 'slow', duration: 'dv.SlowDuration' }],
      notes: ['Target assumed at the chain intersection: hit by the lash and the explosion (disable with Q{explosion:0}).'],
      components: [
        { id: 'lash', label: 'Chain Lash', type: 'magic', amount: 'calc.Damage', aoe: true },
        { id: 'explosion', label: 'Chain Lash (explosion)', type: 'magic', amount: 'calc.ExplosionDamage', aoe: true, delay: 'dv.DetonationDelay' },
      ],
    },
    W: {
      buff: petricite,
      dash: true,
      components: [{ id: 'kingslayer', label: 'Kingslayer', type: 'magic', amount: 'calc.MinDamage' }],
    },
    E: {
      buff: petricite,
      dash: true,
      castTime: 0.5, // Abscond + Abduct casts (0.25s each)
      // Wiki: unable to act while dashing to the target and for 0.05s after: the chains' 0.2s flight
      // (~440 units at 2500 speed, decelerating) and the dash back at 1800 speed (~0.25s).
      lockout: 1,
      cc: [{ kind: 'immobilize', duration: 'dv.KnockUpDuration' }],
      notes: ['One E step = Abscond (dash) + Abduct recast (pull, damage, knock-up); grants two Petricite charges.'],
      components: [{ id: 'abduct', label: 'Abduct', type: 'magic', amount: 'calc.Damage', delay: 0.2 }],
    },
    R: {
      buff: petricite,
      noTarget: true,
      notes: ['Hijack itself deals no damage; the stolen ultimate is not simulated.'],
      components: [],
    },
  },
};
export default kit;
