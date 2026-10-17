import type { BuffSpec, ChampionKit } from "../../engine/kit-types.ts";
import type { Sim } from "../../engine/sim.ts";

// Trundle — patch 16.20.
// Chomp: the empowered attack is followed by an AD buff (applied by a hook after the hit, so it
// doesn't boost the Chomp itself). Subjugate: half the damage and shred up front, the rest over 4
// ticks; the shred ramps 20% → 40% and lingers until dv.ShredDuration (hook: time-dependent shred).
const chompAd: BuffSpec = { id: "chompAd", label: "Chomp (AD)", duration: "Q.dv.SapDebuffDuration", stats: { ad: "Q.dv.BonusAD" } };

const subjugateAt = new WeakMap<Sim, number>();

const kit: ChampionKit = {
  id: "Trundle",
  status: "curated",
  notes: [
    "Chomp: the next attack within 7s deals the Chomp damage instead of the attack damage (assumed unable to crit; applies on-hit), then Trundle gains bonus AD for 5s.",
    "Frozen Domain: Trundle is assumed to stay in the zone for its full duration.",
    "Subjugate: 50% of the max-health damage on cast, the rest over 4 ticks (1/s). Armor/MR reduction: 20% on cast, +5% per tick to 40%, kept until 8s after the cast. The enemy AD loss / Trundle resist gains are not modeled.",
  ],
  hooks: {
    onAttack(sim, atk) {
      if (atk.phantom || !atk.extra.some((x) => x.label === "Chomp")) return;
      sim.schedule(0, () => sim.applyBuff(chompAd, "Q", sim.spellFor("Q"), sim.abilityRank("Q")));
    },
    onCast(sim, cast) {
      if (cast.slot === "R" && cast.hitsTarget) subjugateAt.set(sim, sim.time + (sim.spellFor("R").castTime ?? 0));
    },
    targetResist(sim) {
      const t0 = subjugateAt.get(sim);
      if (t0 === undefined || sim.time < t0) return;
      const elapsed = sim.time - t0;
      if (elapsed > sim.evalExpr("R.dv.ShredDuration", { slot: "R" })) return;
      const upfront = sim.evalExpr("R.dv.PercentOfDamageAndShredUpfront", { slot: "R" });
      const ticks = sim.evalExpr("R.dv.NumberOfTicks", { slot: "R" });
      const tickTime = sim.evalExpr("R.dv.DurationOfDrainForTooltip", { slot: "R" }) / ticks;
      const done = Math.min(ticks, Math.floor(elapsed / tickTime + 1e-6));
      const pct = sim.evalExpr("R.dv.ArmorMRShred", { slot: "R" }) * (upfront + ((1 - upfront) * done) / ticks);
      return { armorPercent: pct, mrPercent: pct };
    },
  },
  abilities: {
    Q: {
      resetsAttack: true,
      buff: {
        id: "chomp",
        label: "Chomp",
        duration: "dv.PrepDuration",
        empowerAttacks: {
          count: 1,
          replaceBase: true,
          resetsAttack: true,
          components: [{ id: "chomp", label: "Chomp", type: "physical", amount: "Q.calc.TotalDamage" }],
          cc: [{ kind: "slow", duration: "Q.dv.SlowDuration" }],
        },
      },
      notes: ["Empowers the next attack (replaces its damage): follow Q with AA."],
    },
    W: {
      noTarget: true,
      buff: { id: "frozenDomain", label: "Frozen Domain", duration: "dv.Duration", stats: { attackSpeed: "dv.ASBonus", msPercent: "dv.MSBonus" } },
      components: [],
    },
    E: {
      cc: [{ kind: "slow", duration: "dv.PillarDuration" }],
      notes: [
        "Pillar of Ice: slows while the target is near the pillar (assumed for its full duration); the knock-back only when cast directly under the target (not modeled).",
      ],
      components: [],
    },
    R: {
      components: [
        { id: "upfront", label: "Subjugate", type: "magic", amount: "calc.TotalPercentHPDamage * target.maxHp * dv.PercentOfDamageAndShredUpfront" },
        {
          id: "drain",
          label: "Subjugate (drain)",
          type: "magic",
          amount: "calc.TotalPercentHPDamage * target.maxHp * (1 - dv.PercentOfDamageAndShredUpfront) / dv.NumberOfTicks",
          hits: "dv.NumberOfTicks",
          interval: "dv.DurationOfDrainForTooltip / dv.NumberOfTicks",
          delay: "dv.DurationOfDrainForTooltip / dv.NumberOfTicks",
          dot: true,
        },
      ],
    },
  },
};
export default kit;
