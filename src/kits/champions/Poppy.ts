import type { ChampionKit } from '../../engine/kit-types.ts';

// Poppy — patch 16.20.
const kit: ChampionKit = {
  id: 'Poppy',
  status: 'curated',
  notes: [
    'Iron Ambassador: the first attack (ready at combat start) and then one attack every ActualCooldown seconds throws the buckler for bonus magic damage. Picking it up (shield) is not modeled.',
    'Steadfast Presence passive resists are not modeled (defensive only).',
  ],
  abilities: {
    Q: {
      cc: [{ kind: 'slow', duration: 'dv.DelayBetweenTwoHits' }],
      notes: ['The ground erupts again after 1 s: the second hit assumes the target stays in the area (disable with Q{eruption:0}).'],
      components: [
        { id: 'smash', label: 'Hammer Shock', type: 'physical', amount: 'calc.BaseDamage + dv.HealthDamagePercent / 100 * target.maxHp', aoe: true, delay: 0.05 },
        { id: 'eruption', label: 'Hammer Shock (eruption)', type: 'physical', amount: 'calc.BaseDamage + dv.HealthDamagePercent / 100 * target.maxHp', aoe: true, delay: 'dv.DelayBetweenTwoHits' },
      ],
    },
    W: {
      cc: [{ kind: 'impair', duration: 'dv.GroundingDuration' }, { kind: 'slow', duration: 'dv.GroundingDuration' }],
      notes: ['Damage, ground and slow only hit an enemy whose dash is stopped by the field: optional component "interrupt" (W+interrupt).'],
      components: [{ id: 'interrupt', label: 'Steadfast Presence', type: 'magic', amount: 'calc.InterruptDamage', optional: true, condition: 'if the enemy dashes into the field' }],
    },
    E: {
      dash: true,
      notes: ['Default: tackle without terrain. Variant "wall": carried into terrain — second hit and stun.'],
      variants: {
        wall: {
          label: 'into terrain',
          dash: true,
          cc: [{ kind: 'immobilize', duration: 'dv.StunDuration' }],
          components: [
            { id: 'tackle', label: 'Heroic Charge', type: 'physical', amount: 'calc.TackleDamage', delay: 0.1 },
            { id: 'wall', label: 'Heroic Charge (terrain)', type: 'physical', amount: 'calc.TackleDamage', delay: 0.3 },
          ],
        },
      },
      components: [{ id: 'tackle', label: 'Heroic Charge', type: 'physical', amount: 'calc.TackleDamage', delay: 0.1 }],
    },
    R: {
      // Charged to full power.
      castTime: 'dv.DurationUntilFullyCharged',
      cc: [{ kind: 'immobilize', duration: 'dv.KnockupDurationCharged' }],
      notes: ['Default: charged release (full damage, knock back). Variant "quick": uncharged swing (half damage, 1 s knock-up).'],
      variants: {
        quick: {
          label: 'uncharged',
          castTime: 0.25,
          cc: [{ kind: 'immobilize', duration: 'dv.KnockupDurationSnap' }],
          components: [{ id: 'verdict', label: "Keeper's Verdict", type: 'physical', amount: 'calc.HalfDamage', aoe: true }],
        },
      },
      components: [{ id: 'verdict', label: "Keeper's Verdict", type: 'physical', amount: 'calc.Damage', aoe: true, delay: 0.2 }],
    },
  },
  hooks: {
    onAttack(sim, atk) {
      if (atk.fromAbility || atk.phantom || !sim.isReady('poppy.P')) return;
      sim.startCooldown('poppy.P', sim.evalExpr('P.calc.ActualCooldown', { slot: 'P' }));
      atk.extra.push({
        source: 'P',
        sourceLabel: 'Iron Ambassador',
        label: 'Iron Ambassador',
        type: 'magic',
        amount: sim.evalExpr('P.calc.TotalDamage', { slot: 'P' }),
        castId: atk.castId,
        flags: { kind: 'ability', slot: 'P', onHit: true, ability: false, proc: true },
      });
    },
  },
};
export default kit;
