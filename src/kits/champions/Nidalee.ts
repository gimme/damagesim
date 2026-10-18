import type { ChampionKit, DebuffSpec } from "../../engine/kit-types.ts";

// Nidalee — patch 16.20.
// Human abilities are the abilities themselves; cougar abilities are the variants takedown / pounce /
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
    "Javelin Toss deals more the farther it flies: the step's distance (Q{1300u}, by default the target's), from 525 units up to 3.25 times as much at 1300 (wiki).",
    "Hunted (from Javelin Toss / Bushwhack) makes Takedown deal 30% more and refreshes Aspect of the Cougar; Pounce on a Hunted target has its cooldown reduced.",
  ],
  options: [{ key: "cougar", label: "Start in cougar form", default: 0, min: 0, max: 1, toggle: true }],
  // The cougar attacks in melee.
  attack: { melee: `stacks.${FORM}` },
  abilities: {
    Q: {
      name: "Javelin Toss",
      // How far the javelin flies (Q{1300u}): from 525 units it deals more, up to DamageMulti times as
      // much from 1300 (wiki; edge to edge here, the wiki's to the target's center).
      variableDistance: true,
      debuff: hunted,
      components: [
        {
          id: "javelin",
          label: "Javelin Toss",
          type: "magic",
          amount: "calc.HumanMinimumDamage * (1 + (dv.DamageMulti - 1) * clamp((reach - dv.RangeThreshold) / (1300 - dv.RangeThreshold), 0, 1))",
          // {{Effect at cast time start}} (wiki): the javelin flies to the target from the start of the cast.
          travel: "max(0, reach / missileSpeed - castTime)",
        },
      ],
      variants: {
        takedown: {
          label: "Takedown",
          name: "Takedown",
          when: `stacks.${FORM}`,
          spell: "Takedown",
          variableDistance: false,
          debuff: null,
          resetsAttack: true,
          note: "Empowers the next attack: it deals Takedown magic damage instead of its normal damage (follow with AA). Its attack part (100% AD) can crit, adding magic damage the missing-health bonus doesn't raise (wiki).",
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
      name: "Bushwhack",
      notes: ["The enemy steps on a trap: magic damage each second for 4 s."],
      debuff: hunted,
      components: [{ id: "trap", label: "Bushwhack", type: "magic", amount: "calc.DamagePerSecond", hits: "dv.DotDuration", interval: 1, delay: 1, dot: true }],
      variants: {
        pounce: {
          label: "Pounce",
          name: "Pounce",
          when: `stacks.${FORM}`,
          spell: "Pounce",
          debuff: null,
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
      name: "Primal Surge",
      notes: ["Self-cast heal and attack speed."],
      buff: { id: "primalSurge", label: "Primal Surge", duration: "dv.ASDuration", stats: { attackSpeed: "dv.BonusAS" } },
      components: [],
      variants: {
        swipe: {
          label: "Swipe",
          name: "Swipe",
          when: `stacks.${FORM}`,
          spell: "Swipe",
          buff: [],
          // {{Effect at cast time start}} (wiki): it has hit by the end of the cast time.
          components: [{ id: "swipe", label: "Swipe", type: "magic", amount: "R.calc.TotalSwipeDamage", aoe: true }],
        },
      },
    },
    R: {
      noTarget: true,
      // The form it turns from.
      icon: `AspectOfTheCougar#stacks.${FORM}`,
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
