import type { ChampionKit } from "../../engine/kit-types.ts";
import type { Sim } from "../../engine/sim.ts";

// Tristana — patch 16.20.
// Explosive Charge: the bomb gains a stack (+25%) for each attack / ability that hits the target and
// explodes after 4s or immediately at 4 stacks (which also refreshes Rocket Jump). Hook-driven:
// the stack count depends on hits after the cast, and the bomb can detonate early.
interface Bomb {
  token: number;
  stacks: number;
  counted: Set<number>;
}
const bombs = new WeakMap<Sim, Bomb | undefined>();
let nextToken = 1;
// Explosive Charge and Buster Shot fly to the target; Draw a Bead adds to their range (not in the data's).
const TO_TARGET = "min(distance, castRange + P.calc.BonusPassiveRange) / missileSpeed";

function detonate(sim: Sim, bomb: Bomb) {
  bombs.set(sim, undefined);
  const amp = sim.evalExpr("E.dv.ActivePerStackAmp", { slot: "E" });
  const amount = sim.evalExpr("E.calc.ActiveDamage", { slot: "E" }) * (1 + amp * bomb.stacks);
  sim.deal({
    source: "E",
    sourceLabel: "Explosive Charge",
    label: `Explosive Charge (${bomb.stacks} stacks)`,
    type: "physical",
    amount,
    flags: { kind: "ability", slot: "E", ability: true, aoe: true },
  });
  // Max-stack detonations on champions refresh Rocket Jump.
  if (bomb.stacks >= sim.evalExpr("E.dv.ActiveMaxStacks", { slot: "E" })) sim.startCooldown("ability:W", 0);
}

const kit: ChampionKit = {
  id: "Tristana",
  status: "curated",
  notes: [
    "Explosive Charge: +25% damage per attack or ability hit on the target after it is attached (one stack per attack / cast); explodes after 4s or at once at 4 stacks, which refreshes Rocket Jump.",
    "The bomb's crit-chance scaling is part of the game formula (E.calc.ActiveDamage). The on-kill passive splash is not modeled.",
  ],
  // Draw a Bead: attack range by level.
  stats: ({ evalExpr }) => ({ range: evalExpr("P.calc.BonusPassiveRange") }),
  hooks: {
    onCast(sim, cast) {
      if (cast.slot !== "E" || !cast.hitsTarget) return;
      // The bomb attaches once it has flown to the target, after the cast time.
      sim.schedule((cast.castTime ?? 0) + sim.evalExpr(TO_TARGET, { slot: "E" }), () => {
        const bomb: Bomb = { token: nextToken++, stacks: 0, counted: new Set() };
        bombs.set(sim, bomb);
        sim.schedule(sim.evalExpr("E.dv.ActiveDuration", { slot: "E" }), () => {
          if (bombs.get(sim)?.token === bomb.token) detonate(sim, bomb);
        });
      });
    },
    afterDamage(sim, inst) {
      const bomb = bombs.get(sim);
      if (!bomb || inst.flags.proc || inst.fromMark || inst.source === "E") return;
      const isAttack = inst.flags.attack;
      const isAbility = inst.flags.kind === "ability" && !!inst.flags.slot && inst.flags.slot !== "P" && !inst.flags.onHit;
      if (!(isAttack || isAbility) || bomb.counted.has(inst.castId)) return;
      bomb.counted.add(inst.castId);
      bomb.stacks++;
      if (bomb.stacks >= sim.evalExpr("E.dv.ActiveMaxStacks", { slot: "E" })) detonate(sim, bomb);
    },
  },
  abilities: {
    Q: {
      noTarget: true,
      buff: { id: "rapidFire", label: "Rapid Fire", duration: "dv.BuffDuration", stats: { attackSpeed: "dv.AttackSpeedMod" } },
      components: [],
    },
    W: {
      dash: true,
      cc: [{ kind: "slow", duration: "dv.SlowDuration" }],
      notes: ["Lands after jumping to the target at its speed."],
      // Wiki: she can cast any of her abilities during the jump.
      attackLockout: "castTime + reach / missileSpeed",
      components: [{ id: "landing", label: "Rocket Jump", type: "magic", amount: "calc.LandingDamage", aoe: true, travel: true }],
    },
    E: {
      // Wiki: her attack windup.
      castTime: "windup",
      notes: ["Attaches the bomb; damage comes from the detonation (hook)."],
      components: [],
    },
    R: {
      cc: [{ kind: "immobilize", duration: "dv.StunDuration" }],
      components: [{ id: "buster", label: "Buster Shot", type: "magic", amount: "calc.DamageCalc", travel: TO_TARGET }],
    },
  },
};
export default kit;
