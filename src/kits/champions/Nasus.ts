import type { ChampionKit } from "../../engine/kit-types.ts";

// Nasus — patch 16.20.
const kit: ChampionKit = {
  id: "Nasus",
  status: "curated",
  notes: ["Siphoning Strike stacks are an option (default 150, a typical mid-game count)."],
  options: [{ key: "stacks", label: "Siphoning Strike stacks", default: 150, min: 0, max: 2000, step: 10 }],
  // Q's TotalDamage reads the stack counter buff.
  buffStacks: { "{1b1d7345}": "opt.stacks" },
  abilities: {
    Q: {
      resetsAttack: true,
      // Fury of the Sands reduces Siphoning Strike's cooldown.
      cooldown: "buff.nasusR ? cooldown * (1 - R.dv.QCDR) : cooldown",
      notes: [
        "Empowers the next attack: it deals Q damage instead of normal attack damage (follow Q with AA).",
        "Crits multiply only the base + AD part, not the stacks (game CritDamage formula).",
      ],
      buff: {
        id: "nasusQ",
        label: "Siphoning Strike",
        duration: "dv.BuffDuration",
        empowerAttacks: {
          count: 1,
          replaceBase: true,
          resetsAttack: true,
          components: [
            { id: "strike", label: "Siphoning Strike", type: "physical", amount: "Q.calc.TotalDamage - opt.stacks", canCrit: true },
            { id: "stacks", label: "Siphoning Strike (stacks)", type: "physical", amount: "opt.stacks" },
          ],
        },
      },
    },
    W: {
      cc: [{ kind: "slow", duration: "dv.Duration" }],
      components: [],
    },
    E: {
      notes: ["Initial hit after ~0.26 s, then 5 ticks (1/s) while the target stays in the area; armor shred assumed for the full duration."],
      debuff: { id: "nasusE", label: "Spirit Fire shred", duration: "dv.Duration", armorReduction: "-dv.ArmorShredPercent" },
      components: [
        { id: "initial", label: "Spirit Fire", type: "magic", amount: "calc.InitialDamage", aoe: true, delay: 0.26 },
        {
          id: "burn",
          label: "Spirit Fire (burn)",
          type: "magic",
          amount: "calc.TotalDotDamage / dv.Duration",
          hits: "dv.Duration",
          interval: 1,
          delay: 1.26,
          aoe: true,
          dot: true,
        },
      ],
    },
    R: {
      notes: [
        "Storm ticks every 0.5 s for 15 s (30 ticks) while the target stays nearby; the 240/s cap is assumed to apply to monsters only.",
        "Siphoning Strike cooldown is halved while the storm is active.",
      ],
      buff: {
        id: "nasusR",
        label: "Fury of the Sands",
        duration: "dv.Duration",
        stats: { hp: "dv.BonusHealth", armor: "dv.InitialResistGain", mr: "dv.InitialResistGain" },
      },
      components: [
        {
          id: "storm",
          label: "Fury of the Sands",
          type: "magic",
          amount: "calc.DamageCalc * target.maxHp * dv.TickRate",
          hits: "dv.Duration / dv.TickRate",
          interval: "dv.TickRate",
          delay: "dv.TickRate",
          aoe: true,
          dot: true,
        },
      ],
    },
  },
};
export default kit;
