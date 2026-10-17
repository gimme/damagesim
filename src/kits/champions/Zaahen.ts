import type { ChampionKit } from "../../engine/kit-types.ts";
import type { StatMods } from "../../engine/stats.ts";

// Zaahen — patch 16.20.
// Cultivation of War: one Determination stack per damage instance on a champion (wiki), each giving
// PercentBonusADCalc of total AD (doubled at max stacks). Stacks are a kit mark; the AD bonus is a
// dynamicStats conversion (totalAd → bonus AD). dynamicStats can't evaluate expressions (recursion
// into stats), so the level-scaled percentage is evaluated once in onStart.
const kit: ChampionKit = {
  id: "Zaahen",
  status: "curated",
  notes: [
    "Determination: +1 stack per attack/ability damage instance (max 12, doubled bonus at max); stacks drop entirely 5s after the last hit (the game decays them gradually). Starts at 0 stacks.",
    'The Darkin Glaive: the empowered attack is two strikes that together deal the attack plus the bonus (one crit roll, each strike applies on-hit). Recast: write "Q AA Q:recast AA" (the recast is available 1.5s after the first).',
    "Grim Deliverance passive armor penetration applies once R is learned. Revive and healing are not modeled.",
  ],
  marks: [
    {
      id: "determination",
      label: "Determination",
      maxStacks: "P.dv.MaxStacks",
      duration: "P.dv.FallOffDuration",
      appliedBy: ["attack", "ability"],
      oncePerCast: false,
    },
  ],
  hooks: {
    onStart(sim) {
      sim.setCounter("zaahenPct", sim.evalExpr("P.calc.PercentBonusADCalc", { slot: "P" }));
    },
    dynamicStats(sim) {
      const mods: Partial<StatMods> = {};
      const p = sim.spellFor("P");
      const stacks = sim.markStacks("determination") ?? 0;
      const max = sim.dataValue(p, "MaxStacks", 1);
      const pct = sim.counter("zaahenPct");
      if (stacks > 0 && pct > 0)
        mods.conversions = [
          { from: "totalAd", to: "ad", ratio: pct * stacks * (stacks >= max ? sim.dataValue(p, "MaxStacksMultiplier", 1) : 1), source: "Cultivation of War" },
        ];
      const r = sim.rankOf("R");
      if (r > 0) mods.armorPenPercent = [sim.dataValue(sim.spellFor("R"), "ArmorPen", r)];
      return mods;
    },
    afterDamage(sim, inst) {
      // The recast's empowered attack knocks up.
      if (inst.source === "Q" && inst.label === "The Darkin Glaive (recast)")
        sim.applyCC("immobilize", sim.evalExpr("Q.dv.KnockUpDuration", { slot: "Q" }), inst.castId, "Q");
    },
  },
  abilities: {
    Q: {
      resetsAttack: true,
      recasts: 2,
      recastDelay: "dv.TimeBetweenAttacks",
      variants: {
        recast: {
          label: "recast",
          resetsAttack: true,
          buff: {
            id: "zaahenQ2",
            label: "The Darkin Glaive (recast)",
            duration: "dv.RecastWindow",
            // The wiki: The Darkin Glaive's damage is basic and spell damage, the attack's too.
            empowerAttacks: {
              count: 1,
              resetsAttack: true,
              spell: true,
              components: [{ id: "q2", label: "The Darkin Glaive (recast)", type: "physical", amount: "Q.calc.SecondHitDamage" }],
            },
          },
          components: [],
        },
      },
      buff: {
        id: "zaahenQ",
        label: "The Darkin Glaive",
        duration: "dv.RecastWindow",
        empowerAttacks: {
          count: 1,
          replaceBase: true,
          resetsAttack: true,
          // Each of the two strikes applies on-hit effects.
          onHitRepeats: 1,
          components: [
            // Each strike deals half of (AD + Q damage); only the AD half can crit (wiki: crits for 50% AD).
            { id: "strike1", label: "The Darkin Glaive (strike 1)", type: "physical", amount: "ad / 2", canCrit: true },
            { id: "strike1Bonus", label: "The Darkin Glaive (strike 1 bonus)", type: "physical", amount: "Q.calc.InitialDamage / 2" },
            { id: "strike2", label: "The Darkin Glaive (strike 2)", type: "physical", amount: "ad / 2", canCrit: true },
            { id: "strike2Bonus", label: "The Darkin Glaive (strike 2 bonus)", type: "physical", amount: "Q.calc.InitialDamage / 2" },
          ],
        },
      },
    },
    W: {
      notes: ["Outbound stab, then the pull at max range (both hit by default)."],
      cc: [{ kind: "immobilize", duration: "dv.MaximumPullDistance / dv.PullSpeed" }],
      // The glaive extends to max range at its speed, stabbing the target on the way; at max range
      // (wiki) the pull hits too.
      components: [
        { id: "stab", label: "Dreaded Return (stab)", type: "physical", amount: "calc.InitialDamage", aoe: true, travel: true },
        { id: "pull", label: "Dreaded Return (pull)", type: "physical", amount: "calc.SecondaryDamage", aoe: true, travel: "castRange / missileSpeed" },
      ],
    },
    E: {
      dash: true,
      // Wiki: unable to move or attack during the dash; The Darkin Glaive can be cast, but only
      // readies the next attack.
      lockout: "reach / dv.DashSpeed",
      notes: ["Default: target inside the slice; E:edge for the outer edge (sweet spot)."],
      variants: {
        edge: {
          label: "edge",
          dash: true,
          lockout: "dv.DashDistance / dv.DashSpeed",
          components: [
            { id: "edge", label: "Aureate Rush (edge)", type: "physical", amount: "calc.BonusDamageCalc", aoe: true, travel: "castRange / missileSpeed" },
            {
              id: "edgeHp",
              label: "Aureate Rush (edge, %HP)",
              type: "magic",
              amount: "dv.PercentHPDamage * target.maxHp",
              aoe: true,
              travel: "castRange / missileSpeed",
            },
          ],
        },
      },
      // The flourish on arrival (wiki), after the dash to the target at its speed.
      components: [{ id: "slice", label: "Aureate Rush", type: "physical", amount: "calc.BaseDamageCalc", aoe: true, travel: true }],
    },
    R: {
      dash: true,
      // Wiki: unable to act from the start of the 0.5s cast time until the slam 0.6s after the launch
      // (sometimes up to 0.25s longer).
      lockout: 1.1,
      // The slam, 0.6s after the launch (its 600 units at 2800 speed fit within).
      components: [{ id: "stab", label: "Grim Deliverance", type: "physical", amount: "calc.DamageEndCalc", aoe: true, delay: 0.6 }],
    },
  },
};
export default kit;
