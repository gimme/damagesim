import type { ChampionKit } from '../../engine/kit-types.ts';

// Blitzcrank — patch 16.20.
const kit: ChampionKit = {
  id: 'Blitzcrank',
  status: 'curated',
  notes: [
    'Static Field passive: while R is off cooldown every basic attack queues a zap (R.calc.PassiveDamage) that strikes R.dv.ZapCountdown s later; queued zaps resolve one per second. Casting R disables it until R is ready again.',
    'Overdrive (W) has a PercentHealthDamage data value but no damage in its tooltip (wiki: stats only); it is modeled as attack speed only.',
  ],
  hooks: {
    // Static Field's passive depends on R being off cooldown, which kit expressions can't read.
    onAttack(sim, atk) {
      if (atk.fromAbility || atk.phantom || sim.rankOf('R') <= 0 || !sim.isReady('ability:R')) return;
      const delay = sim.evalExpr('R.dv.ZapCountdown', { slot: 'R' });
      const at = Math.max(sim.time + delay, sim.counter('blitzZapAt') + 1);
      sim.setCounter('blitzZapAt', at);
      sim.scheduleAt(at, () => {
        sim.deal({
          source: 'R',
          sourceLabel: 'Static Field',
          label: 'Static Field (zap)',
          type: 'magic',
          amount: sim.evalExpr('R.calc.PassiveDamage', { slot: 'R' }),
          flags: { kind: 'ability', slot: 'R', ability: true },
        });
      });
    },
  },
  abilities: {
    Q: {
      // Pull airborne time isn't in the data; ~0.5s is a typical pull.
      cc: [{ kind: 'immobilize', duration: 0.5 }],
      notes: ['Pull duration approximated as 0.5s.'],
      components: [{ id: 'grab', label: 'Rocket Grab', type: 'magic', amount: 'calc.TotalDamage', delay: 0.3 }],
    },
    W: {
      noTarget: true,
      buff: { id: 'blitzW', label: 'Overdrive', duration: 'dv.Duration', stats: { attackSpeed: 'dv.AttackSpeedMod' } },
    },
    E: {
      resetsAttack: true,
      cc: [{ kind: 'immobilize', duration: 'dv.CCDuration' }],
      notes: ['Empowers the next attack: it deals E.calc.TotalDamage (200% AD total) instead of normal attack damage; can crit, counts as spell damage. Follow E with AA.'],
      buff: {
        id: 'blitzE',
        label: 'Power Fist',
        duration: 5, // empowered-attack window (not in data)
        empowerAttacks: {
          count: 1,
          replaceBase: true,
          resetsAttack: true,
          components: [{ id: 'fist', label: 'Power Fist', type: 'physical', amount: 'E.calc.TotalDamage', canCrit: true }],
        },
      },
    },
    R: {
      cc: [{ kind: 'impair', duration: 'dv.SilenceDuration' }],
      components: [{ id: 'active', label: 'Static Field (active)', type: 'magic', amount: 'calc.ActiveDamage', aoe: true }],
    },
  },
};
export default kit;
