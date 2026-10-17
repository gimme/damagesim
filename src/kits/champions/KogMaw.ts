import type { ChampionKit } from "../../engine/kit-types.ts";

// Kog'Maw — patch 16.20.
const kit: ChampionKit = {
  id: "KogMaw",
  status: "curated",
  // Caustic Spittle passive attack speed.
  stats: ({ ranks, evalExpr }) => (ranks.Q > 0 ? { attackSpeed: evalExpr("Q.dv.AttackSpeed", "Q") } : {}),
  abilities: {
    P: {
      notes: ['Icathian Surprise: only after Kog\'Maw dies (explodes 4s later). Cast "P" to include it.'],
      components: [{ id: "surprise", label: "Icathian Surprise", type: "true", amount: "calc.PassiveDamage", aoe: true, delay: "dv.TooltipPassiveDuration" }],
    },
    Q: {
      debuff: {
        id: "kogQ",
        label: "Caustic Spittle shred",
        duration: "dv.ShredDuration",
        armorReduction: "dv.ShredAmount / 100",
        mrReduction: "dv.ShredAmount / 100",
      },
      // Spat as the cast time starts (wiki: {{Effect at cast time start}}): lands its flight after the cast starts.
      components: [{ id: "spittle", label: "Caustic Spittle", type: "magic", amount: "calc.TotalDamage", travel: "reach / missileSpeed - castTime" }],
    },
    W: {
      noTarget: true,
      notes: ["For 8s attacks gain range and deal % max health magic damage on-hit."],
      buff: {
        id: "kogW",
        label: "Bio-Arcane Barrage",
        duration: "dv.Duration",
        onHit: [{ id: "barrage", label: "Bio-Arcane Barrage", type: "magic", amount: "W.calc.TotalHealthDamage * target.maxHp", proc: true }],
      },
      components: [],
    },
    E: {
      cc: [{ kind: "slow", duration: "dv.TrailDuration" }],
      // Spewed as the cast time starts (wiki: {{Effect at cast time start}}): lands its flight after the cast starts.
      components: [{ id: "ooze", label: "Void Ooze", type: "magic", amount: "calc.TotalDamage", aoe: true, travel: "reach / missileSpeed - castTime" }],
    },
    R: {
      notes: ["+0.83% damage per 1% missing health (×1.5 at 40%); below 40% health the target takes double damage. Lands 0.6s after the cast."],
      components: [
        {
          id: "artillery",
          label: "Living Artillery",
          type: "magic",
          amount: "target.hpPct < 0.4 ? calc.MaxDamageCalc : calc.BaseDamageCalc * (1 + dv.TooltipMissingHealthDamageAmp * target.missingHpPct)",
          aoe: true,
          delay: 0.6,
        },
      ],
    },
  },
};
export default kit;
