import type { ChampionKit } from '../../engine/kit-types.ts';

// Olaf — patch 16.20.
const kit: ChampionKit = {
  id: 'Olaf',
  status: 'curated',
  notes: [
    'Berserker Rage: bonus attack speed scales linearly with your missing health, reaching the maximum at 30% health (MaxStatsThreshold). Set option self.hpPercent (default: full health).',
    'Option "axePickup": Olaf picks up Undertow, reducing its cooldown to 2.5 s.',
    "Ragnarok's duration is kept up by attacks / Reckless Swing on the champion (each hit refreshes it to at least 2.5 s).",
  ],
  options: [{ key: 'axePickup', label: 'Pick up Undertow axe', default: 1, min: 0, max: 1, toggle: true }],
  stats: ({ opt, ranks, evalExpr }) => {
    const missing = 1 - (opt['self.hpPercent'] ?? 1);
    const frac = Math.min(1, Math.max(0, missing / (1 - evalExpr('P.dv.MaxStatsThreshold'))));
    return {
      attackSpeed: evalExpr('P.calc.MaxAttackSpeed') * frac,
      ...(ranks.R > 0 ? { armor: evalExpr('R.dv.Resists'), mr: evalExpr('R.dv.Resists') } : {}),
    };
  },
  abilities: {
    Q: {
      // Picking up the axe reduces the cooldown to MinimumCooldown.
      cooldown: 'opt.axePickup ? dv.MinimumCooldown : cooldown',
      cc: [{ kind: 'slow', duration: 'dv.MaxSlowDuration' }],
      debuff: { id: 'undertow', label: 'Undertow shred', duration: 'dv.DebuffDuration', armorReduction: 'dv.ShredAmount' },
      components: [{ id: 'axe', label: 'Undertow', type: 'physical', amount: 'calc.TotalDamage', delay: 0.3 }],
    },
    W: {
      noTarget: true,
      buff: { id: 'toughItOut', label: 'Tough It Out', duration: 'dv.Duration', stats: { attackSpeed: 'dv.Attackspeed' } },
    },
    E: {
      notes: ['Basic attacks reduce the cooldown by 1 s.'],
      components: [{ id: 'swing', label: 'Reckless Swing', type: 'true', amount: 'calc.TotalDamage' }],
    },
    R: {
      noTarget: true,
      buff: { id: 'ragnarok', label: 'Ragnarok', duration: 'dv.Duration', stats: { ad: 'calc.AD' } },
    },
  },
  hooks: {
    afterDamage(sim, inst) {
      if (inst.fromMark) return;
      const isAttack = inst.flags.attack;
      const isE = inst.flags.slot === 'E' && inst.flags.kind === 'ability';
      if (!isAttack && !isE) return;
      // Attacks lower Reckless Swing's cooldown.
      if (isAttack) {
        const ready = sim.cooldownReadyAt('ability:E');
        if (ready > sim.time) sim.startCooldown('ability:E', ready - sim.time - sim.evalExpr('E.dv.ChampionRefresh', { slot: 'E' }));
      }
      // Ragnarok extension.
      const r = sim.getBuff('ragnarok');
      if (r) r.expires = Math.max(r.expires, sim.time + sim.evalExpr('R.dv.DurationExtension', { slot: 'R' }));
    },
  },
};
export default kit;
