import type { ChampionKit } from "../../engine/kit-types.ts";

// Garen — patch 16.20.
// Decisive Strike's bonus is 10% AD more when the attack crits (wiki: "~6.5%", a bug). Measured in the
// practice tool (16.20, rank 1, Sundered Sky): "Q AA" deals 266 at 116.2 AD and 349 at 156.2 AD,
// (2 × AD + 30 + 60% AD) × 80%, where 50% gives 256.4 and 336.4; the same on a 2000 health dummy,
// and without a crit the bonus is as the data says (B.F. Sword: 204, no items: 144). Not in the data.
const CRIT_BONUS_AD = 0.1;

const kit: ChampionKit = {
  id: "Garen",
  status: "curated",
  hooks: {
    onAttack(sim, atk) {
      const strike = atk.phantom ? undefined : atk.extra.find((x) => x.source === "Q" && x.label === "Decisive Strike");
      // A guaranteed or rolled crit, or its chance (expected value).
      if (strike) strike.amount += (atk.crit ? 1 : atk.naturalCrit) * CRIT_BONUS_AD * sim.stats.ad;
    },
  },
  abilities: {
    Q: {
      resetsAttack: true,
      notes: [
        "Empowers the next attack: it deals Q damage instead of normal attack damage (follow Q with AA). The attack part crits as normal, the bonus doesn't (wiki), but a crit adds 10% AD to the bonus (measured with Sundered Sky at rank 1; the wiki notes ~6.5% as a bug). Assumed the same at every rank and for natural crits.",
      ],
      buff: {
        id: "garenQ",
        label: "Decisive Strike",
        duration: "dv.AttackWindow",
        empowerAttacks: {
          count: 1,
          replaceBase: true,
          resetsAttack: true,
          components: [{ id: "strike", label: "Decisive Strike", type: "physical", amount: "Q.calc.TotalDamage" }],
        },
      },
    },
    E: {
      notes: [
        "Spins 7 times plus 1 per 25% bonus attack speed; the nearest enemy (a single target always is) takes 25% more.",
        "Each spin can crit for +30% of bonus crit damage. 6 spins shred 25% armor for 6s.",
      ],
      // Wiki: unable to declare attacks while spinning (the full 3s; ending it early isn't modeled).
      // Decisive Strike and Courage can be cast, but only ready the next attack or shield him;
      // Demacian Justice, which would end the spin, waits for it.
      lockout: "dv.Duration",
      debuff: { id: "garenE", label: "Judgment shred", duration: "dv.ShredDuration", armorReduction: "dv.ShredAmount", afterHits: 6 },
      components: [
        {
          id: "spin",
          label: "Judgment",
          type: "physical",
          amount: "calc.TotalDamage * (1 + dv.NearestEnemyBonus)",
          hits: "dv.NumTicks + floor(bonusAs / dv.ASPerTick)",
          interval: "dv.Duration / (dv.NumTicks + floor(bonusAs / dv.ASPerTick))",
          canCrit: true,
          critMultiplier: "1 + dv.CritMod * (critDamage - 1)",
          aoe: true,
        },
      ],
    },
    R: {
      components: [{ id: "justice", label: "Demacian Justice", type: "true", amount: "dv.BaseDamage + dv.ExecuteDamage * target.missingHp", delay: 0.1 }],
    },
  },
};
export default kit;
