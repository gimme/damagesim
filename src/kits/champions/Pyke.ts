import type { ChampionKit } from '../../engine/kit-types.ts';

// Pyke — patch 16.20.
const kit: ChampionKit = {
  id: 'Pyke',
  status: 'curated',
  notes: [
    'Gift of the Drowned Ones: bonus health is converted to bonus AD (1 per HPPerBAD health); Pyke keeps no bonus health. Stored-damage regeneration is not modeled.',
    'Death From Below executes (true damage equal to the remaining health) if the target is at or below the threshold when the cast starts; otherwise it deals 50% of the threshold as physical damage.',
  ],
  stats: ({ evalExpr }) => ({
    conversions: [{ from: 'bonusHp', to: 'ad', ratio: 1 / evalExpr('P.dv.HPPerBAD'), source: 'Gift of the Drowned Ones' }],
    bonusHpMult: [0],
  }),
  abilities: {
    Q: {
      defaultVariant: 'hold',
      notes: ['Default: hold (harpoon pull, minimum charge time). Variant "tap": stab. Both deal the same damage and slow.'],
      variants: {
        hold: {
          label: 'hold',
          // Minimum charge time (dv.MinChargeTime).
          castTime: 0.5,
          // Wiki: unable to act while the harpoon flies: the 0.5s charge + the 0.25s to the hit.
          lockout: 0.75,
          cc: [{ kind: 'immobilize', duration: 0.25 }, { kind: 'slow', duration: 'dv.SlowDuration' }],
          note: 'Pull duration is not in the data; 0.25 s assumed.',
          // No harpoon speed in the data or the wiki: ~0.25s in flight.
          components: [{ id: 'harpoon', label: 'Bone Skewer (hold)', type: 'physical', amount: 'calc.TotalDamage', delay: 0.25 }],
        },
        tap: {
          label: 'tap',
          cc: [{ kind: 'slow', duration: 'dv.SlowDuration' }],
          components: [{ id: 'stab', label: 'Bone Skewer', type: 'physical', amount: 'calc.TotalDamage' }],
        },
      },
    },
    W: {
      noTarget: true,
      notes: ['Camouflage and move speed; no damage.'],
      components: [],
    },
    E: {
      dash: true,
      cc: [{ kind: 'immobilize', duration: 'calc.StunDuration' }],
      notes: ['The phantom returns StunDelay (1 s) after the dash and hits the target on its way back.'],
      // Dashes his max range at the dash speed, through the target; after dv.StunDelay the phantom
      // follows the same way at the same speed, passing the target (wiki).
      lockout: 'castTime + castRange / missileSpeed',
      components: [{ id: 'phantom', label: 'Phantom Undertow', type: 'physical', amount: 'calc.TotalDamage', delay: 'dv.StunDelay', travel: true }],
    },
    R: {
      dash: true,
      components: [
        {
          id: 'execute',
          label: 'Death From Below (execute)',
          type: 'true',
          amount: 'target.hp <= calc.RDamage ? target.hp : 0',
          hits: 'target.hp <= calc.RDamage ? 1 : 0',
          maxHits: 1,
        },
        {
          id: 'strike',
          label: 'Death From Below',
          type: 'physical',
          amount: 'calc.ReducedDamageFinal',
          hits: 'target.hp <= calc.RDamage ? 0 : 1',
          maxHits: 1,
        },
      ],
    },
  },
};
export default kit;
