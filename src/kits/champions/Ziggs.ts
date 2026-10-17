import type { ChampionKit } from "../../engine/kit-types.ts";

// Ziggs — patch 16.20.
// Short Fuse: a 1-stack mark consumed by the next attack, with the passive's cooldown; each ability
// cast shortens the remaining cooldown by SpellCdr (hook — mark cooldowns can't be reduced declaratively).

// Mega Inferno Bomb lands 1.617s after the cast starts within 2700 units, farther at its speed (wiki).
const R_TRAVEL = "max(1.617 - castTime, reach / missileSpeed)";

const kit: ChampionKit = {
  id: "Ziggs",
  status: "curated",
  notes: [
    "Short Fuse is ready at combo start; each ability cast reduces its cooldown by SpellCdr seconds.",
    "Hexplosive Minefield: one full-damage mine plus 2 reduced mines by default (E{extra:N} for more, up to 10).",
    "Mega Inferno Bomb: center hit by default; R:edge for the outer ring.",
  ],
  marks: [
    {
      id: "shortFuse",
      label: "Short Fuse",
      maxStacks: 1,
      duration: 1,
      appliedBy: ["attack"],
      atMax: {
        components: [{ id: "fuse", label: "Short Fuse", type: "magic", amount: "P.calc.TotalDamage", proc: true }],
        consume: true,
        cooldown: "P.cooldown",
      },
    },
  ],
  hooks: {
    onCast(sim, cast) {
      const m = sim.marks.get("shortFuse");
      if (m && cast.slot !== "P") m.cooldownUntil -= sim.evalExpr("P.calc.SpellCdr", { slot: "P" });
    },
  },
  abilities: {
    Q: {
      // Wiki: thrown at the target, up to its 850 cast range, at 1700 speed, exploding as it lands near
      // it; farther, up to two bounces of 0.495s each out to the 1400 max range.
      components: [
        {
          id: "bomb",
          label: "Bouncing Bomb",
          type: "magic",
          amount: "calc.TotalDamage",
          aoe: true,
          travel: "min(reach, dv.MaxRange) / missileSpeed + 0.495 * ((reach > dv.MaxRange) + (reach > dv.MaxRange + dv.MaxRangeFirstBounce))",
        },
      ],
    },
    W: {
      // Knock-back lasts 0.5s (wiki).
      cc: [{ kind: "immobilize", duration: 0.5 }],
      notes: ["Assumes a recast to detonate as soon as the charge lands."],
      components: [{ id: "charge", label: "Satchel Charge", type: "magic", amount: "calc.TotalDamage", aoe: true, travel: true }],
    },
    E: {
      cc: [{ kind: "slow", duration: "dv.SlowDuration" }],
      // Thrown to the target location at its speed; the mines arm 0.5s later (wiki).
      components: [
        { id: "mine", label: "Hexplosive Minefield", type: "magic", amount: "calc.TotalDamage", aoe: true, delay: 0.5, travel: true },
        {
          id: "extra",
          label: "Hexplosive Minefield (extra mine)",
          type: "magic",
          amount: "calc.ReducedDamage",
          hits: 2,
          maxHits: 10,
          interval: 0.15,
          delay: 0.65,
          travel: true,
          aoe: true,
        },
      ],
    },
    R: {
      variants: {
        edge: {
          label: "edge",
          components: [{ id: "edge", label: "Mega Inferno Bomb (edge)", type: "magic", amount: "calc.BlastDamage", aoe: true, travel: R_TRAVEL }],
        },
      },
      components: [{ id: "center", label: "Mega Inferno Bomb", type: "magic", amount: "calc.EmpoweredDamage", aoe: true, travel: R_TRAVEL }],
    },
  },
};
export default kit;
