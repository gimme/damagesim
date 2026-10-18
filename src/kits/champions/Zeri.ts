import type { BuffSpec, ChampionKit } from "../../engine/kit-types.ts";
import type { Sim } from "../../engine/sim.ts";

// Zeri — patch 16.20.
// Living Battery: her right-click attack is an ability with an attack's timing (the game: "Zeri's
// Attacks deal magic damage and are treated as Abilities"; the wiki: spell damage that applies spell
// effects and triggers on-cast effects, can't crit, applies and triggers no on-hit or on-attack
// effects). It deals Q.calc.MinDamage magic damage and executes low-health targets; a fully charged
// one deals PassiveMaxDamage + %max health instead.
// Burst Fire (Q) is her real attack (wiki: "treated as a basic attack"): basic damage without spell
// effects, can crit, applies on-hit and on-attack effects. It counts as an ability cast for on-cast
// effects except Spellblade, so her right-click (as it hits) and W/E/R arm Spellblade and Burst Fire
// uses it (AA Q; in Q AA its hit lands before the attack's).
const charged: BuffSpec = {
  id: "zeriCharged",
  label: "Living Battery (charged)",
  duration: 999,
  empowerAttacks: {
    count: 1,
    replaceBase: true,
    components: [
      { id: "charged", label: "Charged attack", type: "magic", amount: "Q.calc.PassiveMaxDamage + Q.calc.PassiveMaxChargePercentHealth * target.maxHp" },
    ],
  },
};

// Burst Fire's rounds fly at 2600 (the data's), 3400 while Overcharged (wiki, not in the data).
const Q_TRAVEL = "reach / (buff.zeriR ? 3400 : missileSpeed)";
// Its rounds are fired evenly over the cast time (wiki): one hit here, fired when the middle round is.
const Q_DELAY = "-castTime / 2";

/** Shorten the remaining cooldown of an ability (no-op if it is ready). */
function reduceCooldown(sim: Sim, slot: "Q" | "W" | "E" | "R", seconds: number) {
  const key = `ability:${slot}`;
  const left = sim.cooldownReadyAt(key) - sim.time;
  if (left > 0) sim.startCooldown(key, Math.max(0, left - seconds));
}

