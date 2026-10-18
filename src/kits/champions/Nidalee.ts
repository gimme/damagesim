import type { ChampionKit, DebuffSpec } from "../../engine/kit-types.ts";

// Nidalee — patch 16.20.
// Human abilities are the default variants; cougar abilities are the variants takedown / pounce /
// swipe cast in cougar form (their numbers live in AspectOfTheCougar). Each form has its own
// cooldowns: a hook swaps the Q/W/E cooldowns whenever R (transform) is cast. Combo example:
// "Q R W E Q AA" (Javelin Toss, then Pounce, Swipe and Takedown).

// Hunted lasts 4 s (Prowl tooltip text; not a data value).
const hunted: DebuffSpec = { id: "hunted", label: "Hunted", duration: 4 };

const FORM = "nidaleeCougar";
const SLOTS = ["Q", "W", "E"] as const;

const kit: ChampionKit = {
  id: "Nidalee",
  status: "curated",
  notes: [
    'R switches between human and cougar form: in cougar form Q, W and E cast Takedown, Pounce and Swipe. Option "cougar" starts the combo in cougar form.',
    "Hunted (from Javelin Toss / Bushwhack) makes Takedown deal 30% more and refreshes Aspect of the Cougar; Pounce on a Hunted target has its cooldown reduced.",
  ],
  options: [{ key: "cougar", label: "Start in cougar form", default: 0, min: 0, max: 1, toggle: true }],
  // The cougar attacks in melee.
  attack: { melee: `stacks.${FORM}` },
  abilities: {
    Q: {
      defaultVariant: "javelin",
      variants: {
        javelin: {
          label: "Javelin Toss",
          name: "Javelin Toss",
          debuff: hunted,
          note: "Thrown from ≤525 units: minimum damage.",
          // {{Effect at cast time start}} (wiki): the javelin flies to the target from the start of the cast, here at most 525 units.
          components: [
            {
              id: "javelin",
              label: "Javelin Toss",
              type: "magic",
              amount: "calc.HumanMinimumDamage",
              travel: "min(reach, dv.RangeThreshold) / missileSpeed - castTime",
            },
          ],
        },
        max: {
          label: "Javelin Toss (max range)",
          name: "Javelin Toss",
          debuff: hunted,
          note: "Thrown from maximum distance: maximum damage.",
          // {{Effect at cast time start}} (wiki): the javelin flies its max range from the start of the cast.
          components: [
            { id: "javelin", label: "Javelin Toss", type: "magic", amount: "calc.HumanMaximumDamage", travel: "max(0, castRange / missileSpeed - castTime)" },
          ],
        },
        takedown: {
          label: "Takedown",
          name: "Takedown",
          when: `stacks.${FORM}`,
          spell: "Takedown",
          resetsAttack: true,
          note: "Empowers the next attack: it deals Takedown magic damage instead of its normal damage (follow with AA).",
          buff: {
            id: "takedown",
            label: "Takedown",
            duration: "spell['Takedown'].dv.BuffDuration",
            empowerAttacks: {
              count: 1,
              replaceBase: true,
              resetsAttack: true,
              components: [
                {
                  id: "takedown",
                  label: "Takedown",
                  type: "magic",
                  // +TakedownDamageAmp% per 1% missing health; +30% (Takedown effect 5) against Hunted targets.
                  amount:
                    "R.calc.TotalTakedownDamage * (1 + R.dv.TakedownDamageAmp * target.missingHpPct) * (debuff.hunted ? 1 + spell['Takedown'].dv.Effect5Amount : 1)",
                },
              ],
            },
          },
          components: [],
        },
      },
    },
    W: {
      defaultVariant: "trap",
      variants: {
        trap: {
          label: "Bushwhack",
          name: "Bushwhack",
          debuff: hunted,
          note: "The enemy steps on a trap: magic damage each second for 4 s.",
          components: [
            { id: "trap", label: "Bushwhack", type: "magic", amount: "calc.DamagePerSecond", hits: "dv.DotDuration", interval: 1, delay: 1, dot: true },
          ],
        },
        pounce: {
          label: "Pounce",
          name: "Pounce",
          when: `stacks.${FORM}`,
          spell: "Pounce",
          dash: true,
          // Pouncing at a Hunted target reduces the cooldown.
          cooldown: "debuff.hunted ? R.dv.PounceCooldown : cooldown",
          // No dash speed in the data: ~0.5s to arrive.
          lockout: 0.5,
          components: [{ id: "pounce", label: "Pounce", type: "magic", amount: "R.calc.TotalPounceDamage", aoe: true, delay: 0.5 }],
        },
      },
    },
    E: {
      defaultVariant: "surge",
      variants: {
        surge: {
          label: "Primal Surge",
          name: "Primal Surge",
          note: "Self-cast heal and attack speed.",
          buff: { id: "primalSurge", label: "Primal Surge", duration: "dv.ASDuration", stats: { attackSpeed: "dv.BonusAS" } },
          components: [],
        },
        swipe: {
          label: "Swipe",
          name: "Swipe",
          when: `stacks.${FORM}`,
          spell: "Swipe",
          // {{Effect at cast time start}} (wiki): it has hit by the end of the cast time.
          components: [{ id: "swipe", label: "Swipe", type: "magic", amount: "R.calc.TotalSwipeDamage", aoe: true }],
        },
      },
    },
    R: {
      noTarget: true,
      notes: ["Transforms between human and cougar form (swaps the Q/W/E cooldowns)."],
      components: [],
    },
  },
  hooks: {
    onStart(sim) {
      sim.setCounter(FORM, sim.opt.cougar ? 1 : 0);
    },
    onCast(sim, cast) {
      if (cast.slot === "R") {
        // Save this form's cooldowns and restore the other form's.
        const form = sim.counter(FORM);
        for (const s of SLOTS) {
          const key = `ability:${s}`;
          const other = sim.counter(`nidalee.cd.${1 - form}.${s}`);
          sim.setCounter(`nidalee.cd.${form}.${s}`, sim.cooldownReadyAt(key));
          sim.startCooldown(key, other - sim.time);
        }
        sim.setCounter(FORM, 1 - form);
      }
    },
    // Applying Hunted in human form refreshes Aspect of the Cougar.
    afterDamage(sim, inst) {
      if (inst.flags.kind !== "ability" || inst.flags.attack || inst.fromMark || sim.counter(FORM) !== 0) return;
      if (inst.flags.slot === "Q" || inst.flags.slot === "W") sim.startCooldown("ability:R", 0);
    },
  },
};
export default kit;
