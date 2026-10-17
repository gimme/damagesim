import type { ChampionKit } from '../../engine/kit-types.ts';

// Talon — patch 16.20.
// Blade's End: ability hits add Wound stacks (each pass of Rake / Shadow Assault counts). An attack on
// a target with 3 stacks consumes them and starts a bleed (16 ticks over 2s); no stacks during the bleed.
const BLEED_TICKS = 16; // every 0.125s over P.dv.BleedDuration (wiki)

const kit: ChampionKit = {
  id: 'Talon',
  status: 'curated',
  notes: [
    "Blade's End: every damaging ability pass adds a Wound stack (W out + back = 2, R out + back = 2). The next attack on 3 stacks consumes them and bleeds for P.calc.BleedDamage over 2s (16 ticks, snapshotted). No new stacks while bleeding.",
    'Noxian Diplomacy defaults to the leap (Q); Q:melee is the close-range cast that critically strikes (150% + bonus crit damage).',
  ],
  marks: [
    {
      id: 'wound',
      label: 'Wound',
      maxStacks: 3, // tooltip text (not in data)
      duration: 'P.dv.StackDuration',
      appliedBy: ['ability'],
      oncePerCast: false,
    },
  ],
  hooks: {
    onAttack(sim, atk) {
      if (atk.fromAbility || atk.phantom) return;
      if ((sim.markStacks('wound') ?? 0) < 3) return;
      const duration = sim.evalExpr('P.dv.BleedDuration', { slot: 'P' });
      const perTick = sim.evalExpr('P.calc.BleedDamage', { slot: 'P' }) / BLEED_TICKS;
      sim.setMarkStacks('wound', 0);
      sim.setMarkCooldown('wound', duration); // no Wound stacks while bleeding
      for (let i = 1; i <= BLEED_TICKS; i++)
        sim.schedule((duration / BLEED_TICKS) * i, () =>
          sim.deal({ source: 'P', sourceLabel: "Blade's End", label: 'Bleed', type: 'physical', amount: perTick, castId: atk.castId, flags: { kind: 'ability', slot: 'P', ability: false, proc: true, dot: true } }),
        );
    },
  },
  abilities: {
    Q: {
      dash: true,
      resetsAttack: true,
      // Wiki: the leap has no cast time and dashes at ~1400; Shadow Assault can be cast during the dash.
      attackLockout: 'castRange / missileSpeed',
      castLockout: { W: 'castRange / missileSpeed', E: 'castRange / missileSpeed' },
      components: [{ id: 'leap', label: 'Noxian Diplomacy', type: 'physical', amount: 'calc.LeapDamage', travel: true }],
      variants: {
        melee: {
          label: 'melee',
          note: 'Cast in melee range: no leap, critically strikes.',
          // Wiki: the close cast takes his attack windup (0.198s of his 1.6s attack at base attack speed)
          // and strikes at its end.
          castTime: '0.198 / 1.6 / as',
          attackLockout: 0,
          castLockout: {},
          resetsAttack: true,
          components: [{ id: 'crit', label: 'Noxian Diplomacy (crit)', type: 'physical', amount: 'calc.CriticalDamage' }],
        },
      },
    },
    W: {
      cc: [{ kind: 'slow', duration: 'dv.SlowDuration' }],
      notes: ['Blades go out and return after dv.ReturnDelay; both passes hit a target in their path.'],
      components: [
        { id: 'out', label: 'Rake (out)', type: 'physical', amount: 'calc.TotalInitialDamage', aoe: true, travel: true },
        // Wiki: they linger 0.7s (ReturnDelay) at max range, then home back over it at 3000.
        { id: 'back', label: 'Rake (return)', type: 'physical', amount: 'calc.TotalReturnDamage', aoe: true, delay: 'dv.ReturnDelay', travel: 'castRange / missileSpeed + castRange / 3000' },
      ],
    },
    E: {
      noTarget: true,
      dash: true,
      notes: ["Assassin's Path (wall vault) deals no damage."],
      // Wiki: the vault goes at his movement speed; Shadow Assault can be cast during it.
      attackLockout: 'castRange / ms',
      castLockout: { Q: 'castRange / ms', W: 'castRange / ms' },
      components: [],
    },
    R: {
      notes: ['Blades return to the target when Talon breaks stealth with an attack or Noxian Diplomacy (assumed at the earliest, after their 0.8s minimum lifetime); otherwise they fly back to Talon after 2.5s (disable with R{back:0}).'],
      components: [
        { id: 'out', label: 'Shadow Assault (out)', type: 'physical', amount: 'calc.Damage', aoe: true, travel: true },
        // Wiki: they converge after 0.8s at the earliest, flying back over the range at 4000.
        { id: 'back', label: 'Shadow Assault (return)', type: 'physical', amount: 'calc.Damage', aoe: true, delay: 0.8, travel: 'castRange / 4000' },
      ],
    },
  },
};
export default kit;
