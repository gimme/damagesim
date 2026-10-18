import type { ChampionKit } from "../../engine/kit-types.ts";
import { forceCrit } from "../../engine/effects.ts";

// Shaco — patch 16.20.
// Backstab (option "backstab", on by default): attacks and Two-Shiv Poison from behind deal bonus
// damage. Every attack from behind gets it (no per-target cooldown).
const kit: ChampionKit = {
  id: "Shaco",
  status: "curated",
  notes: [
    'Option "backstab" (default on): Shaco strikes from behind — Backstab bonus on every attack and on Two-Shiv Poison, and the Deceive attack critically strikes.',
    "Two-Shiv Poison passive (attacks slow while E is off cooldown) is not modeled.",
  ],
  options: [{ key: "backstab", label: "Attacking from behind", default: 1, toggle: true, description: "Backstab bonus damage and the Deceive backstab crit." }],
  attack: {
    onHit: [
      {
        id: "backstab",
        label: "Backstab",
        type: "physical",
        amount: "P.calc.BasicAttackDamage",
        // The Deceive attack already includes the backstab bonus in its crit.
        hits: "opt.backstab && !buff.deceive ? 1 : 0",
        canCrit: true,
      },
    ],
  },
  hooks: {
    preAttack(sim, atk) {
      // The Deceive attack from behind crits for Q.calc.QCritDamageMod, or full crit damage if a crit
      // was rolled (wiki).
      if (atk.phantom || !(sim.opt.backstab ?? 1) || !atk.extra.some((x) => x.label === "Deceive (backstab crit)")) return;
      forceCrit(atk, sim.evalExpr("Q.calc.QCritDamageMod", { slot: "Q" }) / atk.critMultiplier, 1);
    },
  },
  abilities: {
    Q: {
      dash: true,
      noTarget: true,
      // Wiki: he blinks after a 0.125s delay (PseudoCastTime).
      lockout: "dv.PseudoCastTime",
      notes: [
        'Next attack while invisible deals bonus damage. From behind it critically strikes for 1 + 60% × (crit damage − 1), or full crit damage if a crit was rolled (expected value). Write "Q AA".',
        "Use Q:front when not striking from behind (bonus damage, normal crit roll).",
      ],
      buff: {
        id: "deceive",
        label: "Deceive",
        duration: "dv.StealthDuration",
        empowerAttacks: {
          count: 1,
          replaceBase: true,
          components: [
            {
              id: "deceive",
              label: "Deceive (backstab crit)",
              type: "physical",
              // All of it crits (wiki: Deceive's and Backstab's bonus are affected by crit modifiers);
              // from behind it is a guaranteed crit (hook).
              amount: "ad + Q.calc.TotalDamage + (opt.backstab ? P.calc.BasicAttackDamage : 0)",
              canCrit: true,
            },
          ],
        },
      },
      variants: {
        front: {
          label: "front",
          buff: {
            id: "deceive",
            label: "Deceive",
            duration: "dv.StealthDuration",
            empowerAttacks: { count: 1, components: [{ id: "deceive", label: "Deceive", type: "physical", amount: "Q.calc.TotalDamage", canCrit: true }] },
          },
          components: [],
        },
      },
    },
    W: {
      notes: [
        "Springs once armed (2s), fears, then fires every 0.5s for 5s (wiki); single-target damage per shot. Default 6 shots (~3s of the target staying in range); up to 10.",
      ],
      cc: [{ kind: "immobilize", duration: "dv.FearDuration" }],
      // Sprung by the target once armed: it arms over 2s (wiki, ArmTime).
      components: [
        { id: "box", label: "Jack In The Box", type: "magic", amount: "calc.STDamage", hits: 6, maxHits: 10, interval: 0.5, delay: "dv.ArmTime", pet: true },
      ],
    },
    E: {
      cc: [{ kind: "slow", duration: "dv.SlowDurationActive" }],
      components: [
        {
          id: "shiv",
          label: "Two-Shiv Poison",
          type: "magic",
          amount: "target.hpPct < dv.ExecuteHealthThreshold ? calc.TotalExecuteDamage : calc.TotalDamage",
          travel: true,
        },
        {
          id: "backstab",
          label: "Two-Shiv Poison (backstab)",
          type: "magic",
          amount: "target.hpPct < dv.ExecuteHealthThreshold ? P.calc.ShivDamageExecute : P.calc.ShivDamage",
          hits: "opt.backstab",
          travel: true,
        },
      ],
    },
    R: {
      notes: [
        "The clone attacks alongside Shaco for 60% of his attack damage (modeled as an extra hit on each of Shaco's attacks for 4s).",
        "Assumes the clone dies ~4s into the fight: explosion + three mini boxes (fear; default 6 single-target shots ≈ 3 boxes × 1s).",
      ],
      buff: {
        id: "hallucinate",
        label: "Hallucinate",
        duration: 4,
        onHit: [{ id: "clone", label: "Clone attack", type: "physical", amount: "ad * R.dv.CloneAADamagePercent", canCrit: true, noProc: true }],
      },
      cc: [{ kind: "immobilize", duration: "dv.BoxFearDuration" }],
      components: [
        { id: "explosion", label: "Clone explosion", type: "magic", amount: "calc.ExplosionTotalDamage", aoe: true, pet: true, delay: 4 },
        { id: "boxes", label: "Mini Jack in the Box", type: "magic", amount: "calc.STDamage", hits: 6, maxHits: 30, interval: 0.5 / 3, delay: 4.1, pet: true },
      ],
    },
  },
};
export default kit;
