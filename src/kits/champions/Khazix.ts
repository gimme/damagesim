import type { BuffSpec, ChampionKit } from '../../engine/kit-types.ts';

// Kha'Zix — patch 16.20. Ability tooltips are templated; behaviour follows the wiki, numbers the calcs.
// Unseen Threat: gained when Kha'Zix leaves vision or activates Void Assault; his next attack
// deals bonus magic damage and slows.
const unseenThreat: BuffSpec = {
  id: 'unseenThreat',
  label: 'Unseen Threat',
  // Lasts until used; 10s is an arbitrary window long enough for any combo.
  duration: 10,
  empowerAttacks: {
    count: 1,
    cc: [{ kind: 'slow', duration: 'P.dv.SlowDuration' }],
    components: [{ id: 'unseen', label: 'Unseen Threat', type: 'magic', amount: 'P.calc.TotalDamage' }],
  },
};

const kit: ChampionKit = {
  id: 'Khazix',
  status: 'curated',
  notes: [
    'Cast "P" to start with Unseen Threat (e.g. from brush); Void Assault (R) grants it on activation.',
    'Isolation is a variant: Q:isolated. Evolutions only change range/cooldowns/slows here (evolved W still hits a single target once).',
  ],
  abilities: {
    P: { noTarget: true, castTime: 0, notes: ['Gain Unseen Threat (leave vision).'], buff: unseenThreat, components: [] },
    Q: {
      components: [{ id: 'taste', label: 'Taste Their Fear', type: 'physical', amount: 'calc.BaseDamage' }],
      variants: {
        isolated: {
          label: 'isolated',
          note: 'Target has no nearby allies.',
          components: [{ id: 'taste', label: 'Taste Their Fear (isolated)', type: 'physical', amount: 'calc.IsoDamage' }],
        },
      },
    },
    W: {
      cc: [{ kind: 'slow', duration: 'dv.SlowDuration' }],
      components: [{ id: 'spike', label: 'Void Spike', type: 'physical', amount: 'calc.BaseDamage', aoe: true, travel: true }],
    },
    E: {
      dash: true,
      // No dash speed in the data: ~0.5s to land. Taste Their Fear can be cast during the leap; Void
      // Spike and Void Assault wait for the landing (wiki).
      attackLockout: 0.5,
      castLockout: { W: 0.5, R: 0.5 },
      components: [{ id: 'leap', label: 'Leap', type: 'physical', amount: 'calc.TotalDamage', aoe: true, delay: 0.5 }],
    },
    R: {
      noTarget: true,
      // Not a dash: flagged so that Sudden Impact (which also triggers on leaving stealth) arms.
      dash: true,
      recasts: 2,
      recastDelay: 'dv.RecastCD',
      buff: unseenThreat,
      notes: ['Stealth; grants Unseen Threat on activation. Two casts per cooldown (three when evolved).'],
      components: [],
    },
  },
};
export default kit;
