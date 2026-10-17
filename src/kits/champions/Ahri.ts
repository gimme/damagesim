import type { ChampionKit } from '../../engine/kit-types.ts';

// Ahri — patch 16.20. Numbers come from the game formulas (calc.*); this file maps them to hits.
// Spirit Rush's dash: its 500 range at 1200 + movement speed (wiki; no dash speed in the data).
const R_DASH = 'castRange / (dv.RBaseDashSpeed + ms)';

const kit: ChampionKit = {
  id: 'Ahri',
  status: 'curated',
  abilities: {
    Q: {
      components: [
        { id: 'out', label: 'Orb (out)', type: 'magic', amount: 'calc.TotalDamage', aoe: true, travel: true },
        // Wiki: the orb flies back its range from 60 speed, accelerating at 1900/s² (~0.94s).
        { id: 'back', label: 'Orb (return)', type: 'true', amount: 'calc.TotalDamage', aoe: true, travel: 'castRange / missileSpeed + (sqrt(60 * 60 + 2 * 1900 * castRange) - 60) / 1900' },
      ],
    },
    W: {
      notes: ['Against a single target: the first fox-fire deals full damage, the other two 40%.'],
      // Wiki: the flames fire at prioritized targets up to 725 away (BonusAcquisitionRange) at 1400
      // speed, after the data's InitialDelay / SecondaryDelay.
      components: [
        { id: 'first', label: 'Fox-fire', type: 'magic', amount: 'calc.SingleFireDamage', delay: 'dv.InitialDelay', travel: 'dv.BonusAcquisitionRange / 1400' },
        { id: 'extra', label: 'Fox-fire (repeat)', type: 'magic', amount: 'calc.MultiFireDamage', hits: 2, maxHits: 2, interval: 0.15, delay: 'dv.SecondaryDelay', travel: 'dv.BonusAcquisitionRange / 1400' },
      ],
    },
    E: {
      cc: [{ kind: 'immobilize', duration: 'dv.CharmDuration' }],
      components: [{ id: 'charm', label: 'Charm', type: 'magic', amount: 'calc.TotalDamage', travel: true }],
    },
    R: {
      dash: true,
      recasts: 3,
      recastDelay: 'dv.RDashCooldown',
      // Wiki: Fox-Fire can be cast during the dash.
      attackLockout: R_DASH,
      castLockout: { Q: R_DASH, E: R_DASH },
      notes: ['Each cast fires bolts at up to 3 targets; a single target is hit once per cast. Use "R R R" for all three dashes.'],
      // Bolts fire once the dash ends, at enemies up to 600 away (RAcquisitionRange) at 1400 speed (wiki).
      components: [{ id: 'bolt', label: 'Essence bolt', type: 'magic', amount: 'calc.RCalculatedDamage', delay: R_DASH, travel: 'dv.RAcquisitionRange / 1400' }],
    },
  },
};
export default kit;
