import type { ChampionKit } from '../../engine/kit-types.ts';

// Smolder — patch 16.20.
// Dragon Practice stacks are an option (fed to the game formulas' stack counter). Stacks gained
// during the combo are ignored.
const STACKS = '{32bcea5d}';

const kit: ChampionKit = {
  id: 'Smolder',
  status: 'curated',
  notes: [
    'Dragon Practice stacks (option "stacks") add magic damage to Q/W/E; Flap, Flap, Flap gains a bolt per 100 stacks.',
    'Super Scorcher Breath tiers: 25 (area around the target) and 125 (explosions beyond the target) do not change single-target damage; at 225 the target burns for % max health true damage over 3s and is executed below 6.5% health by Smolder\'s next damage while burning.',
  ],
  options: [{ key: 'stacks', label: 'Dragon Practice stacks', default: 125, min: 0, max: 1000, step: 5 }],
  buffStacks: { [STACKS]: 'opt.stacks' },
  abilities: {
    Q: {
      components: [
        // Applies on-hit effects and triggers on-attack effects (Spellblade, Energized, Guinsoo's stacks…).
        { id: 'breath', label: 'Super Scorcher Breath', type: 'physical', amount: 'calc.TotalDamage', onHit: true, onAttack: true, delay: 0.15 },
        { id: 'practice', label: 'Super Scorcher Breath (Dragon Practice)', type: 'magic', amount: 'P.calc.Passive_QDamageIncrease', hits: 'opt.stacks > 0 ? 1 : 0', delay: 0.15 },
        {
          id: 'burn',
          label: 'Super Scorcher Breath (burn)',
          type: 'true',
          // 225+ stacks: ticks once per second (wiki).
          amount: 'calc.Tier3_Burn * target.maxHp / dv.Tier3_DotLength',
          hits: 'opt.stacks >= dv.StackTier3 ? dv.Tier3_DotLength : 0',
          interval: 1,
          delay: 1.15,
          dot: true,
        },
      ],
    },
    W: {
      cc: [{ kind: 'slow', duration: 'dv.SlowDuration' }],
      components: [
        { id: 'sneeze', label: 'Achooo!', type: 'physical', amount: 'calc.InitialDamage', delay: 0.3 },
        { id: 'explosion', label: 'Achooo! (explosion)', type: 'physical', amount: 'calc.ExplosionDamage', aoe: true, delay: 0.3 },
        { id: 'practice', label: 'Achooo! (Dragon Practice)', type: 'magic', amount: 'P.calc.Passive_WDamageIncrease', hits: 'opt.stacks > 0 ? 1 : 0', aoe: true, delay: 0.3 },
      ],
    },
    E: {
      dash: true,
      notes: ['Bolts hit the lowest-health enemy (the target) evenly over the flight; they are ability damage, not attacks.'],
      components: [
        { id: 'bolt', label: 'Flap, Flap, Flap', type: 'physical', amount: 'calc.DamagePerHit', hits: 'floor(calc.TotalNumberOfAttacks)', interval: 'dv.Duration / floor(calc.TotalNumberOfAttacks)', delay: 0.1 },
        {
          id: 'practice',
          label: 'Flap, Flap, Flap (Dragon Practice)',
          type: 'magic',
          amount: 'P.calc.EBonusDamage',
          hits: 'opt.stacks > 0 ? floor(calc.TotalNumberOfAttacks) : 0',
          interval: 'dv.Duration / floor(calc.TotalNumberOfAttacks)',
          delay: 0.1,
        },
      ],
    },
    R: {
      notes: ['Default: hit by the edge of the breath. R:center = sweet spot (150% damage + slow).'],
      components: [{ id: 'breath', label: 'MMOOOMMMM!', type: 'physical', amount: 'calc.TotalDamage', aoe: true, delay: 'dv.MomSpawnDelay' }],
      variants: {
        center: {
          label: 'center',
          cc: [{ kind: 'slow', duration: 'dv.SlowDuration' }],
          components: [{ id: 'breath', label: 'MMOOOMMMM! (center)', type: 'physical', amount: 'calc.TooltipOnly_TotalSweetspotDamage', aoe: true, delay: 'dv.MomSpawnDelay' }],
        },
      },
    },
  },
  hooks: {
    onCast(sim, cast) {
      if (cast.slot !== 'Q' || !cast.hitsTarget) return;
      const q = { slot: 'Q' as const };
      if (sim.opt.stacks >= sim.evalExpr('Q.dv.StackTier3', q))
        sim.setCounter('smolderBurnUntil', sim.time + (sim.spellFor('Q').castTime ?? 0) + 0.15 + sim.evalExpr('Q.dv.Tier3_DotLength', q));
    },
    // 225 stacks: Smolder's damage executes a burning target below the threshold.
    afterDamage(sim, inst) {
      if (inst.label === 'Execute' || sim.time > sim.counter('smolderBurnUntil')) return;
      const hp = sim.target.hp;
      if (hp <= 0 || hp >= sim.evalExpr('Q.calc.Tier3_ExecuteThreshold', { slot: 'Q' }) * sim.target.maxHp) return;
      sim.deal({ source: 'Q', sourceLabel: 'Super Scorcher Breath', label: 'Execute', type: 'true', amount: hp, flags: { kind: 'ability', slot: 'Q', ability: false, unamplified: true } });
    },
  },
};
export default kit;
