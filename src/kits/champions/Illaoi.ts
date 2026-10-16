import type { ChampionKit } from '../../engine/kit-types.ts';
import { hasteCooldown } from '../../engine/stats.ts';

// Illaoi — patch 16.20.
// Tentacle Slam damage (passive, Q passive amp) is Q.calc.TentacleDamageTotal. Slams are area ability
// damage. A target hit by several slams within 0.66s takes 50% from the 2nd and 25% from later ones
// (wiki: "-50% per slam in the last 0.66s, capped at 75% less").
const SLAM_FALLOFF = '(hit == 0 ? 1 : hit == 1 ? 0.5 : 0.25)';

const kit: ChampionKit = {
  id: 'Illaoi',
  status: 'curated',
  notes: [
    'Option "tentacles" = Tentacles in range of the target (default 1). Harsh Lesson makes all of them Slam; during Leap of Faith one more Tentacle (spawned by R) joins.',
    'Simultaneous slams on the same target are reduced (100% / 50% / 25%…).',
    'Test of Spirit: Illaoi\'s own hits are modeled on the champion itself. Hitting the spirit instead would echo only E.calc.EchoPercent of that damage (not modeled).',
  ],
  options: [{ key: 'tentacles', label: 'Tentacles near the target', default: 1, min: 0, max: 6, description: 'Tentacles that Slam when Harsh Lesson hits (terrain/vessel tentacles in range).' }],
  abilities: {
    Q: {
      notes: ['A single Tentacle slams forward (0.75s cast).'],
      components: [{ id: 'slam', label: 'Tentacle Slam', type: 'physical', amount: 'calc.TentacleDamageTotal', aoe: true }],
    },
    W: {
      resetsAttack: true,
      dash: true,
      notes: [
        'Empowers the next attack (leap): bonus % max health physical damage (minimum dv.WMinDamage) on top of the attack, then nearby Tentacles Slam the target.',
        'During Leap of Faith the cooldown is W.dv.CooldownDuringR seconds (handled by a hook).',
      ],
      buff: {
        id: 'illaoiW',
        label: 'Harsh Lesson',
        duration: 'dv.BuffDuration',
        empowerAttacks: {
          count: 1,
          resetsAttack: true,
          components: [
            { id: 'lesson', label: 'Harsh Lesson', type: 'physical', amount: 'max(W.calc.HealthPercentTotal * target.maxHp, W.dv.WMinDamage)' },
            {
              id: 'slam',
              label: 'Tentacle Slam (Harsh Lesson)',
              type: 'physical',
              amount: `Q.calc.TentacleDamageTotal * ${SLAM_FALLOFF}`,
              hits: 'opt.tentacles + buff.illaoiR',
              aoe: true,
            },
          ],
        },
      },
    },
    E: {
      notes: [
        'Default: the spirit is pulled and Tentacles slam it every E.calc.TimeBetweenVesselTentacleSlams seconds while it lasts; E.calc.EchoPercent of each slam echoes to the champion (proc damage, mitigated by the champion\'s resists).',
        'E:vessel — the spirit is killed/leashed right away: the champion becomes a Vessel (slowed) and Tentacles slam it directly for dv.VesselDuration seconds.',
        'Slams start ~0.5s after the pull (wiki: "up to a 0.5-second delay").',
      ],
      components: [
        {
          id: 'echo',
          label: 'Tentacle Slam on spirit (echo)',
          type: 'physical',
          amount: 'Q.calc.TentacleDamageTotal * calc.EchoPercent',
          hits: 'floor(dv.SpiritDuration / calc.TimeBetweenVesselTentacleSlams)',
          interval: 'calc.TimeBetweenVesselTentacleSlams',
          delay: 0.5,
          // The wiki: "Echoed damage always counts as proc damage".
          proc: true,
        },
      ],
      variants: {
        vessel: {
          label: 'vessel',
          cc: [{ kind: 'slow', duration: 'dv.SlowDuration' }],
          components: [
            {
              id: 'slam',
              label: 'Tentacle Slam (vessel)',
              type: 'physical',
              amount: 'Q.calc.TentacleDamageTotal',
              hits: 'ceil(dv.VesselDuration / calc.TimeBetweenVesselTentacleSlams)',
              interval: 'calc.TimeBetweenVesselTentacleSlams',
              delay: 0.5,
              aoe: true,
            },
          ],
        },
      },
    },
    R: {
      notes: ['Spawns a Tentacle per champion hit (counted in Harsh Lesson slams while active). Tentacles slam 50% faster during R (not applied to E\'s slam timing).'],
      buff: { id: 'illaoiR', label: 'Leap of Faith', duration: 'dv.Duration' },
      components: [{ id: 'smash', label: 'Leap of Faith', type: 'physical', amount: 'calc.DamageCalc', aoe: true }],
    },
  },
  hooks: {
    // Harsh Lesson has a fixed short cooldown while Leap of Faith is active. The cast sets the normal
    // cooldown after onCast, so override it from a zero-delay event.
    onCast(sim, cast) {
      if (cast.slot !== 'W' || !sim.getBuff('illaoiR')) return;
      const cd = hasteCooldown(sim.evalExpr('W.dv.CooldownDuringR', { slot: 'W' }), sim.stats.abilityHaste + sim.stats.basicAbilityHaste);
      sim.schedule(0, () => sim.startCooldown('ability:W', cd));
    },
  },
};
export default kit;
