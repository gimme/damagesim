import type { ChampionKit } from '../../engine/kit-types.ts';

// Renata Glasc — patch 16.20.
const kit: ChampionKit = {
  id: 'Renata',
  status: 'curated',
  notes: [
    'Leverage: Renata\'s attack on an unmarked target deals bonus % max health magic damage and marks it for 6s. Modeled as once per 6s (continuous attacks that keep the mark refreshed would not re-trigger it).',
    'Allied attacks/abilities consuming the mark (another % max health hit) are not modeled (single attacker).',
  ],
  marks: [
    {
      id: 'leverage',
      label: 'Leverage',
      maxStacks: 1,
      duration: 'P.dv.PassiveDuration',
      appliedBy: ['attack'],
      atMax: {
        consume: true,
        cooldown: 'P.dv.PassiveDuration',
        components: [{ id: 'leverage', label: 'Leverage', type: 'magic', amount: 'P.calc.PercentAmpCalcSelf * target.maxHp', proc: true }],
      },
    },
  ],
  abilities: {
    Q: {
      notes: ['Root on the first enemy hit. The recast throws the target; its damage only hits the enemies it is thrown into, so it is not modeled against a single target.'],
      cc: [{ kind: 'immobilize', duration: 'dv.RootDuration' }],
      // {{Effect at cast time start}} (wiki): the hook flies to the target from the start of the cast.
      // Wiki: while the root's tether lasts Renata can't declare attacks: the flight + RootDuration
      // (the recast that ends it isn't modeled).
      attackLockout: 'reach / missileSpeed + dv.RootDuration',
      components: [{ id: 'handshake', label: 'Handshake', type: 'magic', amount: 'calc.TotalDamage', travel: 'max(0, reach / missileSpeed - castTime)' }],
    },
    W: { noTarget: true, notes: ['Ally buff; not modeled.'], components: [] },
    E: {
      notes: ['A single target is damaged once by the pair of missiles.'],
      cc: [{ kind: 'slow', duration: 'dv.SlowDuration' }],
      // Wiki: the rockets launch as the cast time starts ({{Effect at cast time start}}), converge after
      // 0.4s, then fly to the target at the missile's speed, from up to 200 units ahead.
      components: [{ id: 'missiles', label: 'Loyalty Program', type: 'magic', amount: 'calc.TotalDamage', aoe: true, delay: 'max(0, 0.4 - castTime)', travel: 'max(0, reach - 200) / missileSpeed' }],
    },
    R: {
      notes: ['Berserk (forced attacks) is treated as an immobilizing crowd control; no damage.'],
      cc: [{ kind: 'immobilize', duration: 'dv.BerserkDuration' }],
      components: [],
    },
  },
};
export default kit;
