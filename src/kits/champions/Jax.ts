import type { ChampionKit } from "../../engine/kit-types.ts";

// Jax — patch 16.20.
// Grandmaster-at-Arms passive is a mark (every 3rd attack, every 2nd during R). Hooks: Relentless
// Assault (attack speed stacks) and Empower being consumed by Leap Strike.
const RELENTLESS_DURATION = 2.5; // P.dv.BuffDuration; stacks then fall off one every 0.25s (wiki)
const Q_ARRIVAL = 0.25; // No dash speed in the data: Leap Strike takes ~0.25s to arrive.

const kit: ChampionKit = {
  id: "Jax",
  status: "curated",
  notes: [
    "Relentless Assault: +P.calc.AttackSpeedPerStack attack speed per attack (max P.dv.MaxStacks, 2.5s, then decaying one stack per 0.25s).",
    "Grandmaster-at-Arms (R passive, R learned): every 3rd attack within 2.5s deals R.calc.OnHitDamage bonus magic damage; every 2nd while R is active.",
    'Empower (W) is consumed by the next attack or Leap Strike, whichever comes first ("W Q" adds Empower to Q).',
  ],
  marks: [
    {
      id: "grandmaster",
      label: "Grandmaster-at-Arms",
      slot: "R",
      // Procs on the 3rd attack (2nd while R is active); never before R is learned.
      maxStacks: "R.rank > 0 ? (buff.jaxR ? 2 : 3) : 1000",
      duration: "R.dv.PassiveFallOffTime",
      appliedBy: ["attack"],
      // The wiki: "The on-hit deals proc damage. The swing deals area damage."
      atMax: { consume: true, components: [{ id: "gm", label: "Grandmaster-at-Arms (passive)", type: "magic", amount: "R.calc.OnHitDamage", proc: true }] },
    },
  ],
  options: [
    {
      key: "dodges",
      label: "Attacks dodged by Counter Strike",
      default: 0,
      min: 0,
      max: 5,
      description: "Each dodged attack increases Counter Strike damage by 20% (max 5).",
    },
  ],
  abilities: {
    Q: {
      dash: true,
      // He can cast any ability during the dash (wiki).
      attackLockout: Q_ARRIVAL,
      notes: ["Does not apply on-hit effects."],
      components: [{ id: "leap", label: "Leap Strike", type: "physical", amount: "calc.TotalDamage", delay: Q_ARRIVAL }],
    },
    W: {
      resetsAttack: true,
      // Empower lasts 10s (wiki; no data value).
      buff: {
        id: "jaxW",
        label: "Empower",
        duration: 10,
        empowerAttacks: { count: 1, resetsAttack: true, components: [{ id: "empower", label: "Empower", type: "magic", amount: "W.calc.TotalDamage" }] },
      },
    },
    E: {
      notes: [
        "Default: Counter Strike ends after dv.DodgeDuration seconds (it can be recast after 1s).",
        'Option "dodges" raises the damage by dv.PercentIncreasedPerDodge per dodged attack (max dv.MaxDodgesForDamageIncrease).',
      ],
      cc: [{ kind: "immobilize", duration: "dv.StunDuration" }],
      components: [
        {
          id: "strike",
          label: "Counter Strike",
          type: "magic",
          amount:
            "(calc.TotalDamage + dv.PercentHealthDamage / 100 * target.maxHp) * (1 + dv.PercentIncreasedPerDodge * min(opt.dodges, dv.MaxDodgesForDamageIncrease))",
          delay: "dv.DodgeDuration",
          aoe: true,
        },
      ],
    },
    R: {
      notes: ["Active: lantern slam + armor/MR for dv.Duration s; during that time every 2nd attack procs the passive."],
      buff: { id: "jaxR", label: "Grandmaster-at-Arms", duration: "dv.Duration", stats: { armor: "calc.BaseArmor", mr: "calc.BaseMR" } },
      components: [{ id: "slam", label: "Grandmaster-at-Arms", type: "magic", amount: "calc.SwingDamageTotal", aoe: true }],
    },
  },
  hooks: {
    onStart(sim) {
      // Read once: dynamicStats must not evaluate expressions.
      sim.setCounter("jax.asPerStack", sim.evalExpr("P.calc.AttackSpeedPerStack", { slot: "P" }));
      sim.setCounter("jax.maxStacks", sim.evalExpr("P.dv.MaxStacks", { slot: "P" }));
    },
    dynamicStats(sim) {
      const stacks = relentlessStacks(sim);
      return stacks > 0 ? { attackSpeed: stacks * sim.counter("jax.asPerStack") } : undefined;
    },
    onCast(sim, cast) {
      // Empower on Leap Strike: extra magic damage when Q lands.
      if (cast.slot !== "Q" || !cast.hitsTarget || !sim.getBuff("jaxW")) return;
      sim.removeBuff("jaxW");
      const castTime = sim.spellFor("Q").castTime ?? 0;
      sim.schedule(castTime + Q_ARRIVAL, () =>
        sim.deal({
          source: "W",
          sourceLabel: "Empower",
          label: "Empower (Leap Strike)",
          type: "magic",
          amount: sim.evalExpr("W.calc.TotalDamage", { slot: "W" }),
          castId: cast.castId,
          flags: { kind: "ability", slot: "W", ability: true },
        }),
      );
    },
    onAttack(sim, atk) {
      if (atk.fromAbility || atk.phantom) return;
      // Relentless Assault stack.
      sim.setCounter("jax.relentless", Math.min(sim.counter("jax.maxStacks"), relentlessStacks(sim) + 1));
      sim.setCounter("jax.relentlessUntil", sim.time + RELENTLESS_DURATION);
    },
  },
};

/** Relentless Assault stacks at the current time (after expiry they fall off one per 0.25s). */
function relentlessStacks(sim: import("../../engine/sim.ts").Sim): number {
  const stacks = sim.counter("jax.relentless");
  const over = sim.time - sim.counter("jax.relentlessUntil");
  return over <= 0 ? stacks : Math.max(0, stacks - Math.floor(over / 0.25) - 1);
}
export default kit;
