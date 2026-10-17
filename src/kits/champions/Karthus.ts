import type { ChampionKit } from "../../engine/kit-types.ts";

// Karthus — patch 16.20.
const kit: ChampionKit = {
  id: "Karthus",
  status: "curated",
  notes: [
    "Lay Waste defaults to an isolated target (double damage); Q:multi when another enemy is in the blast.",
    "Defile stays on the target for 4s by default (set the seconds per cast, e.g. E{8s}), ticking every 0.25s.",
    "Death Defied (casting while dead) is not modeled.",
  ],
  abilities: {
    Q: {
      // The blast lands ≈0.5–0.75s after the cast (wiki); 0.6s used.
      components: [{ id: "blast", label: "Lay Waste", type: "magic", amount: "calc.QSingleTargetDamage", aoe: true, delay: 0.6 }],
      variants: {
        multi: {
          label: "multi",
          components: [{ id: "blast", label: "Lay Waste (several enemies)", type: "magic", amount: "calc.QDamage", aoe: true, delay: 0.6 }],
        },
      },
    },
    W: {
      notes: ["Target walks through the wall: dv.MagicResistShred% MR reduction and a decaying slow for dv.DebuffDuration s."],
      cc: [{ kind: "slow", duration: "dv.DebuffDuration" }],
      debuff: { id: "wallOfPain", label: "Wall of Pain", duration: "dv.DebuffDuration", mrReduction: "dv.MagicResistShred / 100" },
      components: [],
    },
    E: {
      notes: ["Per tick: calc.TotalDPS / 4 (the game's own tick calc is TotalDPS × 0.25)."],
      variableDuration: true,
      components: [
        {
          id: "defile",
          label: "Defile",
          type: "magic",
          amount: "calc.TotalDPS * 0.25",
          hits: 16,
          maxHits: 120,
          interval: 0.25,
          delay: 0.25,
          aoe: true,
          dot: true,
        },
      ],
    },
    R: {
      // 0.25s cast + 3s channel before the damage (tooltip); Karthus can't act while channeling.
      castTime: 3.25,
      components: [{ id: "requiem", label: "Requiem", type: "magic", amount: "calc.TotalDamage" }],
    },
  },
};
export default kit;
