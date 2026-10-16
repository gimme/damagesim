import type { ChampionKit } from '../../engine/kit-types.ts';

// Riven — patch 16.20.
// Runic Blade: every ability cast grants a charge (max 3, 6s); each attack spends one for bonus
// physical damage (affected by crit, wiki). Charges are tracked by a hook (counter + expiry).
const CHARGES = 'rivenCharges';
const CHARGES_EXPIRE = 'rivenChargesExpire';

const kit: ChampionKit = {
  id: 'Riven',
  status: 'curated',
  notes: [
    'Runic Blade: each ability cast (including both R casts) grants a charge for 6s (max 3); each attack spends one for bonus physical damage that can crit.',
    'Broken Wings: "Q Q Q" (each cast resets the attack timer); the third cast knocks up.',
    'Blade of the Exile: "R" activates (+20% AD); "R:slash" is the Wind Slash recast, scaling linearly from min damage to 3× at 75% missing health (wiki).',
  ],
  abilities: {
    Q: {
      dash: true,
      resetsAttack: true,
      recasts: 3,
      recastDelay: 0.25,
      components: [{ id: 'wing', label: 'Broken Wings', type: 'physical', amount: 'calc.FirstSlashDamage', aoe: true, delay: 0.1 }],
    },
    W: {
      cc: [{ kind: 'immobilize', duration: 'dv.StunDuration' }],
      components: [{ id: 'burst', label: 'Ki Burst', type: 'physical', amount: 'calc.TotalDamage', aoe: true }],
    },
    E: {
      dash: true,
      noTarget: true,
      notes: ['Dash and self shield (not modeled).'],
      components: [],
    },
    R: {
      recasts: 2,
      recastDelay: 0.5,
      defaultVariant: 'activate',
      notes: ['Activation grants +20% total AD for 15s; Wind Slash is the recast ("R R:slash").'],
      components: [],
      variants: {
        activate: {
          label: 'activate',
          buff: { id: 'rivenR', label: 'Blade of the Exile', duration: 'dv.Duration', stats: { ad: 'calc.BonusAD' } },
          components: [],
        },
        slash: {
          label: 'Wind Slash',
          components: [
            {
              id: 'slash',
              label: 'Wind Slash',
              type: 'physical',
              // Linear from MinDamage (full health) to MaxDamage at 75% missing health (wiki).
              amount: 'calc.MinDamage + (calc.MaxDamage - calc.MinDamage) * min(1, target.missingHpPct / 0.75)',
              aoe: true,
              delay: 0.2,
            },
          ],
        },
      },
    },
  },
  hooks: {
    onCast(sim, cast) {
      const now = sim.time;
      const cur = sim.counter(CHARGES_EXPIRE) >= now ? sim.counter(CHARGES) : 0;
      sim.setCounter(CHARGES, Math.min(sim.evalExpr('P.dv.Charges', { slot: 'P' }), cur + 1));
      sim.setCounter(CHARGES_EXPIRE, now + 6);
      // Third Broken Wings cast knocks up.
      if (cast.slot === 'Q' && cast.hitsTarget) {
        const n = (sim.time - sim.counter('rivenQLast') <= 4 ? sim.counter('rivenQCount') : 0) + 1;
        sim.setCounter('rivenQCount', n >= 3 ? 0 : n);
        sim.setCounter('rivenQLast', sim.time);
        if (n >= 3) {
          // Knock-up duration from the tooltip text (0.75s); lands with the slam.
          const castTime = sim.spellFor('Q').castTime ?? 0;
          sim.schedule(castTime + 0.1, () => sim.applyCC('immobilize', 0.75, cast.castId, 'Q'));
        }
      }
    },
    onAttack(sim, atk) {
      if (atk.fromAbility || atk.phantom) return;
      if (sim.counter(CHARGES_EXPIRE) < sim.time || sim.counter(CHARGES) <= 0) return;
      sim.setCounter(CHARGES, sim.counter(CHARGES) - 1);
      atk.extra.push({
        source: 'P',
        sourceLabel: 'Runic Blade',
        label: 'Runic Blade',
        type: 'physical',
        amount: sim.evalExpr('P.calc.TotalDamage', { slot: 'P' }) * atk.critFactor,
        castId: atk.castId,
        flags: { kind: 'ability', slot: 'P', onHit: true, ability: false, proc: true, crit: atk.crit },
      });
    },
  },
};
export default kit;
