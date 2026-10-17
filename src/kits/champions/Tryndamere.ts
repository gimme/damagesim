import type { ChampionKit } from "../../engine/kit-types.ts";
import { SELF_HP, selfHp } from "../../engine/effects.ts";

// Tryndamere — patch 16.20.
// Battle Fury: Fury (0-100) grants crit chance; attacks give 5 (10 on crit), Spinning Slash 5 per
// champion, Undying Rage a burst; Bloodlust consumes it all. Tracked by hooks in a counter.
const MAX_FURY = 100; // resource cap (not in data)

const kit: ChampionKit = {
  id: "Tryndamere",
  status: "curated",
  notes: [
    "Fury starts at the fury option (default 0) and grants 0.5% crit chance per point; attacks add 5 Fury (10 on crit; expected value in expected-crit mode), Spinning Slash 5, Undying Rage its rank value; Bloodlust (Q) consumes all Fury.",
    "Bloodlust passive AD scales linearly with missing health up to max at 10% health (Tryndamere's health = option self.hpPercent, default full → 0 AD).",
    "Crits reduce Spinning Slash cooldown by 1.5s (expected value in expected-crit mode).",
    "Mocking Shout: the slow applies only to targets facing away (assumed); the AD reduction is not modeled.",
  ],
  options: [{ key: "fury", label: "Starting Fury", default: 0, min: 0, max: MAX_FURY, step: 5 }, SELF_HP],
  stats: ({ opt, ranks, evalExpr }) => {
    if (!(ranks.Q > 0)) return {};
    const missing = 1 - selfHp(opt);
    const full = 1 - evalExpr("Q.dv.RemainingHealthThreshold", "Q");
    return { ad: evalExpr("Q.dv.MaximumBonusAD", "Q") * Math.min(1, Math.max(0, missing) / full) };
  },
  hooks: {
    onStart(sim) {
      sim.setCounter("tryndCritPerFury", sim.evalExpr("P.calc.PassiveCritConversionTooltip", { slot: "P" }) / 100);
      sim.setCounter("fury", Math.min(MAX_FURY, sim.opt.fury ?? 0));
    },
    // No evalExpr here: it would read stats recursively.
    dynamicStats(sim) {
      return { critChance: sim.counter("fury") * sim.counter("tryndCritPerFury") };
    },
    onCast(sim, cast) {
      const add = (n: number) => sim.setCounter("fury", Math.min(MAX_FURY, sim.counter("fury") + n));
      if (cast.slot === "Q") sim.setCounter("fury", 0);
      else if (cast.slot === "E" && cast.hitsTarget) add(sim.evalExpr("E.dv.ChampFuryGain", { slot: "E" }));
      else if (cast.slot === "R") add(sim.evalExpr("R.dv.TryndRFuryGain", { slot: "R" }));
    },
    onAttack(sim, atk) {
      if (atk.phantom || atk.fromAbility) return;
      // Probability this attack crit: 1 for a real crit, crit chance in expected-value mode.
      const p = atk.crit ? 1 : atk.critFactor > 1 ? Math.min(1, sim.stats.critChance) : 0;
      sim.setCounter("fury", Math.min(MAX_FURY, sim.counter("fury") + 5 + 5 * p)); // 5 per attack, 10 per crit (tooltip)
      const key = "ability:E";
      const left = sim.cooldownReadyAt(key) - sim.time;
      if (p > 0 && left > 0) sim.startCooldown(key, Math.max(0, left - p * sim.evalExpr("E.dv.ChampCDRefund", { slot: "E" })));
    },
  },
  abilities: {
    Q: { noTarget: true, notes: ["Bloodlust active heals and consumes all Fury (crit chance drops to 0)."], components: [] },
    W: {
      cc: [{ kind: "slow", duration: "dv.SlowDuration" }],
      components: [],
    },
    E: {
      dash: true,
      // No dash speed in the data: ~0.2s to arrive. Bloodlust and Undying Rage can be cast during the
      // dash (wiki).
      attackLockout: 0.2,
      castLockout: { W: 0.2 },
      components: [{ id: "slash", label: "Spinning Slash", type: "physical", amount: "calc.TotalDamage", aoe: true, delay: 0.2 }],
    },
    R: { noTarget: true, notes: ["Undying Rage: grants Fury; no damage."], components: [] },
  },
};
export default kit;
