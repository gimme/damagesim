import type { ChampionKit } from '../../engine/kit-types.ts';
import type { Sim } from '../../engine/sim.ts';

// Naafiri — patch 16.20. Slot R holds NaafiriW (Hounds' Pursuit), slot W holds NaafiriR (The Call of the Pack).
// Packmates and the Darkin Daggers bleed are driven by hooks: packmates attack on their own timer
// while commanded, and the Q recast consumes the remaining bleed.

const PACK = 'max(0, P.calc.PackmateCap - opt.missingPackmates) + (buff.callOfThePack ? W.dv.PackmatesToAdd : 0)';
// Leap time before the first packmate attack after a command (LeapSpeed 1250 over melee range; assumed).
const LEAP = 0.1;

function packVolley(sim: Sim) {
  if (sim.time > sim.counter('naafiri:commandUntil') + 1e-9) {
    sim.setCounter('naafiri:packLoop', 0);
    return;
  }
  const n = Math.round(sim.evalExpr(PACK, { slot: 'P' }));
  // Prey Drive: each ability cast stores an empowered packmate attack (max 3, within 3s).
  const frenzy = sim.time <= sim.counter('naafiri:frenzyUntil') + 1e-9 && sim.counter('naafiri:frenzy') > 0;
  if (frenzy) sim.setCounter('naafiri:frenzy', sim.counter('naafiri:frenzy') - 1);
  const amount = sim.evalExpr(frenzy ? 'P.calc.PackmateTotalDamage * P.dv.PackmateFrenzyDamageMult' : 'P.calc.PackmateTotalDamage', { slot: 'P' });
  const castId = sim.newCastId();
  for (let i = 0; i < n; i++)
    sim.deal({
      source: 'P',
      sourceLabel: 'We Are More',
      label: frenzy ? 'Packmate (Prey Drive)' : 'Packmate',
      type: 'physical',
      amount,
      castId,
      flags: { kind: 'ability', slot: 'P', ability: true, aoe: true, pet: true },
    });
  // Packmates use Naafiri's attack speed.
  sim.schedule(1 / sim.stats.attackSpeed, () => packVolley(sim));
}

function bleedTick(sim: Sim, gen: number) {
  if (sim.counter('naafiri:bleedGen') !== gen || sim.counter('naafiriBleedLeft') <= 0) return;
  sim.setCounter('naafiriBleedLeft', sim.counter('naafiriBleedLeft') - 1);
  sim.deal({
    source: 'Q',
    sourceLabel: 'Darkin Daggers',
    label: 'Darkin Daggers bleed',
    type: 'physical',
    amount: sim.evalExpr('Q.calc.TotalBleedDamage * Q.dv.BleedInterval / Q.dv.BleedDuration', { slot: 'Q' }),
    // Part of the dagger's cast instance.
    castId: sim.counter('naafiri:bleedCast'),
    flags: { kind: 'ability', slot: 'Q', ability: true, dot: true },
  });
  sim.schedule(sim.evalExpr('Q.dv.BleedInterval', { slot: 'Q' }), () => bleedTick(sim, gen));
}

