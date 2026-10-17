import type { ChampionKit } from '../../engine/kit-types.ts';
import type { Sim } from '../../engine/sim.ts';

// Heimerdinger — patch 16.20.
// Turrets are pets (Q). Hook: turret beams — each turret fires its charged shot (Q.calc.DamageBeam)
// when Electron Storm Grenade hits (full charge) or rockets hit (20% charge each), as in the tooltips.

const TURRET_AS = 1.75; // wiki: H-28G turret attack speed (not in the data)
const APEX_AS = 1.05; // wiki: H-28Q Apex turret attack speed
const APEX_DURATION = 8; // tooltip: "Place an upgraded Turret for 8 seconds"
// wiki: the Apex turret's beam charges 12.5% per second plus 20% per attack.
const APEX_BEAMS = `floor(min(opt.turretTime, ${APEX_DURATION}) * (0.125 + 0.2 * ${APEX_AS}))`;
const ROCKET_CHARGE = 0.2; // tooltip: "Turrets gain 20% charge per rocket that hits a champion"
const MAX_TURRETS = 3;

const kit: ChampionKit = {
  id: 'Heimerdinger',
  status: 'curated',
  options: [{ key: 'turretTime', label: 'Turret uptime on target (s)', default: 5, min: 0, max: 30, step: 0.5, description: 'Seconds each placed turret keeps shooting the target.' }],
  notes: [
    'Each Q places one turret that shoots the target for opt.turretTime seconds (1.75 attacks/s). Up to 3 turrets ("Q Q Q").',
    'Turret beams: Electron Storm Grenade hitting fully charges every active turret; each Micro-Rocket hit adds 20% (all 5 = one beam). Rocket Swarm is assumed not to charge turrets; natural beam charge is ignored.',
    'Micro-Rockets: all 5 rockets assumed to hit (point blank); use W{extra:0} for a single rocket.',
    'UPGRADE!!!: R = Hextech Rocket Swarm (4 waves of 5 rockets: first full, next 4 reduced, the rest halved); R:turret = Apex Turret; R:grenade = Lightning Grenade (a champion is damaged once).',
  ],
  abilities: {
    Q: {
      // Turret kits are ammo charges in the data (3 charges, recharge from the spell data).
      components: [
        {
          id: 'turret',
          label: 'Turret shot',
          type: 'magic',
          amount: 'calc.Damage',
          hits: `floor(opt.turretTime * ${TURRET_AS})`,
          interval: 1 / TURRET_AS,
          delay: 0.5,
          pet: true,
        },
      ],
    },
    W: {
      // No rocket speed in the data: ~0.3s of flight.
      components: [
        { id: 'rocket', label: 'Micro-Rocket', type: 'magic', amount: 'calc.Damage', delay: 0.3 },
        { id: 'extra', label: 'Micro-Rocket (extra)', type: 'magic', amount: 'calc.ExtraHitDamage', hits: 'dv.Rockets - 1', interval: 0.05, delay: 0.35 },
      ],
    },
    E: {
      notes: ['Assumes a center hit (stun).'],
      cc: [
        { kind: 'immobilize', duration: 'dv.StunDuration' },
        { kind: 'slow', duration: 'dv.SlowDuration' },
      ],
      components: [{ id: 'grenade', label: 'Electron Storm Grenade', type: 'magic', amount: 'calc.Damage', aoe: true, travel: true }],
    },
    R: {
      notes: ['Represents R + the upgraded ability as one step.'],
      // UPGRADE!!! is instant; the upgraded abilities have a 0.25s cast time (wiki).
      castTime: 0.25,
      // No rocket speed in the data: ~0.3s of flight.
      components: [
        { id: 'rocket', label: 'Rocket Swarm', type: 'magic', amount: 'calc.WUltDamage', delay: 0.3 },
        { id: 'reduced', label: 'Rocket Swarm (2nd-5th)', type: 'magic', amount: "calc['{a8af07ef}']", hits: 4, interval: 0.05, delay: 0.35 },
        { id: 'halved', label: 'Rocket Swarm (6th+)', type: 'magic', amount: "calc['{f058914b}']", hits: 15, interval: 0.1, delay: 0.6 },
      ],
      variants: {
        turret: {
          label: 'turret',
          note: 'H-28Q Apex Turret: shoots for min(opt.turretTime, 8) s; beam count from its charge rate.',
          components: [
            {
              id: 'apex',
              label: 'Apex Turret shot',
              type: 'magic',
              amount: 'calc.QUltDamage',
              hits: `floor(min(opt.turretTime, ${APEX_DURATION}) * ${APEX_AS})`,
              interval: 1 / APEX_AS,
              delay: 0.5,
              aoe: true,
              pet: true,
            },
            { id: 'apexBeam', label: 'Apex Turret beam', type: 'magic', amount: 'calc.QUltDamageBeam', hits: APEX_BEAMS, interval: 3, delay: 3, aoe: true, pet: true },
          ],
        },
        grenade: {
          label: 'grenade',
          note: 'CH-3X Lightning Grenade: bounces 3 times; a champion is damaged once but stunned.',
          cc: [
            { kind: 'immobilize', duration: 'E.dv.StunDuration' },
            { kind: 'slow', duration: 'E.dv.SlowDuration' },
          ],
          // Same range and speed as Electron Storm Grenade (wiki; not in the data).
          components: [{ id: 'grenade', label: 'Lightning Grenade', type: 'magic', amount: 'calc.EUltDamage', aoe: true, travel: 'E.castRange / E.missileSpeed' }],
        },
      },
    },
  },
  hooks: {
    onCast(sim: Sim, cast) {
      if (cast.slot !== 'Q') return;
      const n = sim.counter('heimerTurret.n');
      // Stored as time + 1 so 0 means "no turret".
      sim.setCounter(`heimerTurret.t${n % MAX_TURRETS}`, sim.time + 1);
      sim.setCounter(`heimerTurret.c${n % MAX_TURRETS}`, 0);
      sim.setCounter('heimerTurret.n', n + 1);
    },
    afterDamage(sim: Sim, inst) {
      if (inst.fromMark || inst.flags.pet || inst.flags.kind !== 'ability') return;
      const slot = inst.flags.slot;
      let charge = 0;
      // Only Micro-Rockets' tooltip charges turrets per rocket; Rocket Swarm's doesn't mention it.
      if (slot === 'W') charge = ROCKET_CHARGE;
      else if (slot === 'E' || (slot === 'R' && inst.label === 'Lightning Grenade')) charge = 1;
      if (!charge) return;
      const uptime = sim.opt.turretTime ?? 0;
      for (let i = 0; i < MAX_TURRETS; i++) {
        const placed = sim.counter(`heimerTurret.t${i}`) - 1;
        if (placed < 0 || sim.time - placed > uptime) continue;
        const c = sim.counter(`heimerTurret.c${i}`) + charge;
        if (c < 1 - 1e-9) {
          sim.setCounter(`heimerTurret.c${i}`, c);
          continue;
        }
        sim.setCounter(`heimerTurret.c${i}`, 0);
        sim.schedule(0.25, () =>
          sim.deal({
            source: 'Q',
            sourceLabel: sim.spellFor('Q').name,
            label: 'Turret beam',
            type: 'magic',
            amount: sim.evalExpr('Q.calc.DamageBeam', { slot: 'Q' }),
            flags: { kind: 'ability', slot: 'Q', ability: true, aoe: true, pet: true },
          }),
        );
      }
    },
  },
};
export default kit;
