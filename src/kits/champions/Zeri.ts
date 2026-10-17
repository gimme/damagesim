import type { BuffSpec, ChampionKit } from '../../engine/kit-types.ts';

// Zeri — patch 16.20.
// Living Battery: her right-click attack deals Q.calc.MinDamage magic damage (cannot crit) and
// executes low-health targets; a fully charged attack deals PassiveMaxDamage + %max health instead.
// Burst Fire (Q) is her real "attack": it applies on-hit and can crit.
const charged: BuffSpec = {
  id: 'zeriCharged',
  label: 'Living Battery (charged)',
  duration: 999,
  empowerAttacks: {
    count: 1,
    replaceBase: true,
    components: [{ id: 'charged', label: 'Charged attack', type: 'magic', amount: 'Q.calc.PassiveMaxDamage + Q.calc.PassiveMaxChargePercentHealth * target.maxHp' }],
  },
};

const kit: ChampionKit = {
  id: 'Zeri',
  status: 'curated',
  notes: [
    "Basic attacks (AA) are Zeri's right-click: Q.calc.MinDamage magic damage that executes below PassiveExecuteThreshold health. In game they apply no on-hit/on-attack effects; the simulator still applies item on-hits to them.",
    'Option charged (default on): the first AA of the combo is fully charged (she starts at full charge).',
    "Burst Fire applies on-hit once per cast and can crit; its 7 rounds are one instance here. Its cooldown is the attack timer: max(MinCooldown, 1 / attack speed).",
    "The 1.5 attack speed cap and conversion of excess bonus attack speed into AD are not modeled.",
    'Spark Surge adds its magic damage to Burst Fire casts for 5s. Lightning Crash: champion hits by abilities extend Overcharge by 2.5s (up to 5s remaining); chain damage to other enemies is ignored.',
  ],
  options: [{ key: 'charged', label: 'First attack is fully charged', default: 1, toggle: true }],
  attack: { type: 'magic', canCrit: false, damageMult: 'Q.calc.MinDamage / ad' },
  hooks: {
    onStart(sim) {
      if (sim.opt.charged) sim.applyBuff(charged, 'P', sim.spellFor('P'), 1);
    },
    afterDamage(sim, inst) {
      // Uncharged attack execute.
      if (inst.flags.attack && inst.source === 'AA' && sim.target.hp > 0 && sim.target.hp <= sim.evalExpr('Q.calc.PassiveExecuteThreshold', { slot: 'Q' }))
        sim.deal({ source: 'P', sourceLabel: 'Living Battery', label: 'Execute', type: 'true', amount: sim.target.hp, castId: inst.castId, flags: { kind: 'ability', slot: 'P', ability: false }, markSource: 'zeriExecute' });
      // Overcharge extension on ability (or charged attack) hits.
      const r = sim.buffs.get('zeriR');
      const extends_ = ['Q', 'W', 'E', 'R'].includes(inst.source) || (inst.source === 'P' && inst.flags.attack); // abilities or the charged attack
      if (r && r.expires >= sim.time && !inst.fromMark && extends_) {
        const max = sim.time + sim.evalExpr('R.dv.RDuration', { slot: 'R' });
        r.expires = Math.min(max, r.expires + sim.evalExpr('R.dv.DurationIncreasePerHit', { slot: 'R' }));
      }
    },
  },
  abilities: {
    Q: {
      // Burst Fire's cooldown is the attack timer (data cooldown 0; the spell ignores ability haste).
      cooldown: 'max(dv.MinCooldown, 1 / as)',
      components: [
        // onHit + canCrit rather than attack: true — kit.attack.canCrit: false (right-click) would also stop Q crits.
        { id: 'burst', label: 'Burst Fire', type: 'physical', amount: 'calc.ActiveDamageThatCanCrit', canCrit: true, onHit: true, onAttack: true, travel: true },
        { id: 'surge', label: 'Spark Surge', type: 'magic', amount: 'E.calc.BonusDamageTotal', hits: 'buff.zeriE', maxHits: 1, travel: true, proc: true, condition: 'during Spark Surge' },
      ],
    },
    W: {
      cc: [{ kind: 'slow', duration: 'dv.SlowDuration' }],
      variants: {
        wall: {
          label: 'wall laser',
          note: 'The pulse hits terrain and becomes a laser that crits champions.',
          cc: [{ kind: 'slow', duration: 'dv.SlowDuration' }],
          components: [{ id: 'laser', label: 'Ultrashock Laser (laser)', type: 'physical', amount: 'calc.WallDamage', aoe: true, delay: 'dv.BeamCastTime' }],
        },
      },
      // Wiki: {{Effect at cast time start}}: the pulse flies during the cast time.
      components: [{ id: 'pulse', label: 'Ultrashock Laser', type: 'physical', amount: 'calc.TotalDamage', travel: 'max(0, reach / missileSpeed - castTime)' }],
    },
    E: {
      dash: true,
      noTarget: true,
      // Wiki: she dashes 300 units at 600 + her movement speed (not in the data); Ultrashock Laser and
      // Lightning Crash can be cast during the dash, Burst Fire can't.
      attackLockout: 'castTime + dv.MaxDistance / (600 + ms)',
      castLockout: { Q: 'castTime + dv.MaxDistance / (600 + ms)' },
      buff: { id: 'zeriE', label: 'Spark Surge', duration: 'dv.BuffDuration' },
    },
    R: {
      buff: { id: 'zeriR', label: 'Lightning Crash', duration: 'dv.RDuration', stats: { attackSpeed: 'dv.BaseASPercent', msPercent: 'dv.BaseBonusMS' } },
      components: [{ id: 'nova', label: 'Lightning Crash', type: 'magic', amount: 'calc.TotalActiveDamage', aoe: true }],
    },
  },
};
export default kit;
