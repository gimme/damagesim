import type { ChampionKit } from '../../engine/kit-types.ts';

// Neeko — patch 16.20.
const kit: ChampionKit = {
  id: 'Neeko',
  status: 'curated',
  notes: [
    'Inherent Glamour (disguise) is not modeled; its hidden magic-penetration data values are not in the tooltip and are ignored.',
    'Shapesplitter passive: every 3rd attack deals bonus magic damage.',
  ],
  attack: {
    everyNth: {
      n: 3,
      label: 'Shapesplitter',
      components: [{ id: 'shapesplitter', label: 'Shapesplitter', type: 'magic', amount: 'W.rank > 0 ? W.calc.PassiveBonusDamageCalc : 0' }],
    },
  },
  abilities: {
    Q: {
      notes: ['Hitting a champion makes the seed bloom again after 0.75 s, up to 2 extra blooms: default assumes the target stays in the area for both (e.g. rooted). Otherwise lower them, e.g. Q{rebloom:1}.'],
      components: [
        { id: 'bloom', label: 'Blooming Burst', type: 'magic', amount: 'calc.ExplosionDamage', aoe: true, delay: 0.5 },
        { id: 'rebloom', label: 'Blooming Burst (extra bloom)', type: 'magic', amount: 'calc.SecondDamage', hits: 2, maxHits: 2, interval: 'dv.RepeatDelay', delay: '0.5 + dv.RepeatDelay', aoe: true },
      ],
    },
    W: {
      noTarget: true,
      notes: ['Active: invisibility and a clone (no damage).'],
      components: [],
    },
    E: {
      cc: [{ kind: 'immobilize', duration: 'dv.MinRootDuration' }],
      notes: ['Default: hits the champion directly (minimum root). Variant "empowered": passes through another enemy first (longer root).'],
      variants: {
        empowered: {
          label: 'empowered',
          cc: [{ kind: 'immobilize', duration: 'dv.MaxRootDuration' }],
          components: [{ id: 'tangle', label: 'Tangle-Barbs', type: 'magic', amount: 'calc.BaseDamage', delay: 0.3 }],
        },
      },
      components: [{ id: 'tangle', label: 'Tangle-Barbs', type: 'magic', amount: 'calc.BaseDamage', delay: 0.3 }],
    },
    R: {
      cc: [{ kind: 'immobilize', duration: 'dv.StunDuration' }],
      notes: ['Winds up for 1.25 s, then knocks up for 0.6 s and crashes down (damage + stun) ≈1.85 s after the cast.'],
      components: [{ id: 'crash', label: 'Pop Blossom', type: 'magic', amount: 'calc.TotalDamage', aoe: true, delay: 'dv.DelayUntilReveal + dv.DelayUntilExplosion' }],
    },
  },
};
export default kit;
