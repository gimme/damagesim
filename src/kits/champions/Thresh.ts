import type { ChampionKit } from '../../engine/kit-types.ts';

// Thresh — patch 16.20.
// Flay passive: attacks deal bonus magic damage growing with the time since Thresh's last attack
// (full after dv.FullChargeDuration). A hook records the last attack time in a counter.
const kit: ChampionKit = {
  id: 'Thresh',
  status: 'curated',
  notes: [
    'Damnation souls (option) grant armor and AP and feed Flay; each soul adds to the game formulas through the soul buff counter.',
    'Flay passive: bonus magic damage on attack ramps linearly (assumed) from the soul part to the full AD part over 10s without attacking; the first attack of a combo is fully charged.',
    'Death Sentence: the leap recast (no damage) is not modeled. The Box: the target is assumed to walk into a wall right away.',
    "Death Sentence: Thresh can't attack while the scythe flies nor while the target is Shackled (1.5s after the hit), so an attack after Q waits ~2.35s; the leap that would end it on arrival isn't modeled.",
  ],
  options: [{ key: 'souls', label: 'Damnation souls', default: 30, min: 0, max: 300, step: 1 }],
  buffStacks: { '{5fbfbf13}': 'opt.souls' },
  stats: ({ opt, evalExpr }) => {
    const v = opt.souls * evalExpr('P.dv.StatValuePerSoul');
    return { ap: v, armor: v };
  },
  hooks: {
    onStart(sim) {
      sim.setCounter('threshLastAttack', -1e3);
    },
    onAttack(sim, atk) {
      if (!atk.fromAbility && !atk.phantom) sim.setCounter('threshLastAttack', sim.time);
    },
  },
  attack: {
    onHit: [
      {
        id: 'flay',
        label: 'Flay',
        type: 'magic',
        amount: 'E.calc.PAttackDamageMin + (E.calc.PAttackDamageMax - E.calc.PAttackDamageMin) * clamp((time - stacks.threshLastAttack) / E.dv.FullChargeDuration, 0, 1)',
        hits: 'E.rank > 0 ? 1 : 0',
        // The wiki: Flay "deals proc damage on the enhanced basic attack" (the active is area damage).
        proc: true,
      },
    ],
  },
  abilities: {
    Q: {
      cc: [{ kind: 'immobilize', duration: 'dv.TauntLength' }],
      // Wiki: unable to move or attack while the scythe flies (0.5s cast time + the 0.35s flight), then
      // free to move and cast but unable to declare attacks while the target is Shackled (1.5s).
      lockout: 0.85,
      attackLockout: 2.35,
      components: [{ id: 'hook', label: 'Death Sentence', type: 'magic', amount: 'calc.TotalDamage', delay: 0.35 }],
    },
    W: { noTarget: true, notes: ['Dark Passage shields; no damage.'], components: [] },
    E: {
      cc: [
        { kind: 'immobilize', duration: 0.25 }, // brief pull/push (not in data)
        { kind: 'slow', duration: 'dv.SlowDuration' },
      ],
      components: [{ id: 'flay', label: 'Flay', type: 'magic', amount: 'calc.TotalDamage', aoe: true, delay: 0.1 }],
    },
    R: {
      cc: [{ kind: 'slow', duration: 'dv.SlowDuration' }],
      components: [{ id: 'box', label: 'The Box', type: 'magic', amount: 'calc.TotalDamage', delay: 0.1 }],
    },
  },
};
export default kit;
