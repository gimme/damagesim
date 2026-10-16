import type { ChampionKit, DebuffSpec } from '../../engine/kit-types.ts';

// K'Sante — patch 16.20.
// Dauntless Instinct: damaging abilities mark the target for 4s; K'Sante's next attack consumes
// the mark for bonus physical damage (a separate instance after the attack).
const mark: DebuffSpec = {
  id: 'ksanteMark',
  label: 'Dauntless Instinct',
  duration: 'P.dv.MarkDuration',
  consume: {
    by: 'attack',
    slot: 'P',
    // The wiki: "The mark deals proc damage in sequence after the basic attack."
    components: [{ id: 'mark', label: 'Dauntless Instinct', type: 'physical', amount: 'P.dv.FlatDamage + P.calc.PercentHealthDamage * target.maxHp', proc: true }],
  },
};
const wDamage = 'dv.BaseDamage + calc.TotalMaxHealthDamage * target.maxHp';
/** Path Maker's charge, from the minimum to the full charge. */
const W_POWER = 'clamp((charge - dv.MinChargeTime) / (dv.TimeToFullCharge - dv.MinChargeTime), 0, 1)';

const kit: ChampionKit = {
  id: 'KSante',
  status: 'curated',
  notes: [
    'All Out (R, 15s): +attack speed, bonus armor penetration, and every physical attack/ability/passive hit is increased by P.calc.MaxHealthDamagePercent of the target\'s max health (same instance, hook).',
    'All Out\'s health/resistance loss is not modelled: it comes out of base resistances and does not change K\'Sante\'s damage scalings. Omnivamp and shields are ignored.',
    'W charge: default minimum (0.4s); set the seconds held (W{0.9s} for the full charge). While All Out use W:allout (bonus true damage, no stun). Casting R refreshes W\'s cooldown (hook); All Out\'s Q/E cooldown reductions are not modelled.',
  ],
  abilities: {
    Q: {
      resetsAttack: true,
      debuff: mark,
      cc: [{ kind: 'slow', duration: 'dv.SlowDuration' }],
      notes: ['Third cast (2 stacks) is Q:q3: same damage, pull + stun.'],
      components: [{ id: 'strike', label: 'Ntofo Strikes', type: 'physical', amount: 'calc.BaseDamage', aoe: true }],
      variants: {
        q3: {
          label: 'shockwave',
          resetsAttack: true,
          debuff: mark,
          cc: [
            { kind: 'immobilize', duration: 'dv.StunDuration' },
            { kind: 'slow', duration: 'dv.SlowDuration' },
          ],
          components: [{ id: 'strike', label: 'Ntofo Strikes (shockwave)', type: 'physical', amount: 'calc.BaseDamage', aoe: true }],
        },
      },
    },
    W: {
      dash: true,
      // Charged for MinChargeTime to MaxDuration; stun and All Out's true damage grow until TimeToFullCharge.
      charge: { default: 'dv.MinChargeTime', max: 'dv.MaxDuration' },
      castTime: 'max(dv.MinChargeTime, charge)',
      debuff: mark,
      cc: [{ kind: 'immobilize', duration: `lerp(dv.MinKnockbackDuration, dv.MaxKnockbackDuration, ${W_POWER})` }],
      components: [{ id: 'ram', label: 'Path Maker', type: 'physical', amount: wDamage, aoe: true }],
      variants: {
        allout: {
          label: 'All Out',
          dash: true,
          debuff: mark,
          cc: [],
          components: [
            { id: 'ram', label: 'Path Maker', type: 'physical', amount: wDamage, aoe: true },
            { id: 'true', label: 'Path Maker (All Out)', type: 'true', amount: `(${wDamage}) * lerp(dv.RDamageIncreaseMin, dv.RDamageIncreaseMax, ${W_POWER})`, aoe: true },
          ],
        },
      },
    },
    E: { dash: true, noTarget: true, notes: ['Dash + shield, no damage.'], components: [] },
    R: {
      dash: true,
      debuff: mark,
      cc: [{ kind: 'immobilize', duration: 'dv.NoWallStunDuration' }],
      buff: { id: 'ksanteR', label: 'All Out', duration: 'dv.AllOutDuration', stats: { attackSpeed: 'dv.AttackSpeed' }, bonusArmorPenPercent: 'dv.ArmorPenPercent' },
      notes: ['R:wall when the target is knocked through a wall (second strike, longer stun).'],
      components: [{ id: 'tackle', label: 'All Out', type: 'physical', amount: 'dv.BaseDamage', delay: 0.3 }],
      variants: {
        wall: {
          label: 'through a wall',
          dash: true,
          debuff: mark,
          cc: [{ kind: 'immobilize', duration: 'dv.WallStunDuration' }],
          buff: { id: 'ksanteR', label: 'All Out', duration: 'dv.AllOutDuration', stats: { attackSpeed: 'dv.AttackSpeed' }, bonusArmorPenPercent: 'dv.ArmorPenPercent' },
          components: [
            { id: 'tackle', label: 'All Out', type: 'physical', amount: 'dv.BaseDamage', delay: 0.3 },
            { id: 'slam', label: 'All Out (wall strike)', type: 'physical', amount: 'calc.TotalDamageSlamDown', delay: 0.8 },
          ],
        },
      },
    },
  },
  hooks: {
    // Going All Out refreshes Path Maker's cooldown.
    onCast(sim, cast) {
      if (cast.slot === 'R') sim.startCooldown('ability:W', 0);
    },
    // All Out: K'Sante's attacks, abilities and passive deal extra % max health inside the same instance
    // (the passive's mark consumption too, though it is proc damage).
    beforeDamage(sim, inst) {
      if (inst.type !== 'physical' || !sim.getBuff('ksanteR')) return;
      const own = inst.fromMark === 'ksanteMark' || (!inst.flags.proc && (inst.flags.kind === 'attack' || (inst.flags.kind === 'ability' && !!inst.flags.slot && inst.flags.slot !== 'P' && !inst.fromMark)));
      if (!own) return;
      inst.raw += sim.evalExpr('P.calc.MaxHealthDamagePercent', { slot: 'P' }) * sim.target.maxHp;
      inst.note = (inst.note ? inst.note + '; ' : '') + 'All Out';
    },
  },
};
export default kit;
