import type { ChampionKit, DebuffSpec } from "../../engine/kit-types.ts";
import type { Sim } from "../../engine/sim.ts";

// Zed — patch 16.20.
// Shadows: W and R each leave a Shadow (tracked as buffs zedW / zedR) that repeats Razor Shuriken.
// Death Mark stores RDamageAmp of the *pre-mitigation* physical and magic damage dealt while it is
// active (wiki) and pops for physical damage; the engine's debuff.detonate stores post-mitigation
// damage of every type, so the mark is tracked by hooks.
const MARK = "deathMark";
/** Wiki: Death Mark's 0.6s delay, then the 0.35s dash to the target; the mark lands as it ends. */
const R_DASH = 0.95;
/** Lands as the dash ends (hook): a shuriken landing during the dash isn't stored. */
const DEATH_MARK: DebuffSpec = { id: MARK, label: "Death Mark", duration: "dv.RDeathMarkDuration" };

function detonate(sim: Sim) {
  if (!sim.getDebuff(MARK)) return;
  sim.removeDebuff(MARK);
  const stored = sim.counter("zedMarkStored");
  const amount = sim.evalExpr("R.calc.RCalculatedDamage", { slot: "R" }) + sim.evalExpr("R.dv.RDamageAmp", { slot: "R" }) * stored;
  sim.deal({
    source: "R",
    sourceLabel: "Death Mark",
    label: "Death Mark (pop)",
    type: "physical",
    amount,
    flags: { kind: "ability", slot: "R", ability: true },
    markSource: MARK,
  });
}

const kit: ChampionKit = {
  id: "Zed",
  status: "curated",
  notes: [
    "Razor Shuriken: one shuriken from Zed plus one per active Shadow (W, R), each dealing full damage to the target as a separate cast.",
    "Shadow Slash damages once even if several slashes hit; it slows only when a Shadow is out. Its Living Shadow cooldown refund is not modeled.",
    "Death Mark pops RCalculatedDamage + RDamageAmp × pre-mitigation physical/magic damage dealt during the mark (true damage excluded).",
    "Contempt for the Weak: an attack on a target below 50% health deals %max-health magic damage, once per 10s.",
    "W:swap / R:swap switch places with the Shadow (dash, no damage); so does a plain R recast (R R).",
  ],
  hooks: {
    onCast(sim, cast) {
      if (cast.slot !== "R" || cast.variant || cast.recast !== 1 || !cast.hitsTarget) return;
      sim.schedule((cast.castTime ?? 0) + R_DASH, () => {
        sim.setCounter("zedMarkStored", 0);
        sim.applyDebuff(DEATH_MARK, "R", sim.spellFor("R"), sim.abilityRank("R"), cast.castId);
        sim.schedule(sim.evalExpr("dv.RDeathMarkDuration", { slot: "R" }), () => detonate(sim));
      });
    },
    afterDamage(sim, inst) {
      if (inst.fromMark || inst.type === "true" || !sim.getDebuff(MARK)) return;
      sim.setCounter("zedMarkStored", sim.counter("zedMarkStored") + inst.raw);
    },
    onAttack(sim, atk) {
      if (atk.fromAbility || atk.phantom) return;
      const t = sim.target;
      if (Math.max(0, t.hp) / t.maxHp >= sim.evalExpr("P.dv.CurrentHealthThreshold", { slot: "P" }) || !sim.isReady("zedPassive")) return;
      sim.startCooldown("zedPassive", sim.evalExpr("P.dv.PerUnitCD", { slot: "P" }));
      atk.extra.push({
        source: "P",
        sourceLabel: "Contempt for the Weak",
        label: "Contempt for the Weak",
        type: "magic",
        amount: sim.evalExpr("P.calc.TotalDamage", { slot: "P" }),
        castId: atk.castId,
        flags: { kind: "ability", slot: "P", ability: false, proc: true, onHit: true },
      });
    },
  },
  abilities: {
    Q: {
      components: [
        { id: "shuriken", label: "Razor Shuriken", type: "physical", amount: "calc.TotalDamage", travel: true },
        // The Shadows' shurikens fly as far, a moment apart (only to order the hits).
        {
          id: "shadow",
          label: "Razor Shuriken (Shadow)",
          type: "physical",
          amount: "calc.TotalDamage",
          hits: "buff.zedW + buff.zedR",
          maxHits: 2,
          delay: 0.05,
          interval: 0.05,
          travel: true,
          sameCast: false,
        },
      ],
    },
    W: {
      noTarget: true,
      recasts: 2,
      buff: { id: "zedW", label: "Living Shadow", duration: "dv.ShadowDuration" },
      variants: {
        swap: { label: "swap", dash: true, buff: [], components: [] },
      },
    },
    E: {
      // Only a Shadow's slash slows.
      cc: [{ kind: "slow", duration: "buff.zedW + buff.zedR > 0 ? dv.SlowDuration : 0" }],
      components: [{ id: "slash", label: "Shadow Slash", type: "physical", amount: "calc.TotalDamage", aoe: true }],
    },
    R: {
      dash: true,
      recasts: 2,
      recastDelay: "dv.RReactivateCD",
      // Wiki: unable to attack or cast during the 0.6s delay and the 0.35s dash to the target. The
      // recast swaps with the Shadow (as R:swap).
      lockout: `recast == 1 ? ${R_DASH} : 0`,
      buff: { id: "zedR", label: "Death Mark Shadow", duration: "dv.RShadowDurationDisplayed" },
      // Death Mark lands as the dash ends and pops RDeathMarkDuration later (hook).
      variants: {
        swap: {
          label: "swap",
          dash: true,
          lockout: 0,
          buff: [],
          components: [],
        },
      },
      components: [],
    },
  },
};
export default kit;
