import type { ChampionKit } from '../../engine/kit-types.ts';

// Leona — patch 16.20.
const kit: ChampionKit = {
  id: 'Leona',
  status: 'curated',
  notes: [
    'Sunlight is consumed by allied champions only: cast "P" to add one ally proc (counted as Leona\'s damage here).',
  ],
  abilities: {
    P: {
      notes: ['An allied champion damages the Sunlight-marked target.'],
      // Spell damage (wiki): Leona's spell effects apply.
      components: [{ id: 'sunlight', label: 'Sunlight (ally)', type: 'magic', amount: 'calc.TotalDamage' }],
    },
    Q: {
      resetsAttack: true,
      notes: ['Use "Q AA": the next attack within 6s deals bonus magic damage and stuns.'],
      buff: {
        id: 'leonaQ',
        label: 'Shield of Daybreak',
        duration: 6, // wiki: next attack within 6 seconds
        empowerAttacks: {
          count: 1,
          resetsAttack: true,
          cc: [{ kind: 'immobilize', duration: 'Q.dv.StunDuration' }],
          components: [{ id: 'daybreak', label: 'Shield of Daybreak', type: 'magic', amount: 'Q.calc.TotalDamageTooltip' }],
        },
      },
    },
    W: {
      castTime: 0, // no cast time (wiki)
      buff: { id: 'leonaW', label: 'Eclipse', duration: 'dv.ArmorMRDuration * 2', stats: { armor: 'calc.BonusArmorTooltip', mr: 'calc.BonusMRTooltip' } },
      notes: ['The shield detonates 3s after the cast; resistances last 3 more seconds when it hits.'],
      components: [{ id: 'eclipse', label: 'Eclipse', type: 'magic', amount: 'calc.TotalDamageTooltip', aoe: true, delay: 'dv.ArmorMRDuration' }],
    },
    E: {
      dash: true,
      // Wiki: unable to move or attack while the blade flies its max range, passing the target on the
      // way; then she dashes, rooting it, and can cast any ability during the dash.
      cc: [{ kind: 'immobilize', duration: 'dv.RootDuration', delay: '(castRange - reach) / missileSpeed' }],
      lockout: 'castTime + castRange / missileSpeed',
      components: [{ id: 'blade', label: 'Zenith Blade', type: 'magic', amount: 'calc.TotalDamageTooltip', aoe: true, travel: true }],
    },
    R: {
      cc: [{ kind: 'immobilize', duration: 'dv.CCDuration' }],
      notes: ['Default: target in the center (stunned). R:edge = slowed instead.'],
      // Strikes 0.625s later (wiki).
      components: [{ id: 'flare', label: 'Solar Flare', type: 'magic', amount: 'calc.ExplosionCalculatedDamage', aoe: true, delay: 0.625 }],
      variants: {
        edge: {
          label: 'edge',
          cc: [{ kind: 'slow', duration: 'dv.CCDuration' }],
          components: [{ id: 'flare', label: 'Solar Flare', type: 'magic', amount: 'calc.ExplosionCalculatedDamage', aoe: true, delay: 0.625 }],
        },
      },
    },
  },
};
export default kit;
