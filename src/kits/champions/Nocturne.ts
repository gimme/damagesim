import type { BuffSpec, ChampionKit } from "../../engine/kit-types.ts";

// Nocturne — patch 16.20.

// Dusk trail: bonus AD and move speed while Nocturne stands on it.
const trail: BuffSpec = {
  id: "duskTrail",
  label: "Dusk Trail",
  duration: "dv.TrailDuration",
  stats: { ad: "dv.BonusTrailAD", msPercent: "dv.MoveSpeed / 100" },
};

const kit: ChampionKit = {
  id: "Nocturne",
  status: "curated",
  notes: [
    "Umbra Blades: the first attack procs (ready at combat start); the proc attack deals 120% AD instead of its normal damage, or 110% AD × crit damage on a crit. Every attack reduces the 12 s cooldown by 3 s.",
    'Option "onTrail": Nocturne fights on the Duskbringer trail (bonus AD for the trail duration after Q hits).',
  ],
  options: [{ key: "onTrail", label: "Stand on the Dusk Trail after Q", default: 1, min: 0, max: 1, toggle: true }],
  stats: ({ ranks, evalExpr }) => (ranks.W > 0 ? { attackSpeed: evalExpr("W.dv.ActiveAS") / 100 } : {}),
  abilities: {
    Q: {
      notes: ["Duskbringer's own damage is not increased by the trail's bonus AD (the trail buff starts when it hits)."],
      // {{Effect at cast time start}} (wiki): the blade flies from the start of the cast, through the target.
      components: [{ id: "blade", label: "Duskbringer", type: "physical", amount: "calc.TotalDamage", aoe: true, travel: "reach / missileSpeed - castTime" }],
    },
    W: {
      noTarget: true,
      notes: ['Passive attack speed is always on. Variant "blocked": the shield blocked an ability, doubling the attack speed for 5 s.'],
      variants: {
        blocked: {
          label: "blocked an ability",
          buff: { id: "shroud", label: "Shroud of Darkness", duration: "dv.DoubleASDuration", stats: { attackSpeed: "dv.ActiveAS / 100" } },
          components: [],
        },
      },
      components: [],
    },
    E: {
      // Fear when the tether completes (LeashDuration after the cast; the first tick is at 0.5 s).
      cc: [{ kind: "immobilize", duration: "dv.CCDuration", delay: "dv.LeashDuration - 0.5" }],
      notes: ["4 ticks over the 2 s tether (every 0.5 s); the fear lands when the tether completes (assumed unbroken)."],
      components: [
        { id: "tether", label: "Unspeakable Horror", type: "magic", amount: "calc.TotalDamage / 4", hits: 4, maxHits: 4, interval: 0.5, delay: 0.5, dot: true },
      ],
    },
    R: {
      dash: true,
      notes: ["Modeled as the recast (dash) hit; the map-darkening first cast is assumed done beforehand."],
      // Dashes to the target at the dash speed. He can cast any of his abilities during the dash (wiki).
      attackLockout: "castTime + reach / missileSpeed",
      components: [{ id: "dash", label: "Paranoia", type: "physical", amount: "calc.Damage", travel: true }],
    },
  },
  hooks: {
    afterDamage(sim, inst) {
      // Dusk Trail starts once Duskbringer has hit.
      if (inst.flags.slot === "Q" && inst.flags.kind === "ability" && !inst.flags.attack && sim.opt.onTrail && !sim.getBuff("duskTrail"))
        sim.applyBuff(trail, "Q", sim.spellFor("Q"), sim.rankOf("Q"));
    },
    onAttack(sim, atk) {
      if (atk.fromAbility || atk.phantom) return;
      if (sim.isReady("nocturne.P")) {
        // Umbra Blades replaces the attack's damage: AD × NoCrit ratio, or AD × Crit ratio × crit damage.
        sim.startCooldown("nocturne.P", sim.evalExpr("P.dv.Cooldown", { slot: "P" }));
        const noCrit = sim.evalExpr("P.dv.TotalDamageNoCritADRatio", { slot: "P" });
        const crit = sim.evalExpr("P.dv.TotalDamageCritADRatio", { slot: "P" });
        const cd = sim.stats.critDamage;
        const p = cd > 1 ? (atk.critFactor - 1) / (cd - 1) : 0; // crit probability implied by the attack's crit factor
        atk.baseMult *= ((1 - p) * noCrit + p * crit * cd) / atk.critFactor;
      } else {
        const ready = sim.cooldownReadyAt("nocturne.P");
        sim.startCooldown("nocturne.P", ready - sim.time - sim.evalExpr("P.dv.AAChampMonsterCDR", { slot: "P" }));
      }
    },
  },
};
export default kit;
