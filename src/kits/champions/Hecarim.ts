import type { BuffSpec, ChampionKit } from "../../engine/kit-types.ts";

// Hecarim — patch 16.20.
const CHARGE_LABEL = "Devastating Charge";
const KNOCKBACK = 0.5; // nominal displacement duration (not in the data)

const charge = (amount: string): BuffSpec => ({
  id: "hecarimE",
  label: CHARGE_LABEL,
  duration: "dv.Duration",
  empowerAttacks: {
    count: 1,
    resetsAttack: true,
    cc: [{ kind: "immobilize", duration: KNOCKBACK }],
    components: [{ id: "charge", label: CHARGE_LABEL, type: "physical", amount }],
  },
});

const kit: ChampionKit = {
  id: "Hecarim",
  status: "curated",
  notes: [
    "Warpath: bonus AD from bonus move speed is computed once from items/runes; temporary move speed (Devastating Charge, boots actives, Phase Rush…) is not included.",
    "Rampage: each Q that hits adds a stack: later Qs deal +calc.RampageBonusDamagePerc % per stack and have dv.RampageCooldownReduction s less base cooldown per stack (4/3.25/2.5/1.75 at rank 5).",
    "Devastating Charge defaults to minimum damage (no travel); E:max after travelling dv.DistanceToMaxDamage units. Bonus damage on top of the attack.",
  ],
  stats: ({ evalExpr }) => ({ ad: evalExpr("P.calc.BonusAD") }),
  marks: [{ id: "rampage", label: "Rampage", slot: "Q", maxStacks: "Q.dv.MaxStacks", duration: "Q.dv.BuffDuration", appliedBy: ["Q"] }],
  abilities: {
    Q: {
      // Base cooldown minus 0.75s per Rampage stack held at cast (haste applies after).
      cooldown: "cooldown - dv.RampageCooldownReduction * stacks.rampage",
      components: [
        // Instant (wiki: no cast time).
        { id: "rampage", label: "Rampage", type: "physical", amount: "calc.Damage * (1 + calc.RampageBonusDamagePerc / 100 * stacks.rampage)", aoe: true },
      ],
    },
    W: {
      buff: { id: "hecarimW", label: "Spirit of Dread", duration: "dv.BuffDuration", stats: { armor: "dv.ResistAmount", mr: "dv.ResistAmount" } },
      components: [
        {
          id: "dread",
          label: "Spirit of Dread",
          type: "magic",
          amount: "calc.TotalDamage * dv.TickTime / dv.BuffDuration",
          hits: "dv.BuffDuration / dv.TickTime",
          interval: "dv.TickTime",
          delay: "dv.TickTime",
          aoe: true,
          dot: true,
        },
      ],
    },
    E: {
      noTarget: true,
      resetsAttack: true,
      notes: ["Empowers the next attack (bonus damage + knockback). Follow with AA."],
      buff: charge("E.calc.MinDamage"),
      variants: {
        max: { label: "max", note: "Charged the full distance: maximum damage.", resetsAttack: true, buff: charge("E.calc.MaxDamage"), components: [] },
      },
    },
    R: {
      dash: true,
      // He dashes to the target (300 units at least, wiki) at the dash's (and riders') speed; the
      // riders charge alongside him through the target (castRange is the riders' 1510).
      lockout: "castTime + min(max(300, distance), dv.MaxDashRange) / missileSpeed",
      notes: ["Fear assumes a full-distance charge (dv.FearDurationMax)."],
      cc: [{ kind: "immobilize", duration: "dv.FearDurationMax" }],
      components: [{ id: "onslaught", label: "Onslaught of Shadows", type: "magic", amount: "calc.DamageDone", aoe: true, travel: true }],
    },
  },
};
export default kit;
