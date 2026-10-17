import type { BuffSpec, ChampionKit } from "../../engine/kit-types.ts";

// Akali — patch 16.20.
// Assassin's Mark: ability damage creates a ring; leaving it empowers the next attack. Modeled as a
// self buff from every damaging ability (ring 4s + empowered 4s), consumed by the next attack.
const assassinsMark: BuffSpec = {
  id: "assassinsMark",
  label: "Assassin's Mark",
  duration: 8,
  empowerAttacks: {
    count: 1,
    components: [{ id: "mark", label: "Assassin's Mark", type: "magic", amount: "P.calc.Damage" }],
  },
};

// Shuriken Flip's dashes, at 1500 speed (wiki): the first cast flips back SelfKnockbackRange from
// 0.15s into its cast time; the recast dashes to the target the shuriken hit, from where the flip
// left her.
const E_DASH = "recast == 1 ? 0.15 + dv.SelfKnockbackRange / 1500 : castTime + (reach + dv.SelfKnockbackRange) / 1500";
// Perfect Execution's first dash: its range at its speed.
const R1_DASH = "castTime + castRange / missileSpeed";
// The recast dashes its range at 3000 speed (wiki), through the target on the way.
const R2_DASH = "spell['AkaliRb'].castRange / 3000";
const R2_HIT = "spell['AkaliRb'].reach / 3000";

const kit: ChampionKit = {
  id: "Akali",
  status: "curated",
  notes: [
    "Assassin's Mark: every damaging ability arms the next attack (the walk out of the ring is not simulated — the attack is assumed to happen after leaving it).",
    'E and R are two-part abilities: "E E" / "R R" cast the first part then the recast.',
  ],
  abilities: {
    P: { notes: ["Empowered attack damage uses the passive's tooltip formula (P.calc.Damage)."] },
    Q: {
      buff: assassinsMark,
      cc: [{ kind: "slow", duration: "dv.SlowDuration" }],
      // Wiki: hits at the end of the cast time (no missile speed in the data).
      components: [{ id: "kunai", label: "Five Point Strike", type: "magic", amount: "calc.Damage", aoe: true }],
    },
    W: { noTarget: true, notes: ["Shroud: invisibility and energy only."] },
    E: {
      buff: assassinsMark,
      dash: true,
      recasts: 2,
      // The recast needs the shuriken's mark: it lands after flying to the target.
      recastDelay: "castTime + reach / missileSpeed",
      // Wiki: Twilight Shroud and Perfect Execution can be cast during either dash; Five Point Strike
      // waits for the dash to end.
      attackLockout: E_DASH,
      castLockout: { Q: E_DASH },
      notes: ["First cast: shuriken (30% of the total); recast: dash to the marked target (70%)."],
      components: [
        { id: "shuriken", label: "Shuriken Flip", type: "magic", amount: "calc.E1Damage", hits: "recast == 1 ? 1 : 0", travel: true },
        {
          id: "dash",
          label: "Shuriken Flip (recast)",
          type: "magic",
          amount: "calc.E2DamageCalc",
          hits: "recast == 2 ? 1 : 0",
          travel: "(reach + dv.SelfKnockbackRange) / 1500",
        },
      ],
    },
    R: {
      buff: assassinsMark,
      dash: true,
      recasts: 2,
      recastDelay: "dv.CooldownBetweenCasts",
      // Wiki: Shuriken Flip can be cast during the first dash. Nothing during the recast's.
      attackLockout: `recast == 1 ? ${R1_DASH} : 0`,
      castLockout: { Q: `recast == 1 ? ${R1_DASH} : 0`, W: `recast == 1 ? ${R1_DASH} : 0` },
      lockout: `recast == 2 ? castTime + ${R2_DASH} : 0`,
      notes: [
        "First cast: vault; recast (after 2.5s): execute dash dealing up to 3× damage, scaling linearly with missing health until the target is at 30% health or less (computed when it lands).",
      ],
      components: [
        { id: "vault", label: "Perfect Execution", type: "magic", amount: "calc.Cast1Damage", hits: "recast == 1 ? 1 : 0", aoe: true, travel: true },
        {
          id: "execute",
          label: "Perfect Execution (recast)",
          type: "magic",
          amount: "calc.Cast2DamageMin * (1 + (calc.Cast2DamageMax / calc.Cast2DamageMin - 1) * min(1, target.missingHpPct / (1 - dv.MaxExecuteThreshold)))",
          max: "calc.Cast2DamageMax",
          hits: "recast == 2 ? 1 : 0",
          aoe: true,
          travel: R2_HIT,
        },
      ],
    },
  },
};
export default kit;
