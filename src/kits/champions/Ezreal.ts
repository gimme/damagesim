import type { ChampionKit } from "../../engine/kit-types.ts";
import type { Sim } from "../../engine/sim.ts";

// Ezreal — patch 16.20.
// Hooks: Rising Spell Force (attack speed per ability hit, stacking, refreshing) — a self stat that
// depends on combo state, which `stats`/buffs can't stack; Mystic Shot's cooldown refund on hit.

const kit: ChampionKit = {
  id: "Ezreal",
  status: "curated",
  notes: [
    "Rising Spell Force: every ability cast that hits grants a stack (P.dv.AttackSpeedPerStack attack speed, P.dv.MaxStacks max, P.dv.StackDuration refreshing).",
    "Essence Flux sticks to the target and is detonated by the next attack or ability hit from another cast.",
    "Mystic Shot hitting reduces the current cooldowns of all abilities (itself and R included) by Q.dv.CDRefund s.",
  ],
  abilities: {
    Q: {
      notes: ["Applies on-hit effects; cannot crit."],
      components: [{ id: "shot", label: "Mystic Shot", type: "physical", amount: "calc.Damage", onHit: true, onAttack: true, travel: true }],
    },
    W: {
      notes: ["The orb deals no damage itself; detonation by a later attack or ability."],
      debuff: {
        id: "essenceFlux",
        label: "Essence Flux",
        duration: "dv.DetonationTimeout",
        consume: { by: ["attack", "ability"], components: [{ id: "detonate", label: "Essence Flux", type: "magic", amount: "W.calc.Damage" }] },
      },
      components: [],
    },
    E: {
      dash: true,
      notes: ["Blink, then a homing bolt at the nearest enemy (prioritizes Essence Flux targets)."],
      // The bolt flies to the target (in its 750 range, wiki) at the missile's speed.
      components: [{ id: "bolt", label: "Arcane Shift", type: "magic", amount: "calc.Damage", travel: "min(distance, 750) / missileSpeed" }],
    },
    R: {
      notes: ["Damage reduction per additional unit hit is ignored (single target)."],
      // Global: flies to the target at the missile's speed.
      components: [{ id: "barrage", label: "Trueshot Barrage", type: "magic", amount: "calc.Damage", aoe: true, travel: "distance / missileSpeed" }],
    },
  },
  hooks: {
    onCast(sim: Sim, cast) {
      if (!cast.hitsTarget || cast.slot === "P") return;
      const max = sim.evalExpr("P.dv.MaxStacks", { slot: "P" });
      sim.setCounter("ezrealP", Math.min(max, sim.counter("ezrealP") + 1));
      sim.setCounter("ezrealP.until", sim.time + sim.evalExpr("P.dv.StackDuration", { slot: "P" }));
    },
    afterDamage(sim: Sim, inst) {
      if (inst.flags.slot !== "Q" || inst.flags.kind !== "ability" || inst.fromMark || sim.counter("ezrealQ.lastCast") === inst.castId) return;
      sim.setCounter("ezrealQ.lastCast", inst.castId);
      const refund = sim.evalExpr("Q.dv.CDRefund", { slot: "Q" });
      for (const s of ["Q", "W", "E", "R"]) {
        const remaining = sim.cooldownReadyAt(`ability:${s}`) - sim.time;
        if (remaining > 0) sim.startCooldown(`ability:${s}`, Math.max(0, remaining - refund));
      }
    },
    dynamicStats(sim: Sim) {
      // No evalExpr here (it reads stats): use the raw data value.
      if (sim.time > sim.counter("ezrealP.until")) return;
      const per = sim.dataValue(sim.spellFor("P"), "AttackSpeedPerStack", 1);
      return { attackSpeed: per * sim.counter("ezrealP") };
    },
  },
};
export default kit;
