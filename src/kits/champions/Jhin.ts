import type { ChampionKit } from '../../engine/kit-types.ts';

// Jhin — patch 16.20.
// Whisper: fixed attack speed (attack speed ratio 0 in the data); bonus AD = P.calc.TotalADPercent of
// total AD; crits deal P.dv.CritReductionPercent less. Every 4th shot always crits and adds
// P.calc.FourthShotExecutePercent of missing health (computed before the shot lands), then Jhin
// reloads for P.dv.ReloadTime seconds (hook).
const kit: ChampionKit = {
  id: 'Jhin',
  status: 'curated',
  notes: [
    'The 4-shot counter starts full at the beginning of the combo; after the 4th shot the next attack waits P.dv.ReloadTime s.',
    'Deadly Flourish roots by default (assumes the target was damaged by Jhin, a Lotus Trap or an ally within 4s); W:noroot when it opens the fight.',
    'Lotus Traps placed within 1s of another trap on the same target deal 65% damage (not modeled).',
    'Attack speed comes from Whisper (base × 3% per level growth); Whisper\'s bonus AD counts item bonus attack speed only.',
  ],
  stats: ({ evalExpr }) => ({ conversions: [{ from: 'totalAd', to: 'ad', ratio: evalExpr('P.calc.TotalADPercent'), source: 'Whisper' }] }),
  attack: {
    critMultiplier: 'critDamage * (1 - P.dv.CritReductionPercent)',
    // Whisper sets the attack speed: base × (1 + 3% per level on the stat-growth curve); items don't
    // change it (wiki: 0.625 → ~0.94 at level 18). Whether level growth feeds the AD conversion is
    // unverified, so the conversion uses item bonus attack speed only.
    attackSpeed: 'P.dv.BaseAttackSpeed * (1 + P.dv.PercentAttackSpeedPerLevel * (level - 1) * (0.7025 + 0.0175 * (level - 1)))',
  },
  abilities: {
    Q: {
      notes: ['Bounces to other enemies; a single champion is hit once.'],
      components: [{ id: 'grenade', label: 'Dancing Grenade', type: 'physical', amount: 'calc.TotalDamage', travel: true }],
    },
    W: {
      cc: [{ kind: 'immobilize', duration: 'dv.RootDuration' }],
      // Not a missile (wiki): it hits as the 0.75s cast time ends.
      components: [{ id: 'flourish', label: 'Deadly Flourish', type: 'physical', amount: 'calc.TotalDamage' }],
      variants: {
        noroot: { label: 'no root', cc: [], components: [{ id: 'flourish', label: 'Deadly Flourish', type: 'physical', amount: 'calc.TotalDamage' }] },
      },
    },
    E: {
      notes: ['Trap placed on/under the target: arms after dv.TrapArmTime s, then detonates dv.TrapDetonationTime s after it is triggered.'],
      cc: [{ kind: 'slow', duration: 'dv.TrapDetonationTime' }],
      components: [{ id: 'trap', label: 'Captive Audience', type: 'magic', amount: 'calc.TotalDamage', aoe: true, delay: 'dv.TrapArmTime + dv.TrapDetonationTime' }],
    },
    R: {
      // Busy until the last shot is fired: the 1s cast (data), then one every MInimumDelayBetweenShots.
      lockout: '1 + 3 * dv.MInimumDelayBetweenShots',
      variableCount: 'shots',
      notes: [
        'Four shots, dv.MInimumDelayBetweenShots s apart; each deals calc.DamageCalc × (1 + dv.PercentMissingAmp × target missing health %) at impact, ≈0.2s after it is fired.',
        'Jhin is busy until the last shot is fired; set the shots to fire fewer (R{2}): the 4th is always the last.',
        'The 4th shot crits for dv.FourthShotMultiplier (raised by bonus crit damage such as Infinity Edge, without Whisper\'s reduction).',
      ],
      cc: [{ kind: 'slow', duration: 'dv.SlowDuration' }],
      components: [
        {
          id: 'shot',
          label: 'Curtain Call',
          type: 'physical',
          amount: 'calc.DamageCalc * (1 + dv.PercentMissingAmp * target.missingHpPct)',
          hits: 3,
          interval: 'dv.MInimumDelayBetweenShots',
          travel: true,
        },
        {
          id: 'final',
          label: 'Curtain Call (4th shot)',
          type: 'physical',
          amount: 'calc.DamageCalc * (1 + dv.PercentMissingAmp * target.missingHpPct) * max(dv.FourthShotMultiplier, critDamage)',
          delay: '3 * dv.MInimumDelayBetweenShots',
          travel: true,
        },
      ],
    },
  },
  hooks: {
    preAttack(sim, atk) {
      if (atk.fromAbility || atk.phantom) return;
      const shot = sim.counter('jhin.shot') + 1;
      const maxAmmo = sim.evalExpr('P.dv.MaxAmmo', { slot: 'P' });
      if (shot < maxAmmo) {
        sim.setCounter('jhin.shot', shot);
        return;
      }
      sim.setCounter('jhin.shot', 0);
      atk.crit = true;
      atk.critFactor = sim.evalExpr('critDamage * (1 - P.dv.CritReductionPercent)', { slot: 'P' });
      atk.extra.push({
        source: 'P',
        sourceLabel: 'Whisper',
        label: 'Whisper (4th shot)',
        type: 'physical',
        amount: sim.evalExpr('P.calc.FourthShotExecutePercent * target.missingHp', { slot: 'P' }),
        castId: atk.castId,
        flags: { kind: 'ability', slot: 'P', onHit: true, ability: false, proc: true },
      });
      // Reload before the next shot, from when this one was fired.
      sim.lockAttacks((atk.launched ?? sim.time) + sim.evalExpr('P.dv.ReloadTime', { slot: 'P' }));
    },
  },
};
export default kit;
