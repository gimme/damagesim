import type { ChampionKit } from '../../engine/kit-types.ts';

// Yasuo — patch 16.20.
// Way of the Wanderer (Intent): crit chance from all other sources is doubled, crit damage ×0.95,
// and crit chance above 100% converts to bonus AD.
// Last Breath: afterwards, crits ignore RPercentArmorPen% bonus armor. Penetration can't be limited
// to crits, so a dynamicStats hook applies it weighted by the crit chance recorded when R lands
// (dynamicStats can't read stats or evaluate expressions without recursing).

const kit: ChampionKit = {
  id: 'Yasuo',
  status: 'curated',
  notes: [
    'Crit chance from items/runes is doubled; crits deal 95% of normal crit damage; each 1% crit above 100% gives 0.5 bonus AD.',
    "Steel Tempest has a static cooldown reduced by bonus attack speed (4s down to 1.33s, same rule as Yone's Q; not in Yasuo's data); its cast-time scaling is not modeled.",
    'Sweeping Blade: its per-target lockout (10/9/8/7/6s) is used as the cooldown. Use option eStacks for stacks gained by dashing through minions first.',
    'Last Breath requires an airborne target (Q:tornado). Its bonus armor penetration (crits only) is applied to all physical damage weighted by crit chance (exact at 100% crit).',
    'Flow shield (Resolve) is not modeled.',
  ],
  options: [{ key: 'eStacks', label: 'Sweeping Blade stacks before the champion dash', default: 0, min: 0, max: 4, step: 1 }],
  attack: { critMultiplier: 'critDamage * P.dv.CritDamageMod' },
  stats: ({ evalExpr }) => ({
    critChanceMult: [1 + evalExpr('P.dv.CritChanceMultiplier')],
    conversions: [{ from: 'critChanceOverCap', to: 'ad', ratio: evalExpr('P.dv.YasuoCritToAD'), source: 'Way of the Wanderer' }],
  }),
  hooks: {
    dynamicStats(sim) {
      const r = sim.buffs.get('yasuoR');
      if (!r || r.expires < sim.time) return;
      // The armor penetration is for crits: as much of it as the hit being resolved crits.
      const mode = sim.critMode();
      const share = mode === 'always' ? 1 : mode === 'never' ? 0 : sim.stats.critChance;
      if (share <= 0) return;
      return { bonusArmorPenPercent: [(share * sim.dataValue(sim.spellFor('R'), 'RPercentArmorPen', sim.rankOf('R'))) / 100] };
    },
    afterDamage(sim, inst) {
      // The crit armor penetration starts once Last Breath's damage has landed.
      if (inst.source !== 'R' || inst.label !== 'Last Breath') return;
      sim.addBuff({ id: 'yasuoR', label: 'Last Breath (armor pen)', expires: sim.time + sim.evalExpr('R.dv.RBuffDuration', { slot: 'R' }) });
    },
  },
  abilities: {
    Q: {
      // Wiki: static cooldown 4 → 1.33 with bonus attack speed (-0.6% per 1% bonus AS, at most -66.7%;
      // same rule as Yone's QAttackSpeedCD data). The spell isn't flagged haste-immune in the data, so
      // the (1 + ah/100) factor cancels the engine's ability-haste reduction.
      cooldown: 'cooldown * (1 - min(2 / 3, 0.6 * bonusAs)) * (1 + ah / 100)',
      notes: [
        'Thrust: applies on-hit; the AD part can crit (95% crit damage). Two hits grant the whirlwind: write "Q Q Q:tornado".',
      ],
      variants: {
        tornado: {
          label: 'whirlwind',
          cc: [{ kind: 'immobilize', duration: 'dv.KnockUpDurationTOOLTIPONLY' }],
          components: [
            {
              id: 'tornado',
              label: 'Whirlwind',
              type: 'physical',
              amount: 'calc.TotalDamage',
              canCrit: true,
              critMultiplier: '(dv.BaseDamage + dv.ADRatio * critDamage * P.dv.CritDamageMod * ad) / calc.TotalDamage',
              onHit: true,
              onAttack: true,
              aoe: true,
              delay: 0.3,
            },
          ],
        },
      },
      components: [
        {
          id: 'thrust',
          label: 'Steel Tempest',
          type: 'physical',
          amount: 'calc.TotalDamage',
          canCrit: true,
          critMultiplier: '(dv.BaseDamage + dv.ADRatio * critDamage * P.dv.CritDamageMod * ad) / calc.TotalDamage',
          onHit: true,
          onAttack: true,
          aoe: true,
        },
      ],
    },
    W: { noTarget: true, components: [] },
    E: {
      dash: true,
      // On a single target the per-target lockout is the effective cooldown (not reduced by haste).
      cooldown: 'dv.PerTargetCooldown * (1 + ah / 100)',
      components: [{ id: 'blade', label: 'Sweeping Blade', type: 'magic', amount: 'calc.TotalDamage + calc.BonusDamagePerStack * opt.eStacks', delay: 0.2 }],
    },
    R: {
      dash: true,
      cc: [{ kind: 'immobilize', duration: 'dv.RKnockupDuration' }],
      components: [{ id: 'breath', label: 'Last Breath', type: 'physical', amount: 'calc.Damage', aoe: true, delay: 0.5 }],
    },
  },
};
export default kit;
