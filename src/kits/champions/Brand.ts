import type { ChampionKit } from "../../engine/kit-types.ts";

// Brand — patch 16.20.
// Blaze: every ability hit adds a stack (max 3); each stack burns separately for P.dv.PercentHealthDamage % max
// health over 4s (ticks every 0.25s, wiki). At 3 stacks the target detonates 2s later (hook below).
const BLAZE_DURATION = 4; // seconds, from the tooltip text ("over 4 seconds")
const BLAZE_TICK = 0.25; // wiki
const DETONATION_DELAY = 2; // tooltip text ("detonate after 2 seconds")
const DETONATION_LOCKOUT = 4; // wiki: max 1 stack for 4s after an explosion
// Pyroclasm's flight over a distance: from 750 speed, accelerating by 500/s (wiki).
const fireball = (d: string) => `(sqrt(750 * 750 + 2 * 500 * ${d}) - 750) / 500`;

const kit: ChampionKit = {
  id: "Brand",
  status: "curated",
  notes: [
    "Blaze: each ability hit adds a stack (max 3, all stacks refresh to 4s); each stack burns for its own 2% max health over 4s.",
    "At 3 stacks the target explodes 2s later for P.calc.ExplosionDamage × max health, which consumes the stacks and re-applies 1 stack; for 4s afterwards the target cannot hold more than 1 stack.",
    "Pyroclasm against a lone champion bounces champion → Brand → champion…: 3 hits on the target (wiki), each bounce flying between them after a 0.15s delay.",
    "Sear only stuns Ablaze targets and Pyroclasm only slows Ablaze targets: both are assumed to hit an Ablaze target (cast them after another ability).",
  ],
  marks: [
    {
      id: "blaze",
      label: "Blaze",
      maxStacks: 3,
      duration: BLAZE_DURATION,
      appliedBy: ["ability"],
      dot: {
        interval: BLAZE_TICK,
        components: [
          {
            id: "burn",
            label: "Blaze (burn)",
            type: "magic",
            amount: `P.dv.PercentHealthDamage / 100 * target.maxHp / ${BLAZE_DURATION / BLAZE_TICK} * stacks.blaze`,
            dot: true,
          },
        ],
      },
    },
  ],
  hooks: {
    // The detonation fires 2s after reaching 3 stacks and re-applies a stack; MarkSpec.atMax deals its
    // damage immediately, so the delay and the post-explosion lockout are handled here.
    afterDamage(sim, inst) {
      if (inst.fromMark || inst.flags.kind !== "ability" || !inst.flags.slot || inst.flags.slot === "P") return;
      // Marks are updated after afterDamage hooks: check once this hit's stack has been added.
      sim.schedule(0, () => {
        const m = sim.marks.get("blaze");
        if (!m || m.expires < sim.time) return;
        if (!sim.isReady("brand:lockout")) {
          m.stacks = Math.min(m.stacks, 1);
          return;
        }
        if (m.stacks < 3 || sim.counter("brand:detonating")) return;
        sim.setCounter("brand:detonating", 1);
        sim.schedule(DETONATION_DELAY, () => {
          sim.setCounter("brand:detonating", 0);
          sim.deal({
            source: "P",
            sourceLabel: "Blaze",
            label: "Blaze (explosion)",
            type: "magic",
            amount: sim.evalExpr("P.calc.ExplosionDamage * target.maxHp", { slot: "P" }),
            flags: { kind: "ability", slot: "P", ability: true, aoe: true },
            markSource: "blaze",
          });
          // The explosion consumes the stacks and applies a fresh one.
          const mm = sim.marks.get("blaze");
          if (mm) {
            mm.stacks = 1;
            mm.expires = sim.time + BLAZE_DURATION;
          }
          sim.startCooldown("brand:lockout", DETONATION_LOCKOUT);
        });
      });
    },
  },
  abilities: {
    Q: {
      cc: [{ kind: "immobilize", duration: "dv.StunDuration" }],
      components: [{ id: "sear", label: "Sear", type: "magic", amount: "calc.TotalDamage", travel: true }],
    },
    W: {
      notes: ["Deals W.calc.EmpoweredDamage instead if the target is Ablaze when the pillar erupts."],
      components: [
        {
          id: "pillar",
          label: "Pillar of Flame",
          type: "magic",
          amount: "stacks.blaze > 0 ? calc.EmpoweredDamage : calc.TotalDamage",
          aoe: true,
          delay: 0.625, // wiki: erupts 0.625s after the cast time
        },
      ],
    },
    E: {
      components: [{ id: "blast", label: "Conflagration", type: "magic", amount: "calc.EDamageCalc", aoe: true }],
    },
    R: {
      cc: [{ kind: "slow", duration: "dv.SlowDuration" }],
      components: [
        {
          id: "bounce",
          label: "Pyroclasm (bounce)",
          type: "magic",
          amount: "calc.TotalDamage",
          hits: 3,
          maxHits: 3,
          // Flies to the target, then to Brand and back (at most the 600 bounce range apart), 0.15s
          // between bounces (wiki).
          interval: `2 * (0.15 + ${fireball("min(distance, 600)")})`,
          travel: fireball("reach"),
          sameCast: false,
        },
      ],
    },
  },
};
export default kit;
