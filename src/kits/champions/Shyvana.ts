import type { ChampionKit } from '../../engine/kit-types.ts';
import type { Sim } from '../../engine/sim.ts';

// Shyvana — patch 16.20.
// Dragon Form (R buff, or option "dragonForm" to start transformed) upgrades the basic abilities;
// expressions check `buff.dragonForm || opt.dragonForm`.

const DRAGON = '(buff.dragonForm || opt.dragonForm)';
const isDragon = (sim: Sim) => !!sim.getBuff('dragonForm') || !!sim.opt.dragonForm;

function reduceCooldown(sim: Sim, slot: 'Q' | 'W' | 'E' | 'R', seconds: number) {
  const key = `ability:${slot}`;
  const left = sim.cooldownReadyAt(key) - sim.time;
  if (left > 0) sim.startCooldown(key, Math.max(0, left - seconds));
}

const kit: ChampionKit = {
  id: 'Shyvana',
  status: 'curated',
  notes: [
    'Emberstrike passive: every attack deals % max health magic damage on-hit and reduces Q cooldown by 0.5s.',
    'Dragon Form lasts 100 Fury / drain rate (15s; Fury gained in form is ignored). Option "dragonForm" starts the combo transformed (bonus health/range included).',
    'Scalemail stacks (option) only add armor/MR.',
  ],
  options: [
    { key: 'dragonForm', label: 'Start in Dragon Form', default: 0, toggle: true },
    { key: 'scalemail', label: 'Scalemail stacks', default: 0, min: 0, max: 200, step: 1 },
  ],
  buffStacks: { '{bba88b2a}': 'opt.scalemail' },
  stats: ({ opt, ranks, evalExpr }) => ({
    armor: opt.scalemail * evalExpr('P.dv.BonusArmor'),
    mr: opt.scalemail * evalExpr('P.dv.BonusMagicResist'),
    ...(opt.dragonForm && ranks.R > 0 ? { hp: evalExpr('R.calc.Calc_Bonus_Health', 'R'), range: evalExpr('R.dv.BonusAttackRange', 'R') } : {}),
  }),
  attack: {
    // The wiki: "The passive on-hit damage applies proc damage" (the empowered strikes are spell damage).
    onHit: [{ id: 'ember', label: 'Emberstrike (passive)', slot: 'Q', type: 'magic', amount: 'Q.calc.Calc_Max_Health_Damage * target.maxHp', hits: 'Q.rank > 0 ? 1 : 0', proc: true }],
  },
  abilities: {
    Q: {
      resetsAttack: true,
      recasts: 2,
      notes: [
        'Each cast resets the attack timer and empowers the next attack with bonus physical damage (claw, then tail slam on recast). Write "Q AA Q AA".',
        'Dragon Form: after the recast\'s attack, the next attack also bites for true damage (150% of the strike) — write "Q AA Q AA AA" (the bite\'s own attack reset is not modeled).',
      ],
      buff: {
        id: 'shyvanaQ',
        label: 'Emberstrike',
        duration: 'dv.EnhanceDuration',
        empowerAttacks: {
          count: 1,
          resetsAttack: true,
          components: [{ id: 'strike', label: 'Emberstrike', type: 'physical', amount: 'Q.calc.Calc_Damage', canCrit: true }],
        },
      },
    },
    W: {
      notes: ['Detonation assumed when the effect ends (2.5s); it can be recast after 1s or detonates when the shield breaks.'],
      components: [{ id: 'detonate', label: 'Inferno Aegis', type: 'magic', amount: 'calc.Damage', aoe: true, delay: 'dv.Duration' }],
    },
    E: {
      notes: [
        'Dragon Form: 25% more damage. Optional "repeat" = a second explosion on the same target at 40% damage (unverified), optional "trail" = burning trail ticks (0.25s) while the target stands in it.',
      ],
      // Wiki: Dragon Form casts in 0.3333s and its fireball's range is 1000 at 1600 speed (800 at 1500 in
      // human form).
      castTime: `${DRAGON} ? 0.3333 : castTime`,
      cc: [{ kind: 'slow', duration: 'dv.SlowDuration' }],
      components: [
        {
          id: 'fireball',
          label: 'Molten Burst',
          type: 'magic',
          amount: `${DRAGON} ? calc.Calc_Dragon_Damage + calc.Calc_Max_Health_Dragon_Damage * target.maxHp : calc.Damage + calc.Calc_Max_Health_Damage * target.maxHp`,
          aoe: true,
          travel: `${DRAGON} ? min(distance, 1000) / 1600 : reach / missileSpeed`,
        },
        {
          id: 'repeat',
          label: 'Molten Burst (repeat explosion)',
          type: 'magic',
          amount: '(calc.Calc_Dragon_Damage + calc.Calc_Max_Health_Dragon_Damage * target.maxHp) * calc.Calc_Multihit_Efficacy',
          hits: `${DRAGON} ? 1 : 0`,
          optional: true,
          aoe: true,
          delay: 'dv.RepeatExplosionDelay',
          travel: 'min(distance, 1000) / 1600',
        },
        {
          id: 'trail',
          label: 'Molten Burst (trail)',
          type: 'magic',
          // Ticks every 0.25s (wiki).
          amount: 'calc.DamagePerSecond * 0.25',
          hits: `${DRAGON} ? dv.GroundLingerDuration / 0.25 : 0`,
          interval: 0.25,
          optional: true,
          dot: true,
          aoe: true,
          // First tick a tick after the impact.
          delay: 0.25,
          travel: 'min(distance, 1000) / 1600',
        },
      ],
    },
    R: {
      dash: true,
      // No dash speed in the data: ~0.4s after the cast time to land. Busy until then.
      lockout: 'castTime + 0.4',
      cc: [{ kind: 'immobilize', duration: 'dv.FearDuration' }],
      buff: {
        id: 'dragonForm',
        label: 'Dragon Form',
        // Requires 100 Fury; drains FuryDrainPerSecond.
        duration: '100 / dv.FuryDrainPerSecond',
        stats: { hp: 'calc.Calc_Bonus_Health', range: 'dv.BonusAttackRange' },
      },
      components: [{ id: 'descent', label: "Dragon's Descent", type: 'magic', amount: 'calc.Damage', aoe: true, delay: 0.4 }],
    },
  },
  hooks: {
    onCast(sim, cast) {
      if (cast.slot !== 'Q') return;
      // The simulator alternates first cast / recast (recasts: 2), so mirror it: odd casts are recasts.
      const n = sim.counter('shyQCasts');
      sim.setCounter('shyQCasts', n + 1);
      if (n % 2 === 1 && isDragon(sim)) sim.setCounter('shyBitePending', 1);
    },
    onAttack(sim, atk) {
      if (atk.fromAbility || atk.phantom) return;
      if (sim.counter('shyBiteArmed') > 0 && sim.time <= sim.counter('shyBiteUntil')) {
        sim.setCounter('shyBiteArmed', 0);
        atk.extra.push({
          source: 'Q',
          sourceLabel: 'Emberstrike',
          label: 'Emberstrike (bite)',
          type: 'true',
          amount: sim.evalExpr('Q.calc.Calc_Dragon_Form_Damage', { slot: 'Q' }),
          castId: atk.castId,
          flags: { kind: 'ability', slot: 'Q', onHit: true, ability: true },
        });
      } else if (sim.counter('shyBitePending') > 0 && !sim.getBuff('shyvanaQ')) {
        // The recast's empowered attack just landed: the bite empowers the next attack.
        sim.setCounter('shyBitePending', 0);
        sim.setCounter('shyBiteArmed', 1);
        sim.setCounter('shyBiteUntil', sim.time + sim.evalExpr('Q.dv.RecastDuration', { slot: 'Q' }));
      }
      if (sim.rankOf('Q') > 0) reduceCooldown(sim, 'Q', sim.evalExpr('Q.dv.Cooldown_Reduction', { slot: 'Q' }));
    },
  },
};
export default kit;
