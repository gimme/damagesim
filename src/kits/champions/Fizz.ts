import type { ChampionKit } from "../../engine/kit-types.ts";
import type { Sim } from "../../engine/sim.ts";

// Fizz — patch 16.20.
// Hooks: Seastone Trident's post-active on-hit window starts only after the empowered attack lands
// (the empowered-attack buff is consumed by that attack); Chum the Waters' slow lands when the fish
// attaches, before the shark (the cast's first hit).

const W_ACTIVE_LABEL = "Seastone Trident (active)";
// Chum the Waters: the fish flies to the target at its speed, its shark the larger the farther (the
// step's distance, R{900u}; wiki: under 455 units, 455 to 910, over 910).
const R_FLIGHT = "reach / missileSpeed";
const R_SHARK = "reach > 910 ? calc.BigSharkDamage : reach >= 455 ? calc['{262c3c02}'] : calc.SmallSharkDamage";

const kit: ChampionKit = {
  id: "Fizz",
  status: "curated",
  notes: [
    "Seastone Trident passive: attacks and Urchin Strike apply a bleed (W.calc.DoTDamage over W.dv.BleedDuration, ticking every 0.5s, refreshed by new hits, not stacking).",
    "Seastone Trident active: the next attack deals bonus damage; if it does not kill, attacks deal W.calc.OnHitBuffDamage on-hit for W.dv.OnHitBuffDuration s afterwards (basic attacks only).",
    "Chum the Waters: the shark is the larger the farther the fish flies, the step's distance (R{900u}; by default the target's): under 455 units, 455 to 910, over 910 (wiki). The slow starts when the fish attaches; the knock-up comes with the shark.",
  ],
  marks: [
    {
      id: "tridentBleed",
      label: "Seastone Trident",
      slot: "W",
      maxStacks: 1,
      duration: "W.dv.BleedDuration",
      appliedBy: ["onhit"],
      dot: {
        interval: "1 / W.dv.DoTTicksPerSecond",
        components: [
          {
            id: "bleed",
            label: "Seastone Trident (bleed)",
            type: "magic",
            amount: "W.rank > 0 ? W.calc.DoTDamage / (W.dv.BleedDuration * W.dv.DoTTicksPerSecond) : 0",
            dot: true,
          },
        ],
      },
    },
  ],
  abilities: {
    Q: {
      dash: true,
      // No dash speed in the data: ~0.35s to arrive. W and R can be cast during the dash (wiki), E
      // not for ~0.5s.
      attackLockout: 0.35,
      castLockout: { E: 0.5 },
      notes: ["The physical part (100% AD) applies on-hit effects; the magic part is separate."],
      components: [
        { id: "strike", label: "Urchin Strike", type: "physical", amount: "calc.TotalDamage", onHit: true, delay: 0.35 },
        { id: "magic", label: "Urchin Strike (magic)", type: "magic", amount: "calc.QDamage", delay: 0.35 },
      ],
    },
    W: {
      resetsAttack: true,
      notes: ["Attack reset; follow with AA."],
      buff: {
        id: "fizzW",
        label: "Seastone Trident",
        duration: "dv.ActiveDuration",
        empowerAttacks: { count: 1, resetsAttack: true, components: [{ id: "active", label: W_ACTIVE_LABEL, type: "magic", amount: "W.calc.ActiveDamage" }] },
      },
    },
    E: {
      dash: true,
      notes: ["Untargetable for 0.75s, then lands. The recast (second hop) deals the same damage in a smaller area without the slow."],
      // Wiki: dashes and balances on his trident for 0.75s, then lands; busy until then.
      lockout: 0.75,
      cc: [{ kind: "slow", duration: "dv.SlowDuration" }],
      components: [{ id: "land", label: "Playful / Trickster", type: "magic", amount: "calc.EDamage", aoe: true, delay: 0.75 }],
    },
    R: {
      notes: ["Shark erupts dv.DetonationTime s after the fish attaches; the attached champion is knocked up for 1s (tooltip)."],
      variableDistance: true,
      // The fish flies to the target, then the shark erupts dv.DetonationTime later.
      cc: [{ kind: "immobilize", duration: 1 }],
      components: [{ id: "shark", label: "Chum the Waters", type: "magic", amount: R_SHARK, aoe: true, delay: "dv.DetonationTime", travel: R_FLIGHT }],
    },
  },
  hooks: {
    onCast(sim: Sim, cast) {
      if (cast.slot !== "R" || !cast.hitsTarget) return;
      const castId = cast.castId;
      // The slow applies as the fish attaches, after its flight.
      sim.schedule(sim.evalExpr(`castTime + ${R_FLIGHT}`, { slot: "R", distance: cast.distance }), () =>
        sim.applyCC("slow", sim.evalExpr("R.dv.SlowDuration", { slot: "R" }), castId, "R"),
      );
    },
    onAttack(sim: Sim, atk) {
      if (atk.fromAbility || atk.phantom) return;
      if (atk.extra.some((x) => x.label === W_ACTIVE_LABEL)) {
        sim.setCounter("fizzW.until", sim.time + sim.evalExpr("W.dv.OnHitBuffDuration", { slot: "W" }));
        return;
      }
      if (sim.time > sim.counter("fizzW.until")) return;
      atk.extra.push({
        source: "W",
        sourceLabel: "Seastone Trident",
        label: "Seastone Trident (on-hit)",
        type: "magic",
        amount: sim.evalExpr("W.calc.OnHitBuffDamage", { slot: "W" }),
        castId: atk.castId,
        // The wiki: proc damage on the bonus damage on-hit (spell damage on the empowered attack).
        flags: { kind: "ability", slot: "W", onHit: true, ability: false, proc: true },
      });
    },
  },
};
export default kit;
