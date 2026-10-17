import type { ChampionKit } from '../../engine/kit-types.ts';
import type { Sim } from '../../engine/sim.ts';

// Amumu — patch 16.20.
// Cursed Touch: cursed targets take bonus true damage equal to a % of the pre-mitigation magic
// damage they take (from any source). Attacks curse before their on-hit damage; Curse of the Sad
// Mummy curses after its own damage; Despair only refreshes an existing curse.
const CURSE = 'amumuCurse';

const curse = (sim: Sim, castId: number) =>
  sim.addDebuff({ id: CURSE, label: 'Curse', expires: sim.time + sim.evalExpr('P.dv.DebuffDuration', { slot: 'P' }), castId });

const kit: ChampionKit = {
  id: 'Amumu',
  status: 'curated',
  notes: ['Curse: +10% of every pre-mitigation magic hit as true damage while the target is cursed (applied by attacks and R, refreshed by W).'],
  abilities: {
    P: { notes: ['Curse is applied by attacks and Curse of the Sad Mummy (see notes).'] },
    Q: {
      dash: true,
      cc: [{ kind: 'immobilize', duration: 'dv.StunDuration' }],
      // Pulled to the target (at DashSpeed) once the bandage lands. Wiki: Despair can be cast
      // during the dash; he attacks the target when it ends. (Locked from the cast's start, though he
      // can act while the bandage flies.)
      attackLockout: 'castTime + reach / missileSpeed + reach / dv.DashSpeed',
      castLockout: {
        Q: 'castTime + reach / missileSpeed + reach / dv.DashSpeed',
        E: 'castTime + reach / missileSpeed + reach / dv.DashSpeed',
        R: 'castTime + reach / missileSpeed + reach / dv.DashSpeed',
      },
      notes: ['Two charges (from the data): "Q Q" casts both, the second after the 3s static cooldown.'],
      components: [{ id: 'bandage', label: 'Bandage Toss', type: 'magic', amount: 'calc.TotalDamage', travel: true }],
    },
    W: {
      notes: ['Toggle: ticks every 0.5s for half of the per-second damage, the first at once; default 8 ticks in range (3.5s; set the seconds, e.g. W{6s}).'],
      variableDuration: true,
      components: [
        { id: 'tick', label: 'Despair', type: 'magic', amount: "calc['{c8e45bc3}'] + calc['{8a96509c}'] * target.maxHp", hits: 8, maxHits: 40, interval: 0.5, aoe: true, dot: true },
      ],
    },
    E: {
      components: [{ id: 'tantrum', label: 'Tantrum', type: 'magic', amount: 'calc.TantrumDamage', aoe: true }],
    },
    R: {
      cc: [{ kind: 'immobilize', duration: 'dv.RDuration' }],
      debuff: { id: CURSE, label: 'Curse', duration: 'P.dv.DebuffDuration' },
      components: [{ id: 'curse', label: 'Curse of the Sad Mummy', type: 'magic', amount: 'calc.RCalculatedDamage', aoe: true }],
    },
  },
  hooks: {
    onAttack(sim, atk) {
      if (!atk.phantom) curse(sim, atk.castId);
    },
    afterDamage(sim, inst) {
      if (inst.fromMark === CURSE) return;
      if (inst.flags.slot === 'W' && sim.getDebuff(CURSE)) curse(sim, inst.castId);
      if (inst.type !== 'magic' || inst.raw <= 0 || !sim.getDebuff(CURSE)) return;
      sim.deal({
        source: 'P',
        sourceLabel: 'Cursed Touch',
        label: 'Cursed Touch',
        type: 'true',
        amount: inst.raw * sim.evalExpr('P.dv.DamageAmp', { slot: 'P' }),
        castId: inst.castId,
        flags: { kind: 'ability', slot: 'P', ability: false, proc: true },
        markSource: CURSE,
      });
    },
  },
};
export default kit;
