import type { ChampionKit, ComponentSpec } from '../../engine/kit-types.ts';

// Zyra — patch 16.20.
// Plants (pets): Deadly Spines grows a Thorn Spitter and Grasping Roots a Vine Lasher when cast near
// a Seed. Each plant attacks every 1.25s (wiki: 0.8 attack speed) for up to PlantDuration seconds.
// A plant that is not the first to attack the target deals 50% damage (wiki): the plant grown while
// the other kind is already alive uses the halved component (hit counts are evaluated on cast).
// Stranglethorns enrages plants: +PlantDamageBonus% damage while its buff lasts.
const PLANT_DAMAGE = 'P.calc.PlantDamage * (1 + (buff.zyraR ? R.dv.PlantDamageBonus / 100 : 0))';

function plant(id: string, label: string, otherBuff: string): ComponentSpec[] {
  const common = { type: 'magic' as const, interval: 1.25, delay: 0.75, maxHits: 7, aoe: true, pet: true, condition: 'cast near a Seed' };
  return [
    { id, label, amount: PLANT_DAMAGE, hits: `buff.${otherBuff} ? 0 : opt.plantAttacks`, ...common },
    { id: `${id}Half`, label: `${label} (second plant)`, amount: `${PLANT_DAMAGE} * 0.5`, hits: `buff.${otherBuff} ? opt.plantAttacks : 0`, ...common },
  ];
}

const kit: ChampionKit = {
  id: 'Zyra',
  status: 'curated',
  notes: [
    'Q and E are assumed to be cast near a Seed (passive seeds or W), each growing one plant that attacks plantAttacks times (option, default 4; 0 disables plants).',
    'When both plant kinds are alive, the later one deals 50% damage. Stranglethorns enrages plants (+50% damage) for 10s (wiki); plant duration reset is not modeled.',
  ],
  options: [{ key: 'plantAttacks', label: 'Attacks per plant on the target', default: 4, min: 0, max: 7, step: 1 }],
  abilities: {
    Q: {
      buff: { id: 'zyraSpitter', label: 'Thorn Spitter', duration: 'P.dv.PlantDuration' },
      components: [{ id: 'spines', label: 'Deadly Spines', type: 'magic', amount: 'calc.InitialDamage', aoe: true, delay: 0.6 }, ...plant('spitter', 'Thorn Spitter', 'zyraLasher')],
    },
    W: { noTarget: true, notes: ['Plants a Seed; no damage.'], components: [] },
    E: {
      // Wiki: locked out of actions for 0.15s after the 0.25s cast time.
      lockout: 0.4,
      cc: [{ kind: 'immobilize', duration: 'dv.RootDuration' }],
      buff: { id: 'zyraLasher', label: 'Vine Lasher', duration: 'P.dv.PlantDuration' },
      components: [{ id: 'roots', label: 'Grasping Roots', type: 'magic', amount: 'calc.TotalDamage', aoe: true, delay: 0.4 }, ...plant('lasher', 'Vine Lasher', 'zyraSpitter')],
    },
    R: {
      // "After 2 seconds, the vines snap upwards" (tooltip text).
      cc: [{ kind: 'immobilize', duration: 'dv.KnockupDuration', delay: 2 }],
      buff: { id: 'zyraR', label: 'Stranglethorns (enraged plants)', duration: 10 },
      components: [{ id: 'thicket', label: 'Stranglethorns', type: 'magic', amount: 'calc.TotalDamage', aoe: true, delay: 0.5 }],
    },
  },
};
export default kit;
