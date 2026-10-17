import type { ChampionKit } from '../../engine/kit-types.ts';

// Akshan — patch 16.20.
const kit: ChampionKit = {
  id: 'Akshan',
  status: 'curated',
  notes: [
    'Dirty Fighting: every attack fires a second shot (a separate basic attack for P.calc.SecondAutoDamage that can crit and applies on-hit effects). The movement-speed cancel is not modeled.',
    'Every third hit from attacks (both shots) or ability hits (each Avengerang pass, Heroic Swing shot, Comeuppance bullet) deals bonus magic damage; the shield is not modeled.',
  ],
  marks: [
    {
      id: 'dirtyFighting',
      label: 'Dirty Fighting',
      maxStacks: 'P.dv.MaxStacks',
      duration: 'P.dv.DebuffDuration',
      appliedBy: ['attack', 'ability'],
      // Each hit counts (Avengerang passes, swing shots and bullets are separate hits of one cast).
      oncePerCast: false,
      atMax: { consume: true, components: [{ id: 'proc', label: 'Dirty Fighting', type: 'magic', amount: 'P.calc.PassiveProcDamage', noProc: true }] },
    },
  ],
  abilities: {
    P: { notes: ['Second shot and 3-hit proc are automatic (see notes).'] },
    Q: {
      notes: ['Hits the target on the way out and on the way back (Q{boomerang:1} for one pass).'],
      // Wiki: out at 1500 to the target, then on to its range but at least 500 past the enemy hit, and
      // back at 2400: it passes the target again on its return.
      components: [{ id: 'boomerang', label: 'Avengerang', type: 'physical', amount: 'calc.FinalDamage', hits: 2, maxHits: 2, interval: 'max(castRange - reach, 500) / missileSpeed + max(castRange - reach, 500) / 2400', travel: true, aoe: true }],
    },
    W: { noTarget: true, notes: ['Going Rogue: camouflage / revive only.'] },
    E: {
      dash: true,
      // Wiki: Comeuppance can be cast at any point; Avengerang and Going Rogue not while the hook flies
      // and he swings (default 6 shots), and attacking only moves on to the next cast.
      attackLockout: 'castRange / missileSpeed + 5 * dv.AttackFrequency',
      castLockout: { Q: 'castRange / missileSpeed + 5 * dv.AttackFrequency', W: 'castRange / missileSpeed + 5 * dv.AttackFrequency' },
      notes: [
        'One "E" = hook, swing and dismount. The swing fires every 0.2s plus a dismount shot; default 6 shots on the target (E{shot:N}).',
        'Shots can crit (+50% of bonus crit damage) and apply on-hit effects at 25% effectiveness.',
      ],
      components: [
        {
          id: 'shot',
          label: 'Heroic Swing',
          type: 'physical',
          amount: 'calc.DamageToDeal',
          hits: 6,
          maxHits: 15,
          interval: 'dv.AttackFrequency',
          // The swing starts once the hook has flown its range; shots fly to the target (up to 500) at
          // 3000 (wiki).
          delay: 'castRange / missileSpeed',
          travel: 'min(distance, 500) / 3000',
          canCrit: true,
          critMultiplier: '1 + dv.CritDamageMod * (critDamage - 1)',
          onHit: true,
          onHitEffectiveness: 'dv.OnHitDamageReduction',
        },
      ],
    },
    R: {
      // Full channel before firing; data castTime is 0.
      castTime: 'dv.ChannelDuration',
      notes: [
        'Full 2.5s channel, then every stored bullet hits the target. Each bullet deals +2% per 1% missing health (up to 3×), recomputed bullet by bullet.',
        'Crit chance increases bullet damage through the game formula (no separate crit roll).',
      ],
      components: [
        {
          id: 'bullet',
          label: 'Comeuppance',
          type: 'physical',
          amount: 'calc.DamagePerBulletWithCrit * (1 + (dv.MaxIncrease - 1) * target.missingHpPct)',
          max: 'calc.MaxDamagePerBullet',
          hits: 'dv.NumberOfBullets',
          interval: 'dv.CastTimePerBullet',
          travel: true,
        },
      ],
    },
  },
  hooks: {
    // The second shot is its own basic attack (separate hit, own crit roll, applies on-hit), fired
    // 0.1s after the first.
    onLaunch(sim, launch) {
      if (launch.fromAbility || sim.counter('akshanSecondShot')) return;
      sim.schedule(0.1, () => {
        sim.setCounter('akshanSecondShot', 1);
        sim.launchAttack({
          castId: sim.newCastId(),
          amount: sim.evalExpr('P.calc.SecondAutoDamage', { slot: 'P' }),
          label: 'Dirty Fighting (second shot)',
          sourceLabel: 'Dirty Fighting',
        });
        sim.setCounter('akshanSecondShot', 0);
      });
    },
  },
};
export default kit;
