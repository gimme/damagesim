import type { ChampionKit, DebuffSpec } from '../../engine/kit-types.ts';
import type { Sim } from '../../engine/sim.ts';

// Wukong — patch 16.20.

// Crushing Blow's armor shred is applied by the empowered attack, after its damage (wiki).
const crushingBlowShred: DebuffSpec = { id: 'crushingBlow', label: 'Crushing Blow shred', duration: 'Q.dv.ShredDuration', armorReduction: 'Q.dv.ArmorShredPercent' };

function reduceQCooldown(sim: Sim) {
  const ready = sim.cooldownReadyAt('ability:Q');
  if (ready > sim.time) sim.startCooldown('ability:Q', Math.max(0, ready - sim.time - sim.evalExpr('Q.dv.CooldownDecrease', { slot: 'Q' })));
}

const kit: ChampionKit = {
  id: 'MonkeyKing',
  status: 'curated',
  notes: [
    'Crushing Blow\'s armor shred is applied after the empowered attack\'s damage. Each attack or (non-periodic) ability hit reduces Crushing Blow\'s cooldown by Q.dv.CooldownDecrease s.',
    'The Warrior Trickster clone is optional (W+clone): it attacks for dv.CloneDuration at Wukong\'s attack speed for dv.CloneDamageMod of his AD; its copies of Crushing Blow/Cyclone are not modeled.',
    'Stone Skin (armor/regen) is not modeled.',
  ],
  hooks: {
    onAttack(sim, atk) {
      if (atk.phantom || !atk.extra.some((x) => x.label === 'Crushing Blow')) return;
      sim.schedule(0, () => sim.applyDebuff(crushingBlowShred, 'Q', sim.spellFor('Q'), sim.rankOf('Q'), atk.castId));
    },
    afterDamage(sim, inst) {
      if (inst.fromMark || inst.flags.dot || inst.flags.pet) return;
      if (inst.flags.attack || (inst.flags.kind === 'ability' && inst.flags.slot && inst.flags.slot !== 'P' && inst.label !== 'Crushing Blow')) reduceQCooldown(sim);
    },
  },
  abilities: {
    Q: {
      resetsAttack: true,
      notes: ['Empowers the next attack with bonus physical damage (proc damage) and gives it extra range; follow Q with AA.'],
      buff: {
        id: 'crushingBlowBuff',
        label: 'Crushing Blow',
        duration: 'dv.BuffDuration',
        // The wiki: the attack is basic and spell damage, the bonus damage portion proc damage.
        empowerAttacks: { count: 1, resetsAttack: true, spell: true, components: [{ id: 'blow', label: 'Crushing Blow', type: 'physical', amount: 'Q.calc.BonusDamageTT', proc: true }] },
      },
    },
    W: {
      dash: true,
      noTarget: false,
      // He can cast any ability during the dash (wiki), not attack.
      attackLockout: 'castTime + castRange / missileSpeed',
      components: [
        {
          id: 'clone',
          label: 'Warrior Trickster clone',
          type: 'physical',
          amount: 'dv.CloneDamageMod * ad',
          hits: 'floor(dv.CloneDuration * as)',
          interval: '1 / as',
          delay: '1 / as',
          pet: true,
          optional: true,
          condition: 'the clone is in range and attacking the target',
        },
      ],
    },
    E: {
      dash: true,
      // No dash speed in the data: ~0.2s to arrive. Crushing Blow can be cast during the dash (wiki).
      attackLockout: 0.2,
      castLockout: { W: 0.2, R: 0.2 },
      buff: { id: 'nimbusStrike', label: 'Nimbus Strike', duration: 'dv.AttackSpeedDuration', stats: { attackSpeed: 'dv.AttackSpeed' } },
      components: [{ id: 'strike', label: 'Nimbus Strike', type: 'magic', amount: 'calc.TotalDamage', delay: 0.2 }],
    },
    R: {
      // Spinning: no attacks and abilities interrupt it, so the cast blocks for the spin.
      lockout: 'dv.SpinDuration',
      // Recast after 0.5s (or cast another ability) to end a spin early (wiki).
      variableDuration: true,
      minDuration: 0.5,
      recasts: 2,
      recastDelay: 'dv.LockoutTimeBetweenCasts',
      notes: ['Use R R for both spins (each knocks up). Ticks every dv.SecondsPerTick for dv.SpinDuration; set the seconds to end a spin early (R{1s}).'],
      cc: [{ kind: 'immobilize', duration: 'dv.KnockupDuration' }],
      components: [
        {
          id: 'spin',
          label: 'Cyclone',
          type: 'physical',
          amount: "(calc.DamagePerSecondTotal + calc['{26c20668}'] * target.maxHp) * dv.SecondsPerTick",
          hits: 'dv.SpinDuration / dv.SecondsPerTick',
          maxHits: 'dv.SpinDuration / dv.SecondsPerTick',
          interval: 'dv.SecondsPerTick',
          delay: 'dv.SecondsPerTick',
          aoe: true,
          dot: true,
        },
      ],
    },
  },
};
export default kit;
