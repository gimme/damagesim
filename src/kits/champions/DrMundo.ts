import type { ChampionKit } from '../../engine/kit-types.ts';
import { SELF_HP } from '../../engine/effects.ts';

// Dr. Mundo — patch 16.20.
const kit: ChampionKit = {
  id: 'DrMundo',
  status: 'curated',
  notes: [
    'Blunt Force Trauma passive bonus AD (E.calc.PassiveBonusAD) is computed from max health at combo start.',
    "Blunt Force Trauma's bonus damage grows linearly with Mundo's missing health, up to +40% at 70% missing (wiki); Mundo's health comes from the self.hpPercent option (default full).",
    'Heart Zapper: ticks every 0.25s (wiki) for the full 3s, then detonates automatically (TotalDamage). Gray-health healing and Maximum Dosage are not modeled.',
  ],
  options: [SELF_HP],
  stats: ({ ranks, evalExpr }) => (ranks.E > 0 ? { ad: evalExpr('E.calc.PassiveBonusAD', 'E') } : {}),
  abilities: {
    Q: {
      cc: [{ kind: 'slow', duration: 'dv.SlowDuration' }],
      components: [
        // Thrown as the cast time starts (wiki: {{Effect at cast time start}}).
        { id: 'bonesaw', label: 'Infected Bonesaw', type: 'magic', amount: 'max(dv.CurrentHealthDamage * target.hp, dv.MinimumDamage)', travel: 'reach / missileSpeed - castTime' },
      ],
    },
    W: {
      components: [
        { id: 'zap', label: 'Heart Zapper', type: 'magic', amount: 'dv.DamagePerTick', hits: 'dv.Duration * 4', maxHits: 'dv.Duration * 4', interval: 0.25, delay: 0.25, aoe: true, dot: true },
        { id: 'detonate', label: 'Heart Zapper (detonation)', type: 'magic', amount: 'calc.TotalDamage', delay: 'dv.Duration', aoe: true },
      ],
    },
    E: {
      resetsAttack: true,
      buff: {
        id: 'bluntForceTrauma',
        label: 'Blunt Force Trauma',
        duration: 'dv.AttackOverrideDuration',
        empowerAttacks: {
          count: 1,
          resetsAttack: true,
          // The wiki: the attack and its bonus damage are basic and spell damage.
          spell: true,
          components: [
            {
              id: 'bag',
              label: 'Blunt Force Trauma',
              type: 'physical',
              amount: 'max(0, E.calc.AdditionalDamage) * (1 + (E.dv.MaxDamageAmp - 1) * min(1, (1 - hp / maxHp) / E.dv.MaxMissingHealthThreshold))',
            },
          ],
        },
      },
    },
    R: { noTarget: true, components: [] },
  },
};
export default kit;
