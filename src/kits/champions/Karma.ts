import type { ChampionKit } from "../../engine/kit-types.ts";

// Karma — patch 16.20.
// Mantra (R) empowers the next ability within 8s (tooltip text): the `mantra` variant, cast while
// the Mantra buff lasts ("R Q"); the hook removes the buff when an empowered variant is cast.
// Gathering Fire (hook): each ability damage instance on the champion lowers Mantra's remaining
// cooldown by P.calc.SpellMantraRefund seconds.
const kit: ChampionKit = {
  id: "Karma",
  status: "curated",
  notes: [
    "Mantra (R) empowers the next ability within 8s: Q, W or E casts Soulflare, Renewal or Defiance.",
    "Gathering Fire refunds Mantra cooldown per damage instance on the champion (Soulflare and Focused Resolve count twice).",
  ],
  abilities: {
    Q: {
      cc: [{ kind: "slow", duration: "dv.SlowDuration" }],
      components: [{ id: "flame", label: "Inner Flame", type: "magic", amount: "calc.TotalDamage", aoe: true, travel: true }],
      variants: {
        mantra: {
          label: "Soulflare",
          name: "Soulflare",
          when: "buff.mantra",
          note: "Impact deals Inner Flame + R.calc.RQImpactDamage; the field ruptures R.dv.RQSlowDuration s later for R.calc.RQFieldDamage.",
          cc: [{ kind: "slow", duration: "dv.SlowDuration + R.dv.RQSlowDuration" }],
          components: [
            { id: "flame", label: "Soulflare (impact)", type: "magic", amount: "calc.TotalDamage + R.calc.RQImpactDamage", aoe: true, travel: true },
            { id: "field", label: "Soulflare (field)", type: "magic", amount: "R.calc.RQFieldDamage", aoe: true, delay: "R.dv.RQSlowDuration", travel: true },
          ],
        },
      },
    },
    W: {
      notes: ["Damage on cast, and the same damage again plus the root if the tether holds for dv.TetherDuration s."],
      cc: [{ kind: "immobilize", duration: "dv.RootDuration", delay: "dv.TetherDuration" }],
      components: [
        { id: "tether", label: "Focused Resolve", type: "magic", amount: "calc.InitialDamage" },
        { id: "root", label: "Focused Resolve (root)", type: "magic", amount: "calc.InitialDamage", delay: "dv.TetherDuration" },
      ],
      variants: {
        mantra: {
          label: "Renewal",
          name: "Renewal",
          when: "buff.mantra",
          cc: [{ kind: "immobilize", duration: "dv.RootDuration + R.dv.RWBonusRoot", delay: "dv.TetherDuration" }],
          components: [
            { id: "tether", label: "Focused Resolve", type: "magic", amount: "calc.InitialDamage" },
            { id: "root", label: "Focused Resolve (root)", type: "magic", amount: "calc.InitialDamage", delay: "dv.TetherDuration" },
          ],
        },
      },
    },
    E: {
      noTarget: true,
      notes: ["Shield and move speed (no damage)."],
      components: [],
      variants: { mantra: { label: "Defiance", name: "Defiance", when: "buff.mantra", components: [] } },
    },
    R: {
      noTarget: true,
      // Mantra window: 8s (tooltip text, no data value).
      buff: { id: "mantra", label: "Mantra", duration: 8 },
      components: [],
    },
  },
  hooks: {
    onCast(sim, cast) {
      if (cast.variant === "mantra") sim.removeBuff("mantra");
    },
    afterDamage(sim, inst) {
      if (inst.fromMark || inst.flags.kind !== "ability" || !inst.flags.ability) return;
      if (inst.flags.slot !== "Q" && inst.flags.slot !== "W" && inst.flags.slot !== "E") return;
      const ready = sim.cooldownReadyAt("ability:R");
      if (ready <= sim.time) return;
      sim.startCooldown("ability:R", Math.max(0, ready - sim.time - sim.evalExpr("P.calc.SpellMantraRefund", { slot: "P" })));
    },
  },
};
export default kit;
