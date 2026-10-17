import type { ChampionKit } from '../../engine/kit-types.ts';
import type { Sim } from '../../engine/sim.ts';

// Kayle — patch 16.20.
// Divine Ascent: each attack grants a Zealous stack (attack speed, max 5); at 5 stacks Kayle is
// Exalted. From level 11 Exalted attacks also launch a fire wave (including the attack that reaches
// the 5th stack); from level 16 she is permanently Exalted.
const pdv = (sim: Sim, name: string) => sim.dataValue(sim.spellFor('P'), name, 1);
const zealousStacks = (sim: Sim) => (sim.level >= pdv(sim, 'LevelForPassiveRank3') ? pdv(sim, 'EnrageMaxStacks') : (sim.markStacks('zealous') ?? 0));

const kit: ChampionKit = {
  id: 'Kayle',
  status: 'curated',
  notes: [
    'Zealous stacks start at 0 (level 16+: permanently Exalted). Stacks are tracked as a mark on the target (single target, same result).',
    'Aflame fire waves (level 11+) are a separate magic hit that can crit, fired by Exalted attacks and by the attack that reaches 5 stacks.',
  ],
  marks: [{ id: 'zealous', label: 'Zealous', maxStacks: 'P.dv.EnrageMaxStacks', duration: 'P.dv.EnrageDuration', appliedBy: ['attack'] }],
  attack: {
    // Starfire Spellblade passive. The wiki: "Proc damage for the passive's on-hit effect."
    onHit: [{ id: 'starfire', label: 'Starfire Spellblade', slot: 'E', type: 'magic', amount: 'E.rank > 0 ? E.calc.EPassiveTotalDamage : 0', proc: true }],
  },
  abilities: {
    Q: {
      cc: [{ kind: 'slow', duration: 'dv.SlowDuration' }],
      debuff: { id: 'kayleQ', label: 'Radiant Blast shred', duration: 'dv.ShredDuration', armorReduction: 'dv.ShredPercent / 100', mrReduction: 'dv.ShredPercent / 100' },
      // The portal launches the sword dv.CastDelay (0.25s) after the cast starts (wiki), as the cast time ends.
      components: [{ id: 'blast', label: 'Radiant Blast', type: 'magic', amount: 'calc.TotalDamage', travel: true }],
    },
    W: { noTarget: true, components: [] },
    E: {
      resetsAttack: true,
      notes: ['Active: next attack within 6s deals bonus missing-health magic damage (resets the attack timer). Use "E AA".'],
      buff: {
        id: 'kayleE',
        label: 'Starfire Spellblade',
        duration: 6,
        empowerAttacks: {
          count: 1,
          resetsAttack: true,
          // The wiki: the attack's physical damage is basic and spell damage; "Proc damage for the
          // active's on-hit effect."
          spell: true,
          components: [{ id: 'execute', label: 'Starfire Spellblade (active)', type: 'magic', amount: 'E.calc.ActiveTotalExecuteDamage * target.missingHp', aoe: true, proc: true }],
        },
      },
    },
    R: {
      notes: ['Damage lands 2.5s after the cast starts (end of the invulnerability), around the protected ally (usually Kayle herself).'],
      components: [{ id: 'judgment', label: 'Divine Judgment', type: 'magic', amount: 'calc.TotalDamage', aoe: true, delay: 'dv.InvulnDuration - castTime' }],
    },
  },
  hooks: {
    // Zealous attack speed (stacks live on a mark; dynamicStats must not evaluate stat-based expressions).
    dynamicStats(sim) {
      const stacks = zealousStacks(sim);
      return stacks > 0 ? { attackSpeed: (stacks * pdv(sim, 'EnrageASPerStack')) / 100 } : {};
    },
    // Aflame fire wave: only exists from level 11 and only while Exalted, so a hook avoids zero-damage hits.
    onAttack(sim, atk) {
      if (atk.fromAbility || atk.phantom || sim.level < pdv(sim, 'LevelForPassiveRank2')) return;
      if (zealousStacks(sim) + 1 < pdv(sim, 'EnrageMaxStacks')) return;
      atk.extra.push({
        source: 'P',
        sourceLabel: 'Divine Ascent',
        label: 'Aflame wave',
        type: 'magic',
        amount: sim.evalExpr('P.calc.PassiveWaveDamage', { slot: 'P' }) * atk.critFactor,
        castId: atk.castId,
        flags: { kind: 'ability', slot: 'P', ability: true, aoe: true, crit: atk.crit },
      });
    },
  },
};
export default kit;