const kit: ChampionKit = {
  id: 'Naafiri',
  status: 'curated',
  notes: [
    'Packmates (P.calc.PackmateCap, +W.dv.PackmatesToAdd during The Call of the Pack) attack the target at Naafiri\'s attack speed for P.dv.PackmateTauntDuration s after each of her attack or ability hits. After each ability cast their next attack deals ×P.dv.PackmateFrenzyDamageMult (max 3 stored, P.dv.PackmateFrenzyDuration s).',
    'Darkin Daggers: the first dagger applies a bleed (Q.dv.BleedInterval ticks); a recast on the bleeding target deals the remaining bleed instantly plus the missing-health bonus (assumed linear from min at full health to max at 0 health) and ends the bleed.',
    'Hounds\' Pursuit recast/shield and the takedown reveal are not modeled.',
  ],
  options: [{ key: 'missingPackmates', label: 'Dead/missing packmates', default: 0, min: 0, max: 5 }],
  hooks: {
    onCast(sim, cast) {
      if (cast.slot === 'P') return;
      const max = sim.evalExpr('P.dv.PackmateFrenzyMaxCounters', { slot: 'P' });
      const active = sim.time <= sim.counter('naafiri:frenzyUntil');
      sim.setCounter('naafiri:frenzy', Math.min(max, (active ? sim.counter('naafiri:frenzy') : 0) + 1));
      sim.setCounter('naafiri:frenzyUntil', sim.time + sim.evalExpr('P.dv.PackmateFrenzyDuration', { slot: 'P' }));
    },
    afterDamage(sim, inst) {
      if (inst.flags.pet || inst.flags.dot || inst.fromMark) return;
      // Darkin Daggers bleed: started by the first dagger, ended by the recast.
      if (inst.label === 'Darkin Daggers') {
        const gen = sim.counter('naafiri:bleedGen') + 1;
        sim.setCounter('naafiri:bleedGen', gen);
        sim.setCounter('naafiri:bleedCast', inst.castId);
        sim.setCounter('naafiriBleedLeft', sim.evalExpr('Q.dv.BleedDuration / Q.dv.BleedInterval', { slot: 'Q' }));
        sim.schedule(sim.evalExpr('Q.dv.BleedInterval', { slot: 'Q' }), () => bleedTick(sim, gen));
      } else if (inst.label === 'Darkin Daggers (recast)') {
        sim.setCounter('naafiriBleedLeft', 0);
        sim.setCounter('naafiri:bleedGen', sim.counter('naafiri:bleedGen') + 1);
      }
      // Attack and ability hits command the packmates.
      if (inst.flags.attack || (inst.flags.kind === 'ability' && inst.flags.slot && inst.flags.slot !== 'P')) {
        sim.setCounter('naafiri:commandUntil', sim.time + sim.evalExpr('P.dv.PackmateTauntDuration', { slot: 'P' }));
        if (!sim.counter('naafiri:packLoop')) {
          sim.setCounter('naafiri:packLoop', 1);
          sim.schedule(LEAP, () => packVolley(sim));
        }
      }
    },
  },
  abilities: {
    Q: {
      recasts: 2,
      recastDelay: 'dv.RecastLockout',
      notes: ['Q then Q again (within dv.RecastWindow) for the recast on the bleeding target.'],
      components: [
        // First dagger (or any cast on a target that isn't bleeding).
        { id: 'dagger', label: 'Darkin Daggers', type: 'physical', amount: 'calc.TotalDamageFirstCast', hits: 'stacks.naafiriBleedLeft > 0 ? 0 : 1', travel: true },
        {
          id: 'recast',
          label: 'Darkin Daggers (recast)',
          type: 'physical',
          amount:
            'lerp(calc.TotalMinDamageSecondCast, calc.TotalMaxDamageSecondCast, target.missingHpPct) + stacks.naafiriBleedLeft * calc.TotalBleedDamage * dv.BleedInterval / dv.BleedDuration',
          hits: 'stacks.naafiriBleedLeft > 0 ? 1 : 0',
          travel: true,
          condition: 'target is bleeding from the first dagger',
        },
      ],
    },
    W: {
      noTarget: true,
      buff: { id: 'callOfThePack', label: 'The Call of the Pack', duration: 'dv.Duration', stats: { ad: 'calc.BonusAD' } },
      components: [],
    },
    E: {
      dash: true,
      // Dashes to the target at the dash speed (at least dv.MinDashDistance), slashing it on the way;
      // the flurry bursts where she lands.
      lockout: 'castTime + max(dv.MinDashDistance, reach) / missileSpeed',
      components: [
        { id: 'slash', label: 'Eviscerate (dash)', type: 'physical', amount: 'calc.TotalDamageFirstSlash', travel: true },
        { id: 'flurry', label: 'Eviscerate (flurry)', type: 'physical', amount: 'calc.TotalDamageSecondSlash', travel: 'max(dv.MinDashDistance, reach) / missileSpeed', aoe: true },
      ],
    },
    R: {
      dash: true,
      notes: ['Each packmate dashing alongside deals dv.PackmateModifier of the damage. The data\'s ArmorShred/ShredDuration values aren\'t in the tooltip and are not modeled.'],
      cc: [{ kind: 'slow', duration: 'dv.SlowDuration' }],
      // Wiki: a 0.75s channel (unable to act), then the dash to the target at the dash speed.
      lockout: '0.75 + reach / missileSpeed',
      components: [
        { id: 'pursuit', label: "Hounds' Pursuit", type: 'physical', amount: 'calc.TotalDamage', delay: 0.75, travel: true },
        { id: 'pack', label: "Hounds' Pursuit (packmate)", type: 'physical', amount: 'calc.PackmateDamage', hits: PACK, delay: 0.75, travel: true, pet: true },
      ],
    },
  },
};
export default kit;
