import type { BuffSpec, ChampionKit } from '../../engine/kit-types.ts';
import type { Sim } from '../../engine/sim.ts';

// Jayce — patch 16.20.
// Two forms share the Q/W/E keys: the default casts are Mercury Hammer abilities, `:cannon` variants
// are Mercury Cannon abilities (spells JayceShockBlast / JayceHyperCharge / JayceAccelerationGate,
// evaluated at the slot's rank). R toggles the form (hook): it applies the transform's next-attack
// bonus and keeps a separate cooldown per form for Q/W/E.

// Cannon → Hammer: the next attack deals bonus magic damage (no time limit until it is used).
const toHammer: BuffSpec = {
  id: 'jayceHammerStrike',
  label: 'Transform: Mercury Hammer',
  duration: 600,
  empowerAttacks: { count: 1, components: [{ id: 'transform', label: 'Mercury Hammer (transform)', type: 'magic', amount: 'R.calc.Damage' }] },
};
// Hammer → Cannon: the next attack reduces armor and MR (hook: applied after that attack hits).
const toCannon: BuffSpec = { id: 'jayceShredNext', label: 'Transform: Mercury Cannon', duration: 600 };

const SLOTS = ['Q', 'W', 'E'] as const;

const kit: ChampionKit = {
  id: 'Jayce',
  status: 'curated',
  notes: [
    'Q/W/E = Mercury Hammer abilities, Q:cannon / W:cannon / E:cannon = Mercury Cannon abilities. R switches form (each form keeps its own cooldowns).',
    'Option "cannon" picks the starting form (default: Hammer). Write combos in a consistent form order, e.g. "E:cannon Q:cannon R Q AA E" (gate-boosted Shock Blast, then hammer).',
    'Shock Blast is boosted (calc.EmpoweredDamage) while an Acceleration Gate (E:cannon) is up — assumed to be fired through it.',
  ],
  options: [{ key: 'cannon', label: 'Start in Mercury Cannon form', default: 0, toggle: true }],
  abilities: {
    Q: {
      dash: true,
      // Wiki: leaps to the target over 0.5s and smashes on arrival; Lightning Field can be cast
      // during the dash (nothing else).
      attackLockout: 0.5,
      castLockout: { Q: 0.5, E: 0.5, R: 0.5 },
      cc: [{ kind: 'slow', duration: 'dv.SlowDuration' }],
      components: [{ id: 'skies', label: 'To the Skies!', type: 'physical', amount: 'calc.Damage', aoe: true, delay: 0.5 }],
      variants: {
        cannon: {
          label: 'cannon',
          spell: 'JayceShockBlast',
          attackLockout: 0,
          castLockout: {},
          cc: [],
          // Through the gate (assumed right in front of Jayce) the bolt flies its 1600 total range at
          // 2350 (wiki).
          components: [{ id: 'blast', label: 'Shock Blast', type: 'physical', amount: 'buff.jayceGate ? calc.EmpoweredDamage : calc.Damage', aoe: true, travel: 'buff.jayceGate ? 1600 / 2350 : castRange / missileSpeed' }],
        },
      },
    },
    W: {
      // Lightning Field has no cooldown in the data; 10s at all ranks (wiki). Hyper Charge uses its own.
      cooldown: 10,
      components: [
        // Lightning Field: calc.Damage over dv.Duration seconds, one tick per second (wiki).
        { id: 'field', label: 'Lightning Field', type: 'magic', amount: 'calc.Damage / dv.Duration', hits: 'dv.Duration', interval: 1, delay: 1, aoe: true, dot: true },
      ],
      variants: {
        cannon: {
          label: 'cannon',
          spell: 'JayceHyperCharge',
          cooldown: 'cooldown',
          resetsAttack: true,
          note: 'Hyper Charge: the next NumAttacks attacks deal ActualDamage instead of normal damage (can crit) at maximum attack speed.',
          // Explicit spell refs: empowered-attack components are evaluated against the slot's root spell.
          // spell['JayceHyperCharge'] (an unslotted spell) is evaluated at W's rank.
          buff: {
            id: 'hyperCharge',
            label: 'Hyper Charge',
            duration: "spell['JayceHyperCharge'].dv.Duration",
            stats: { attackSpeed: "spell['JayceHyperCharge'].dv.PercentIncreasedAS" },
            empowerAttacks: {
              count: "spell['JayceHyperCharge'].dv.NumAttacks",
              replaceBase: true,
              resetsAttack: true,
              // The wiki tags Hyper Charge proc, but the attacks work like regular attacks: no spell
              // effects, and they trigger runes.
              components: [{ id: 'charged', label: 'Hyper Charge', type: 'physical', amount: "spell['JayceHyperCharge'].calc.ActualDamage", canCrit: true, noProc: true }],
            },
          },
          components: [],
        },
      },
    },
    E: {
      // Wiki: unable to cast To the Skies! or Shock Blast for 0.4s after the 0.25s cast time.
      lockout: 0.65,
      cc: [{ kind: 'immobilize', duration: 'dv.KnockbackDuration' }],
      components: [{ id: 'blow', label: 'Thundering Blow', type: 'magic', amount: 'calc.FlatDamage + dv.PercHPDamage * target.maxHp' }],
      variants: {
        cannon: {
          label: 'cannon',
          spell: 'JayceAccelerationGate',
          lockout: 0, // not Thundering Blow's
          cc: [],
          note: 'Acceleration Gate: Shock Blasts cast while it stands are boosted.',
          buff: { id: 'jayceGate', label: 'Acceleration Gate', duration: "spell['JayceAccelerationGate'].dv.Duration" },
          components: [],
        },
      },
    },
    R: {
      noTarget: true,
      notes: [
        'To Hammer: next attack deals R.calc.Damage bonus magic damage. To Cannon: next attack reduces armor and MR by R.calc.RangedFormShred for R.dv.ShredDuration s.',
        'The Hammer stance armor/MR bonus is not modeled.',
      ],
      components: [],
    },
  },
  hooks: {
    onStart(sim) {
      sim.setCounter('jayce.cannon', sim.opt.cannon ? 1 : 0);
    },
    onCast(sim, cast) {
      if (cast.slot !== 'R') return;
      const toCannonForm = !sim.counter('jayce.cannon');
      sim.setCounter('jayce.cannon', toCannonForm ? 1 : 0);
      // Swap per-form cooldowns: save the current form's, restore the other form's.
      for (const s of SLOTS) {
        const key = `ability:${s}`;
        const current = sim.cooldownReadyAt(key);
        const other = sim.counter(`jayce.cd.${s}`);
        sim.setCounter(`jayce.cd.${s}`, Number.isFinite(current) ? current : 0);
        sim.startCooldown(key, Math.max(0, other - sim.time));
      }
      sim.removeBuff(toHammer.id);
      sim.removeBuff(toCannon.id);
      sim.applyBuff(toCannonForm ? toCannon : toHammer, 'R', sim.spellFor('R'), sim.abilityRank('R'));
    },
    onAttack(sim, atk) {
      if (atk.fromAbility || atk.phantom || !sim.getBuff(toCannon.id)) return;
      sim.removeBuff(toCannon.id);
      // Apply after this attack's damage.
      sim.schedule(0, () => applyShred(sim, atk.castId));
    },
  },
};

function applyShred(sim: Sim, castId: number) {
  const pct = sim.evalExpr('R.calc.RangedFormShred', { slot: 'R' });
  sim.addDebuff({ id: 'jayceShred', label: 'Mercury Cannon shred', expires: sim.time + sim.evalExpr('R.dv.ShredDuration', { slot: 'R' }), armorPct: pct, mrPct: pct, castId });
}
export default kit;
