import type { ChampionKit } from '../../engine/kit-types.ts';

// Kled — patch 16.20.
const rDamage = (charge: string) =>
  `calc.MinimumDamageTooltip * target.maxHp * (1 + (calc.MaximumChargeDamage / calc.MinimumDamageTooltip - 1) * clamp(${charge} / dv.SecondsToMaxPower, 0, 1))`;

const kit: ChampionKit = {
  id: 'Kled',
  status: 'curated',
  options: [
    { key: 'dismounted', label: 'Dismounted', default: 0, toggle: true, description: 'Attacks deal P.calc.DismountedAttackPenalty less damage; use Q:pistol for Pocket Pistol.' },
    { key: 'rChargeTime', label: 'Chaaaaaaaarge!!! travel time (s)', default: 0, min: 0, max: 3, step: 0.5, description: 'R damage grows from 1x to 3x over R.dv.SecondsToMaxPower seconds of charging.' },
  ],
  notes: [
    'Violent Tendencies (W passive) is automatic (hook): the first attack while W is ready triggers it and counts as hit 1; the 4th hit deals the bonus damage; +attack speed until then (max 4s). Each attack on a champion while W is on cooldown reduces it by W.dv.ChampCooldownRefund s.',
    'Courage, remounting and Skaarl\'s health are not modelled.',
  ],
  attack: { damageMult: 'opt.dismounted ? 1 - P.calc.DismountedAttackPenalty : 1' },
  abilities: {
    Q: {
      notes: ['Mounted: trap hit + yank after 1.75s if Kled stays close (disable with Q{yank:0}). Dismounted: Q:pistol.'],
      // Pull (short displacement, duration estimated) and slow land with the yank.
      cc: [
        { kind: 'immobilize', duration: 0.25, delay: 'dv.TetherPopTime' },
        { kind: 'slow', duration: 'dv.SlowDuration', delay: 'dv.TetherPopTime' },
      ],
      components: [
        { id: 'trap', label: 'Bear Trap on a Rope', type: 'physical', amount: 'calc.TotalDamage', delay: 0.2 },
        { id: 'yank', label: 'Bear Trap (yank)', type: 'physical', amount: 'calc.TotalYankDamage', delay: '0.2 + dv.TetherPopTime' },
      ],
      variants: {
        pistol: {
          label: 'Pocket Pistol',
          spell: 'KledRiderQ',
          note: 'Dismounted shotgun: 5 pellets, each pellet after the first deals 20%. Assumes all 5 hit an adjacent target.',
          components: [
            {
              id: 'pellet',
              label: 'Pocket Pistol',
              type: 'physical',
              // Rank-scaled damage lives on KledQ (the rider spell only carries rank 1 values).
              amount: 'Q.calc.DismountedQDamage * (hit == 0 ? 1 : dv.FalloffPerMissile)',
              hits: 5,
              maxHits: 5,
            },
          ],
        },
      },
    },
    W: {
      noTarget: true,
      notes: ['Passive only (handled automatically on attacks); casting W does nothing.'],
      components: [],
    },
    E: {
      dash: true,
      recasts: 2,
      notes: ['Recast ("E E") dashes back through the target for the same damage.'],
      components: [{ id: 'joust', label: 'Jousting', type: 'physical', amount: 'calc.TotalDamage', aoe: true, delay: 0.3 }],
    },
    R: {
      dash: true,
      cc: [{ kind: 'immobilize', duration: 0.25 }], // brief knockback (150 units), duration estimated
      notes: ['Damage scales with charge time (opt.rChargeTime); R:max for a fully charged ram.'],
      components: [{ id: 'ram', label: 'Chaaaaaaaarge!!!', type: 'magic', amount: rDamage('opt.rChargeTime') }],
      variants: {
        max: {
          label: 'max charge',
          dash: true,
          cc: [{ kind: 'immobilize', duration: 0.25 }],
          components: [{ id: 'ram', label: 'Chaaaaaaaarge!!! (max)', type: 'magic', amount: 'calc.MaximumChargeDamage * target.maxHp' }],
        },
      },
    },
  },
  hooks: {
    // Violent Tendencies: passive trigger, attack speed for 4 attacks/4s, 4th hit bonus damage, cooldown refunds.
    onAttack(sim, atk) {
      if (atk.fromAbility || atk.phantom || sim.rankOf('W') <= 0) return;
      const w = sim.spellFor('W');
      const rank = sim.rankOf('W');
      const dv = (n: string) => sim.dataValue(w, n, rank);
      const st = sim.stats;
      const startCd = (at: number) => {
        const cd = (dv('WCooldown') * 100) / (100 + st.abilityHaste + st.basicAbilityHaste);
        sim.startCooldown('kledW', Math.max(0, at + cd - sim.time));
      };
      if (sim.counter('kledW.hits') > 0 && !sim.getBuff('kledW')) {
        // Expired before the 4th hit: the cooldown started at expiry.
        sim.setCounter('kledW.hits', 0);
        startCd(sim.counter('kledW.expires'));
      }
      if (sim.getBuff('kledW')) {
        const n = sim.counter('kledW.hits') + 1;
        sim.setCounter('kledW.hits', n);
        if (n < 4) return;
        atk.extra.push({
          source: 'W',
          sourceLabel: 'Violent Tendencies',
          label: 'Violent Tendencies (4th hit)',
          type: 'physical',
          amount: dv('BaseFlatDamage') + sim.evalExpr('W.calc.PercentDamage', { slot: 'W' }) * sim.target.maxHp,
          castId: atk.castId,
          flags: { kind: 'ability', slot: 'W', onHit: true, ability: true },
        });
        sim.removeBuff('kledW');
        sim.setCounter('kledW.hits', 0);
        startCd(sim.time);
        return;
      }
      if (sim.isReady('kledW')) {
        const expires = sim.time + dv('ActiveDuration');
        sim.addBuff({ id: 'kledW', label: 'Violent Tendencies', expires, mods: { attackSpeed: dv('AttackSpeed') } });
        sim.setCounter('kledW.hits', 1);
        sim.setCounter('kledW.expires', expires);
        return;
      }
      // On cooldown: hits on champions refund part of it.
      sim.startCooldown('kledW', Math.max(0, sim.cooldownReadyAt('kledW') - sim.time - dv('ChampCooldownRefund')));
    },
  },
};
export default kit;
