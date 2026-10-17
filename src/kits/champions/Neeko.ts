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
      components: [{ id: 'shapesplitter', label: 'Shapesplitter', type: 'magic', amount: 'W.rank > 0 ? W.calc.PassiveBonusDamageCalc : 0', proc: true }],
    },
  },
  abilities: {
    Q: {
      notes: ['Hitting a champion makes the seed bloom again after 0.75 s, up to 2 extra blooms: default assumes the target stays in the area for both (e.g. rooted). Otherwise lower them, e.g. Q{rebloom:1}.'],
      // {{Effect at cast time start}} (wiki): the seed flies its max range from the start of the cast.
      components: [
        { id: 'bloom', label: 'Blooming Burst', type: 'magic', amount: 'calc.ExplosionDamage', aoe: true, travel: 'max(0, castRange / missileSpeed - castTime)' },
        { id: 'rebloom', label: 'Blooming Burst (extra bloom)', type: 'magic', amount: 'calc.SecondDamage', hits: 2, maxHits: 2, interval: 'dv.RepeatDelay', delay: 'dv.RepeatDelay', travel: 'max(0, castRange / missileSpeed - castTime)', aoe: true },
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
          // Speeds up to 1500 (wiki) only after passing through the first enemy: the standard speed assumed.
          components: [{ id: 'tangle', label: 'Tangle-Barbs', type: 'magic', amount: 'calc.BaseDamage', travel: true }],
        },
      },
      components: [{ id: 'tangle', label: 'Tangle-Barbs', type: 'magic', amount: 'calc.BaseDamage', travel: true }],
    },
    R: {
      cc: [{ kind: 'immobilize', duration: 'dv.StunDuration' }],
      notes: ['Winds up for 1.25 s, then knocks up for 0.6 s and crashes down (damage + stun) ≈1.85 s after the cast.'],
      // Wiki: a 1.25s wind-up (free to act), then the 0.6s cast time (the leap), landing as it ends.
      // Modeled as the cast time first and the wind-up after it: the same 1.85s, the lockout earlier.
      components: [{ id: 'crash', label: 'Pop Blossom', type: 'magic', amount: 'calc.TotalDamage', aoe: true, delay: 'dv.DelayUntilReveal' }],
    },
  },
};
export default kit;
