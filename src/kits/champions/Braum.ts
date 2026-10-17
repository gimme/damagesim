import type { ChampionKit } from '../../engine/kit-types.ts';

// Braum — patch 16.20.
const kit: ChampionKit = {
  id: 'Braum',
  status: 'curated',
  notes: [
    "Concussive Blows: Braum's attacks and Winter's Bite add stacks (ally attacks are not modeled). The 4th stack stuns and deals P.calc.TotalDamage; for P.calc.StunCD seconds the target gains no stacks and Braum's attacks deal P.calc.OnHitDamage bonus magic damage.",
    'Glacial Fissure: the first target hit is knocked up for MinKnockup–MaxKnockup seconds depending on distance, assumed to grow linearly to its range.',
  ],
  marks: [
    {
      id: 'concussiveBlows',
      label: 'Concussive Blows',
      maxStacks: 'P.dv.StackCap',
      duration: 'P.dv.StackDuration',
      appliedBy: ['attack', 'Q'],
      atMax: {
        components: [{ id: 'stun', label: 'Concussive Blows (stun)', type: 'magic', amount: 'P.calc.TotalDamage', proc: true }],
        consume: true,
        cooldown: 'P.calc.StunCD',
        buff: {
          id: 'braumAfterStun',
          label: 'Concussive Blows (after stun)',
          duration: 'P.calc.StunCD',
          onHit: [{ id: 'bonus', label: 'Concussive Blows (bonus)', type: 'magic', amount: 'P.calc.OnHitDamage', proc: true }],
        },
      },
    },
  ],
  hooks: {
    // MarkSpec.atMax can't apply crowd control: stun when the 4th stack procs.
    afterDamage(sim, inst) {
      if (inst.fromMark === 'concussiveBlows' && inst.label === 'Concussive Blows (stun)')
        sim.applyCC('immobilize', sim.evalExpr('P.calc.StunDuration', { slot: 'P' }), inst.castId, 'P');
    },
  },
  abilities: {
    Q: {
      cc: [{ kind: 'slow', duration: 'dv.SlowDuration' }],
      components: [{ id: 'bite', label: "Winter's Bite", type: 'magic', amount: 'calc.TotalDamage', travel: true }],
    },
    W: { noTarget: true, dash: true, components: [] },
    E: { noTarget: true, components: [] },
    R: {
      cc: [
        { kind: 'immobilize', duration: 'lerp(dv.MinKnockup, dv.MaxKnockup, reach / castRange)' },
        { kind: 'slow', duration: 'dv.SlowZoneDuration' },
      ],
      components: [{ id: 'fissure', label: 'Glacial Fissure', type: 'magic', amount: 'calc.TotalDamage', aoe: true, travel: true }],
    },
  },
};
export default kit;
