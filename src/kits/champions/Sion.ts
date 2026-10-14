import type { ChampionKit } from '../../engine/kit-types.ts';

// Sion — patch 16.20.
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
      // Charge time is the cast time: damage grows from min to max over 2s.
      castTime: 2,
      notes: [
        'Default: fully charged (2s) — max damage, knock-up + stun 2.25s. Q:half = 1s charge (midpoint damage, 1.25s stun); Q:tap = released at once (min damage, brief slow).',
      ],
      // Stun 1.25–2.25s by charge time (upper bound from the tooltip text).
      cc: [{ kind: 'immobilize', duration: 'dv.BaseStunTime + 1' }],
      components: [{ id: 'smash', label: 'Decimating Smash', type: 'physical', amount: 'calc.MaxDamageTotal', aoe: true }],
      variants: {
        half: {
          label: '1s charge',
          castTime: 1,
          cc: [{ kind: 'immobilize', duration: 'dv.BaseStunTime' }],
          components: [{ id: 'smash', label: 'Decimating Smash', type: 'physical', amount: 'lerp(calc.MinDamageTotal, calc.MaxDamageTotal, 0.5)', aoe: true }],
        },
        tap: {
          label: 'uncharged',
          castTime: 0.25,
          cc: [{ kind: 'slow', duration: 0.25 }],
          components: [{ id: 'smash', label: 'Decimating Smash', type: 'physical', amount: 'calc.MinDamageTotal', aoe: true }],
        },
      },
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
      // Damage and stun scale with charge time, maximum after 3s (wiki).
      castTime: 3,
      notes: ['Default: full-length charge (3s) — max damage and stun. R:short = a short charge (min damage and stun).'],
      cc: [
        { kind: 'immobilize', duration: 'dv.MaxStunDuration' },
        { kind: 'slow', duration: 3 },
      ],
      components: [{ id: 'slam', label: 'Unstoppable Onslaught', type: 'physical', amount: 'calc.MaxDamageTotal', aoe: true }],
      variants: {
        short: {
          label: 'short charge',
          castTime: 0.5,
          dash: true,
          cc: [
            { kind: 'immobilize', duration: 'dv.MinStunDuration' },
            { kind: 'slow', duration: 3 },
          ],
          components: [{ id: 'slam', label: 'Unstoppable Onslaught', type: 'physical', amount: 'calc.MinDamageTotal', aoe: true }],
        },
      },
    },
  },
};
export default kit;
