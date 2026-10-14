import type { ChampionKit, ComponentSpec } from '../../engine/kit-types.ts';
import type { Sim } from '../../engine/sim.ts';

// Gwen — patch 16.20.
// Hook: Snip Snip! stacks (gained per attack, consumed by Q) feed the snip count through a counter
// (stacks.gwenQSnips).

const MAX_SNIP_STACKS = 4; // tooltip: "max 4"
const CUTS = 'P.calc.PercentHealth1000Cuts * target.maxHp';

function snips(id: string, label: string, amount: string, hits: string, delay: string | number, center: boolean): ComponentSpec[] {
  if (!center) return [{ id, label, type: 'magic', amount, hits, interval: 0.05, delay, aoe: true }];
  return [
    { id, label, type: 'magic', amount: `${amount} * (1 - dv.TrueDamageConversion)`, hits, interval: 0.05, delay, aoe: true },
    { id: `${id}True`, label: `${label} (true)`, type: 'true', amount: `${amount} * dv.TrueDamageConversion`, hits, interval: 0.05, delay, aoe: true },
    { id: `${id}Cuts`, label: 'A Thousand Cuts', type: 'magic', amount: CUTS, hits, interval: 0.05, delay, noProc: true },
  ];
}
const qSnips = (center: boolean): ComponentSpec[] => [
  ...snips('snip', 'Snip', 'calc.MiniSwipeDamage', '1 + stacks.gwenQSnips', 0, center),
  ...snips('final', 'Final snip', 'calc.FinalSwipeDamage', '1', 0.3, center),
];

const kit: ChampionKit = {
  id: 'Gwen',
  status: 'curated',
  options: [{ key: 'snipStacks', label: 'Snip Snip! stacks at start', default: 4, min: 0, max: MAX_SNIP_STACKS, step: 1 }],
  notes: [
    'Snip Snip!: 1 snip + 1 per stack + a final snip. Stacks come from attacks (max 4, Q.dv.BuffDuration s) plus the "snipStacks" option at combo start (default 4).',
    'Center snips (default) convert dv.TrueDamageConversion of their damage to true damage and each applies A Thousand Cuts; Q:edge for edge hits (all magic, no Cuts).',
    'Needlework: write "R R R" — 1, 3 and 5 needles; each needle applies A Thousand Cuts.',
  ],
  attack: {
    onHit: [{ id: 'cuts', label: 'A Thousand Cuts', type: 'magic', amount: CUTS }],
  },
  abilities: {
    Q: {
      components: qSnips(true),
      variants: { edge: { label: 'edge', note: 'Target outside the center: all magic damage, no A Thousand Cuts.', components: qSnips(false) } },
    },
    W: {
      noTarget: true,
      buff: { id: 'gwenW', label: 'Hallowed Mist', duration: 'dv.ZoneDuration', stats: { armor: 'calc.TotalResists', mr: 'calc.TotalResists' } },
    },
    E: {
      dash: true,
      resetsAttack: true,
      noTarget: true,
      notes: ['Attack reset; empowered attacks for dv.BuffDuration s (attack speed, range, magic on-hit).'],
      buff: {
        id: 'gwenE',
        label: "Skip 'n Slash",
        duration: 'dv.BuffDuration',
        stats: { attackSpeed: 'calc.BonusAttackSpeed', range: 'dv.BonusAttackRange' },
        onHit: [{ id: 'skip', label: "Skip 'n Slash", type: 'magic', amount: 'E.calc.OnHitDamage' }],
      },
    },
    R: {
      recasts: 3,
      recastDelay: 'dv.LockoutTime',
      cc: [{ kind: 'slow', duration: 'dv.DebuffDuration' }],
      components: [
        { id: 'needle', label: 'Needle', type: 'magic', amount: 'calc.TotalDamage', hits: '2 * recast - 1', interval: 0.05, delay: 0.3, aoe: true },
        { id: 'needleCuts', label: 'A Thousand Cuts', type: 'magic', amount: CUTS, hits: '2 * recast - 1', interval: 0.05, delay: 0.3, noProc: true },
      ],
    },
  },
  hooks: {
    onStart(sim: Sim) {
      sim.setCounter('gwenQ', Math.min(MAX_SNIP_STACKS, sim.opt.snipStacks ?? MAX_SNIP_STACKS));
      sim.setCounter('gwenQ.until', sim.evalExpr('Q.dv.BuffDuration', { slot: 'Q' }));
    },
    onAttack(sim: Sim, atk) {
      if (atk.fromAbility || atk.phantom) return;
      const cur = sim.time <= sim.counter('gwenQ.until') ? sim.counter('gwenQ') : 0;
      sim.setCounter('gwenQ', Math.min(MAX_SNIP_STACKS, cur + 1));
      sim.setCounter('gwenQ.until', sim.time + sim.evalExpr('Q.dv.BuffDuration', { slot: 'Q' }));
    },
    onCast(sim: Sim, cast) {
      if (cast.slot !== 'Q') return;
      sim.setCounter('gwenQSnips', sim.time <= sim.counter('gwenQ.until') ? sim.counter('gwenQ') : 0);
      sim.setCounter('gwenQ', 0);
    },
  },
};
export default kit;
