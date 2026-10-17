import type { ChampionKit } from '../../engine/kit-types.ts';

// Yunara — patch 16.20.
// Vow of the First Lands: critical strikes deal bonus magic damage equal to Calc_Damage_Amp of the
// crit's total pre-mitigation damage (wiki). In expected-crit mode the bonus is weighted by crit
// chance; the hook needs the attack's crit state, which component expressions can't see.
const kit: ChampionKit = {
  id: 'Yunara',
  status: 'curated',
  notes: [
    'Cultivation of Spirit: the passive on-hit always applies; the active (5s) adds attack speed and a second on-hit. Unleash stacks (4 champion attacks) are not tracked — cast Q when you would have them.',
    'Transcendent State (R) keeps the Q active for its duration (no need to cast Q); use W:ruin and E:dash while it lasts.',
    'Arc of Judgment: impact plus the lingering bead for 1s (15% of impact every 0.25s per the wiki). Its 10s cooldown (wiki) is set in the kit — the data has none.',
    'Attacks spreading to other enemies (Q active) are ignored (single target).',
  ],
  // The wiki: Cultivation of Spirit's passive and active on-hits are proc damage.
  attack: {
    onHit: [{ id: 'cultivation', label: 'Cultivation of Spirit', slot: 'Q', type: 'magic', amount: 'Q.calc.Calc_Passive_Damage', proc: true }],
  },
  hooks: {
    onAttack(sim, atk) {
      if (atk.fromAbility || atk.phantom) return;
      const share = atk.crit ? 1 : atk.critFactor > 1 ? sim.stats.critChance : 0;
      if (share <= 0) return;
      const st = sim.stats;
      const critDamage = st.ad * atk.baseMult * st.critDamage;
      atk.extra.push({
        source: 'P',
        sourceLabel: 'Vow of the First Lands',
        label: atk.crit ? 'Vow of the First Lands (crit)' : 'Vow of the First Lands (avg. crit)',
        type: 'magic',
        amount: share * sim.evalExpr('P.calc.Calc_Damage_Amp', { slot: 'P' }) * critDamage,
        castId: atk.castId,
        flags: { kind: 'ability', slot: 'P', ability: false, proc: true, onHit: true },
      });
    },
  },
  abilities: {
    Q: {
      noTarget: true,
      resetsAttack: true,
      buff: {
        id: 'yunaraQ',
        label: 'Cultivation of Spirit',
        duration: 'dv.Buff_Duration',
        stats: { attackSpeed: 'calc.Calc_Attack_Speed' },
        onHit: [{ id: 'active', label: 'Cultivation of Spirit (active)', type: 'magic', amount: 'Q.calc.Calc_Damage', proc: true }],
      },
    },
    W: {
      name: 'Arc of Judgment',
      cooldown: 10, // missing from the data; wiki: 10s (Arc of Ruin too)
      // Cast time shrinks linearly from Cast_Time_Base to Cast_Time_Min at Cast_Time_Attack_Speed_Cap % bonus AS.
      castTime: 'dv.Cast_Time_Base - (dv.Cast_Time_Base - dv.Cast_Time_Min) * min(1, bonusAs * 100 / dv.Cast_Time_Attack_Speed_Cap)',
      cc: [{ kind: 'slow', duration: 'dv.Slow_Duration' }],
      variants: {
        ruin: {
          label: 'Arc of Ruin',
          note: 'Transcendent State only.',
          // Its own cast time, 0.6s down to 0.45s with bonus attack speed (data); the beam hits as it ends (wiki).
          castTime: 'dv.Cast_Time_Base_Empowered - (dv.Cast_Time_Base_Empowered - dv.Cast_Time_Min_Empowered) * min(1, bonusAs * 100 / dv.Cast_Time_Attack_Speed_Cap_Empowered)',
          cc: [{ kind: 'slow', duration: 'R.dv.RW_Slow_Duration' }],
          components: [{ id: 'laser', label: 'Arc of Ruin', type: 'magic', amount: 'R.calc.Calc_RW_Damage', aoe: true }],
        },
      },
      components: [
        { id: 'impact', label: 'Arc of Judgment', type: 'magic', amount: 'calc.Calc_Damage_Initial', travel: true },
        // Linger: Calc_Damage_Per_Second spread over 0.25s ticks (wiki) for Linger_Duration seconds after the impact.
        { id: 'linger', label: 'Arc of Judgment (linger)', type: 'magic', amount: 'calc.Calc_Damage_Per_Second / 4', hits: 'dv.Linger_Duration * 4', maxHits: 'dv.Linger_Duration * 4', interval: 0.25, delay: 0.25, travel: true, aoe: true, dot: true },
      ],
    },
    E: {
      name: "Kanmei's Steps",
      noTarget: true,
      variants: {
        dash: {
          label: 'Untouchable Shadow',
          note: 'Transcendent State only.',
          dash: true,
          resetsAttack: true,
          // Wiki: dashes up to 450 units at R.dv.RE_Dash_Speed; Arc of Ruin can be cast during the dash.
          attackLockout: '450 / R.dv.RE_Dash_Speed',
          components: [],
        },
      },
      components: [],
    },
    R: {
      noTarget: true,
      // Same buff id as Q's active: entering Transcendent State replaces (doesn't stack with) a running Q.
      buff: {
        id: 'yunaraQ',
        label: 'Transcendent State',
        duration: 'dv.Buff_Duration',
        stats: { attackSpeed: 'Q.calc.Calc_Attack_Speed' },
        onHit: [{ id: 'active', label: 'Cultivation of Spirit (active)', type: 'magic', amount: 'Q.calc.Calc_Damage', proc: true }],
      },
    },
  },
};
export default kit;
