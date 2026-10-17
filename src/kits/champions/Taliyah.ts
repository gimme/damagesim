import type { ChampionKit } from '../../engine/kit-types.ts';

// Taliyah — patch 16.20.
/** A Stone Shard's flight to the target: 3600 speed slowing by 5000/s² (wiki). */
const SHARD_TRAVEL = '(3600 - sqrt(3600 * 3600 - 2 * 5000 * reach)) / 5000';

const kit: ChampionKit = {
  id: 'Taliyah',
  status: 'curated',
  notes: [
    'Threaded Volley: 5 rocks over ~1.5s; against one target the first deals full damage, the other four 40%. Q:boulder = cast on Worked Ground (one big rock + slow).',
    'Unraveled Earth stones detonate when Seismic Shove knocks the target through them (E then W within 4s): the stones option sets how many (each one 25% less, max 4).',
    'Weaver\'s Wall and Rock Surfing deal no damage.',
  ],
  options: [{ key: 'stones', label: 'Unraveled Earth stones detonated by W', default: 2, min: 0, max: 4, step: 1 }],
  abilities: {
    Q: {
      notes: ['Rocks: first instantly, then four more over ~1.5s (≈0.375s apart).'],
      // Wiki: unable to attack until the third shard is launched, 1s after the 0.25s cast time; she can
      // move and cast meanwhile.
      attackLockout: 1.25,
      components: [
        { id: 'rock', label: 'Threaded Volley', type: 'magic', amount: 'calc.RockDamage', aoe: true, travel: SHARD_TRAVEL },
        { id: 'rest', label: 'Threaded Volley (repeat)', type: 'magic', amount: 'calc.RockDamage * (1 - dv.ExtraMissileReducedDamagePercent / 100)', aoe: true, hits: 4, maxHits: 4, delay: 0.375, interval: 0.375, travel: SHARD_TRAVEL },
      ],
      variants: {
        boulder: {
          label: 'boulder',
          note: 'Cast on Worked Ground: one boulder dealing 180% damage and slowing.',
          attackLockout: 0, // a single boulder: no shards to wait for
          cc: [{ kind: 'slow', duration: 'dv.SlowDuration' }],
          // The boulder flies at 2000 (wiki).
          components: [{ id: 'boulder', label: 'Threaded Volley (boulder)', type: 'magic', amount: 'calc.BigRockDamage', aoe: true, travel: 'reach / 2000' }],
        },
      },
    },
    W: {
      notes: ['No damage. The ledge erupts dv.KnockupDelay after the cast and knocks the target ~1s (+0.75s stun when it passes through Unraveled Earth stones).'],
      // Knock lasts ~1s (wiki, not in data); +stun when knocked through the stones.
      cc: [{ kind: 'immobilize', duration: '1 + (buff.unraveledEarth ? E.dv.StunDuration : 0)' }],
      components: [
        {
          id: 'stones',
          label: 'Unraveled Earth (detonation)',
          type: 'magic',
          amount: 'E.calc.DetonationDamage * (1 - E.dv.MineDamageFalloff * hit)',
          hits: 'buff.unraveledEarth ? min(opt.stones, 4) : 0',
          maxHits: 4,
          aoe: true,
          delay: 'dv.KnockupDelay + 0.2',
          interval: 0.1,
          condition: 'after Unraveled Earth',
        },
      ],
    },
    E: {
      cc: [{ kind: 'slow', duration: 1 }], // slow duration not in data (~while in the stone field)
      // Self marker so a following Seismic Shove knows the stones are on the ground.
      buff: { id: 'unraveledEarth', label: 'Unraveled Earth stones', duration: 'dv.MineLifetime' },
      components: [{ id: 'scatter', label: 'Unraveled Earth', type: 'magic', amount: 'calc.ScatterDamage', aoe: true, delay: 0.3 }],
    },
    R: { noTarget: true, notes: ['Weaver\'s Wall deals no damage.'], components: [] },
  },
};
export default kit;
