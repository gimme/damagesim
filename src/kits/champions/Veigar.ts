import type { ChampionKit } from "../../engine/kit-types.ts";

// Veigar — patch 16.20.
const kit: ChampionKit = {
  id: "Veigar",
  status: "curated",
  notes: [
    'Phenomenal Evil: "stacks" option = stacks at combo start (1 AP each); each ability cast that hits adds a stack during the combo.',
    "Dark Matter has no cooldown in the game data (it is driven by the passive): the kit sets 8s minus 10% per 50 stacks (then ability haste).",
  ],
  options: [{ key: "stacks", label: "Phenomenal Evil stacks", default: 100, min: 0, max: 2000, step: 1 }],
  stats: ({ opt, evalExpr }) => ({ ap: opt.stacks * evalExpr("P.calc.APPerStack") }),
  abilities: {
    Q: {
      components: [{ id: "bolt", label: "Baleful Strike", type: "magic", amount: "calc.TotalDamage", travel: true }],
    },
    W: {
      // The data cooldown is 0: 8s base, -10% per 50 Phenomenal Evil stacks (start option + stacks gained).
      cooldown: "dv.BaseCooldown * max(0.0001, 1 - P.dv.DarkMatterCDRIncrement * floor((opt.stacks + stacks.veigarStacks) / P.dv.PStacksPerDarkMatterCDR))",
      // Impact dv.ImpactDelay (1.2s) after the cast starts (wiki), not after the cast time.
      components: [{ id: "matter", label: "Dark Matter", type: "magic", amount: "calc.TotalDamage", aoe: true, delay: "dv.ImpactDelay - castTime" }],
    },
    E: {
      notes: ["The cage stuns 0.5s after the cast; no damage."],
      cc: [{ kind: "immobilize", duration: "dv.StunDuration", delay: "dv.CageDelay" }],
    },
    R: {
      notes: ["Damage rises linearly with missing health up to 2× at 33% health or below (+1.5% per 1% missing health)."],
      components: [
        {
          id: "burst",
          label: "Primordial Burst",
          type: "magic",
          amount: "calc.MinDamage * (1 + (dv.MaxExecuteMult - 1) * min(1, target.missingHpPct * 1.5))",
          // A missile, but no speed in the data or the wiki: ~0.25s flight.
          delay: 0.25,
        },
      ],
    },
  },
  hooks: {
    afterDamage(sim, inst) {
      // One Phenomenal Evil stack per ability cast that hits.
      if (inst.fromMark || inst.flags.kind !== "ability" || !inst.flags.slot || inst.flags.slot === "P") return;
      if (sim.counter("veigar.lastCast") === inst.castId) return;
      sim.setCounter("veigar.lastCast", inst.castId);
      sim.setCounter("veigarStacks", sim.counter("veigarStacks") + sim.evalExpr("P.dv.dAbilityStacks", { slot: "P" }));
      sim.setCounter("veigar.apGained", sim.counter("veigarStacks") * sim.evalExpr("P.calc.APPerStack", { slot: "P" }));
    },
    dynamicStats(sim) {
      return { ap: sim.counter("veigar.apGained") };
    },
  },
};
export default kit;
