import type { ChampionKit } from "../../engine/kit-types.ts";

// Annie — patch 16.20.
// Pyromania: every ability cast adds a stack; with 4 stacks the next Q, W or R stuns (counter
// 'annieStacks', starting from the 'pyromania' option).
// When each stunning ability's hit lands, from the cast's start.
const STUNNING: Record<string, string> = { Q: "castTime + reach / missileSpeed", W: "castTime", R: "castTime" };

const kit: ChampionKit = {
  id: "Annie",
  status: "curated",
  options: [
    {
      key: "pyromania",
      label: "Pyromania stacks at start",
      default: 4,
      min: 0,
      max: 4,
      description: "4 = the first Q/W/R stuns (Annie starts and respawns with the stun ready).",
    },
  ],
  notes: [
    'Pyromania: the stunning Q/W/R is chosen automatically from the stack count (option "pyromania").',
    "Tibbers: initial burst, aura every 0.25s and enraged attacks; default 4s of Tibbers on the target (R{aura:N,claw:N}).",
  ],
  stats: ({ ranks, evalExpr }) => (ranks.R > 0 ? { magicPenPercent: [evalExpr("R.dv.RPercentPenBuff")] } : {}),
  abilities: {
    P: { notes: ["Stun from Pyromania is applied by the hook on the 5th ability cast."] },
    Q: {
      components: [{ id: "fireball", label: "Disintegrate", type: "magic", amount: "calc.TotalDamage", travel: true }],
    },
    W: {
      components: [{ id: "cone", label: "Incinerate", type: "magic", amount: "calc.TotalDamage", aoe: true }],
    },
    E: {
      notes: ["Shield on Annie or an ally; the reflect damage only happens if the enemy hits the shielded unit (E+reflect)."],
      components: [
        {
          id: "reflect",
          label: "Molten Shield (reflect)",
          type: "magic",
          amount: "calc.DamageReturn",
          optional: true,
          condition: "enemy hits the shielded ally",
        },
      ],
    },
    R: {
      notes: [
        "Passive: % magic penetration. Tibbers aura ticks every 0.25s (per-second damage / 4).",
        "Enraged Tibbers attacks with decaying attack speed (≈1.74 → 0.74 over 5 attacks); modeled as 4 attacks 0.65s apart.",
      ],
      components: [
        { id: "burst", label: "Summon: Tibbers", type: "magic", amount: "calc.InitialBurstDamage", aoe: true },
        {
          id: "aura",
          label: "Tibbers (aura)",
          type: "magic",
          amount: "calc.TibbersAuraDamage / 4",
          hits: 16,
          maxHits: 180,
          interval: 0.25,
          delay: 0.25,
          aoe: true,
          dot: true,
          pet: true,
        },
        { id: "claw", label: "Tibbers (attack)", type: "magic", amount: "calc.TibbersAADamage", hits: 4, maxHits: 40, interval: 0.65, delay: 0.3, pet: true },
      ],
    },
  },
  hooks: {
    onStart(sim) {
      sim.setCounter("annieStacks", sim.opt.pyromania ?? 4);
    },
    onCast(sim, cast) {
      if (cast.slot === "P") return;
      const stacks = sim.counter("annieStacks");
      const max = sim.evalExpr("P.dv.MaxStacks", { slot: "P" });
      if (stacks >= max && cast.slot in STUNNING) {
        sim.setCounter("annieStacks", 0);
        if (!cast.hitsTarget) return;
        const duration = sim.evalExpr("P.calc.StunDuration", { slot: "P" });
        sim.schedule(sim.evalExpr(STUNNING[cast.slot], { slot: cast.slot }), () => sim.applyCC("immobilize", duration, cast.castId, cast.slot));
        return;
      }
      sim.setCounter("annieStacks", Math.min(max, stacks + 1));
    },
  },
};
export default kit;
