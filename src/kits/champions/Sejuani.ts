import type { ChampionKit, DebuffSpec } from '../../engine/kit-types.ts';

// Sejuani — patch 16.20.
// Fury of the North: targets Sejuani stuns are Frozen for the stun's duration; her next attack or
// ability against them consumes it for % max health magic damage (wiki).
const frozen = (duration: string): DebuffSpec => ({
  id: 'sejuaniFrozen',
  label: 'Frozen',
  duration,
  consume: { by: 'any', components: [{ id: 'shatter', label: 'Fury of the North', type: 'magic', amount: 'P.calc.PercentHPDamage * target.maxHp', noProc: true }] },
});

const kit: ChampionKit = {
  id: 'Sejuani',
  status: 'curated',
  notes: [
    'Permafrost stacks come from Sejuani\'s attacks and each Winter\'s Wrath swing (max 4, 5s); allied attacks are not modeled. Permafrost (E) can only be cast at 4 stacks — otherwise it does nothing — and then the target is immune to stacks for 8s.',
    'Fury of the North: a stunned (Frozen) target takes % max health magic damage from Sejuani\'s next attack or ability during the stun.',
    'Glacial Prison defaults to the empowered throw (traveled 25%+ of its range): the target takes only the empowered damage and a 1.5s stun. R:short is the close-range throw.',
  ],
  marks: [
    {
      id: 'permafrost',
      label: 'Permafrost',
      maxStacks: 'E.dv.MaxStacks',
      duration: 'E.dv.StackDuration',
      appliedBy: ['attack', 'W'],
      // Both Winter's Wrath swings apply a stack.
      oncePerCast: false,
      slot: 'E',
    },
  ],
  abilities: {
    Q: {
      dash: true,
      cc: [{ kind: 'immobilize', duration: 'dv.KnockupDurationTOOLTIPONLY' }],
      components: [{ id: 'charge', label: 'Arctic Assault', type: 'magic', amount: 'calc.TotalDamageTooltip', aoe: true, delay: 0.1 }],
    },
    W: {
      notes: ['First swing right after the cast, the lash ~0.75s later (wiki).'],
      cc: [{ kind: 'slow', duration: 'dv.SlowDuration' }],
      components: [
        { id: 'swing', label: "Winter's Wrath (swing)", type: 'physical', amount: 'calc.FirstHitDamageTooltip', aoe: true },
        { id: 'lash', label: "Winter's Wrath (lash)", type: 'physical', amount: 'calc.SecondHitDamageTooltip', aoe: true, delay: 0.75 },
      ],
    },
    E: {
      cc: [{ kind: 'immobilize', duration: 'dv.CCDuration' }],
      debuff: frozen('E.dv.CCDuration'),
      components: [{ id: 'freeze', label: 'Permafrost', type: 'magic', amount: 'calc.TotalDamage', hits: 'stacks.permafrost >= dv.MaxStacks ? 1 : 0' }],
    },
    R: {
      cc: [{ kind: 'immobilize', duration: 'dv.EmpoweredStunDuration' }],
      debuff: frozen('R.dv.EmpoweredStunDuration'),
      components: [{ id: 'prison', label: 'Glacial Prison', type: 'magic', amount: 'calc.TotalDamageTooltip', delay: 0.4 }],
      variants: {
        short: {
          label: 'short range',
          cc: [{ kind: 'immobilize', duration: 'dv.BaseStunDuration' }],
          debuff: frozen('R.dv.BaseStunDuration'),
          components: [{ id: 'prison', label: 'Glacial Prison', type: 'magic', amount: 'calc.MinorDamageTooltip', delay: 0.2 }],
        },
      },
    },
  },
  hooks: {
    // Permafrost consumes the stacks; the target can't gain stacks for PerChampionCD seconds.
    afterDamage(sim, inst) {
      if (inst.source !== 'E' || inst.fromMark) return;
      sim.setMarkStacks('permafrost', 0);
      sim.setMarkCooldown('permafrost', sim.evalExpr('E.dv.PerChampionCD', { slot: 'E' }));
    },
  },
};
export default kit;
