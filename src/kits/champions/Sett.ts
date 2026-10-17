import type { ChampionKit } from '../../engine/kit-types.ts';

// Sett — patch 16.20.
// Pit Grit: attacks alternate left/right punches; every right punch deals bonus damage.
const kit: ChampionKit = {
  id: 'Sett',
  status: 'curated',
  notes: [
    'Right punches (every 2nd attack) deal bonus physical damage. Their faster wind-up is not modeled.',
    'Knuckle Down resets the alternation: its two empowered attacks are always a left then a right punch.',
    'Haymaker Grit is an option (% of max Grit = 50% max health), since the simulator does not model damage taken.',
  ],
  options: [{ key: 'gritPct', label: 'Grit stored (% of max)', default: 50, min: 0, max: 100, step: 5, description: 'Grit consumed by Haymaker, as a percentage of the cap (50% of max health).' }],
  attack: {
    everyNth: { n: 2, label: 'Right punch', components: [{ id: 'right', label: 'Right punch', type: 'physical', amount: 'P.calc.RightPunchBonus', proc: true }] },
  },
  abilities: {
    Q: {
      resetsAttack: true,
      notes: ['Next two attacks deal bonus damage (base + % max health). Write "Q AA AA".'],
      buff: {
        id: 'settQ',
        label: 'Knuckle Down',
        duration: 'dv.Duration',
        empowerAttacks: {
          // "next two Attacks" (tooltip text; no data value).
          count: 2,
          resetsAttack: true,
          components: [{ id: 'knuckle', label: 'Knuckle Down', type: 'physical', amount: 'Q.dv.BaseDamage + Q.calc.MaxHealthDamageCalc * target.maxHp' }],
        },
      },
    },
    W: {
      notes: ['Center of the punch: true damage. Use W:edge for the physical damage outside the center.'],
      components: [{ id: 'center', label: 'Haymaker (center)', type: 'true', amount: 'calc.DamageCalc + calc.DamageConversion * opt.gritPct / 100 * calc.MaxGrit', aoe: true }],
      variants: {
        edge: {
          label: 'edge',
          components: [{ id: 'edge', label: 'Haymaker (edge)', type: 'physical', amount: 'calc.DamageCalc + calc.DamageConversion * opt.gritPct / 100 * calc.MaxGrit', aoe: true }],
        },
      },
    },
    E: {
      notes: ['A lone champion is only slowed; E:stun when another enemy is on the opposite side.'],
      // Wiki: unable to move or attack for 0.25s after the 0.25s cast time; Haymaker is held too only
      // if Facebreaker misses.
      attackLockout: 0.5,
      castLockout: { Q: 0.5, R: 0.5 },
      cc: [{ kind: 'slow', duration: 'dv.SlowDuration' }],
      components: [{ id: 'smash', label: 'Facebreaker', type: 'physical', amount: 'calc.DamageCalc', aoe: true }],
      variants: {
        stun: {
          label: 'stun',
          cc: [{ kind: 'immobilize', duration: 'dv.StunDuration' }],
          components: [{ id: 'smash', label: 'Facebreaker', type: 'physical', amount: 'calc.DamageCalc', aoe: true }],
        },
      },
    },
    R: {
      dash: true,
      // No dash speed in the data: ~1.25s to the slam (wiki: within ~1.23s at max range). Busy until then.
      lockout: 1.25,
      notes: ['Damage scales with the grabbed target\'s bonus health. Slam assumed ~1.25s after the cast (wiki: ≤1.23s at max range).'],
      cc: [
        { kind: 'immobilize', duration: 1 },
        { kind: 'slow', duration: 'dv.SlowDuration' },
      ],
      components: [{ id: 'slam', label: 'The Show Stopper', type: 'physical', amount: 'calc.DamageCalc + calc.MaxHealthDamageCalc * target.bonusHp', aoe: true, delay: 1.25 }],
    },
  },
  hooks: {
    // Knuckle Down's attacks are always left then right: restart the alternation.
    onCast(sim, cast) {
      if (cast.slot === 'Q') sim.setCounter('kit.nth', 0);
    },
  },
};
export default kit;
