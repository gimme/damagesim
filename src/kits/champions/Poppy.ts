import type { ChampionKit } from '../../engine/kit-types.ts';

// Poppy — patch 16.20.
/** Seconds Keeper's Verdict is held for its charged release (wiki). */
const CHARGED = 0.5;

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
        { id: 'smash', label: 'Hammer Shock', type: 'physical', amount: 'calc.BaseDamage + dv.HealthDamagePercent / 100 * target.maxHp', aoe: true },
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
      // Dashes to the target at the dash speed, then carries it up to 400 units
      // (dv.MaxEnemyPushbackDistance; at the dash speed, assumed), into terrain for the wall hit.
      lockout: 'castTime + (reach + dv.MaxEnemyPushbackDistance) / missileSpeed',
      variants: {
        wall: {
          label: 'into terrain',
          dash: true,
          cc: [{ kind: 'immobilize', duration: 'dv.StunDuration' }],
          components: [
            { id: 'tackle', label: 'Heroic Charge', type: 'physical', amount: 'calc.TackleDamage', travel: true },
            { id: 'wall', label: 'Heroic Charge (terrain)', type: 'physical', amount: 'calc.TackleDamage', travel: '(reach + dv.MaxEnemyPushbackDistance) / missileSpeed' },
          ],
        },
      },
      components: [{ id: 'tackle', label: 'Heroic Charge', type: 'physical', amount: 'calc.TackleDamage', travel: true }],
    },
    R: {
      // Charged for up to ChannelMaxDuration: 0.5s of it doubles the damage and knocks back, whose
      // distance grows until DurationUntilFullyCharged (wiki). The release then takes 0.25s, or 0.35s
      // charged (wiki).
      charge: { default: 'dv.DurationUntilFullyCharged', max: 'dv.ChannelMaxDuration' },
      castTime: `charge + (charge >= ${CHARGED} ? 0.35 : 0.25)`,
      cc: [{ kind: 'immobilize', duration: `charge >= ${CHARGED} ? dv.KnockupDurationCharged : dv.KnockupDurationSnap` }],
      notes: ['Default: charged release (full damage, knock back). Set the seconds held (R{0s}): under 0.5s it is the uncharged swing (half damage, 1s knock-up).'],
      // Uncharged, it hits around Poppy. Charged, the shockwave flies to the target at the missile's
      // speed, within its range: 500 + 175 per 0.25s held, up to 1200 (wiki).
      components: [
        {
          id: 'verdict',
          label: "Keeper's Verdict",
          type: 'physical',
          amount: `charge >= ${CHARGED} ? calc.Damage : calc.HalfDamage`,
          aoe: true,
          travel: `charge >= ${CHARGED} ? min(distance, 1200, castRange + 700 * charge) / missileSpeed : 0`,
        },
      ],
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
