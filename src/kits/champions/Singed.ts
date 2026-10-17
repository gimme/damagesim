import type { ChampionKit } from "../../engine/kit-types.ts";

// Singed — patch 16.20.
const kit: ChampionKit = {
  id: "Singed",
  status: "curated",
  abilities: {
    Q: {
      notes: [
        "Poison ticks 4 times per second. Default exposure = the game's own tooltip estimate (ApproximateTotalDamageTooltip = 4.75s of damage, 19 ticks); override the hit count for longer chases.",
      ],
      components: [
        {
          id: "poison",
          label: "Poison Trail",
          type: "magic",
          amount: "calc.DamagePerSecond / dv.TicksPerSecond",
          hits: "round(calc.ApproximateTotalDamageTooltip / calc.DamagePerSecond * dv.TicksPerSecond)",
          interval: "1 / dv.TicksPerSecond",
          dot: true,
          aoe: true,
        },
      ],
    },
    W: {
      notes: ['Grounds and slows; marks the area so a following Fling roots (debuff "megaAdhesive").'],
      // Wiki: the goo lands 0.375s (DelayExecute) after the cast.
      cc: [
        { kind: "impair", duration: "dv.WDuration", delay: "dv.DelayExecute" },
        { kind: "slow", duration: "dv.WDuration", delay: "dv.DelayExecute" },
      ],
      debuff: { id: "megaAdhesive", label: "Mega Adhesive", duration: "dv.WDuration" },
      components: [],
    },
    E: {
      notes: ["The target is airborne for 0.693s (wiki); flung into Mega Adhesive (W cast first) it is also rooted."],
      cc: [{ kind: "immobilize", duration: "debuff.megaAdhesive ? 0.693 + dv.RootDuration : 0.693" }],
      components: [{ id: "fling", label: "Fling", type: "magic", amount: "calc.BaseDamage + dv.MaxHPDamage / 100 * target.maxHp" }],
    },
    R: {
      noTarget: true,
      buff: {
        id: "insanity",
        label: "Insanity Potion",
        duration: "dv.Duration",
        stats: { ap: "dv.StatAmount", armor: "dv.StatAmount", mr: "dv.StatAmount", msFlat: "dv.StatAmount" },
      },
      components: [],
    },
  },
};
export default kit;
