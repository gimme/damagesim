import type { ChampionKit } from "../../engine/kit-types.ts";

// Lillia — patch 16.20.
// Dream Dust: every ability hit applies (refreshes) a 3s burn of % max health magic damage in 6 ticks.
const kit: ChampionKit = {
  id: "Lillia",
  status: "curated",
  notes: [
    "Dream Dust is a mark refreshed by any ability hit; it ticks every 0.5s while active (6 ticks per application).",
    "Lilting Lullaby: the wake-up damage is dealt by the next attack/ability hit after R (Dream Dust ticks do not wake). The sleep starts 1.8s after the cast: add wait{1.8s} before the waking hit. The Dream Dust requirement is not checked.",
  ],
  marks: [
    {
      id: "dreamDust",
      label: "Dream Dust",
      maxStacks: 1,
      duration: "P.dv.Duration",
      appliedBy: ["ability"],
      dot: {
        interval: "P.dv.Duration / P.dv.DotTicks",
        components: [{ id: "dust", label: "Dream Dust", type: "magic", amount: "P.calc.DotPercentTooltip * target.maxHp / P.dv.DotTicks", dot: true }],
      },
    },
  ],
  abilities: {
    Q: {
      notes: ["Outer edge adds the same amount as true damage: Q+edge."],
      components: [
        { id: "censer", label: "Blooming Blows", type: "magic", amount: "calc.TotalDamage", aoe: true },
        {
          id: "edge",
          label: "Blooming Blows (edge)",
          type: "true",
          amount: "calc.BonusTrueDamage",
          aoe: true,
          optional: true,
          condition: "target at the outer edge",
        },
      ],
    },
    W: {
      // No cast time; she dashes and the strike lands 0.767s after the cast (wiki). Lillia can't act before.
      lockout: 0.767,
      components: [{ id: "eep", label: "Watch Out! Eep!", type: "magic", amount: "calc.FlatDamage", aoe: true, delay: 0.767 }],
      variants: {
        center: {
          label: "center",
          lockout: 0.767,
          components: [{ id: "eep", label: "Watch Out! Eep! (center)", type: "magic", amount: "calc.FlatDamageSweetSpot", aoe: true, delay: 0.767 }],
        },
      },
    },
    E: {
      cc: [{ kind: "slow", duration: "dv.SlowDuration" }],
      // Lobbed at the target at its speed, detonating on it as it lands.
      components: [{ id: "seed", label: "Swirlseed", type: "magic", amount: "calc.ImpactDamageTotal", aoe: true, travel: true }],
    },
    R: {
      // The lullaby arrives 0.3s after the cast time (wiki: fixed travel time missile).
      cc: [
        { kind: "slow", duration: "dv.DrowsyDuration", delay: 0.3 },
        { kind: "immobilize", duration: "dv.SleepDuration", delay: "0.3 + dv.DrowsyDuration" }, // sleep after the drowsy phase
      ],
      debuff: {
        id: "lullaby",
        label: "Lilting Lullaby",
        duration: "0.3 + dv.DrowsyDuration + dv.SleepDuration",
        consume: { by: "any", components: [{ id: "wake", label: "Lilting Lullaby (wake)", type: "magic", amount: "R.calc.TotalDamage" }] },
      },
      components: [],
    },
  },
};
export default kit;
