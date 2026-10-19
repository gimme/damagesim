import type { ChampionKit } from "../../engine/kit-types.ts";

// Garen — patch 16.20.
// Decisive Strike's bonus is × CRIT_BONUS when the attack crits, whatever the crit (not in the data;
// the wiki's only figure is "~6.5%", as a bug). Measured in the practice tool (16.20, rank 1), "Q AA"
// deals 266 with Sundered Sky at 116.2 AD (bonus 88.1), 349 with Sundered Sky and a B.F. Sword at
// 156.2 AD (bonus 108.1), and 590 with a natural crit at 216.2 AD (bonus 138.1): 266.4, 348.6 and
// 590.0 with 1.1415, the least-squares fit (1.140 to 1.143 fit all three within rounding; the
// data's bonus alone gives 256.4, 336.4 and 570.5). The same on a 2000 health dummy, and without a
// crit the bonus is as the data says (B.F. Sword: 204, no items: 144).
const CRIT_BONUS = 1.1415;

const kit: ChampionKit = {
  id: "Garen",
  status: "curated",
  hooks: {
    onAttack(sim, atk) {
      const strike = atk.phantom ? undefined : atk.extra.find((x) => x.source === "Q" && x.label === "Decisive Strike");
      // Its bonus beyond the attack's AD, by a guaranteed or rolled crit, or its chance (expected value).
      if (strike) strike.amount += (atk.crit ? 1 : atk.naturalCrit) * (CRIT_BONUS - 1) * Math.max(0, strike.amount - sim.stats.ad);
    },
  },
  abilities: {
    Q: {
      resetsAttack: true,
      notes: [
        "Empowers the next attack: it deals Q damage instead of normal attack damage (follow Q with AA). The attack part crits as normal, the bonus doesn't (wiki), but a crit makes the bonus 14.15% more, Sundered Sky's or a natural one (measured at rank 1: a fit of three readings; the wiki notes ~6.5% as a bug). Assumed the same at every rank.",
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
