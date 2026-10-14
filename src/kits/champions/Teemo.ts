import type { BuffSpec, ChampionKit } from '../../engine/kit-types.ts';

// Teemo — patch 16.20.
const guerrilla: BuffSpec = { id: 'guerrilla', label: 'Guerrilla Warfare', duration: 'P.dv.AttackSpeedDuration', stats: { attackSpeed: 'P.calc.BonusAttackSpeed' } };

const kit: ChampionKit = {
  id: 'Teemo',
  status: 'curated',
  notes: [
    'Toxic Shot: attacks deal impact damage on-hit and poison for 4 ticks (1/s); the poison refreshes, it does not stack.',
    'Noxious Trap: the target is assumed to step on the mushroom right away; damage ticks every second for 4s. Several traps refresh rather than stack.',
    'Option fromStealth: the combo starts by leaving Guerrilla Warfare camouflage (bonus attack speed for 5s).',
  ],
  options: [{ key: 'fromStealth', label: 'Start from Guerrilla Warfare camouflage', default: 0, toggle: true, min: 0, max: 1 }],
  hooks: {
    onStart(sim) {
      if (sim.opt.fromStealth) sim.applyBuff(guerrilla, 'P', sim.spellFor('P'), 1);
    },
  },
  attack: {
    onHit: [{ id: 'toxicShot', label: 'Toxic Shot', source: 'Toxic Shot', type: 'magic', amount: 'E.calc.ImpactCalculatedDamage', hits: 'E.rank > 0 ? 1 : 0' }],
  },
  marks: [
    {
      id: 'toxicShot',
      label: 'Toxic Shot poison',
      slot: 'E',
      maxStacks: 1,
      duration: 'E.dv.PoisonDuration',
      appliedBy: ['attack'],
      dot: { interval: 'E.dv.TickFrequency', components: [{ id: 'poison', label: 'Poison', type: 'magic', amount: 'E.calc.TickCalculatedDamage', hits: 'E.rank > 0 ? 1 : 0', dot: true }] },
    },
  ],
  abilities: {
    Q: {
      cc: [{ kind: 'impair', duration: 'dv.BlindDuration' }],
      components: [{ id: 'dart', label: 'Blinding Dart', type: 'magic', amount: 'calc.CalculatedDamage', delay: 0.2 }],
    },
    W: { noTarget: true, notes: ['Move Quick: movement speed only.'], components: [] },
    E: { noTarget: true, notes: ['Toxic Shot is passive (see attack on-hit and poison).'], components: [] },
    R: {
      cc: [{ kind: 'slow', duration: 'dv.DebuffDuration' }],
      components: [
        { id: 'trap', label: 'Noxious Trap', type: 'magic', amount: 'calc.TotalDamage / dv.DebuffDuration', hits: 'dv.DebuffDuration', interval: 1, dot: true, aoe: true, delay: 0.5 },
      ],
    },
  },
};
export default kit;
