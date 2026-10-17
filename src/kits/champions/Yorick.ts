import type { ChampionKit } from "../../engine/kit-types.ts";

// Yorick — patch 16.20.
// Mist Walkers (passive) and the Maiden of the Mist (R) are pets; their attack counts in a trade are
// options (the data has no attack timer for them).
const kit: ChampionKit = {
  id: "Yorick",
  status: "curated",
  notes: [
    "Mist Walkers: option ghouls (awakened by Mourning Mist, default 2) each attack ghoulAttacks times (default 3) during the mark; R adds its own Mist Walkers.",
    "Maiden of the Mist attacks maidenAttacks times (wiki: 1 attack/s, starts after the summon delay). While she is out, Yorick's attacks and Mourning Mist deal the mark's %max-health bonus (assumes the Maiden keeps the target marked).",
    "Last Rites heal, graves and Awakening recast are not modeled.",
  ],
  options: [
    { key: "ghouls", label: "Mist Walkers attacking (from graves)", default: 2, min: 0, max: 4, step: 1 },
    { key: "ghoulAttacks", label: "Attacks per Mist Walker", default: 3, min: 0, max: 20, step: 1 },
    { key: "maidenAttacks", label: "Maiden attacks", default: 5, min: 0, max: 30, step: 1 },
  ],
  abilities: {
    Q: {
      resetsAttack: true,
      notes: ['Next attack deals bonus physical damage (write "Q AA").'],
      buff: {
        id: "yorickQ",
        label: "Last Rites",
        duration: "dv.BuffDuration",
        empowerAttacks: { count: 1, resetsAttack: true, components: [{ id: "rites", label: "Last Rites", type: "physical", amount: "Q.calc.BonusDamage" }] },
      },
    },
    W: { noTarget: true, notes: ["Wall of spirits; no damage."], components: [] },
    E: {
      cc: [{ kind: "slow", duration: "dv.SlowDuration" }],
      debuff: { id: "yorickE", label: "Mourning Mist", duration: "dv.MarkDuration", armorReduction: "dv.ArmorShred" },
      components: [
        { id: "mist", label: "Mourning Mist", type: "magic", amount: "calc.Calc_HealthDamage * target.maxHp", aoe: true, travel: true },
        {
          id: "maidenMark",
          label: "Maiden mark",
          type: "magic",
          amount: "R.dv.RMarkDamagePercent / 100 * target.maxHp",
          hits: "buff.yorickMaiden",
          maxHits: 1,
          travel: true,
          condition: "while the Maiden is out",
        },
        {
          id: "walkers",
          label: "Mist Walkers",
          type: "physical",
          amount: "P.calc.YorickPassiveGhoulDamage",
          hits: "opt.ghouls * opt.ghoulAttacks",
          interval: "dv.MarkDuration / max(1, opt.ghouls * opt.ghoulAttacks)",
          // Raised from the graves 1s after the mist lands.
          delay: "reach / missileSpeed + P.dv.YorickGhoulSpawnDelay",
          pet: true,
          noProc: true,
        },
      ],
    },
    R: {
      notes: ["Maiden persists until killed (buff 60s)."],
      buff: {
        id: "yorickMaiden",
        label: "Maiden of the Mist",
        duration: 60,
        onHit: [{ id: "mark", label: "Maiden mark", type: "magic", amount: "R.dv.RMarkDamagePercent / 100 * target.maxHp" }],
      },
      components: [
        {
          id: "maiden",
          label: "Maiden of the Mist",
          type: "magic",
          amount: "calc.YorickBigGhoulDamage",
          hits: "opt.maidenAttacks",
          interval: 1,
          delay: "dv.RSummonDelay",
          pet: true,
          noProc: true,
        },
        {
          id: "walkers",
          label: "Mist Walkers (R)",
          type: "physical",
          amount: "P.calc.YorickPassiveGhoulDamage",
          hits: "dv.RGhoulNumbers * opt.ghoulAttacks",
          interval: "1 / max(1, dv.RGhoulNumbers)",
          delay: "dv.RSummonDelay",
          pet: true,
          noProc: true,
        },
      ],
    },
  },
};
export default kit;
