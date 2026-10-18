import type { ChampionKit } from "../../engine/kit-types.ts";

// Yunara — patch 16.20.
// Vow of the First Lands: critical strikes deal bonus magic damage equal to Calc_Damage_Amp of the
// crit's total pre-mitigation damage (wiki). In expected-crit mode the bonus is weighted by crit
// chance; the hook needs the attack's crit state, which component expressions can't see.
// Shadowflame's Cinderbloom crits are hers too (wiki): a magic one the passive amps directly; another
// gets the bonus as a new instance of magic damage, which Cinderbloom crits again, so the passive amps
// it once more (a bug the wiki notes), as it does the bonus of her attacks' crits.
const VOW = "Vow of the First Lands";

const kit: ChampionKit = {
  id: "Yunara",
  status: "curated",
  notes: [
    "Cultivation of Spirit: the passive on-hit always applies; the active (5s) adds attack speed and a second on-hit. Unleash stacks (4 champion attacks) are not tracked — cast Q when you would have them.",
    "Transcendent State (R) keeps the Q active for its duration (no need to cast Q); while it lasts, W casts Arc of Ruin and E Untouchable Shadow.",
    "Vow of the First Lands amps Shadowflame's crits (below 40% health) of her magic damage, W and Q's on-hits included, and its own bonus damage again (a bug the wiki notes); the results show it as the passive's.",
    "Arc of Judgment: the impact, then 15% of it every 0.25s while the bead lingers on the target (wiki). On an enemy the bead slows to 150 units/s and keeps going to the end of its range, where it lingers 1s, so how long it stays on the target is up to how the target moves: the step's seconds (W{2s}), up to 8.5s. The default, 1.5s (6 ticks), is about a champion standing in its path. A second impact when the bead runs into the target again is not modeled.",
    "Arc of Judgment's 10s cooldown (wiki) is set in the kit — the data has none.",
    "Attacks spreading to other enemies (Q active) are ignored (single target).",
  ],
  // The wiki: Cultivation of Spirit's passive and active on-hits are proc damage.
  attack: {
    onHit: [{ id: "cultivation", label: "Cultivation of Spirit", slot: "Q", type: "magic", amount: "Q.calc.Calc_Passive_Damage", proc: true }],
  },
  hooks: {
    onAttack(sim, atk) {
      if (atk.fromAbility || atk.phantom) return;
      const share = atk.crit ? 1 : atk.critFactor > 1 ? sim.stats.critChance : 0;
      if (share <= 0) return;
      const st = sim.stats;
      const critDamage = st.ad * atk.baseMult * st.critDamage;
      atk.extra.push({
        source: "P",
        sourceLabel: VOW,
        label: atk.crit ? `${VOW} (crit)` : `${VOW} (avg. crit)`,
        type: "magic",
        amount: share * sim.evalExpr("P.calc.Calc_Damage_Amp", { slot: "P" }) * critDamage,
        castId: atk.castId,
        flags: { kind: "ability", slot: "P", ability: false, proc: true, onHit: true },
      });
    },
    onCrit(sim, inst) {
      const amp = sim.evalExpr("P.calc.Calc_Damage_Amp", { slot: "P" });
      if (inst.type === "magic") {
        inst.amps.push({ id: "P", source: VOW, value: amp, kind: "multiplier", hit: `${VOW} (crit)` });
        return;
      }
      // True damage: a new instance of magic damage, of the crit's whole damage, after the hit (as
      // her attacks' crits add theirs).
      const crit = inst.raw * inst.amps.reduce((m, a) => (a.kind === "multiplier" ? m * (1 + a.value) : m), 1);
      sim.schedule(0, () =>
        sim.deal({
          source: "P",
          sourceLabel: VOW,
          label: `${VOW} (crit)`,
          type: "magic",
          amount: amp * crit,
          castId: inst.castId,
          flags: { kind: "ability", slot: "P", ability: false, proc: true, crit: true },
        }),
      );
    },
  },
  abilities: {
    Q: {
      noTarget: true,
      resetsAttack: true,
      buff: {
        id: "yunaraQ",
        label: "Cultivation of Spirit",
        duration: "dv.Buff_Duration",
        stats: { attackSpeed: "calc.Calc_Attack_Speed" },
        onHit: [{ id: "active", label: "Cultivation of Spirit (active)", type: "magic", amount: "Q.calc.Calc_Damage", proc: true }],
      },
    },
    W: {
      name: "Arc of Judgment",
      cooldown: 10, // missing from the data; wiki: 10s (Arc of Ruin too)
      // Cast time shrinks linearly from Cast_Time_Base to Cast_Time_Min at Cast_Time_Attack_Speed_Cap % bonus AS.
      castTime: "dv.Cast_Time_Base - (dv.Cast_Time_Base - dv.Cast_Time_Min) * min(1, bonusAs * 100 / dv.Cast_Time_Attack_Speed_Cap)",
      // Not the player's choice but the target's movement (see the notes): W{2s} stays 2s on it.
      variableDuration: true,
      cc: [{ kind: "slow", duration: "dv.Slow_Duration" }],
      variants: {
        ruin: {
          label: "Arc of Ruin",
          name: "Arc of Ruin",
          icon: "YunaraW2",
          when: "buff.yunaraR",
          note: "Cast as W in Transcendent State.",
          // Its own cast time, 0.6s down to 0.45s with bonus attack speed (data); the beam hits as it ends (wiki).
          castTime:
            "dv.Cast_Time_Base_Empowered - (dv.Cast_Time_Base_Empowered - dv.Cast_Time_Min_Empowered) * min(1, bonusAs * 100 / dv.Cast_Time_Attack_Speed_Cap_Empowered)",
          cc: [{ kind: "slow", duration: "R.dv.RW_Slow_Duration" }],
          components: [{ id: "laser", label: "Arc of Ruin", type: "magic", amount: "R.calc.Calc_RW_Damage", aoe: true }],
        },
      },
      components: [
        { id: "impact", label: "Arc of Judgment", type: "magic", amount: "calc.Calc_Damage_Initial", travel: true },
        // Linger: Calc_Damage_Per_Second spread over 0.25s ticks (wiki) while the bead is on the target.
        // Slowed to 150 units/s on an enemy (wiki), it crosses a standing champion (its 120 width and
        // ~65 radius each side: 250 units) in 1.67s: 6 ticks. At most, hitting at once, it goes all its
        // range at that speed with the target and lingers there for Linger_Duration.
        {
          id: "linger",
          label: "Arc of Judgment (linger)",
          type: "magic",
          amount: "calc.Calc_Damage_Per_Second / 4",
          hits: 6,
          maxHits: "floor(4 * (castRange / 150 + dv.Linger_Duration))",
          interval: 0.25,
          delay: 0.25,
          travel: true,
          aoe: true,
          dot: true,
        },
      ],
    },
    E: {
      name: "Kanmei's Steps",
      noTarget: true,
      variants: {
        dash: {
          label: "Untouchable Shadow",
          name: "Untouchable Shadow",
          icon: "YunaraE2",
          when: "buff.yunaraR",
          note: "Cast as E in Transcendent State.",
          dash: true,
          resetsAttack: true,
          // Wiki: dashes up to 450 units at R.dv.RE_Dash_Speed; Arc of Ruin can be cast during the dash.
          attackLockout: "450 / R.dv.RE_Dash_Speed",
          components: [],
        },
      },
      components: [],
    },
    R: {
      noTarget: true,
      buff: [
        // Same buff id as Q's active: entering Transcendent State replaces (doesn't stack with) a running Q.
        {
          id: "yunaraQ",
          label: "Transcendent State",
          duration: "dv.Buff_Duration",
          stats: { attackSpeed: "Q.calc.Calc_Attack_Speed" },
          onHit: [{ id: "active", label: "Cultivation of Spirit (active)", type: "magic", amount: "Q.calc.Calc_Damage", proc: true }],
        },
        // The state itself, which a Q cast meanwhile doesn't end: W and E cast their empowered forms.
        { id: "yunaraR", label: "Transcendent State", duration: "dv.Buff_Duration" },
      ],
    },
  },
};
export default kit;
