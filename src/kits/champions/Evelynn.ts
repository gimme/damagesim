import type { ChampionKit, DebuffSpec } from '../../engine/kit-types.ts';
import type { DamageInstance } from '../../engine/effects.ts';
import type { Sim } from '../../engine/sim.ts';

// Evelynn — patch 16.20.
// Hooks: Hate Spike's mark (next 3 attacks/abilities deal bonus damage) and Allure's delayed expunge
// (charm + MR shred on the next hit once the mark is 2.5s old) are consumed by later hits, which the
// declarative debuff.consume (single use, fixed timing) can't express.

const Q_CASTS = 4; // dart + 3 recasts (tooltip: "Recast this Ability up to QStackCount times")
const Q_MARK_DURATION = 4; // wiki: the Hate Spike mark lasts 4 seconds (not in the data)
const W_EMPOWER_TIME = 2.5; // tooltip: "If the mark lasts at least 2.5 seconds"

const allureShred: DebuffSpec = { id: 'allure', label: 'Allure (MR shred)', duration: 'W.dv.ShredDuration', mrReduction: 'W.dv.MRShred' };

/** A hit by Evelynn that can consume a mark: a basic attack or a (non-passive) ability hit. */
function consumingHit(inst: DamageInstance): boolean {
  if (inst.fromMark || inst.flags.proc) return false;
  return inst.flags.attack || (inst.flags.kind === 'ability' && !!inst.flags.slot && inst.flags.slot !== 'P');
}

const kit: ChampionKit = {
  id: 'Evelynn',
  status: 'curated',
  notes: [
    'Hate Spike: the first cast (dart) marks the target; its next 3 attacks or ability hits (one per cast, from a later cast) deal the mark bonus. Write "Q Q Q Q" for dart + 3 recasts — the recast spikes consume the 3 stacks.',
    'Allure: write "W wait{2.5s} …" — the next attack/ability hit at least 2.5s after W charms and shreds MR; earlier it only slows.',
    'Whiplash defaults to the normal cast; use E:empowered for the Demon Shade dash (out of combat).',
  ],
  abilities: {
    Q: {
      recasts: Q_CASTS,
      notes: ['4 casts per cooldown: the dart (marks) and 3 recast spike volleys (each consumes a mark stack).'],
      // The dart is launched as the cast time starts ({{Effect at cast time start}}) and flies to the
      // target at its speed; the recast spikes have no speed in the data (they hit at the cast time's
      // end). The data's 0.3s cast time also applies to the recasts, which the wiki says have none.
      components: [{ id: 'spike', label: 'Hate Spike', type: 'magic', amount: 'calc.MissileDamage', travel: 'recast == 1 ? reach / missileSpeed - castTime : 0' }],
    },
    W: {
      noTarget: true,
      notes: [
        'Marks the target; the charm (dv.CharmDuration) and MR shred (dv.MRShred for dv.ShredDuration) apply on the next hit ≥2.5s after the cast (a hook), otherwise only the slow.',
      ],
    },
    E: {
      notes: ['Applies on-hit effects to the target.'],
      components: [
        { id: 'whip', label: 'Whiplash', type: 'magic', amount: 'dv.BaseDamage + calc.PercentHealthBaseTOOLTIP * target.maxHp', onHit: true },
      ],
      variants: {
        empowered: {
          label: 'empowered',
          spell: 'EvelynnE2',
          dash: true,
          note: 'Out of combat (Demon Shade): dashes to the target, higher damage.',
          components: [
            { id: 'whip', label: 'Whiplash (empowered)', type: 'magic', amount: 'dv.EmpoweredDamage + calc.PercentHealthEmpoweredTOOLTIP * target.maxHp', onHit: true, areaOnHit: true },
          ],
        },
      },
    },
    R: {
      dash: true,
      // Wiki: she blinks back 0.5s after the cast time; busy until then.
      lockout: 'castTime + 0.5',
      notes: ['Blinks backwards; damage is multiplied (calc.CritDamage) if the target is below dv.CritTreshold health when hit.'],
      components: [
        { id: 'caress', label: 'Last Caress', type: 'magic', amount: 'target.hpPct < dv.CritTreshold ? calc.CritDamage : calc.Damage', aoe: true },
      ],
    },
  },
  hooks: {
    onCast(sim: Sim, cast) {
      if (cast.slot === 'Q') {
        const n = sim.counter('evelynnQ.n');
        if (n === 0) sim.setCounter('evelynnQ.dart', cast.castId);
        sim.setCounter('evelynnQ.n', (n + 1) % Q_CASTS);
      } else if (cast.slot === 'W') {
        sim.setCounter('allure.castId', cast.castId);
        sim.setCounter('allure.castTime', sim.time);
        sim.setCounter('allure.until', sim.time + sim.evalExpr('W.dv.BuffDuration', { slot: 'W' }));
      }
    },
    afterDamage(sim: Sim, inst) {
      if (!consumingHit(inst)) return;
      // Hate Spike mark.
      if (inst.flags.slot === 'Q' && inst.castId === sim.counter('evelynnQ.dart')) {
        if (sim.counter('hateSpike.castId') !== inst.castId) {
          sim.setCounter('hateSpike.castId', inst.castId);
          sim.setCounter('hateSpike', 3); // "next 3 Attacks or Abilities"
          sim.setCounter('hateSpike.until', sim.time + Q_MARK_DURATION);
        }
      } else if (sim.counter('hateSpike') > 0 && sim.time <= sim.counter('hateSpike.until') && sim.counter('hateSpike.lastCast') !== inst.castId) {
        sim.setCounter('hateSpike', sim.counter('hateSpike') - 1);
        sim.setCounter('hateSpike.lastCast', inst.castId);
        sim.deal({
          source: 'Q',
          sourceLabel: 'Hate Spike',
          label: 'Hate Spike mark',
          type: 'magic',
          amount: sim.evalExpr('Q.calc.TotalBonusDamage', { slot: 'Q' }),
          castId: inst.castId,
          flags: { kind: 'ability', slot: 'Q', ability: true },
          markSource: 'hateSpike',
        });
      }
      // Allure expunge.
      const wCast = sim.counter('allure.castId');
      if (wCast && inst.castId !== wCast && sim.time <= sim.counter('allure.until')) {
        sim.setCounter('allure.castId', 0);
        const spell = sim.spellFor('W');
        const rank = sim.abilityRank('W');
        if (sim.time - sim.counter('allure.castTime') >= W_EMPOWER_TIME) {
          sim.applyCC('immobilize', sim.evalExpr('W.dv.CharmDuration', { slot: 'W' }), wCast, 'W');
          sim.applyDebuff(allureShred, 'W', spell, rank, wCast);
        } else {
          sim.applyCC('slow', sim.evalExpr('W.dv.SlowDuration', { slot: 'W' }), wCast, 'W');
        }
      }
    },
  },
};
export default kit;
