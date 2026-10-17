import type { BuffSpec, ChampionKit } from "../../engine/kit-types.ts";
import type { Slot } from "../../engine/effects.ts";

// Elise — patch 16.20.
// R toggles Human ⇄ Spider form (hook below). Spider abilities are variants: Q:spider, W:spider, E:spider.
// Spider spells sit in the unslotted "X" group, so cross-spell references go through the slotted human
// spells (Q.dv.SpiderBaseDamage, E.dv.RappelDamageAmp), which carry the same per-rank values.
const spiderForm: BuffSpec = {
  id: "eliseSpiderForm",
  label: "Spider Form",
  duration: 3600,
  onHit: [
    {
      id: "spiderQueen",
      label: "Spider Queen",
      type: "magic",
      // Rappel raises Spider Queen's bonus damage by RappelDamageAmp % for 5s.
      amount: "R.calc.PassiveTotalDamage * (1 + (buff.eliseRappel ? E.dv.RappelDamageAmp / 100 : 0))",
      // The wiki: "Applies proc damage on the bonus magic damage on-hit in Spider Form".
      proc: true,
    },
    {
      id: "spiderling",
      label: "Spiderling",
      type: "magic",
      amount: "R.calc.SpiderlingTotalDamage",
      hits: "min(opt.spiderlings, R.dv.BaseSpiderlingsStored)",
      pet: true,
    },
  ],
};

const kit: ChampionKit = {
  id: "Elise",
  status: "curated",
  attack: { melee: `buff.${spiderForm.id}` },
  options: [
    {
      key: "spiderlings",
      label: "Spiderlings",
      default: 3,
      min: 0,
      max: 5,
      description: "Spiderlings summoned in Spider Form (capped by R.dv.BaseSpiderlingsStored).",
    },
  ],
  notes: [
    "Combo: human Q W E, then R (Spider Form), then Q:spider W:spider E:spider; R again returns to Human Form. Each form keeps its own Q/W/E cooldowns.",
    "Spider Form: attacks deal Spider Queen bonus magic damage (+RappelDamageAmp % for 5s after Rappel). Spiderlings (option, default 3 = one per human ability hit) are approximated as each attacking once per Elise attack.",
    "Venomous Bite applies on-hit effects, including the Spider Form ones above.",
    "Volatile Spiderling is assumed to reach the target ~0.75s after the cast.",
    "Spider Form attacks in melee (no missile); the simulator keeps her ranged for melee/ranged item effects.",
  ],
  hooks: {
    // Form switching: swap the Q/W/E cooldowns of the two forms and toggle the Spider Form buff.
    onCast(sim, cast) {
      if (cast.slot !== "R") return;
      const toSpider = !sim.counter("eliseSpider");
      const stash = (spider: boolean, s: Slot) => `elise:${spider ? "spider" : "human"}:${s}`;
      for (const s of ["Q", "W", "E"] as Slot[]) {
        const key = `ability:${s}`;
        const current = sim.cooldownReadyAt(key);
        const other = sim.cooldownReadyAt(stash(toSpider, s));
        sim.startCooldown(stash(!toSpider, s), current - sim.time);
        sim.startCooldown(key, other - sim.time);
      }
      sim.setCounter("eliseSpider", toSpider ? 1 : 0);
      if (toSpider) sim.applyBuff(spiderForm, "R", sim.spellFor("R"), sim.abilityRank("R"));
      else sim.removeBuff(spiderForm.id);
    },
  },
  abilities: {
    Q: {
      components: [{ id: "neurotoxin", label: "Neurotoxin", type: "magic", amount: "dv.BaseDamage + calc.HumanPercentHealth * target.hp", travel: true }],
      variants: {
        spider: {
          label: "Venomous Bite",
          spell: "EliseSpiderQCast",
          dash: true,
          // Wiki: the spiderlings pounce with her upon the cast, and the bite applies as the cast time
          // ends even if the dash is cut short. Busy until she lands on the target at the dash speed.
          lockout: "reach / missileSpeed",
          components: [
            { id: "bite", label: "Venomous Bite", type: "magic", amount: "Q.dv.SpiderBaseDamage + calc.MissingHPDamage * target.missingHp", onHit: true },
          ],
        },
      },
    },
    W: {
      // Wiki: the spider crawls to a nearby target after a 0.75s delay (its crawl isn't modeled).
      components: [{ id: "spiderling", label: "Volatile Spiderling", type: "magic", amount: "calc.TotalDamage", aoe: true, delay: 0.75 }],
      variants: {
        spider: {
          label: "Skittering Frenzy",
          spell: "EliseSpiderW",
          components: [],
          buff: { id: "eliseFrenzy", label: "Skittering Frenzy", duration: "dv.BuffDuration", stats: { attackSpeed: "dv.ActiveAttackSpeed" } },
        },
      },
    },
    E: {
      // The cocoon flies to the target at the missile's speed before it stuns.
      cc: [{ kind: "immobilize", duration: "calc.TotalStunDuration", delay: "reach / missileSpeed" }],
      components: [],
      variants: {
        spider: {
          label: "Rappel",
          spell: "EliseSpiderE",
          dash: true,
          // Wiki: unable to act while lifting up (0.6s) and descending onto the target (0.4s), recast
          // right away.
          lockout: 1,
          cc: [], // don't inherit Cocoon's stun
          components: [],
          buff: { id: "eliseRappel", label: "Rappel", duration: "dv.BuffDuration" },
        },
      },
    },
    R: { noTarget: true, components: [], notes: ["Toggles Human ⇄ Spider Form."] },
  },
};
export default kit;
