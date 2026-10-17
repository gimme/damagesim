import type { BuffSpec, ChampionKit, DebuffSpec } from "../../engine/kit-types.ts";

// Quinn — patch 16.20.
// Harrier: Quinn's next attack against a marked target deals bonus physical damage (consumes the
// mark). Q (first target), E and R's Skystrike mark for 4s; Valor also marks passively.
const harrier: DebuffSpec = {
  id: "harrier",
  label: "Harrier",
  duration: "P.dv.RevealDuration",
  consume: { by: "attack", components: [{ id: "harrier", label: "Harrier", type: "physical", amount: "P.calc.BonusDamage", proc: true }] },
};

// Heightened Senses passive: attacking a Harrier target grants attack speed.
const heightenedSenses: BuffSpec = {
  id: "quinnW",
  label: "Heightened Senses",
  duration: "W.dv.BuffDuration",
  stats: { attackSpeed: "W.dv.AttackSpeedBonus" },
};

const kit: ChampionKit = {
  id: "Quinn",
  status: "curated",
  notes: [
    "Harrier is consumed by Quinn's next attack (bonus physical damage, not an ability hit). Consuming it grants Heightened Senses attack speed (W passive) for 2s.",
    "Valor re-marks the target 7 × 0.99^(crit chance %) seconds after a Harrier is consumed (wiki), if it is not already marked.",
    'Option "startMarked": the target already carries Valor\'s passive Harrier when the combo starts (on by default: Valor marks a visible enemy whenever none is marked).',
  ],
  options: [{ key: "startMarked", label: "Target starts marked with Harrier", default: 1, toggle: true }],
  abilities: {
    Q: {
      notes: ["Valor dives the first enemy hit: marks it with Harrier and damages enemies around it."],
      debuff: harrier,
      // {{Effect at cast time start}} (wiki): Valor flies to the target from the start of the cast.
      components: [
        { id: "dive", label: "Blinding Assault", type: "physical", amount: "calc.TotalDamage", aoe: true, travel: "reach / missileSpeed - castTime" },
      ],
    },
    W: { noTarget: true, components: [] },
    E: {
      dash: true,
      resetsAttack: true,
      notes: ["Resets the attack timer and marks the target with Harrier; the knock-back is a brief displacement."],
      debuff: harrier,
      cc: [
        { kind: "immobilize", duration: 0.25 },
        { kind: "slow", duration: "dv.SlowDecayTime" },
      ],
      // Dashes to the target at the dash speed, then leaps back; the attack reset comes 0.25-0.5s
      // after the first dash ends (wiki).
      lockout: "castTime + reach / missileSpeed + 0.25",
      components: [{ id: "vault", label: "Vault", type: "physical", amount: "calc.TotalDamage", travel: true }],
    },
    R: {
      notes: [
        "Modeled as the Skystrike recast (after the 2s channel): damage around Quinn and a Harrier mark.",
        "The channel itself is not a combo step; attacking or Q/E while paired also triggers Skystrike.",
      ],
      debuff: harrier,
      // Skystrike has no cast time (wiki); the data's is Behind Enemy Lines'.
      castTime: 0,
      components: [{ id: "skystrike", label: "Skystrike", type: "physical", amount: "calc.Damage", aoe: true }],
    },
  },
  hooks: {
    onStart(sim) {
      if (sim.opt.startMarked) sim.applyDebuff(harrier, "P", sim.spellFor("P"), 1, sim.newCastId());
    },
    afterDamage(sim, inst) {
      if (inst.fromMark !== "harrier") return;
      if (sim.rankOf("W") > 0) sim.applyBuff(heightenedSenses, "W", sim.spellFor("W"), sim.rankOf("W"));
      // Valor's passive re-mark (static cooldown from the wiki: 7s × 0.99^crit%).
      const cd = 7 * Math.pow(0.99, sim.stats.critChance * 100);
      sim.schedule(cd, () => {
        if (!sim.getDebuff("harrier")) sim.applyDebuff(harrier, "P", sim.spellFor("P"), 1, sim.newCastId());
      });
    },
  },
};
export default kit;
