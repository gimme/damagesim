import type { ChampionKit } from "../../engine/kit-types.ts";

// Ryze — patch 16.20.
// Flux (from Spell Flux) is consumed by Overload (bonus damage) and Rune Prison (root instead of
// slow). Rune Prison and Spell Flux refresh Overload's cooldown.
const kit: ChampionKit = {
  id: "Ryze",
  status: "curated",
  notes: [
    "Arcane Mastery: +0.1% max mana per AP (from item AP; buff AP not counted). Bonus-mana damage ratios are in the game formulas.",
    "Overload deals +OverloadDamageBonus% (Realm Warp rank) against a Flux target and consumes Flux; Rune Prison roots a Flux target (consumes it), otherwise slows.",
    "Rune Prison and Spell Flux reset Overload's cooldown. Rune charges / move speed and Realm Warp's teleport are not modeled.",
  ],
  // Max mana bonus from AP (PassiveManaCalcTooltip is in percent).
  stats: ({ evalExpr }) => ({ mana: evalExpr("mana * P.calc.PassiveManaCalcTooltip / 100") }),
  abilities: {
    Q: {
      components: [
        {
          id: "overload",
          label: "Overload",
          type: "magic",
          amount: "calc.QDamageCalc * (1 + (debuff.flux ? R.dv.OverloadDamageBonus / 100 : 0))",
          // Fired as the cast time starts (wiki: {{Effect at cast time start}}).
          travel: "reach / missileSpeed - castTime",
        },
      ],
    },
    W: {
      notes: ["Roots a Flux target (consuming Flux), otherwise slows."],
      cc: [
        { kind: "immobilize", duration: "debuff.flux ? dv.CCDuration : 0" },
        { kind: "slow", duration: "debuff.flux ? 0 : dv.CCDuration" },
      ],
      components: [{ id: "prison", label: "Rune Prison", type: "magic", amount: "calc.WDamageCalc" }],
    },
    E: {
      debuff: { id: "flux", label: "Flux", duration: "dv.DebuffDuration" },
      components: [{ id: "flux", label: "Spell Flux", type: "magic", amount: "calc.EDamageCalc", travel: true }],
    },
    R: { noTarget: true, notes: ["Teleport; its passive raises Overload's Flux bonus."], components: [] },
  },
  hooks: {
    onCast(sim, cast) {
      if (cast.slot === "W" || cast.slot === "E") sim.startCooldown("ability:Q", 0);
    },
    // Overload and Rune Prison consume Flux; removed after the hit so W's crowd control still sees it.
    afterDamage(sim, inst) {
      if (inst.fromMark || (inst.source !== "Q" && inst.source !== "W")) return;
      if (sim.getDebuff("flux")) sim.schedule(0, () => sim.removeDebuff("flux"));
    },
  },
};
export default kit;
