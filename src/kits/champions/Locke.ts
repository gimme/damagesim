import type { ChampionKit } from '../../engine/kit-types.ts';
import { addOnHitRepeat } from '../../engine/effects.ts';
import type { Sim } from '../../engine/sim.ts';

// Locke — patch 16.20.
// Soul Nails stacks (Q) and Purgatory's execute (R) are tracked in hooks: nail consumption damage
// depends on the stack count, which a consumable debuff can't read.

const NAILS = 'locke:nails';
const NAILS_UNTIL = 'locke:nailsUntil';
const nailStacks = (sim: Sim) => (sim.time <= sim.counter(NAILS_UNTIL) + 1e-9 ? sim.counter(NAILS) : 0);

const kit: ChampionKit = {
  id: 'Locke',
  status: 'curated',
  notes: [
    'Silver Stake on-hit is assumed to scale linearly from min (full health) to max (0 health) with the target\'s missing health.',
    'Ritual Nails: each cast throws one nail (Q Q Q for all three); each nail hit adds a Soul Nails stack (max 3). The next attack or Ashen Pursuit hit consumes all stacks for Q.calc.NailDamage per stack, +20%/+40% for 2/3 stacks.',
    'Purgatory: while marked (dv.Duration), any hit that leaves the target below the execute threshold executes it (true damage).',
    'Soul Ignition\'s self-damage and healing are not modeled.',
  ],
  options: [{ key: 'sealedStacks', label: 'Sealed champions (R stacks)', default: 0, min: 0, max: 50, description: 'Permanent Purgatory execute-threshold stacks.' }],
  buffStacks: { '{b5c3348f}': 'opt.sealedStacks' },
  attack: {
    onHit: [{ id: 'stake', label: 'Silver Stake', type: 'magic', amount: 'lerp(P.calc.MinOnHitDamage, P.calc.MaxOnHitDamage, target.missingHpPct)', proc: true }],
  },
  hooks: {
    preAttack(sim, atk) {
      // Ashen Pursuit's dash applies on-hit effects to the target on top of the attack that follows it.
      if (atk.extra.some((x) => x.label === 'Ashen Pursuit (dash)')) addOnHitRepeat(atk);
    },
    afterDamage(sim, inst) {
      if (inst.fromMark) return;
      // Soul Nails: a nail hit adds a stack; the next attack or E hit consumes them all.
      const n = nailStacks(sim);
      if (inst.flags.slot === 'Q' && inst.flags.kind === 'ability' && !inst.flags.attack) {
        sim.setCounter(NAILS, Math.min(sim.evalExpr('Q.dv.MaxStacks', { slot: 'Q' }), n + 1));
        sim.setCounter(NAILS_UNTIL, sim.time + sim.evalExpr('Q.dv.NailDuration', { slot: 'Q' }));
      } else if (n > 0 && (inst.flags.attack || (inst.flags.slot === 'E' && inst.flags.kind === 'ability'))) {
        sim.setCounter(NAILS, 0);
        const bonus = n >= 3 ? 'Q.dv.ThreeMarkBonusPercent' : n === 2 ? 'Q.dv.TwoMarkBonusPercent' : '0';
        sim.deal({
          source: 'Q',
          sourceLabel: 'Ritual Nails',
          label: `Soul Nails ×${n}`,
          type: 'magic',
          amount: sim.evalExpr(`Q.calc.NailDamage * ${n} * (1 + ${bonus} / 100)`, { slot: 'Q' }),
          flags: { kind: 'ability', slot: 'Q', ability: true },
          markSource: 'soulNails',
        });
      }
      // Purgatory execute.
      if (sim.getDebuff('purgatory') && sim.target.hp > 0 && sim.target.hp <= sim.evalExpr("calc['{6c540a3a}'] * target.maxHp", { slot: 'R' })) {
        sim.deal({
          source: 'R',
          sourceLabel: 'Purgatory',
          label: 'Purgatory (sealed)',
          type: 'true',
          amount: sim.target.hp,
          flags: { kind: 'ability', slot: 'R', ability: false },
          markSource: 'purgatory',
        });
      }
    },
  },
  abilities: {
    Q: {
      recasts: 3,
      recastDelay: 0.5, // static 0.5s between nails (wiki)
      notes: ['One nail per cast: write Q Q Q AA for three nails and the consuming attack.'],
      cc: [{ kind: 'slow', duration: 'dv.SlowDuration1' }],
      // Thrown as the cast time starts (wiki: {{Effect at cast time start}}): lands its flight after the cast starts.
      components: [{ id: 'nail', label: 'Ritual Nail', type: 'magic', amount: 'calc.MissileDamage', travel: 'max(0, reach / missileSpeed - castTime)', aoe: true }],
    },
    W: {
      noTarget: true,
      notes: ['Attack speed decays over dv.DecayTimeHelper seconds: modeled as the full bonus for dv.TimeMaxPower + dv.DecayTime/2 seconds.'],
      buff: { id: 'soulIgnition', label: 'Soul Ignition', duration: 'dv.TimeMaxPower + dv.DecayTime / 2', stats: { attackSpeed: 'calc.AttackSpeed' } },
      components: [],
    },
    E: {
      dash: true,
      notes: [
        'Blink damage on arrival, then the next attack (E AA) dashes to the target for extra magic damage and applies on-hit effects once more before the attack lands.',
        'Each E hit consumes Soul Nails.',
      ],
      buff: {
        id: 'ashenPursuit',
        label: 'Ashen Pursuit',
        duration: 4,
        empowerAttacks: { count: 1, components: [{ id: 'dash', label: 'Ashen Pursuit (dash)', type: 'magic', amount: 'E.calc.DashDamage' }] },
      },
      components: [{ id: 'blink', label: 'Ashen Pursuit', type: 'magic', amount: 'calc.OnHitDamage', aoe: true }],
    },
    R: {
      cc: [{ kind: 'slow', duration: 'dv.SlowDuration' }],
      debuff: { id: 'purgatory', label: 'Purgatory mark', duration: 'dv.Duration', applyBeforeHit: true },
      // The totem flies to the spot over 0.5s and fires its nails 0.25s after landing (wiki).
      components: [{ id: 'artifact', label: 'Purgatory', type: 'magic', amount: 'calc.Damage', delay: 0.75, aoe: true }],
    },
  },
};
export default kit;
