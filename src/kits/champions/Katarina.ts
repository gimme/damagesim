import type { ChampionKit } from '../../engine/kit-types.ts';

// Katarina — patch 16.20.
// Voracity: picking up a Dagger slashes nearby enemies. Daggers come from Q (lands ~1s after the
// first hit) and W (lands 1.25s after the cast); model the pickup with the "P" step.
const kit: ChampionKit = {
  id: 'Katarina',
  status: 'curated',
  notes: [
    'Dagger pickups are the "P" step (Voracity slash, applies on-hit). Write e.g. "Q wait:1 E P" or "W wait:1.25 E P": the Dagger must have landed.',
    'Each pickup also reduces Shunpo\'s remaining cooldown by E.calc.DaggerCooldownReduction (hook).',
    'Death Lotus knives apply on-hit effects at R.dv.OnHitRatio (25/30/35%) effectiveness; the 2.5s channel locks Katarina out (lockout).',
  ],
  abilities: {
    P: {
      notes: ['Cast "P" when Katarina picks up a Dagger next to the target.'],
      components: [{ id: 'slash', label: 'Voracity (Dagger)', type: 'magic', amount: 'calc.TotalDamage', aoe: true, onHit: true, areaOnHit: true }],
    },
    Q: {
      notes: ['Hits the target (and bounces to 2 others); the Dagger lands behind the target ~1s after the hit.'],
      components: [{ id: 'blade', label: 'Bouncing Blade', type: 'magic', amount: 'calc.TotalDamage', delay: 0.1 }],
    },
    W: {
      noTarget: true,
      notes: ['Tosses a Dagger that lands after 1.25s (pick it up with "P").'],
      components: [],
    },
    E: {
      dash: true,
      resetsAttack: true,
      notes: ['Blink strike applies on-hit effects and resets the attack timer.'],
      components: [{ id: 'strike', label: 'Shunpo', type: 'magic', amount: 'calc.TotalDamage', onHit: true }],
    },
    R: {
      notes: [
        '15 knives per target (6/s for 2.5s); each knife deals both the magic and the physical part, applies on-hit at reduced effectiveness and counts as a separate hit.',
        'Full channel by default: Katarina is busy for 2.5s. Set the knives or the seconds (R{6}, R{1s}) to cancel it early, as a Shunpo does in the game.',
      ],
      lockout: 'dv.Duration',
      channel: true,
      components: [
        {
          id: 'knife',
          label: 'Death Lotus knife',
          type: 'magic',
          unit: 'knives',
          amount: 'calc.DamageCalc',
          hits: 'dv.TicksPerSecond * dv.Duration',
          interval: '1 / dv.TicksPerSecond',
          delay: '1 / dv.TicksPerSecond',
          sameCast: false,
          onHit: true,
          onAttack: true,
          areaOnHit: true,
          onHitEffectiveness: 'dv.OnHitRatio',
        },
        {
          id: 'knifeAd',
          label: 'Death Lotus knife (AD)',
          type: 'physical',
          amount: 'calc.ADDamageCalc',
          // No hits without bonus AD (avoids 15 zero-damage instances on AP builds).
          hits: 'calc.ADDamageCalc > 0 ? dv.TicksPerSecond * dv.Duration : 0',
          maxHits: 'dv.TicksPerSecond * dv.Duration',
          interval: '1 / dv.TicksPerSecond',
          delay: '1 / dv.TicksPerSecond',
          condition: 'scales with bonus AD and bonus attack speed',
        },
      ],
    },
  },
  hooks: {
    // Picking up a Dagger reduces Shunpo's remaining cooldown (not expressible declaratively).
    onCast(sim, cast) {
      if (cast.slot !== 'P') return;
      const ready = sim.cooldownReadyAt('ability:E');
      if (ready <= sim.time) return;
      const cut = sim.evalExpr('E.calc.DaggerCooldownReduction', { slot: 'E' });
      sim.startCooldown('ability:E', Math.max(0, ready - sim.time - cut));
    },
  },
};
export default kit;
