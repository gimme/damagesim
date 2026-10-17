import type { ChampionKit } from '../../engine/kit-types.ts';

// Jinx — patch 16.20.
// Switcheroo! is a toggle (hook): with Fishbones (rockets) attacks deal Q.dv.RocketTAD × AD instead of
// AD (can crit); with Pow-Pow (minigun) each attack grants a stack for Q.dv.MinigunAttackSpeedDuration s
// (max Q.dv.MinigunAttackSpeedStacks): the first stack gives half of Q.dv.MinigunAttackSpeedMax, the
// other two a quarter each (wiki: "later stacks are 50% as strong").
// Zap!'s cast time (wiki): 0.6s, down to 0.4s at 250% bonus attack speed (the data has 0.25).
const W_CAST = '(0.6 - 0.2 * min(1, bonusAs / 2.5))';

const kit: ChampionKit = {
  id: 'Jinx',
  status: 'curated',
  notes: [
    'Q toggles the weapon: Jinx starts with Pow-Pow (minigun) unless option "rockets" is on.',
    'Rockets\' splash and their 10% bonus attack speed penalty are not modeled; minigun stacks expire all at once.',
    'Get Excited! (takedown buff) is not modeled.',
  ],
  options: [{ key: 'rockets', label: 'Start with Fishbones (rockets)', default: 0, toggle: true }],
  abilities: {
    Q: { noTarget: true, notes: ['Toggle between Pow-Pow and Fishbones.'], components: [] },
    W: {
      castTime: W_CAST,
      cc: [{ kind: 'slow', duration: 'dv.SlowDuration' }],
      // Launched as the cast time starts (wiki: {{Effect at cast time start}}); `castTime` would read
      // the data's.
      components: [{ id: 'zap', label: 'Zap!', type: 'physical', amount: 'calc.TotalDamage', travel: `max(0, reach / missileSpeed - ${W_CAST})` }],
    },
    E: {
      notes: ['Chompers thrown at the target\'s feet: they land after 0.4s and arm dv.GrenadeArmTime s later (wiki), then explode on contact.'],
      cc: [{ kind: 'immobilize', duration: 'dv.RootDuration' }],
      components: [{ id: 'chomp', label: 'Flame Chompers!', type: 'magic', amount: 'calc.TotalDamage', aoe: true, delay: '0.4 + dv.GrenadeArmTime' }],
    },
    R: {
      notes: [
        'Default: the rocket travelled ≥1500 units (maximum damage) — about 0.85s of flight. R:close = minimum damage (point blank).',
        'The missing health part uses the target\'s health at impact.',
      ],
      // Launched as the cast time starts (wiki: {{Effect at cast time start}}); full damage takes 1500
      // units: 1350 at missileSpeed, then 2200 (wiki).
      components: [{ id: 'rocket', label: 'Super Mega Death Rocket!', type: 'physical', amount: 'calc.DamageMax + dv.PercentDamage / 100 * target.missingHp', travel: 'max(0, 1350 / missileSpeed + 150 / 2200 - castTime)' }],
      variants: {
        close: {
          label: 'close',
          components: [{ id: 'rocket', label: 'Super Mega Death Rocket! (close)', type: 'physical', amount: 'calc.DamageFloor + dv.PercentDamage / 100 * target.missingHp' }],
        },
      },
    },
  },
  hooks: {
    onStart(sim) {
      sim.setCounter('jinx.rockets', sim.opt.rockets ? 1 : 0);
      // Read once: dynamicStats must not evaluate expressions.
      sim.setCounter('jinx.minigunMax', sim.evalExpr('Q.dv.MinigunAttackSpeedMax', { slot: 'Q' }) / 100);
      sim.setCounter('jinx.minigunStacks', sim.evalExpr('Q.dv.MinigunAttackSpeedStacks', { slot: 'Q' }));
      sim.setCounter('jinx.minigunDuration', sim.evalExpr('Q.dv.MinigunAttackSpeedDuration', { slot: 'Q' }));
    },
    onCast(sim, cast) {
      if (cast.slot === 'Q') sim.setCounter('jinx.rockets', sim.counter('jinx.rockets') ? 0 : 1);
    },
    dynamicStats(sim) {
      if (sim.counter('jinx.rockets') || sim.time > sim.counter('jinx.stacksUntil')) return undefined;
      const stacks = sim.counter('jinx.stacks');
      if (stacks <= 0) return undefined;
      return { attackSpeed: sim.counter('jinx.minigunMax') * (0.5 + 0.25 * (stacks - 1)) };
    },
    preAttack(sim, atk) {
      if (atk.fromAbility || atk.phantom) return;
      if (sim.counter('jinx.rockets')) {
        atk.baseMult *= sim.evalExpr('Q.dv.RocketTAD', { slot: 'Q' });
        return;
      }
      const live = sim.time <= sim.counter('jinx.stacksUntil') ? sim.counter('jinx.stacks') : 0;
      sim.setCounter('jinx.stacks', Math.min(sim.counter('jinx.minigunStacks'), live + 1));
      sim.setCounter('jinx.stacksUntil', sim.time + sim.counter('jinx.minigunDuration'));
    },
  },
};
export default kit;
