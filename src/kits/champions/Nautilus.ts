import type { ChampionKit } from "../../engine/kit-types.ts";

// Nautilus — patch 16.20.
const kit: ChampionKit = {
  id: "Nautilus",
  status: "curated",
  notes: [
    "Staggering Blow: the first attack against the target (then again after the 6 s per-target cooldown) deals bonus physical damage and roots.",
    "Titan's Wrath assumed to last its full duration (shield not broken). Each application deals half its damage on hit and half 1.25 s later; attacks while the burn is active add no damage.",
  ],
  abilities: {
    Q: {
      dash: true,
      cc: [{ kind: "immobilize", duration: 0.5 }],
      // {{Effect at cast time start}} (wiki): the anchor flies to the target from the start of the
      // cast. Unable to move or attack while it flies; he can cast any ability during the 0.9s dash
      // that follows (wiki), but not attack.
      lockout: "reach / missileSpeed",
      attackLockout: "reach / missileSpeed + 0.9",
      notes: ['Stun duration is not in the data ("briefly"); 0.5 s assumed.'],
      components: [{ id: "anchor", label: "Dredge Line", type: "magic", amount: "calc.QDamageCalc", travel: "reach / missileSpeed - castTime" }],
    },
    W: {
      noTarget: true,
      buff: { id: "nautW", label: "Titan's Wrath", duration: "dv.ShieldDuration" },
    },
    E: {
      cc: [{ kind: "slow", duration: "dv.SlowDuration" }],
      notes: ["A champion in melee range is hit by all three waves: the first deals full damage, later waves 50% (MultiHitReduction)."],
      components: [
        { id: "wave", label: "Riptide", type: "magic", amount: "calc.DamageCalc", aoe: true },
        // Wiki: the waves hit 0, 0.297 and 0.561s after the cast time ends (measured).
        {
          id: "extra",
          label: "Riptide (extra wave)",
          type: "magic",
          amount: "calc.DamageCalc * dv.MultiHitReduction",
          hits: 2,
          maxHits: 2,
          interval: 0.264,
          delay: 0.297,
          aoe: true,
        },
      ],
    },
    R: {
      cc: [{ kind: "immobilize", duration: "dv.StunDuration" }],
      notes: ["Damage to other enemies on the path is not modeled."],
      // No speed in the data. Wiki: the charge starts at 275 speed and gains 466.67 per second, so it
      // reaches the target in (sqrt(275² + 2·466.67·reach) − 275) / 466.67 (≈1.38s at max range).
      components: [
        {
          id: "charge",
          label: "Depth Charge",
          type: "magic",
          amount: "calc.PrimaryTargetDamage",
          travel: "(sqrt(275 ^ 2 + 2 * 466.67 * reach) - 275) / 466.67",
        },
      ],
    },
  },
  hooks: {
    onAttack(sim, atk) {
      if (atk.fromAbility || atk.phantom) return;
      // Staggering Blow: bonus damage + root, per-target cooldown.
      if (sim.isReady("nautilus.P")) {
        sim.startCooldown("nautilus.P", sim.evalExpr("P.dv.PerTargetCD", { slot: "P" }));
        atk.extra.push({
          source: "P",
          sourceLabel: "Staggering Blow",
          label: "Staggering Blow",
          type: "physical",
          amount: sim.evalExpr("P.calc.BonusDamage", { slot: "P" }),
          castId: atk.castId,
          flags: { kind: "ability", slot: "P", onHit: true, ability: false, proc: true },
        });
        sim.applyCC("immobilize", sim.evalExpr("P.calc.RootDuration", { slot: "P" }), atk.castId, "P");
      }
      // Titan's Wrath burn: half now, half after 1.25 s; no extra damage while a burn is running.
      if (sim.getBuff("nautW") && sim.isReady("nautilus.Wburn")) {
        sim.startCooldown("nautilus.Wburn", 2);
        const half = sim.evalExpr("W.calc.DotDamageCalc", { slot: "W" }) / 2;
        const burn = {
          source: "W",
          sourceLabel: "Titan's Wrath",
          label: "Titan's Wrath",
          type: "magic" as const,
          amount: half,
          castId: atk.castId,
          flags: { kind: "ability" as const, slot: "W" as const, onHit: true, ability: true, aoe: true, dot: true },
        };
        atk.extra.push(burn);
        sim.schedule(1.25, () => sim.deal({ ...burn, castId: sim.newCastId() }));
      }
    },
  },
};
export default kit;
