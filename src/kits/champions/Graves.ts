import type { ChampionKit } from "../../engine/kit-types.ts";
import type { Sim } from "../../engine/sim.ts";

// Graves — patch 16.20.
// New Destiny: an attack fires 4 pellets; on one target the first deals P.calc.SingleBulletDamage and
// each further pellet P.calc.MultiBulletDamage. Crits fire 6 pellets, each dealing (1 + P.calc.CritDamageMult)×.
// Modeled as one attack instance (only the first pellet applies on-hit) via damageMult/critMultiplier.
// Hook: each pellet hit reduces Quickdraw's cooldown.

const PELLETS = "P.calc.SingleBulletDamage + (opt.bullets - 1) * P.calc.MultiBulletDamage";
// Point-blank (all 4 pellets hit) crits land all 6 pellets; otherwise assume the same pellet count.
const CRIT_PELLETS = "P.calc.SingleBulletDamage + (opt.bullets >= 4 ? 5 : opt.bullets - 1) * P.calc.MultiBulletDamage";

const kit: ChampionKit = {
  id: "Graves",
  status: "curated",
  options: [
    {
      key: "bullets",
      label: "Pellets hitting per attack",
      default: 4,
      min: 1,
      max: 4,
      step: 1,
      description: "4 = point blank (crits then land all 6 pellets).",
    },
  ],
  notes: [
    "Attacks assume opt.bullets pellets hit (default 4, point blank); a crit then lands 6 pellets with +50% × (crit damage − 1) each (≈2× a normal attack).",
    "The two-shell reload is not modeled: attacks follow the normal attack speed timing.",
    "Each pellet hit (opt.bullets per attack, 6 on a point-blank crit) reduces Quickdraw's cooldown by E.dv.CooldownPerHit s.",
  ],
  attack: {
    damageMult: `(${PELLETS}) / ad`,
    critMultiplier: `(1 + P.calc.CritDamageMult) * (${CRIT_PELLETS}) / (${PELLETS})`,
  },
  abilities: {
    Q: {
      notes: ["The round deals its initial damage, then detonates after 1s along its path (target assumed to stay in it)."],
      components: [
        // No missile speed in the data: ~0.15s of flight. It detonates 1s later (tooltip).
        { id: "round", label: "End of the Line", type: "physical", amount: "calc.TotalDamage", aoe: true, delay: 0.15 },
        { id: "detonation", label: "End of the Line (detonation)", type: "physical", amount: "calc.TotalDetonationDamage", aoe: true, delay: 1 },
      ],
    },
    W: {
      cc: [{ kind: "slow", duration: "dv.SmokeDuration" }],
      notes: ["Slows while the target stays in the smoke; nearsight not modeled."],
      // Wiki: the canister starts flying at the start of the cast time.
      components: [{ id: "impact", label: "Smoke Screen", type: "magic", amount: "calc.ImpactDamage", aoe: true, travel: "reach / missileSpeed - castTime" }],
    },
    E: {
      dash: true,
      resetsAttack: true,
      noTarget: true,
      // The dash's max distance at its dash speed (data; no missile speed).
      lockout: "dv.DashMaxDistance / dv.DashSpeed",
      notes: ["Dash + attack reset (reloads a shell). Armor/MR stacks not modeled."],
    },
    R: {
      dash: true,
      notes: ["The primary target takes the impact damage only; the cone explosion (calc.FalloffDamage) hits enemies behind it."],
      components: [{ id: "impact", label: "Collateral Damage", type: "physical", amount: "calc.Damage", travel: true }],
    },
  },
  hooks: {
    onAttack(sim: Sim, atk) {
      if (atk.fromAbility || atk.phantom) return;
      const bullets = sim.opt.bullets ?? 4;
      const pellets = atk.crit && bullets >= 4 ? 6 : bullets;
      const remaining = sim.cooldownReadyAt("ability:E") - sim.time;
      if (remaining > 0) sim.startCooldown("ability:E", Math.max(0, remaining - pellets * sim.evalExpr("E.dv.CooldownPerHit", { slot: "E" })));
    },
  },
};
export default kit;
