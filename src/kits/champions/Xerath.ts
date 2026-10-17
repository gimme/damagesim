import type { ChampionKit } from '../../engine/kit-types.ts';

// Xerath — patch 16.20.
const kit: ChampionKit = {
  id: 'Xerath',
  status: 'curated',
  notes: ['Mana Surge (mana restore) has no damage and is not modeled.'],
  abilities: {
    Q: {
      // Typical charge ≈1s plus the 0.528s release lock before the beam fires (wiki). Damage does not
      // depend on charge time.
      castTime: 1.5,
      notes: ['Cast time = ~1s charge + 0.53s release (approximation for a mid-range Arcanopulse).'],
      components: [{ id: 'beam', label: 'Arcanopulse', type: 'magic', amount: 'calc.TooltipTotalDamage', aoe: true }],
    },
    W: {
      cc: [{ kind: 'slow', duration: 'dv.SlowDuration' }],
      notes: ['Default: outer area. "W:center" = sweet spot (more damage, stronger slow).'],
      components: [{ id: 'blast', label: 'Eye of Destruction', type: 'magic', amount: 'calc.TotalDamage', aoe: true, delay: 'dv.DamageDelay' }],
      variants: {
        center: {
          label: 'center',
          cc: [{ kind: 'slow', duration: 'dv.SlowDuration' }],
          components: [{ id: 'blast', label: 'Eye of Destruction (center)', type: 'magic', amount: 'calc.SweetSpotTotalDamage', aoe: true, delay: 'dv.DamageDelay' }],
        },
      },
    },
    E: {
      notes: ['Stun scales with travel distance; the average of the minimum and maximum duration is assumed.'],
      cc: [{ kind: 'immobilize', duration: '(dv.MinStunDuration + dv.MaxStunDuration) / 2' }],
      components: [{ id: 'orb', label: 'Shocking Orb', type: 'magic', amount: 'calc.TooltipTotalDamage', travel: true }],
    },
    R: {
      // Busy until the last recast: 0.5s ascension + one recast every CDPerShot.
      lockout: '0.5 + (dv.NumberOfShots - 1) * dv.CDPerShot',
      variableCount: 'shots',
      notes: [
        'One R step = the whole channel: every shot (count from data) lands 0.627s after its recast (wiki), recasts every CDPerShot after the 0.5s ascension. Set the shots to fire fewer (R{3}).',
        'Each shot that hits a champion grants a stack that raises the damage of later shots (wiki) — shot n deals base + n × ramp damage.',
      ],
      components: [
        {
          id: 'shot',
          label: 'Rite of the Arcane',
          type: 'magic',
          amount: 'calc.TooltipTotalDamage + calc.RampDamageCalc * hit',
          hits: 'dv.NumberOfShots',
          interval: 'dv.CDPerShot',
          delay: 0.5,
          travel: 0.627,
          aoe: true,
          sameCast: false,
        },
      ],
    },
  },
};
export default kit;
