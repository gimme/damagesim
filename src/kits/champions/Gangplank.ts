import type { ChampionKit, ComponentSpec } from '../../engine/kit-types.ts';
import type { Sim } from '../../engine/sim.ts';

// Gangplank — patch 16.20.
// Hook: Trial by Fire (cooldown-gated burn on basic attacks, refreshed by destroying a Powder Keg).

const BURN_TICK = 0.25; // wiki: the burn ticks every 0.25s over P.dv.DoTDuration
const CLUSTER_GAP = 0.25; // wiki: Cannon Barrage drops waves in clusters of 3, 0.25s apart


/** Cannon Barrage waves: clusters of 3 waves every `interval` seconds. */
function barrage(waves: string, interval: string): ComponentSpec[] {
  return [0, 1, 2].map((k) => ({
    id: `wave${k + 1}`,
    label: 'Cannonball wave',
    type: 'magic' as const,
    amount: 'calc.OneWaveDamage',
    hits: `(${waves}) / 3`,
    interval,
    delay: `dv.CannonDelay + ${k * CLUSTER_GAP}`,
    aoe: true,
  }));
}
const deathsDaughter: ComponentSpec = {
  id: 'deathsDaughter',
  label: "Death's Daughter",
  type: 'true',
  amount: 'calc.DeathsDaughterDamage',
  delay: 'dv.CannonDelay',
  aoe: true,
  optional: true,
  condition: "Death's Daughter upgrade",
};

const kit: ChampionKit = {
  id: 'Gangplank',
  status: 'curated',
  notes: [
    'Trial by Fire: off cooldown, a basic attack burns for P.calc.TotalDamage true damage over P.dv.DoTDuration (10 ticks); Parrrley does not trigger it. Destroying a Powder Keg (Q:barrel) refreshes the cooldown.',
    'Powder Keg: E only places the keg. Detonate it next to the target with Q:barrel once it is down to 1 health (3 health, decaying 1 per P.calc.BarrelDecayTime: ~4s before level 7, 2s at 7-12, 1s from 13), e.g. "E wait:2 Q:barrel".',
    'Cannon Barrage: the target is assumed to stay in the zone for all waves; +deathsDaughter for the upgrade, R:fireAtWill for 18 waves.',
  ],
  abilities: {
    Q: {
      notes: ['Applies on-hit effects; crits for calc.ShotCrit.'],
      components: [
        { id: 'shot', label: 'Parrrley', type: 'physical', amount: 'calc.ShotDamage', onHit: true, onAttack: true, canCrit: true, critMultiplier: '1 + dv.CritDamageMod * (critDamage - 1)', delay: 0.15 },
      ],
      variants: {
        barrel: {
          label: 'barrel',
          note: 'Parrrley hits a Powder Keg next to the target: the explosion deals the shot\'s damage (can crit) plus the champion bonus, ignoring 40% armor. The shot itself does not hit the target (no on-hit on it).',
          cc: [{ kind: 'slow', duration: 'E.dv.DebuffDuration' }],
          components: [
            { id: 'keg', label: 'Powder Keg', type: 'physical', amount: 'calc.ShotDamage', canCrit: true, critMultiplier: '1 + dv.CritDamageMod * (critDamage - 1)', penPercent: 'E.dv.BarrelArmorPenetration / 100', aoe: true, delay: 0.15 },
            { id: 'kegBonus', label: 'Powder Keg (champion bonus)', type: 'physical', amount: 'E.dv.BonusDamageToChampions', penPercent: 'E.dv.BarrelArmorPenetration / 100', aoe: true, delay: 0.15 },
          ],
        },
      },
    },
    W: { noTarget: true, notes: ['Heal/cleanse only.'] },
    E: { noTarget: true, notes: ['Places a keg; damage is dealt by Q:barrel.'] },
    R: {
      notes: ['Waves fall in clusters of 3 every dv.CannonInterval s after dv.CannonDelay.'],
      components: [...barrage('dv.TotalWavesTooltip', 'dv.CannonInterval'), deathsDaughter],
      variants: {
        fireAtWill: {
          label: 'fireAtWill',
          note: 'Fire at Will upgrade: 6 more waves, clusters every dv.ZoneDuration / 6 s.',
          components: [...barrage('dv.TotalWavesTooltip + 6', 'dv.ZoneDuration / 6'), deathsDaughter],
        },
      },
    },
  },
  hooks: {
    onCast(sim: Sim, cast) {
      if (cast.slot === 'Q' && cast.variant === 'barrel') sim.startCooldown('trialByFire', 0);
    },
    onAttack(sim: Sim, atk) {
      if (atk.fromAbility || atk.phantom || !sim.isReady('trialByFire')) return;
      sim.startCooldown('trialByFire', sim.evalExpr('P.dv.Cooldown', { slot: 'P' }));
      const ticks = Math.round(sim.evalExpr('P.dv.DoTDuration', { slot: 'P' }) / BURN_TICK);
      const perTick = sim.evalExpr('P.calc.TotalDamage', { slot: 'P' }) / ticks;
      const castId = sim.newCastId();
      for (let i = 1; i <= ticks; i++)
        sim.schedule(i * BURN_TICK, () =>
          sim.deal({ source: 'P', sourceLabel: 'Trial by Fire', label: 'Burn', type: 'true', amount: perTick, castId, flags: { kind: 'ability', slot: 'P', ability: false, dot: true }, markSource: 'trialByFire' }),
        );
    },
  },
};
export default kit;
