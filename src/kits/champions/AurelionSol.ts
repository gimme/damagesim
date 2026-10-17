import type { ChampionKit } from "../../engine/kit-types.ts";

// Aurelion Sol — patch 16.20.
// Stardust (passive stacks, buff {c9372c6b}) adds max-Health damage to Breath of Light bursts and
// grows Singularity's execute threshold.
const kit: ChampionKit = {
  id: "AurelionSol",
  status: "curated",
  options: [{ key: "stardust", label: "Stardust", default: 40, min: 0, max: 1000, step: 1, description: "Stacks collected so far (passive)." }],
  buffStacks: { "{c9372c6b}": "opt.stardust" },
  notes: [
    'Option "stardust" feeds every Stardust scaling. The Skies Descend (R:skies) needs 75 Stardust gathered since the last ult.',
    "Area growth from Stardust is irrelevant against a single target.",
  ],
  abilities: {
    P: { notes: ["Stardust: see option."] },
    Q: {
      // Busy for the default 2s channel (16 ticks × 0.125s).
      lockout: 2,
      // Held as long as Aurelion Sol likes (mana permitting).
      variableDuration: true,
      maxDuration: 25,
      notes: [
        "Default 2s channel on the target (set the seconds, e.g. Q{4s}): damage ticks every 0.125s (per-second damage / 8) and a burst after each full second.",
        "During Astral Flight the per-second (non-burst) damage is increased by W.dv.TrueDamageBonus.",
      ],
      components: [
        {
          id: "tick",
          label: "Breath of Light",
          type: "magic",
          amount: "calc.DamagePerSecond / 8 * (1 + W.dv.TrueDamageBonus * buff.astralFlight)",
          hits: 16,
          maxHits: 200,
          interval: 0.125,
          delay: 0.125,
        },
        {
          id: "burst",
          label: "Breath of Light (burst)",
          type: "magic",
          amount: "calc.BurstDamage + calc.BurstBonusTrueDamageToChamps * target.maxHp",
          hits: 2,
          maxHits: 25,
          interval: "dv.BurstAfter",
          delay: "dv.BurstAfter",
        },
      ],
    },
    W: {
      dash: true,
      noTarget: true,
      notes: ["Flight: Breath of Light has no cooldown and +X% non-burst damage."],
      // Wiki: flies its range at base + 100% movement speed after the cast time; he can cast any
      // ability during the flight, and an attack ends it.
      buff: { id: "astralFlight", label: "Astral Flight", duration: "castTime + castRange / (2 * ms - bonusMs)" },
    },
    E: {
      cc: [{ kind: "slow", duration: "dv.Duration" }],
      notes: [
        "Ticks every 0.25s for 5s from 0.5s after the cast starts (per-second damage / 4); E{tick:N} for less time in the hole.",
        "E+execute: one execute check after the pull (target in the center below the Stardust-scaled threshold).",
      ],
      components: [
        {
          id: "tick",
          label: "Singularity",
          type: "magic",
          amount: "calc.DamagePerSecond / 4",
          hits: "dv.Duration * 4",
          maxHits: 20,
          interval: 0.25,
          delay: "0.5 - castTime",
          aoe: true,
          dot: true,
        },
        {
          id: "execute",
          label: "Singularity (execute)",
          type: "true",
          amount: "target.hp <= calc.CurrentExecutionThreshold / 100 * target.maxHp ? calc.CurrentExecutionThreshold / 100 * target.maxHp : 0",
          delay: 1.5,
          optional: true,
          execute: true,
          condition: "target in the center",
        },
      ],
    },
    R: {
      cc: [{ kind: "immobilize", duration: "dv.StunDuration" }],
      notes: ["R:skies = The Skies Descend (bigger hit, knock-up and a shockwave)."],
      // Wiki: the star strikes after 1.25s (The Skies Descend: 2s, its shockwave expanding from there).
      components: [{ id: "star", label: "Falling Star", type: "magic", amount: "calc.MaxDamageTooltip", aoe: true, delay: 1.25 }],
      variants: {
        skies: {
          label: "The Skies Descend",
          cc: [
            { kind: "immobilize", duration: "dv.StunDuration" },
            { kind: "slow", duration: 1 },
          ],
          components: [
            { id: "star", label: "The Skies Descend", type: "magic", amount: "calc.R2Damage", aoe: true, delay: 2 },
            { id: "shockwave", label: "The Skies Descend (shockwave)", type: "magic", amount: "calc.ShockwaveDamage", aoe: true, delay: 2 },
          ],
        },
      },
    },
  },
};
export default kit;
