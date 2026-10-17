import type { ChampionKit } from '../../engine/kit-types.ts';

// Jarvan IV — patch 16.20.
const kit: ChampionKit = {
  id: 'JarvanIV',
  status: 'curated',
  notes: [
    'Martial Cadence: the first attack on the target deals P.dv.TooltipCurrentHealthDamage of its current health (before the attack\'s damage, minimum P.dv.MinimumCadenceDamage; the 400 cap is non-champions only), then P.calc.TooltipCooldown s per-target cooldown.',
    'Demacian Standard\'s passive attack speed is always on once E is learned.',
  ],
  stats: ({ ranks, evalExpr }) => (ranks.E > 0 ? { attackSpeed: evalExpr('E.dv.PermanentAttackSpeed', 'E') } : {}),
  abilities: {
    Q: {
      notes: ['Armor reduction applies after the Q damage. Q:flag = E→Q combo (pulls to the standard, 0.75s knock-up).'],
      debuff: { id: 'dragonStrike', label: 'Dragon Strike', duration: 'dv.Effect3Amount', armorReduction: 'dv.BaseARShred' },
      components: [{ id: 'lance', label: 'Dragon Strike', type: 'physical', amount: 'calc.TotalDamage', aoe: true }],
      variants: {
        flag: {
          label: 'flag',
          dash: true,
          // After the lance (0.4s cast) he dashes to the flag at E.dv.EDashSpeed, assumed at the lance's
          // max range; he can cast any ability during the dash (wiki).
          attackLockout: 'castTime + castRange / E.dv.EDashSpeed',
          // Knock-up duration from the tooltip text ("Knocking Up … for 0.75 seconds").
          cc: [{ kind: 'immobilize', duration: 0.75 }],
          debuff: { id: 'dragonStrike', label: 'Dragon Strike', duration: 'dv.Effect3Amount', armorReduction: 'dv.BaseARShred' },
          components: [{ id: 'lance', label: 'Dragon Strike', type: 'physical', amount: 'calc.TotalDamage', aoe: true }],
        },
      },
    },
    W: {
      notes: ['Shield + slow (no damage).'],
      cc: [{ kind: 'slow', duration: 'dv.Effect5Amount' }],
      components: [],
    },
    E: {
      notes: ['The standard also grants allies near it attack speed for 8s (not modeled).'],
      // The flag flies its range at 1450 (game files; no speed on the wiki).
      components: [{ id: 'standard', label: 'Demacian Standard', type: 'magic', amount: 'calc.TotalDamage', aoe: true, travel: 'castRange / 1450' }],
    },
    R: {
      dash: true,
      // Wiki: leaps to the target over 0.35s, the damage on arrival.
      lockout: 0.35,
      notes: ['Leaps to the target and builds an arena (terrain, not crowd control).'],
      components: [{ id: 'cataclysm', label: 'Cataclysm', type: 'physical', amount: 'calc.DamageCalc', aoe: true, delay: 0.35 }],
    },
  },
  hooks: {
    // Per-target cooldown + damage from health before the attack: done on-attack, before the hit lands.
    onAttack(sim, atk) {
      if (atk.fromAbility || atk.phantom || !sim.isReady('jarvan.cadence')) return;
      const pct = sim.evalExpr('P.dv.TooltipCurrentHealthDamage', { slot: 'P' });
      const min = sim.evalExpr('P.dv.MinimumCadenceDamage', { slot: 'P' });
      atk.extra.push({
        source: 'P',
        sourceLabel: 'Martial Cadence',
        label: 'Martial Cadence',
        type: 'physical',
        amount: Math.max(min, pct * Math.max(0, sim.target.hp)),
        castId: atk.castId,
        flags: { kind: 'ability', slot: 'P', onHit: true, ability: false, proc: true },
      });
      sim.startCooldown('jarvan.cadence', sim.evalExpr('P.calc.TooltipCooldown', { slot: 'P' }));
    },
  },
};
export default kit;
