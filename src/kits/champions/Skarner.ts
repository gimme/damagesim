import type { ChampionKit } from '../../engine/kit-types.ts';

// Skarner — patch 16.20.
// Threads of Vibration: attacks, Shattered Earth / Upheaval and Impale apply Quaking (4s, refreshed
// on every application, max 3). At 3 stacks the target burns for % max health magic damage over
// Quaking's duration (ticks every 0.5s); further hits refresh it (assumption: like a Darius bleed).
// Shattered Earth's third empowered attack is counted with a mark on the target.

const kit: ChampionKit = {
  id: 'Skarner',
  status: 'curated',
  notes: [
    'Quaking: one stack per attack / Q / R cast (4s, refreshed). At 3 stacks the target takes % max health magic damage over 4s (8 ticks); hits while at 3 stacks refresh the burn (assumption — the wiki does not say whether stacks are consumed).',
  ],
  marks: [
    {
      id: 'quaking',
      label: 'Threads of Vibration',
      maxStacks: 'P.dv.StacksToTriggerPassive',
      duration: 'P.dv.Duration',
      appliedBy: ['attack', 'Q', 'R'],
      dot: {
        interval: 'P.dv.TickFrequency',
        components: [
          {
            id: 'burn',
            label: 'Quaking',
            type: 'magic',
            amount: 'P.calc.PercentHealthDamage * target.maxHp * P.dv.TickFrequency / P.dv.Duration',
            hits: 'stacks.quaking >= P.dv.StacksToTriggerPassive ? 1 : 0',
            dot: true,
            noProc: true,
          },
        ],
      },
    },
    {
      // Counts Shattered Earth's empowered hits (reset on each Q cast); the third deals % max health and slows.
      id: 'shatteredEarth',
      label: 'Shattered Earth',
      slot: 'Q',
      maxStacks: 3,
      duration: 'dv.RockHoldDuration',
      appliedBy: ['Q'],
      atMax: {
        consume: true,
        cc: [{ kind: 'slow', duration: 'dv.SlowDuration' }],
        components: [{ id: 'final', label: 'Shattered Earth (final)', type: 'physical', amount: 'dv.MaxHPPercent * target.maxHp', aoe: true }],
      },
    },
  ],
  abilities: {
    Q: {
      resetsAttack: true,
      notes: [
        'Shattered Earth: next 3 attacks gain attack speed and bonus physical damage; the 3rd also deals % max health and slows. Write "Q AA AA AA".',
        'Q:throw = rip the boulder and throw it immediately (Upheaval): ability damage + % max health. Throwing after some empowered attacks needs the cooldown in this model.',
      ],
      buff: {
        id: 'skarnerQ',
        label: 'Shattered Earth',
        duration: 'dv.RockHoldDuration',
        stats: { attackSpeed: 'dv.AttackSpeed' },
        empowerAttacks: {
          // "next 3 Attacks" (tooltip text).
          count: 3,
          resetsAttack: true,
          components: [{ id: 'quake', label: 'Shattered Earth', type: 'physical', amount: 'Q.calc.AbilityDamage', aoe: true }],
        },
      },
      components: [],
      variants: {
        throw: {
          label: 'throw',
          buff: { id: 'skarnerQThrow', label: 'Upheaval', duration: 0 },
          cc: [{ kind: 'slow', duration: 'dv.SlowDuration' }],
          components: [{ id: 'upheaval', label: 'Upheaval', type: 'physical', amount: 'calc.AbilityDamage + dv.MaxHPPercent * target.maxHp', aoe: true, delay: 0.3 }],
        },
      },
    },
    W: {
      cc: [{ kind: 'slow', duration: 'dv.SlowDuration' }],
      components: [{ id: 'quake', label: 'Seismic Bastion', type: 'magic', amount: 'calc.Damage', aoe: true }],
    },
    E: {
      dash: true,
      // Charging until the wall hit.
      lockout: 0.75,
      notes: ['Assumes the dragged champion is slammed into a wall (no damage or stun otherwise).'],
      cc: [{ kind: 'immobilize', duration: 'dv.StunDuration' }],
      components: [{ id: 'pin', label: "Ixtal's Impact", type: 'physical', amount: 'calc.PinDamage', delay: 0.75 }],
    },
    R: {
      cc: [{ kind: 'immobilize', duration: 'dv.Duration' }],
      components: [{ id: 'impale', label: 'Impale', type: 'magic', amount: 'calc.Damage', aoe: true }],
    },
  },
  hooks: {
    // A new Shattered Earth starts its count from zero.
    onCast(sim, cast) {
      if (cast.slot !== 'Q') return;
      const m = sim.marks.get('shatteredEarth');
      if (m) {
        m.stacks = 0;
        m.castIds.clear();
      }
    },
  },
};
export default kit;
