import type { BuffSpec, ChampionKit } from '../../engine/kit-types.ts';

// Lee Sin — patch 16.20.
// Flurry: every ability cast (including recasts) grants attack speed for the next 2 attacks within 3s.
const flurry: BuffSpec = {
  id: 'flurry',
  label: 'Flurry',
  duration: 3, // wiki: 2 attacks within 3 seconds
  stats: { attackSpeed: 'P.dv.PassiveAS / 100' },
  empowerAttacks: { count: 2, components: [] },
};
// Resonating Strike's dash to the target, at 1350 + his movement speed (wiki).
const Q2_DASH = 'reach / (1350 + ms)';

const kit: ChampionKit = {
  id: 'LeeSin',
  status: 'curated',
  notes: [
    'Second casts are variants: "Q Q:Q2", "W W:W2", "E E:E2". Every cast refreshes Flurry (+attack speed for 2 attacks); energy is not modelled.',
    "Dragon's Rage collision damage to other enemies (bonus-health based) is not modelled (single target).",
  ],
  abilities: {
    Q: {
      recasts: 2,
      buff: flurry,
      // Fired as the cast time starts (wiki: {{Effect at cast time start}}): lands its flight after the cast starts.
      components: [{ id: 'wave', label: 'Sonic Wave', type: 'physical', amount: 'calc.InitialDamage', travel: 'max(0, reach / missileSpeed - castTime)' }],
      variants: {
        Q2: {
          label: 'Resonating Strike',
          dash: true,
          // No cast time (wiki; the data's is Sonic Wave's). No dash speed in the data: the wiki's 1350
          // + his movement speed to the target. Safeguard, Iron Will and Cripple can be cast during the
          // dash, Tempest and Dragon's Rage can't (wiki; Cripple waits too, sharing Tempest's slot).
          castTime: 0,
          attackLockout: Q2_DASH,
          castLockout: { E: Q2_DASH, R: Q2_DASH },
          buff: flurry,
          note: 'Damage increased by 1% per 1% of the target\'s missing health (up to double).',
          components: [{ id: 'strike', label: 'Resonating Strike', type: 'physical', amount: 'calc.RecastDamage * (1 + dv.Q2MaxMissingHealthMod * target.missingHpPct)', delay: Q2_DASH }],
        },
      },
    },
    W: {
      noTarget: true,
      dash: true,
      recasts: 2,
      buff: flurry,
      notes: ['Dash to an ally/ward and shield; W:W2 grants omnivamp. No damage.'],
      components: [],
      variants: { W2: { label: 'Iron Will', buff: flurry, components: [] } },
    },
    E: {
      recasts: 2,
      buff: flurry,
      components: [{ id: 'tempest', label: 'Tempest', type: 'magic', amount: 'calc.InitialDamage', aoe: true }],
      variants: {
        // No cast time (wiki; the data's is Tempest's).
        E2: { label: 'Cripple', castTime: 0, buff: flurry, cc: [{ kind: 'slow', duration: 'dv.SlowDuration' }], components: [] },
      },
    },
    R: {
      buff: flurry,
      cc: [{ kind: 'immobilize', duration: 1 }], // kicked target is airborne for 1s (wiki)
      components: [{ id: 'kick', label: "Dragon's Rage", type: 'physical', amount: 'calc.Damage' }],
    },
  },
};
export default kit;
