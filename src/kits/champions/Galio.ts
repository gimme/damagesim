import type { ChampionKit } from '../../engine/kit-types.ts';
import type { Sim } from '../../engine/sim.ts';
import type { DamageRequest } from '../../engine/effects.ts';

// Galio — patch 16.20.
// Hook: Colossal Smash is a cooldown-gated empowered attack whose cooldown is cut by ability hits.

const R_LANDING = 2.25; // wiki: 1.25s channel + ~0.8s leap + ~0.2s dash before landing (not in the data)
const R_TOTAL = 2.75; // wiki: Galio stays in place ~0.5s after landing (2.75s in total)

const kit: ChampionKit = {
  id: 'Galio',
  status: 'curated',
  notes: [
    'Colossal Smash: when off cooldown (P.calc.PassiveCooldownModified), the next attack deals P.calc.TotalDamage magic damage instead of its normal damage (the AD part can crit). Each ability cast that hits cuts the cooldown by P.dv.ChargeRatePerHit s.',
    'Winds of War: a single target is assumed to be hit by one windblast, then to stand in the tornado for its full duration.',
    'Shield of Durand defaults to a full charge (1.25s: max damage and taunt); set the seconds held (W{0.5s}) for less.',
  ],
  abilities: {
    Q: {
      // The windblasts fly to the target at their speed and form the tornado there, which ticks
      // every 0.5s (wiki).
      components: [
        { id: 'windblast', label: 'Windblast', type: 'magic', amount: 'calc.QMissileDamage', aoe: true, travel: true },
        {
          id: 'tornado',
          label: 'Tornado',
          type: 'magic',
          amount: "calc['{85f4c0e9}'] / 100 * target.maxHp",
          hits: 'dv.TornadoTicks',
          interval: 'dv.SuperQDuration / dv.TornadoTicks',
          delay: 'dv.SuperQDuration / dv.TornadoTicks',
          travel: true,
          aoe: true,
          dot: true,
        },
      ],
    },
    W: {
      // Charged for up to MaxChargeDuration; damage and taunt grow over the first 1.25s (wiki).
      charge: { default: 1.25, max: 'dv.MaxChargeDuration' },
      castTime: 'charge',
      // Wiki: unable to attack or cast for 0.4s after the release.
      lockout: 'charge + 0.4',
      cc: [{ kind: 'immobilize', duration: 'lerp(dv.CCDurationMin, dv.CCDurationMax, min(1, charge / 1.25))' }],
      components: [{ id: 'release', label: 'Shield of Durand', type: 'magic', amount: 'lerp(calc.MinTotalDamage, calc.MaxTotalDamage, min(1, charge / 1.25))', aoe: true }],
    },
    E: {
      dash: true,
      // Wiki: steps back over the cast time, then dashes at its speed until he hits the target; busy until then.
      lockout: 'castTime + reach / missileSpeed',
      cc: [{ kind: 'immobilize', duration: 'dv.KnockupDuration' }],
      components: [{ id: 'punch', label: 'Justice Punch', type: 'magic', amount: 'calc.TotalDamage', travel: true }],
    },
    R: {
      dash: true,
      lockout: R_TOTAL,
      notes: ['Lands ~2.25s after the cast (channel + flight).'],
      cc: [{ kind: 'immobilize', duration: 'dv.StunDurationOuter' }],
      components: [{ id: 'landing', label: "Hero's Entrance", type: 'magic', amount: 'calc.TotalDamage', aoe: true, delay: R_LANDING }],
    },
  },
  hooks: {
    onAttack(sim: Sim, atk) {
      if (atk.fromAbility || atk.phantom || atk.replaceBase || !sim.isReady('galioP')) return;
      sim.startCooldown('galioP', sim.evalExpr('P.calc.PassiveCooldownModified', { slot: 'P' }));
      const total = sim.evalExpr('P.calc.TotalDamage', { slot: 'P' });
      const ad = sim.stats.ad;
      const smash: DamageRequest = {
        source: 'P',
        sourceLabel: 'Colossal Smash',
        label: atk.crit ? 'Colossal Smash (crit)' : 'Colossal Smash',
        type: 'magic',
        amount: total - ad + ad * atk.critFactor,
        castId: atk.castId,
        // The wiki: basic and spell damage to the target (area proc damage only to others around it).
        flags: { kind: 'ability', slot: 'P', attack: true, ability: true, crit: atk.crit, empowered: true },
      };
      atk.replaceBase = true;
      atk.extra.unshift(smash);
      (atk.replacedBy ??= []).push(smash);
    },
    afterDamage(sim: Sim, inst) {
      if (inst.fromMark || inst.flags.kind !== 'ability' || !inst.flags.slot || inst.flags.slot === 'P' || inst.flags.attack) return;
      if (sim.counter('galioP.lastCast') === inst.castId) return;
      sim.setCounter('galioP.lastCast', inst.castId);
      const remaining = sim.cooldownReadyAt('galioP') - sim.time;
      if (remaining > 0) sim.startCooldown('galioP', Math.max(0, remaining - sim.evalExpr('P.dv.ChargeRatePerHit', { slot: 'P' })));
    },
  },
};
export default kit;
