import type { ChampionKit } from '../../engine/kit-types.ts';

// Morgana — patch 16.20.
const kit: ChampionKit = {
  id: 'Morgana',
  status: 'curated',
  notes: ['Soul Siphon (healing) and Black Shield (ally shield) deal no damage and are not modeled.'],
  abilities: {
    Q: {
      cc: [{ kind: 'immobilize', duration: 'dv.RootDuration' }],
      // {{Effect at cast time start}} (wiki): the missile is launched as the cast time starts.
      components: [{ id: 'binding', label: 'Dark Binding', type: 'magic', amount: 'calc.TotalDamage', travel: 'reach / missileSpeed - castTime' }],
    },
    W: {
      notes: [
        'Ticks every dv.TickRate (0.5s) for the full dv.WDuration (10 ticks) by default — i.e. the target stays in the pool (rooted by Q, then walking out). Lower with W{burn:N}.',
        'Each tick is increased by up to 100% (dv.MissingHealthAmpPercent) linearly with the target\'s missing health, evaluated at the tick.',
      ],
      components: [
        {
          id: 'burn',
          label: 'Tormented Shadow',
          type: 'magic',
          amount: 'calc.TotalMinDamage * dv.TickRate * (1 + dv.MissingHealthAmpPercent * target.missingHpPct)',
          hits: 'dv.WDuration / dv.TickRate',
          maxHits: 'dv.WDuration / dv.TickRate',
          interval: 'dv.TickRate',
          delay: 'dv.TickRate',
          aoe: true,
          dot: true,
        },
      ],
    },
    E: { noTarget: true, components: [] },
    R: {
      notes: [
        'Hits on cast, then again (with the stun) after dv.ChainDuration if the target can\'t break the chains (on by default; disable with R{chains:0}).',
      ],
      cc: [
        { kind: 'slow', duration: 'dv.ChainDuration' },
        { kind: 'immobilize', duration: 'dv.StunDuration', delay: 'dv.ChainDuration' },
      ],
      components: [
        { id: 'cast', label: 'Soul Shackles', type: 'magic', amount: 'calc.TotalDamage', aoe: true },
        { id: 'chains', label: 'Soul Shackles (chains)', type: 'magic', amount: 'calc.TotalDamage', delay: 'dv.ChainDuration', aoe: true, condition: 'target stays in range for the chain duration' },
      ],
    },
  },
};
export default kit;
