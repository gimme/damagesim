import type { ChampionKit } from '../../engine/kit-types.ts';

// Cassiopeia — patch 16.20.
// Poisoned state (Q / W) is a debuff that Twin Fang reads for its bonus damage.
const BLAST_DELAY = 0.4; // wiki: Noxious Blast explodes 0.4s after the cast time
const kit: ChampionKit = {
  id: 'Cassiopeia',
  status: 'curated',
  notes: [
    'Noxious Blast explodes 0.4s after the cast (wiki) and poisons for Q.dv.PoisonDuration s in Q.dv.NumDamageTicks equal ticks.',
    'Miasma: the target is assumed to stay in the clouds for 2s (2 one-second ticks of the per-second damage; override with W{cloud:N}, max 5). Poison is assumed to last 1s (W.dv.PoisonDuration) after the last tick.',
    'Twin Fang adds its poisoned bonus when the target is Poisoned (Q or W) at impact; like in game it waits for a pending Noxious Blast to explode first.',
    'Petrifying Gaze assumes the target faces Cassiopeia (stun rather than slow).',
  ],
  hooks: {
    // Remember when the last Noxious Blast explodes: Twin Fang waits for it (wiki).
    onCast(sim, cast) {
      if (cast.slot === 'Q' && cast.hitsTarget) sim.setCounter('cassBlastAt', sim.time + sim.spellFor('Q').castTime + BLAST_DELAY);
    },
  },
  abilities: {
    Q: {
      debuff: { id: 'cassPoison', label: 'Poisoned', duration: 'dv.PoisonDuration', applyBeforeHit: true },
      components: [
        {
          id: 'blast',
          label: 'Noxious Blast',
          type: 'magic',
          amount: 'calc.TooltipTotalDamage / dv.NumDamageTicks',
          hits: 'dv.NumDamageTicks',
          maxHits: 'dv.NumDamageTicks',
          interval: 'dv.PoisonDuration / dv.NumDamageTicks',
          delay: BLAST_DELAY,
          aoe: true,
          dot: true,
        },
      ],
    },
    W: {
      // Grounded + slowed while in the clouds (same 2s assumption as the ticks).
      cc: [
        { kind: 'impair', duration: 2 },
        { kind: 'slow', duration: 2 },
      ],
      debuff: { id: 'cassPoison', label: 'Poisoned', duration: '2 + dv.PoisonDuration', applyBeforeHit: true },
      components: [
        {
          id: 'cloud',
          label: 'Miasma',
          type: 'magic',
          amount: 'calc.DamagePerSecond',
          hits: 2,
          maxHits: 'dv.CloudDuration',
          interval: 1,
          delay: 0.25,
          aoe: true,
          dot: true,
        },
      ],
    },
    E: {
      components: [
        {
          id: 'fang',
          label: 'Twin Fang',
          type: 'magic',
          amount: 'calc.BasicDamage + (debuff.cassPoison ? calc.BonusPoisonedDamage : 0)',
          // Missile travel ~0.15s, or until a pending Noxious Blast explodes (0.125 = Twin Fang's cast time).
          delay: 'max(0.15, stacks.cassBlastAt - time - 0.125)',
          condition: 'bonus if Poisoned',
        },
      ],
    },
    R: {
      cc: [{ kind: 'immobilize', duration: 'dv.RCCDuration' }],
      components: [{ id: 'gaze', label: 'Petrifying Gaze', type: 'magic', amount: 'calc.RDamage', aoe: true }],
    },
  },
};
export default kit;
