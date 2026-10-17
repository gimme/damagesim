import type { ChampionKit } from "../../engine/kit-types.ts";

// Smolder — patch 16.20.
// Dragon Practice stacks are an option (fed to the game formulas' stack counter). Stacks gained
// during the combo are ignored. Dragon Practice's bonus damage in Q/W/E is proc damage (wiki).
const STACKS = "{32bcea5d}";
// Super Scorcher Breath's range is his attack range (wiki; the data's is its Tier 2 missiles').
const Q_REACH = "min(distance, range)";
const Q_TRAVEL = `${Q_REACH} / missileSpeed`;

const kit: ChampionKit = {
  id: "Smolder",
  status: "curated",
  notes: [
    'Dragon Practice stacks (option "stacks") add magic damage to Q/W/E; Flap, Flap, Flap gains a bolt per 100 stacks.',
    "Super Scorcher Breath tiers: 25 (area around the target) and 125 (explosions beyond the target) do not change single-target damage; at 225 the target burns for % max health true damage over 3s and is executed below 6.5% health by Smolder's next damage while burning.",
  ],
  options: [{ key: "stacks", label: "Dragon Practice stacks", default: 125, min: 0, max: 1000, step: 5 }],
  buffStacks: { [STACKS]: "opt.stacks" },
  abilities: {
    Q: {
      // Wiki: his attack windup.
      castTime: "windup",
      components: [
        // Applies on-hit effects and triggers on-attack effects (Spellblade, Energized, Guinsoo's stacks…).
        { id: "breath", label: "Super Scorcher Breath", type: "physical", amount: "calc.TotalDamage", onHit: true, onAttack: true, travel: Q_TRAVEL },
        {
          id: "practice",
          label: "Super Scorcher Breath (Dragon Practice)",
          type: "magic",
          amount: "P.calc.Passive_QDamageIncrease",
          hits: "opt.stacks > 0 ? 1 : 0",
          travel: Q_TRAVEL,
          proc: true,
        },
        {
          id: "burn",
          label: "Super Scorcher Breath (burn)",
          type: "true",
          // 225+ stacks: ticks once per second (wiki). The wiki: "The burn deals proc damage" (no
          // Liandry's, unlike Brand's passive burn).
          amount: "calc.Tier3_Burn * target.maxHp / dv.Tier3_DotLength",
          hits: "opt.stacks >= dv.StackTier3 ? dv.Tier3_DotLength : 0",
          interval: 1,
          delay: 1,
          travel: Q_TRAVEL,
          dot: true,
          proc: true,
        },
      ],
    },
    W: {
      cc: [{ kind: "slow", duration: "dv.SlowDuration" }],
      components: [
        { id: "sneeze", label: "Achooo!", type: "physical", amount: "calc.InitialDamage", travel: true },
        { id: "explosion", label: "Achooo! (explosion)", type: "physical", amount: "calc.ExplosionDamage", aoe: true, travel: true },
        {
          id: "practice",
          label: "Achooo! (Dragon Practice)",
          type: "magic",
          amount: "P.calc.Passive_WDamageIncrease",
          hits: "opt.stacks > 0 ? 1 : 0",
          aoe: true,
          travel: true,
          proc: true,
        },
      ],
    },
    E: {
      // Not a dash: it doesn't arm Sudden Impact.
      notes: [
        "Bolts hit the lowest-health enemy (the target) evenly over the flight; they are ability damage, not attacks.",
        "Full flight by default: Smolder is busy for 1.25s. Set the seconds (E{0.5s}) to end it early, as another cast or flying out of range does in the game.",
      ],
      // In flight an attack command only moves Smolder, and a cast ends the flight.
      lockout: "dv.Duration",
      variableDuration: true,
      components: [
        {
          id: "bolt",
          label: "Flap, Flap, Flap",
          type: "physical",
          amount: "calc.DamagePerHit",
          hits: "floor(calc.TotalNumberOfAttacks)",
          interval: "dv.Duration / floor(calc.TotalNumberOfAttacks)",
          travel: true,
        },
        {
          id: "practice",
          label: "Flap, Flap, Flap (Dragon Practice)",
          type: "magic",
          amount: "P.calc.EBonusDamage",
          hits: "opt.stacks > 0 ? floor(calc.TotalNumberOfAttacks) : 0",
          interval: "dv.Duration / floor(calc.TotalNumberOfAttacks)",
          travel: true,
          proc: true,
        },
      ],
    },
    R: {
      notes: ["Default: hit by the edge of the breath. R:center = sweet spot (150% damage + slow)."],
      // Called as the cast time starts (wiki: {{Effect at cast time start}}), she breathes MomSpawnDelay
      // later; the wave flies to the target from MomDistBehindOffset behind Smolder.
      components: [
        {
          id: "breath",
          label: "MMOOOMMMM!",
          type: "physical",
          amount: "calc.TotalDamage",
          aoe: true,
          delay: "dv.MomSpawnDelay - castTime",
          travel: "(dv.MomDistBehindOffset + reach) / missileSpeed",
        },
      ],
      variants: {
        center: {
          label: "center",
          cc: [{ kind: "slow", duration: "dv.SlowDuration" }],
          components: [
            {
              id: "breath",
              label: "MMOOOMMMM! (center)",
              type: "physical",
              amount: "calc.TooltipOnly_TotalSweetspotDamage",
              aoe: true,
              delay: "dv.MomSpawnDelay - castTime",
              travel: "(dv.MomDistBehindOffset + reach) / missileSpeed",
            },
          ],
        },
      },
    },
  },
  hooks: {
    // 225 stacks: Smolder's damage executes a burning target below the threshold. The burn starts
    // with Q's hit, not its cast: a W landing in between doesn't execute.
    afterDamage(sim, inst) {
      const q = { slot: "Q" as const };
      if (inst.source === "Q" && inst.label === "Super Scorcher Breath" && sim.opt.stacks >= sim.evalExpr("Q.dv.StackTier3", q))
        sim.setCounter("smolderBurnUntil", sim.time + sim.evalExpr("Q.dv.Tier3_DotLength", q));
      if (sim.time > sim.counter("smolderBurnUntil")) return;
      const line = sim.evalExpr("Q.calc.Tier3_ExecuteThreshold", q) * sim.target.maxHp;
      if (sim.target.hp >= line) return;
      sim.deal({
        source: "Q",
        sourceLabel: "Super Scorcher Breath",
        label: "Super Scorcher Breath (execute)",
        type: "true",
        amount: line,
        castId: inst.castId,
        flags: { kind: "ability", slot: "Q", execute: true },
      });
    },
  },
};
export default kit;
