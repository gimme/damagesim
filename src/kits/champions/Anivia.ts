import type { ChampionKit, DebuffSpec } from '../../engine/kit-types.ts';

// Anivia — patch 16.20.
// Chill (Flash Frost, fully formed Glacial Storm) doubles Frostbite's damage.
const chill = (id: string, duration: string): DebuffSpec => ({ id, label: 'Chilled', duration });

const kit: ChampionKit = {
  id: 'Anivia',
  status: 'curated',
  notes: ['Rebirth (egg) and Crystallize (wall) do not deal damage.'],
  abilities: {
    Q: {
      cc: [
        { kind: 'slow', duration: 'dv.SlowDuration' },
        { kind: 'immobilize', duration: 'dv.StunDuration' },
      ],
      debuff: chill('chill', 'dv.SlowDuration'),
      notes: ['Default: the ice passes through the target and is detonated on it (both hits, stun). Q{detonate:0} for the pass only.'],
      components: [
        { id: 'pass', label: 'Flash Frost', type: 'magic', amount: 'calc.TotalPassthroughDamage', aoe: true, travel: true },
        // Recast as the ice reaches the target (wiki: else it detonates by itself at its max range).
        { id: 'detonate', label: 'Flash Frost (detonation)', type: 'magic', amount: 'calc.TotalExplosionDamage', aoe: true, travel: true },
      ],
    },
    W: { noTarget: true, notes: ['Wall only.'] },
    E: {
      notes: ['Deals double damage to Chilled targets (Flash Frost, fully formed Glacial Storm).'],
      components: [{ id: 'frostbite', label: 'Frostbite', type: 'magic', amount: 'debuff.chill || debuff.stormChill ? calc.EmpoweredDamage : calc.TotalDamage', travel: true }],
    },
    R: {
      // Slowed while in the storm (default 3s) plus the lingering slow.
      cc: [{ kind: 'slow', duration: 'dv.GrowthTime + 4 * dv.TickRate + dv.ChillDuration' }],
      // The fully formed storm (4th tick) chills while the target stays in it (default 4 formed ticks).
      debuff: { ...chill('stormChill', '4 * dv.TickRate + dv.ChillDuration'), afterHits: 4 },
      notes: [
        'Ticks every 0.5s from the cast. Growing storm (first 1.5s): 3 ticks of half the per-second damage; fully formed: 300% damage.',
        'Default: target stays 3s in the storm (3 growing + 4 formed ticks); set the seconds Anivia keeps it on (R{6s}).',
      ],
      variableDuration: true,
      components: [
        { id: 'growing', label: 'Glacial Storm', type: 'magic', amount: 'calc.TotalDamagePerSecond * dv.TickRate', hits: 'dv.GrowthTime / dv.TickRate', interval: 'dv.TickRate', aoe: true, dot: true },
        {
          id: 'formed',
          label: 'Glacial Storm (formed)',
          type: 'magic',
          amount: 'calc.EmpoweredDamagePerSecondTooltipOnly * dv.TickRate',
          hits: 4,
          maxHits: 40,
          interval: 'dv.TickRate',
          delay: 'dv.GrowthTime',
          aoe: true,
          dot: true,
        },
      ],
    },
  },
};
export default kit;