const kit: ChampionKit = {
  id: "Zeri",
  status: "curated",
  notes: [
    "Basic attacks (AA) are Zeri's right-click, an ability with an attack's timing (a windup of 15.6% of the attack timer, then the hit, no missile): Q.calc.MinDamage magic damage that executes below PassiveExecuteThreshold health (marked on the health bar; Settings turn executes off). They are spell damage (Liandry's, Luden's…) and count as a cast as they hit (arming Spellblade then), but can't crit and apply no on-hit or on-attack effects (Spellblade's hit, Kraken Slayer, Energize charges…).",
    "Option charged (default on): the first AA of the combo is fully charged (she starts at full charge).",
    "Burst Fire (Q) is her attack in all but timing: basic damage without spell effects, can crit, applies on-hit and on-attack effects (it uses an armed Spellblade: AA Q, not Q AA, where the attack arms it as it lands after Burst Fire's hit; at high attack speed the attack can land first). It is an ability cast that doesn't arm Spellblade. Its cast time is her attack windup (80% while Overcharged); its 7 rounds (3 while Overcharged) fire over it and fly to the target, one hit here when the middle round lands, so an AA after it lands as the last rounds do. Its cooldown is its own attack timer, separate from the AA's: max(MinCooldown, 1 / attack speed), not shortened by haste or Navori; Spark Surge resets it.",
    "Her attack speed cap is Q.dv.AttackSpeedCap (1.5), raised only by Overcharged's attack speed, by as much as it adds (not Hail of Blades); she gains Q.dv.ExcessAttackSpeedToADMult (0.6) bonus AD per 1% bonus attack speed past it, Overcharged's not counted.",
    "Spark Surge adds its magic damage to Burst Fire casts for 5s; charged attacks and Burst Fire shorten its cooldown by 0.5s (1.5s on a Burst Fire crit, its expected value by default). Lightning Crash: champion hits by abilities and charged attacks extend Overcharge by 2.5s (up to 5s remaining); chain damage to other enemies is ignored.",
  ],
  options: [{ key: "charged", label: "First attack is fully charged", default: 1, toggle: true }],
  attack: { type: "magic", canCrit: false, damageMult: "Q.calc.MinDamage / ad", ability: true },
  // Burst Fire: her attack speed cap is 1.5 (raised by Overcharged's attack speed only), and 0.6 AD
  // per 1% bonus attack speed past it (wiki: calculated before Overcharged's).
  stats: ({ evalExpr }) => ({
    attackSpeedCapLimit: evalExpr("Q.dv.AttackSpeedCap"),
    conversions: [{ from: "bonusAttackSpeedOverCap", to: "ad", ratio: evalExpr("Q.dv.ExcessAttackSpeedToADMult") * 100, source: "Burst Fire" }],
  }),
  hooks: {
    onStart(sim) {
      if (sim.opt.charged) sim.applyBuff(charged, "P", sim.spellFor("P"), 1);
    },
    onAttack(sim, atk) {
      // Spark Surge's cooldown: Burst Fire and charged attacks (the right-click's empowered one).
      const q = atk.fromAbility === "Q";
      if (atk.phantom || !(q || (!atk.fromAbility && atk.replaceBase)) || sim.rankOf("E") <= 0) return;
      const per = sim.evalExpr("E.dv.CDReductionPerHit", { slot: "E" });
      const crit = sim.evalExpr("E.dv.CritCDReductionPerHit", { slot: "E" });
      reduceCooldown(sim, "E", q ? per + (crit - per) * atk.naturalCrit : per);
    },
    afterDamage(sim, inst) {
      // Uncharged attack execute.
      if (inst.flags.attack && inst.source === "AA")
        sim.deal({
          source: "P",
          sourceLabel: "Living Battery",
          label: "Living Battery (execute)",
          type: "true",
          amount: sim.evalExpr("Q.calc.PassiveExecuteThreshold", { slot: "Q" }),
          castId: inst.castId,
          flags: { kind: "ability", slot: "P", execute: true },
        });
      // Overcharge extension on ability (or charged attack) hits.
      const r = sim.buffs.get("zeriR");
      const extends_ = ["Q", "W", "E", "R"].includes(inst.source) || (inst.source === "P" && inst.flags.attack); // abilities or the charged attack
      if (r && r.expires >= sim.time && !inst.fromMark && extends_) {
        const max = sim.time + sim.evalExpr("R.dv.RDuration", { slot: "R" });
        r.expires = Math.min(max, r.expires + sim.evalExpr("R.dv.DurationIncreasePerHit", { slot: "R" }));
      }
    },
  },
  abilities: {
    Q: {
      // Wiki: her attack windup, 80% of it while Overcharged.
      castTime: "buff.zeriR ? 0.8 * windup : windup",
      // The data's cooldown is 0; the wiki's is 1 / attack speed.
      cooldown: "max(dv.MinCooldown, 1 / as)",
      attackTimer: true,
      noSpellblade: true,
      components: [
        // Treated as a basic attack (wiki): basic damage, no spell effects.
        {
          id: "burst",
          label: "Burst Fire",
          type: "physical",
          amount: "calc.ActiveDamageThatCanCrit",
          attack: true,
          onAttack: true,
          noProc: true,
          delay: Q_DELAY,
          travel: Q_TRAVEL,
        },
        {
          id: "surge",
          label: "Spark Surge",
          type: "magic",
          amount: "E.calc.BonusDamageTotal",
          hits: "buff.zeriE",
          maxHits: 1,
          delay: Q_DELAY,
          travel: Q_TRAVEL,
          proc: true,
          condition: "during Spark Surge",
        },
      ],
    },
    W: {
      // Wiki: 0.55s less 0.09s per 100% bonus attack speed, at least 0.3s.
      castTime: "max(dv.MinCastTime, dv.BaseCastTime - dv.ASpeedCastTimeScalarPerHundrethSecond * bonusAs)",
      cc: [{ kind: "slow", duration: "dv.SlowDuration" }],
      variants: {
        wall: {
          label: "wall laser",
          note: "The pulse hits terrain and becomes a laser that crits champions.",
          cc: [{ kind: "slow", duration: "dv.SlowDuration" }],
          components: [{ id: "laser", label: "Ultrashock Laser (laser)", type: "physical", amount: "calc.WallDamage", aoe: true, delay: "dv.BeamCastTime" }],
        },
      },
      // Wiki: {{Effect at cast time start}}: the pulse flies during the cast time.
      components: [{ id: "pulse", label: "Ultrashock Laser", type: "physical", amount: "calc.TotalDamage", travel: "reach / missileSpeed - castTime" }],
    },
    E: {
      dash: true,
      noTarget: true,
      // Wiki: resets her attack timer and Burst Fire's cooldown (an attack timer too).
      resetsAttack: true,
      // Wiki: she dashes 300 units at 600 + her movement speed (not in the data); Ultrashock Laser and
      // Lightning Crash can be cast during the dash, Burst Fire can't.
      attackLockout: "castTime + dv.MaxDistance / (600 + ms)",
      castLockout: { Q: "castTime + dv.MaxDistance / (600 + ms)" },
      buff: { id: "zeriE", label: "Spark Surge", duration: "dv.BuffDuration" },
    },
    R: {
      buff: { id: "zeriR", label: "Lightning Crash", duration: "dv.RDuration", stats: { attackSpeedPastCap: "dv.BaseASPercent", msPercent: "dv.BaseBonusMS" } },
      components: [{ id: "nova", label: "Lightning Crash", type: "magic", amount: "calc.TotalActiveDamage", aoe: true }],
    },
  },
};
export default kit;
