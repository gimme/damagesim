import type { ChampionKit } from "../../engine/kit-types.ts";
import type { Sim } from "../../engine/sim.ts";

// Yone — patch 16.20.
// Way of the Hunter: crit chance from all other sources is doubled, crits deal ×0.95, crit chance
// above 100% → bonus AD. Every second attack (Azakana sword) splits its damage into physical and
// magic — not expressible declaratively, hence the preAttack hook.
function passiveDv(sim: Sim, name: string): number {
  return sim.dataValue(sim.spellFor("P"), name, 1);
}

const CRIT_Q = "(dv.BaseDamage + dv.ADRatio * critDamage * P.dv.CritDamageMod * ad) / calc.QDamage";
/** Mortal Steel's cast time, shorter with bonus attack speed (data). */
const Q_CAST = "dv.QBaseCastTime * (1 - min(dv.QAttackSpeedCastReductionMax, dv.QAttackSpeedCastReductionPercent * bonusAs))";

const kit: ChampionKit = {
  id: "Yone",
  status: "curated",
  notes: [
    "Crit chance from items/runes is doubled; crits deal 95% of normal crit damage; each 1% crit above 100% gives 0.5 bonus AD.",
    "Every second basic attack deals 50% of its damage as magic damage (crit applies to both halves); Q does not advance the alternation.",
    "Mortal Steel / Spirit Cleave: static cooldowns and cast times shrink with bonus attack speed (data ratios).",
    "Soul Unbound repeats its share of all damage dealt during the 5s spirit form as true damage (the engine also stores item/rune damage, which the game excludes); recasting early is not modeled.",
  ],
  attack: { critMultiplier: "critDamage * P.dv.CritDamageMod" },
  stats: ({ evalExpr }) => ({
    critChanceMult: [1 + evalExpr("P.dv.CritChanceMultiplier")],
    conversions: [{ from: "critChanceOverCap", to: "ad", ratio: evalExpr("P.dv.YoneCritToAD"), source: "Way of the Hunter" }],
  }),
  hooks: {
    preAttack(sim, atk) {
      if (atk.fromAbility || atk.phantom || atk.replaceBase) return;
      const n = sim.counter("yoneSword") + 1;
      sim.setCounter("yoneSword", n);
      if (n % 2 !== 0) return;
      const split = passiveDv(sim, "MagicDamageSplit");
      atk.baseMult *= 1 - split;
      atk.extra.push({
        source: "AA",
        sourceLabel: "Basic attack",
        label: "Azakana sword (magic half)",
        type: "magic",
        amount: sim.stats.ad * split * atk.critFactor,
        castId: atk.castId,
        flags: { kind: "attack", attack: false, onHit: false, ability: false, crit: atk.crit },
      });
    },
  },
  abilities: {
    Q: {
      // Static cooldown (spell ignores haste) reduced by bonus attack speed.
      cooldown: "cooldown * (1 - min(dv.QAttackSpeedCDMax, dv.QAttackSpeedCDPercent * bonusAs))",
      castTime: Q_CAST,
      notes: ['Applies on-hit; the AD part can crit (95% crit damage). Two hits empower the third cast: write "Q Q Q:q3".'],
      variants: {
        q3: {
          label: "Q3 dash",
          dash: true,
          // He dashes the 450 range at its 1500 speed after the cast time, hitting on the way.
          lockout: `${Q_CAST} + castRange / missileSpeed`,
          cc: [{ kind: "immobilize", duration: "dv.Q3KnockupDuration" }],
          components: [
            {
              id: "q3",
              label: "Mortal Steel (wind)",
              type: "physical",
              amount: "calc.QDamage",
              canCrit: true,
              critMultiplier: CRIT_Q,
              onHit: true,
              onAttack: true,
              aoe: true,
              travel: true,
            },
          ],
        },
      },
      components: [
        {
          id: "thrust",
          label: "Mortal Steel",
          type: "physical",
          amount: "calc.QDamage",
          canCrit: true,
          critMultiplier: CRIT_Q,
          onHit: true,
          onAttack: true,
          aoe: true,
        },
      ],
    },
    W: {
      cooldown: "cooldown * (1 - min(dv.WAttackSpeedCDMax, dv.WAttackSpeedCDPercent * bonusAs))",
      castTime: "dv.WBaseCastTime * (1 - min(dv.WAttackSpeedCastReductionMax, dv.WAttackSpeedCastReductionPercent * bonusAs))",
      notes: ["Damage is split evenly: physical half first, then magic half. Shield not modeled."],
      components: [
        {
          id: "physical",
          label: "Spirit Cleave (physical)",
          type: "physical",
          amount: "dv.BaseDamage * 0.5 + dv.MaxHealthDamage * 0.5 * target.maxHp",
          aoe: true,
        },
        { id: "magic", label: "Spirit Cleave (magic)", type: "magic", amount: "dv.BaseDamage * 0.5 + dv.MaxHealthDamage * 0.5 * target.maxHp", aoe: true },
      ],
    },
    E: {
      dash: true,
      // Busy for the 300-unit dash at its 1200 speed.
      lockout: "castTime + castRange / missileSpeed",
      notes: ["Spirit form lasts dv.ReturnTimer seconds; put the damage you want repeated after E in the combo."],
      debuff: {
        id: "yoneE",
        label: "Soul Unbound",
        duration: "dv.ReturnTimer",
        detonate: { components: [], storeFraction: "dv.DeathmarkPercent", storeType: "true", label: "Soul Unbound" },
      },
      components: [],
    },
    R: {
      dash: true,
      // Wiki: locked out of actions for 0.45s after the 0.75s cast time.
      lockout: 1.2,
      cc: [{ kind: "immobilize", duration: "dv.RKnockupDuration" }],
      components: [
        { id: "physical", label: "Fate Sealed (physical)", type: "physical", amount: "calc.TooltipDamage", aoe: true },
        { id: "magic", label: "Fate Sealed (magic)", type: "magic", amount: "calc.TooltipDamage", aoe: true },
      ],
    },
  },
};
export default kit;
