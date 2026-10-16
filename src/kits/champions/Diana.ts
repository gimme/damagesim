import type { BuffSpec, ChampionKit } from '../../engine/kit-types.ts';

// Diana — patch 16.20.
// Moonsilver Blade: permanent bonus attack speed, tripled for 5s after casting an ability.
const moonsilver: BuffSpec = {
  id: 'moonsilverBlade',
  label: 'Moonsilver Blade',
  duration: 'P.dv.BuffDuration',
  stats: { attackSpeed: 'P.calc.EmpoweredAS - P.calc.BonusAS' },
};

const kit: ChampionKit = {
  id: 'Diana',
  status: 'curated',
  notes: [
    'Pale Cascade: all three orbs are assumed to hit a target in melee range, 0.5s apart.',
    'Lunar Rush on a Moonlit target consumes Moonlight and its cooldown drops to E.dv.CDResetTime (Q → E → … → E).',
    'Moonfall against a single champion: no bonus for extra champions pulled. The pull is treated as a brief (0.25s) immobilize.',
  ],
  stats: ({ evalExpr }) => ({ attackSpeed: evalExpr('P.calc.BonusAS') }),
  attack: {
    // n = P.dv.AttackCount (3); everyNth takes a literal. The cleave is spell damage (wiki: spellaoe).
    everyNth: { n: 3, label: 'Moonsilver Blade', components: [{ id: 'cleave', label: 'Moonsilver Blade', type: 'magic', amount: 'P.calc.CleaveDamage', aoe: true, spell: true }] },
  },
  hooks: {
    // Lunar Rush cooldown refresh when it hits a Moonlit target (cooldown resets can't be expressed declaratively).
    afterDamage(sim, inst) {
      if (inst.fromMark || inst.flags.slot !== 'E' || inst.source !== 'E' || !sim.getDebuff('moonlight')) return;
      sim.removeDebuff('moonlight');
      sim.startCooldown('ability:E', sim.evalExpr('E.dv.CDResetTime', { slot: 'E' }));
    },
  },
  abilities: {
    Q: {
      buff: moonsilver,
      debuff: { id: 'moonlight', label: 'Moonlight', duration: 'dv.MoonlightDuration' },
      components: [{ id: 'strike', label: 'Crescent Strike', type: 'magic', amount: 'calc.TotalDamage', aoe: true, delay: 0.3 }],
    },
    W: {
      buff: moonsilver,
      components: [{ id: 'orb', label: 'Pale Cascade orb', type: 'magic', amount: 'calc.TotalDamage', hits: 3, maxHits: 3, interval: 0.5, delay: 0.25, aoe: true }],
    },
    E: {
      dash: true,
      buff: moonsilver,
      components: [{ id: 'rush', label: 'Lunar Rush', type: 'magic', amount: 'calc.TotalDamage', delay: 0.2 }],
    },
    R: {
      buff: moonsilver,
      cc: [
        { kind: 'immobilize', duration: 0.25 },
        { kind: 'slow', duration: 'dv.SlowDuration' },
      ],
      components: [{ id: 'moonfall', label: 'Moonfall', type: 'magic', amount: 'calc.RExplosionDamage', aoe: true, delay: 'dv.Delay' }],
    },
  },
};
export default kit;
