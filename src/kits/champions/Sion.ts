import type { ChampionKit } from '../../engine/kit-types.ts';

// Sion — patch 16.20.
/** Unstoppable Onslaught's power from the seconds charging: each full second up to 3 (wiki). */
const R_POWER = 'min(1, floor(charge) / 3)';

const kit: ChampionKit = {
  id: 'Sion',
  status: 'curated',
  notes: [
    'Glory in Death (reanimation after dying) is not modeled.',
    'Soul Furnace bonus health from kills is an option ("furnaceHp"); no damage scales with it.',
  ],
  options: [{ key: 'furnaceHp', label: 'Soul Furnace bonus health', default: 0, min: 0, max: 2000, step: 5 }],
  stats: ({ opt }) => ({ hp: opt.furnaceHp }),
  abilities: {
    Q: {
      // Charged for up to 2s, the damage growing every 0.25s from min to max (wiki). Released, Sion is
      // locked out of all actions for 0.25s (Soul Furnace excepted).
      charge: { default: 2 },
      castTime: 'max(0.25, charge)',
      lockout: 'max(0.25, charge) + 0.25',
      notes: [
        'Default: fully charged (2s): max damage, knock-up and a 2.25s stun. Set the seconds held (Q{1s}): charged 1s or more it stuns for 1.25s + 0.25s per 0.25s beyond 1s; less only slows briefly.',
      ],
      cc: [
        { kind: 'immobilize', duration: 'charge >= 1 ? dv.BaseStunTime + min(1, floor((charge - 1) * 4) / 4) : 0' },
        { kind: 'slow', duration: 'charge < 1 ? 0.25 : 0' },
      ],
      components: [{ id: 'smash', label: 'Decimating Smash', type: 'physical', amount: 'lerp(calc.MinDamageTotal, calc.MaxDamageTotal, min(1, floor(charge * 4) / 8))', aoe: true }],
    },
    W: {
      notes: ['Shield, then the recast detonation after DetonateRecastCooldown (3s).'],
      components: [
        { id: 'detonate', label: 'Soul Furnace', type: 'magic', amount: 'calc.TotalDamage + dv.MaxHPDamageRatio / 100 * target.maxHp', aoe: true, delay: 'dv.DetonateRecastCooldown' },
      ],
    },
    E: {
      cc: [{ kind: 'slow', duration: 'dv.SlowDuration' }],
      debuff: { id: 'sionE', label: 'Roar of the Slayer', duration: 'dv.ArmorShredDuration', armorReduction: 'dv.ArmorShred / 100' },
      components: [{ id: 'roar', label: 'Roar of the Slayer', type: 'magic', amount: 'calc.TotalDamage', delay: 0.25 }],
    },
    R: {
      dash: true,
      // Charges for up to 8s, recast to stop after ~0.4s at the earliest; damage and stun grow every
      // second up to 3s (wiki).
      charge: { default: 3, min: 0.4, max: 8 },
      castTime: 'charge',
      notes: ['Default: a 3s charge (max damage and stun). Set the seconds charging (R{1s}): damage and stun grow each full second up to 3.'],
      cc: [
        { kind: 'immobilize', duration: `lerp(dv.MinStunDuration, dv.MaxStunDuration, ${R_POWER})` },
        { kind: 'slow', duration: 3 },
      ],
      components: [{ id: 'slam', label: 'Unstoppable Onslaught', type: 'physical', amount: `lerp(calc.MinDamageTotal, calc.MaxDamageTotal, ${R_POWER})`, aoe: true }],
    },
  },
};
export default kit;
