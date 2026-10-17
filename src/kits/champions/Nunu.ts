import type { ChampionKit } from "../../engine/kit-types.ts";

// Nunu & Willump — patch 16.20.
const kit: ChampionKit = {
  id: "Nunu",
  status: "curated",
  notes: [
    "Call of the Freljord: damaging the champion grants attack speed for 4 s; the same enemy can trigger it again only after 10 s (target immunity from the wiki, not in the data). Cleave damage to other enemies is not modeled.",
    "Snowball Barrage: the root (and its damage) lands 3 s after the first cast if that cast hit.",
  ],
  marks: [
    {
      id: "freljord",
      label: "Call of the Freljord",
      maxStacks: 1,
      duration: "P.dv.BloodBoilBaseDuration",
      appliedBy: ["attack", "ability"],
      atMax: {
        components: [],
        consume: true,
        cooldown: 10,
        buff: {
          id: "freljord",
          label: "Call of the Freljord",
          duration: "P.dv.BloodBoilBaseDuration",
          stats: { attackSpeed: "P.dv.ASIncrease", msPercent: "P.dv.MSIncrease" },
        },
      },
    },
  ],
  abilities: {
    Q: {
      notes: ["Champion damage (the true damage applies to minions/monsters only)."],
      components: [{ id: "bite", label: "Consume", type: "magic", amount: "calc.TotalChampionDamage" }],
    },
    W: {
      cc: [{ kind: "immobilize", duration: "calc.MaximumStunDuration" }],
      notes: [
        'Default: fully grown snowball (maximum damage and knock-up). Variant "small": collides right away (minimum damage and knock-up).',
        "The rolling time is not simulated: the impact happens at the cast.",
      ],
      variants: {
        small: {
          label: "small",
          cc: [{ kind: "immobilize", duration: "dv.BaseKnockupDuration" }],
          components: [{ id: "snowball", label: "Biggest Snowball Ever!", type: "magic", amount: "calc.NoImpactSnowballDamage", aoe: true }],
        },
      },
      components: [{ id: "snowball", label: "Biggest Snowball Ever!", type: "magic", amount: "calc.MaximumSnowballDamage", aoe: true }],
    },
    E: {
      recasts: 3,
      recastDelay: "spell['NunuESnowballBurstFire'].cooldown",
      cc: [{ kind: "slow", duration: "dv.SlowDuration" }],
      notes: ['Each cast throws 3 snowballs; all 3 assumed to hit. Use "E E E" for all three volleys.'],
      components: [
        {
          id: "snowball",
          label: "Snowball Barrage",
          type: "magic",
          amount: "calc.TotalSnowballDamage",
          hits: 3,
          maxHits: 3,
          interval: "dv.DelayBetweenSnowballs",
          travel: true,
        },
      ],
    },
    R: {
      // Channels before detonating; the damage and the slow's duration grow with the channel (wiki:
      // 1% of the maximum damage every 0.03s, the slow lasting the seconds channelled).
      // Released (recast) after 0.5s at the earliest (wiki).
      charge: { default: "dv.ChannelDuration", min: 0.5 },
      castTime: "charge",
      cc: [{ kind: "slow", duration: "min(charge, dv.SlowDuration)" }],
      notes: ["Default: the full 3s channel (maximum damage). Set the seconds to release it early (R{1.5s}): damage grows linearly with the channel."],
      components: [{ id: "blast", label: "Absolute Zero", type: "magic", amount: "calc.MaximumDamage * min(1, charge / dv.ChannelDuration)", aoe: true }],
    },
  },
  hooks: {
    onCast(sim, cast) {
      if (cast.slot !== "E" || !cast.hitsTarget || sim.time < sim.counter("nunu.Eend")) return;
      // First volley of a new Snowball Barrage: root + damage after TotalSpellDuration.
      const delay = sim.evalExpr("E.dv.TotalSpellDuration", { slot: "E" });
      sim.setCounter("nunu.Eend", sim.time + delay);
      sim.schedule(delay, () => {
        sim.deal({
          source: "E",
          sourceLabel: "Snowball Barrage",
          label: "Snowball Barrage (root)",
          type: "magic",
          amount: sim.evalExpr("E.calc.TotalRootDamage", { slot: "E" }),
          castId: cast.castId,
          flags: { kind: "ability", slot: "E", ability: true, aoe: true },
        });
        sim.applyCC("immobilize", sim.evalExpr("E.calc.RootDuration", { slot: "E" }), cast.castId, "E");
      });
    },
  },
};
export default kit;
