import type { BuffSpec, CCSpec, ChampionKit, ComponentSpec } from '../../engine/kit-types.ts';

// Udyr — patch 16.20.
// Each stance empowers the next two attacks; switching stance replaces those empowered attacks (one
// shared buff id), while timed effects (Claw attack speed / on-hit, the storm) keep running.
// Awakened casts (Q:awakened …) recast a stance that is on cooldown. Monk Training (+AS for the next
// two attacks) follows every cast.
const stanceAttacks = (label: string, duration: string, components: ComponentSpec[], cc?: CCSpec[]): BuffSpec => ({
  id: 'stanceAttacks',
  label,
  duration,
  empowerAttacks: { count: 2, components, ...(cc ? { cc } : {}) }, // "next two Attacks" (tooltip)
});

const clawAttacks = stanceAttacks('Wilding Claw', 'Q.dv.AttackSpeedDurationBase', [
  { id: 'claw', label: 'Wilding Claw (max HP)', type: 'physical', amount: 'Q.calc.MaxHPOnHit1 * target.maxHp' },
]);
const clawAttacksAwakened = stanceAttacks('Wilding Claw (awakened)', 'Q.dv.AttackSpeedDurationEmpowered', [
  { id: 'claw', label: 'Wilding Claw (max HP)', type: 'physical', amount: 'Q.calc.Q2TotalOnHitHPDamage * target.maxHp' },
]);
// Awakened Claw: the next two attacks (in any stance) each call 6 lightning strikes on an isolated
// target, the first at once and the rest every 0.2s (wiki).
const lightning: BuffSpec = {
  id: 'udyrLightning',
  label: 'Awakened Wilding Claw',
  duration: 'Q.dv.AttackSpeedDurationEmpowered',
  empowerAttacks: { count: 2, components: [{ id: 'lightning', label: 'Awakened Wilding Claw (lightning)', type: 'magic', amount: 'Q.calc.EmpoweredLightningBonus * target.maxHp', hits: 'Q.dv.Bounces', interval: 0.2 }] },
};
const mantleAttacks = stanceAttacks('Iron Mantle', 'W.dv.ShieldDuration', []);
// Stampede: the empowered attack dashes and stuns (per-target cooldown ≥ 4.4s, so one stun per cast).
const stampedeAttacks: BuffSpec = {
  id: 'stanceAttacks',
  label: 'Blazing Stampede',
  duration: 'E.dv.MoveSpeedDuration',
  empowerAttacks: { count: 1, components: [], cc: [{ kind: 'immobilize', duration: 'E.dv.StunDuration' }] },
};
const stormAttacks = stanceAttacks('Wingborne Storm', 'R.dv.BuffDuration', [{ id: 'pulse', label: 'Wingborne Storm (pulse)', type: 'magic', amount: 'R.calc.PulseDamage', aoe: true }]);
const monkTraining: BuffSpec = {
  id: 'monkTraining',
  label: 'Monk Training',
  duration: 'P.dv.AttackSpeedDuration',
  stats: { attackSpeed: 'P.calc.AttackSpeed' },
  empowerAttacks: { count: 2, components: [] },
};

const clawBuff = (awakened: boolean): BuffSpec => ({
  id: 'clawStance',
  label: 'Claw Stance',
  duration: awakened ? 'dv.AttackSpeedDurationEmpowered' : 'dv.AttackSpeedDurationBase',
  stats: { attackSpeed: awakened ? 'calc.EmpoweredTotalAS' : 'dv.AttackSpeedBase' },
  onHit: [{ id: 'clawOnHit', label: 'Wilding Claw', type: 'physical', amount: 'Q.calc.OnHitDamage' }],
});

// Wiki: a Stance can be recast to Awaken it 0.25s after it's entered (the stances are instant casts).
const AWAKEN_AFTER = 0.25;

// Storm: ticks every 0.5s for dv.BuffDuration (wiki); the target is assumed to stay in it.
const STORM_TICKS = 'dv.BuffDuration * 2';
const storm: ComponentSpec = { id: 'storm', label: 'Wingborne Storm', type: 'magic', amount: 'calc.StormDamage / 2', hits: STORM_TICKS, interval: 0.5, delay: 0.5, dot: true, aoe: true };

const kit: ChampionKit = {
  id: 'Udyr',
  status: 'curated',
  notes: [
    'Stances empower the next two attacks; casting another stance replaces them (timed effects like Claw attack speed/on-hit and the storm continue). Monk Training: +30% attack speed for the next two attacks after every cast.',
    'Awakened casts: X:awakened (e.g. "Q Q:awakened"). Each stance allows one immediate recast so the awakened cast is not blocked by the stance cooldown; the Awaken cooldown itself is not enforced.',
    'Awakened Claw: the next two attacks each call 6 lightning strikes (0.2s apart) on an isolated target.',
    'Blazing Stampede: the next attack dashes and stuns. Iron Mantle shields/heals only.',
    'Wingborne Storm ticks every 0.5s for 4s; the target is assumed to stay inside. R is a basic ability (no ultimate haste).',
  ],
  abilities: {
    Q: {
      noTarget: true,
      recasts: 2,
      recastDelay: AWAKEN_AFTER,
      buff: [clawBuff(false), clawAttacks, monkTraining],
      components: [],
      variants: { awakened: { label: 'awakened', buff: [clawBuff(true), clawAttacksAwakened, lightning, monkTraining], components: [] } },
    },
    W: {
      noTarget: true,
      recasts: 2,
      recastDelay: AWAKEN_AFTER,
      buff: [mantleAttacks, monkTraining],
      notes: ['Iron Mantle: shield and life steal only.'],
      components: [],
      variants: { awakened: { label: 'awakened', components: [] } },
    },
    E: {
      noTarget: true,
      dash: true,
      recasts: 2,
      recastDelay: AWAKEN_AFTER,
      buff: [stampedeAttacks, monkTraining],
      components: [],
      variants: { awakened: { label: 'awakened', components: [] } },
    },
    R: {
      notUltimate: true,
      recasts: 2,
      recastDelay: AWAKEN_AFTER,
      buff: [stormAttacks, monkTraining],
      cc: [{ kind: 'slow', duration: 'dv.BuffDuration' }],
      components: [storm],
      variants: {
        awakened: {
          label: 'awakened',
          note: 'Unleashed storm follows the last attacked enemy and adds % max health damage over its duration.',
          components: [
            storm,
            { id: 'blast', label: 'Wingborne Storm (awakened)', type: 'magic', amount: `calc.PercentHPBlast * target.maxHp / (${STORM_TICKS})`, hits: STORM_TICKS, interval: 0.5, delay: 0.5, dot: true, aoe: true },
          ],
        },
      },
    },
  },
};
export default kit;
