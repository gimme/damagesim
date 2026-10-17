import type { BuffSpec, ChampionKit } from "../../engine/kit-types.ts";

// Renekton — patch 16.20.
// Fury: abilities are empowered when cast above 50 Fury. Which ability spends the Fury is chosen
// with the ":fury" variants (Q:fury, W:fury, E:fury for the Dice recast).
const ruthless = (fury: boolean): BuffSpec => ({
  id: "renektonW",
  label: "Ruthless Predator",
  duration: "dv.BuffDuration",
  empowerAttacks: {
    count: 1,
    replaceBase: true,
    resetsAttack: true,
    // Every strike applies on-hit effects (wiki): one extra pass per extra strike.
    onHitRepeats: fury ? 2 : 1,
    components: [
      // Only the first strike can crit (wiki); it is the attack itself.
      { id: "strike1", label: "Ruthless Predator", type: "physical", amount: "W.calc.HitDamage", canCrit: true },
      { id: "strikes", label: "Ruthless Predator", type: "physical", amount: "W.calc.HitDamage", hits: fury ? 2 : 1 },
    ],
  },
});

const kit: ChampionKit = {
  id: "Renekton",
  status: "curated",
  notes: [
    "Fury bonuses are chosen per cast with variants: Q:fury, W:fury, E E:fury (empowered Dice). Fury generation is not tracked.",
    "Ruthless Predator strikes 2 (3 with Fury) times; every strike applies on-hit effects (wiki). Only the first strike can crit.",
    "Dominus: 10 ticks (5s of the 15s aura) by default; set R{aura:N} for other uptimes.",
  ],
  abilities: {
    Q: {
      // Wiki: no attacks, Slice and Dice or Dominus for 0.25s after activation (Ruthless Predator,
      // which only readies an attack, can be cast).
      lockout: 0.25,
      components: [{ id: "cleave", label: "Cull the Meek", type: "physical", amount: "calc.BasicDamage", aoe: true }],
      variants: {
        fury: { label: "fury", components: [{ id: "cleave", label: "Cull the Meek (Fury)", type: "physical", amount: "calc.EmpDamage", aoe: true }] },
      },
    },
    W: {
      resetsAttack: true,
      castTime: 0,
      notes: ['Empowers the next attack: write "W AA". The stun is applied when W is cast (close to the empowered attack).'],
      cc: [{ kind: "immobilize", duration: "dv.StunDuration" }],
      buff: ruthless(false),
      components: [],
      variants: {
        fury: { label: "fury", cc: [{ kind: "immobilize", duration: "dv.EnragedStunDuration" }], buff: ruthless(true), components: [] },
      },
    },
    E: {
      dash: true,
      recasts: 2,
      recastDelay: 0.25,
      notes: ['Slice, then recast for Dice ("E E"); "E E:fury" for the empowered Dice (more damage and armor shred).'],
      // Dashes its full range at dv.BaseDashSpeed + his movement speed (wiki: 760 + 100% movement
      // speed; no speed in the data), hitting the target as he passes through it.
      lockout: "castTime + castRange / (dv.BaseDashSpeed + ms)",
      components: [{ id: "dash", label: "Slice and Dice", type: "physical", amount: "calc.BasicDamage", aoe: true, travel: "reach / (dv.BaseDashSpeed + ms)" }],
      variants: {
        fury: {
          label: "fury",
          dash: true,
          debuff: { id: "renektonShred", label: "Dice armor shred", duration: "dv.ShredTimer", armorReduction: "dv.EnragedArmorShred / 100" },
          components: [{ id: "dash", label: "Dice (Fury)", type: "physical", amount: "calc.EmpDamage", aoe: true, travel: "reach / (dv.BaseDashSpeed + ms)" }],
        },
      },
    },
    R: {
      components: [
        {
          id: "aura",
          label: "Dominus",
          type: "magic",
          amount: "calc.TotalDamagePerSecond * dv.TickRate",
          hits: 10,
          maxHits: "dv.BuffDuration / dv.TickRate",
          interval: "dv.TickRate",
          delay: "dv.TickRate",
          aoe: true,
          dot: true,
        },
      ],
    },
  },
  hooks: {
    // Wiki: after the empowered attack's cast time, unable to move or cast Q/E for 0.525s.
    onLaunch(sim, launch) {
      if (!launch.fromAbility && (sim.getBuff("renektonW")?.charges ?? 0) > 0) sim.lockCasts(["Q", "E"], sim.time + 0.525);
    },
  },
};
export default kit;
