import type { ChampionKit } from '../../engine/kit-types.ts';

// Ivern — patch 16.20.
// Daisy attack speed (wiki): 0.75 base × (1 + R.dv.DaisyAS%) → 0.975 / 1.0875 / 1.2 by rank.
const DAISY_INTERVAL = '1 / (0.75 * (1 + R.dv.DaisyAS / 100))';

const kit: ChampionKit = {
  id: 'Ivern',
  status: 'curated',
  notes: [
    'Ivern deals no damage to non-epic monsters; everything here is vs a champion.',
    'Daisy is modeled as a pet that attacks the target 6 times (≈5-6s); her attacks apply on-hit effects (wiki "Attack effects"). Override with R{daisy:N}.',
  ],
  abilities: {
    Q: {
      cc: [{ kind: 'immobilize', duration: 'dv.RootDuration' }],
      notes: ['The recast dash onto the rooted target is not modeled as a separate step.'],
      // {{Effect at cast time start}} (wiki): the vine flies from the start of the cast time.
      components: [{ id: 'vine', label: 'Rootcaller', type: 'magic', amount: 'calc.TotalDamage', travel: 'max(0, castRange / missileSpeed - castTime)' }],
    },
    W: {
      noTarget: true,
      notes: ['Brushmaker passive: Ivern\'s attacks deal bonus magic damage while in brush and for dv.BuffDuration s after leaving. Casting W (creating brush) is assumed to start that window.'],
      buff: {
        id: 'brushmaker',
        label: 'Brushmaker',
        duration: 'dv.BuffDuration',
        onHit: [{ id: 'bolt', label: 'Brushmaker', type: 'magic', amount: 'W.calc.TotalDamage', proc: true }],
      },
    },
    E: {
      notes: ['Shield on Ivern/an ally/Daisy next to the target; it bursts after dv.ShieldDuration seconds.'],
      cc: [{ kind: 'slow', duration: 'dv.SlowDuration' }],
      components: [{ id: 'burst', label: 'Triggerseed', type: 'magic', amount: 'calc.TotalDamage', aoe: true, delay: 'dv.ShieldDuration' }],
    },
    R: {
      notes: [
        'Daisy leaps in (≈0.5s) and attacks every 1/(0.75 × (1 + DaisyAS)) s for R.calc.TotalDaisyAD physical damage.',
        'Daisy Smash! on her 3rd consecutive attack: magic damage + 1s knock-up (once every dv.ShockwaveCD s).',
      ],
      // Knock-up lands with the Smash: two attack intervals + 0.625s charge after Daisy's first hit.
      cc: [{ kind: 'immobilize', duration: 'dv.ShockwaveCCDuration', delay: `2 * ${DAISY_INTERVAL} + 0.625` }],
      components: [
        { id: 'daisy', label: 'Daisy attack', type: 'physical', amount: 'calc.TotalDaisyAD', hits: 6, interval: DAISY_INTERVAL, delay: 0.5, pet: true, onHit: true },
        // 3rd attack charges for 0.625s (wiki) before the shockwave.
        { id: 'smash', label: 'Daisy Smash!', type: 'magic', amount: 'calc.TotalShockwaveDamage', delay: `0.5 + 2 * ${DAISY_INTERVAL} + 0.625`, aoe: true },
      ],
    },
  },
};
export default kit;
