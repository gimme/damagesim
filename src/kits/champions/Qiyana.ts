import type { BuffSpec, ChampionKit } from '../../engine/kit-types.ts';

// Qiyana — patch 16.20.
// Terrashape enchantment: while enchanted, bonus attack speed and bonus magic damage on attacks
// (on-hit) and basic abilities (a hook). The enchantment lasts until replaced, so the buff is long-lived.
const enchant: BuffSpec = {
  id: 'qiyanaEnchant',
  label: 'Enchantment',
  duration: 600,
  stats: { attackSpeed: 'W.dv.AttackSpeed' },
  onHit: [{ id: 'enchant', label: 'Terrashape (enchanted)', type: 'magic', amount: 'W.calc.OnHitDamage', proc: true }],
};

const kit: ChampionKit = {
  id: 'Qiyana',
  status: 'curated',
  notes: [
    'Royal Privilege procs on the first attack or ability against the target, then has a 25s per-target cooldown (tooltip text).',
    'Terrashape to a different element resets Royal Privilege (option "wNewElement", on by default).',
    'Default Elemental Wrath is the Rock enchantment (bonus damage below 50% health); use Q:ice / Q:grass / Q:vanilla for the others.',
  ],
  options: [
    { key: 'enchanted', label: 'Weapon enchanted at combo start', default: 1, toggle: true, description: 'Terrashape passive (attack speed + on-hit) is active before the first cast.' },
    { key: 'wNewElement', label: 'Terrashape picks a new element', default: 1, toggle: true, description: 'Resets Royal Privilege on the target when Terrashape is cast.' },
  ],
  marks: [
    {
      // Single-stack mark: the first qualifying hit procs the passive, then a 25s per-target cooldown.
      id: 'royalPrivilege',
      label: 'Royal Privilege',
      maxStacks: 1,
      duration: 25,
      appliedBy: ['attack', 'ability'],
      atMax: {
        consume: true,
        cooldown: 25,
        components: [{ id: 'privilege', label: 'Royal Privilege', type: 'physical', amount: 'P.calc.FinalDamage', proc: true }],
      },
    },
  ],
  abilities: {
    Q: {
      notes: ['Rock: the bonus damage (Q+tremor) applies only if the target is below 50% health when the rocks explode (0.4s later).'],
      components: [
        { id: 'blast', label: 'Edge of Ixtal (rock)', type: 'physical', amount: 'calc.EnchantedDamage', aoe: true, delay: 0.1 },
        {
          id: 'tremor',
          label: 'Rock shatter',
          type: 'physical',
          amount: 'target.hpPct < dv.CritThreshold ? calc.TremorDamage : 0',
          aoe: true,
          optional: true,
          delay: '0.1 + dv.RockExplosionDelay',
          condition: 'target below 50% health (checked when the rocks explode)',
        },
      ],
      variants: {
        ice: {
          label: 'ice',
          spell: 'QiyanaQ_Water',
          cc: [{ kind: 'immobilize', duration: 'dv.RootDuration' }, { kind: 'slow', duration: 'dv.RootDuration + dv.SlowDuration' }],
          components: [{ id: 'blast', label: 'Edge of Ixtal (ice)', type: 'physical', amount: 'calc.EnchantedDamage', aoe: true, delay: 0.1 }],
        },
        grass: {
          label: 'grass',
          spell: 'QiyanaQ_Grass',
          components: [{ id: 'blast', label: 'Edge of Ixtal (grass)', type: 'physical', amount: 'calc.EnchantedDamage', aoe: true, delay: 0.1 }],
        },
        vanilla: {
          label: 'no enchantment',
          components: [{ id: 'slash', label: 'Elemental Wrath', type: 'physical', amount: 'calc.VanillaDamage', aoe: true }],
        },
      },
    },
    W: {
      dash: true,
      noTarget: true,
      notes: ['Dashes, enchants the weapon (attack speed, bonus magic damage on attacks and once per Q or E cast) and refreshes Elemental Wrath\'s cooldown.'],
      buff: enchant,
      components: [],
    },
    E: {
      dash: true,
      components: [{ id: 'dash', label: 'Audacity', type: 'physical', amount: 'calc.Damage', delay: 0.15 }],
    },
    R: {
      notes: [
        'Assumes the target is pinned near the terrain edge: maximum stun duration. Knock-back plus stun.',
        'A second explosion from river/brush along the path is not modeled (one explosion per target).',
      ],
      cc: [{ kind: 'immobilize', duration: 'dv.StunDuration' }],
      components: [
        { id: 'explosion', label: 'Supreme Display of Talent', type: 'physical', amount: 'calc.Damage + calc.MissingHealthDamageRock * target.maxHp', aoe: true, delay: 0.5 },
      ],
    },
  },
  hooks: {
    // Start enchanted (option) — the enchantment is usually picked up before a fight.
    onStart(sim) {
      if (sim.opt.enchanted && sim.rankOf('W') > 0) sim.applyBuff(enchant, 'W', sim.spellFor('W'), sim.rankOf('W'));
    },
    // The enchantment's bonus damage also lands with basic abilities (wiki), once per cast.
    afterDamage(sim, inst) {
      if (inst.fromMark || inst.flags.kind !== 'ability' || (inst.flags.slot !== 'Q' && inst.flags.slot !== 'E') || !sim.getBuff(enchant.id)) return;
      if (sim.counter(`qiyanaW:${inst.castId}`)) return;
      sim.setCounter(`qiyanaW:${inst.castId}`, 1);
      sim.deal({
        source: 'W',
        sourceLabel: enchant.label,
        label: 'Terrashape (enchanted)',
        type: 'magic',
        amount: sim.evalExpr('W.calc.OnHitDamage', { slot: 'W' }),
        castId: inst.castId,
        flags: { kind: 'ability', slot: 'W', ability: false, proc: true },
      });
    },
    // Terrashape refreshes Q's cooldown and (new element) resets Royal Privilege.
    onCast(sim, cast) {
      if (cast.slot !== 'W') return;
      sim.startCooldown('ability:Q', 0);
      if (sim.opt.wNewElement) {
        sim.setMarkStacks('royalPrivilege', 0);
        sim.setMarkCooldown('royalPrivilege', 0);
      }
    },
  },
};
export default kit;
