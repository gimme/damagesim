import type { ChampionKit } from "../../engine/kit-types.ts";
import type { Sim } from "../../engine/sim.ts";
import type { DamageInstance } from "../../engine/effects.ts";

// Kennen — patch 16.20.
// Mark of the Storm: ability hits (and the Electrical Surge empowered attack) add a stack for 6s;
// 3 stacks stun (1.25s, 0.5s if stunned again within 6s) and consume the stacks. Slicing Maelstrom
// adds a stack per bolt but at most 3 per cast. Implemented in a hook because a mark cannot apply
// crowd control. `stacks.storm` reads the current count.
const SURGE = "Electrical Surge (passive)";

function addStormStack(sim: Sim, inst: DamageInstance) {
  const p = sim.spellFor("P");
  const dv = (n: string) => sim.dataValue(p, n, 1);
  if (inst.flags.slot === "R") {
    // At most 3 stacks per Slicing Maelstrom cast.
    if (sim.counter("storm.rCast") !== inst.castId) {
      sim.counters.set("storm.rCast", inst.castId);
      sim.counters.set("storm.rCount", 0);
    }
    if (sim.counter("storm.rCount") >= 3) return;
    sim.counters.set("storm.rCount", sim.counter("storm.rCount") + 1);
  } else {
    // One stack per cast for every other ability.
    if (sim.counters.get("storm.lastCast") === inst.castId) return;
    sim.counters.set("storm.lastCast", inst.castId);
  }
  let stacks = sim.time > sim.counter("stormExpires") ? 0 : sim.counter("storm");
  stacks += 1;
  sim.counters.set("stormExpires", sim.time + dv("MarkDuration"));
  if (stacks >= 3) {
    const last = sim.counters.has("storm.lastStun") ? sim.counter("storm.lastStun") : -Infinity;
    const duration = sim.time - last <= dv("DiminishingReturnDuration") ? dv("ReducedStunDuration") : dv("StunDuration");
    sim.applyCC("immobilize", duration, inst.castId, "P");
    sim.counters.set("storm.lastStun", sim.time);
    stacks = 0;
  }
  sim.setCounter("storm", stacks);
}

const kit: ChampionKit = {
  id: "Kennen",
  status: "curated",
  notes: [
    "Mark of the Storm stacks/stuns are handled by a hook (stun = immobilize for Aftershock etc.); energy is not modelled.",
    "Electrical Surge passive (every 5th attack) uses the expected crit value of its 140% crit multiplier (W.calc.TotalDamagePassiveCrit).",
  ],
  attack: {
    everyNth: {
      n: 5,
      label: "Electrical Surge",
      components: [
        {
          id: "surge",
          label: SURGE,
          type: "magic",
          amount: "W.rank > 0 ? W.calc.TotalDamagePassive * (1 + critChance * (W.calc.TotalDamagePassiveCrit / W.calc.TotalDamagePassive - 1)) : 0",
        },
      ],
    },
  },
  abilities: {
    Q: {
      // Thrown as the cast time starts (wiki: {{Effect at cast time start}}): lands its flight to the
      // target after the cast starts.
      components: [{ id: "shuriken", label: "Thundering Shuriken", type: "magic", amount: "calc.TotalDamage", travel: "reach / missileSpeed - castTime" }],
    },
    W: {
      notes: ["Active only damages a target that has Mark of the Storm stacks or stands in Slicing Maelstrom (0 damage otherwise)."],
      components: [
        {
          id: "surge",
          label: "Electrical Surge",
          type: "magic",
          // Checked when the blast lands (a Q cast just before may still be in flight at cast time).
          amount: "(stacks.storm > 0 && time <= stacks.stormExpires) || buff.kennenR ? calc.TotalDamageActive : 0",
          aoe: true,
        },
      ],
    },
    E: {
      // No cast time: Kennen runs as lightning, unable to attack (wiki; he can cast), until he ends it
      // with the recast after 0.5s. The attack speed starts when the ball ends.
      attackLockout: 0.5,
      notes: ["Hits the target as it starts (he runs through it at once); the ball is ended as early as it can be (0.5s), then +attack speed for 4s."],
      buff: { id: "kennenE", label: "Lightning Rush", duration: "dv.DurationAfterBall + 0.5", stats: { attackSpeed: "dv.TotalAS" } },
      components: [{ id: "rush", label: "Lightning Rush", type: "magic", amount: "calc.TotalDamage", aoe: true }],
    },
    R: {
      notes: ["6 bolts (every 0.5s for 3s), each 10% stronger than the previous one; adds up to 3 Mark of the Storm stacks."],
      buff: { id: "kennenR", label: "Slicing Maelstrom", duration: "dv.KennenRDuration", stats: { armor: "dv.KennenRDefenses", mr: "dv.KennenRDefenses" } },
      components: [
        {
          id: "bolt",
          label: "Slicing Maelstrom",
          type: "magic",
          amount: "calc.PerTickDamageCalculated * (1 + dv.DamageAmp * hit)",
          hits: "dv.KennenRDuration / dv.KennenRTickRate",
          interval: "dv.KennenRTickRate",
          delay: "dv.KennenRTickRate",
          aoe: true,
        },
      ],
    },
  },
  hooks: {
    afterDamage(sim, inst) {
      if (inst.fromMark || inst.flags.proc || !(inst.raw > 0)) return;
      const ability =
        inst.flags.kind === "ability" && (inst.flags.slot === "Q" || inst.flags.slot === "W" || inst.flags.slot === "E" || inst.flags.slot === "R");
      if (ability || inst.label === SURGE) addStormStack(sim, inst);
    },
  },
};
export default kit;
