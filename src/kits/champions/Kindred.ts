import type { ChampionKit } from '../../engine/kit-types.ts';

// Kindred — patch 16.20. Mark of the Kindred stacks feed the game formulas through buff {64290302}.
const kit: ChampionKit = {
  id: 'Kindred',
  status: 'curated',
  options: [
    { key: 'marks', label: 'Marks of the Kindred', default: 4, min: 0, max: 30, step: 1, description: 'Completed hunts: more Q attack speed, W current-health and E missing-health damage.' },
    { key: 'wolfBites', label: "Wolf's Frenzy bites on the target", default: 4, min: 0, max: 12, step: 1, description: 'Bites Wolf lands during the trade (the zone lasts 8.5s).' },
  ],
  buffStacks: { '{64290302}': 'opt.marks' },
  notes: [
    "Wolf's bite rate is not in the game data or on the wiki: the kit assumes 1 bite/s, sped up by 25% of Kindred's bonus attack speed, and opt.wolfBites bites per cast.",
    'Mounting Dread: the E cast is the first stack; the 3rd attack after it (each within 4s of the previous) makes Wolf pounce. The pounce already includes its crit-chance scaling (game formula).',
  ],
  marks: [
    {
      id: 'mountingDread',
      label: 'Mounting Dread',
      slot: 'E',
      // The E cast is the first of StacksToProc stacks; attacks add the rest while E (or a stack) is active.
      maxStacks: 'dv.StacksToProc - 1',
      duration: 'dv.TotalDuration',
      appliedBy: ['attack'],
      stacksPerHit: 'debuff.mountingDread || stacks.mountingDread > 0 ? 1 : 0',
      atMax: {
        consume: true,
        cooldown: 'dv.TotalDuration',
        components: [{ id: 'pounce', label: 'Mounting Dread (pounce)', type: 'physical', amount: 'calc.BaseBiteDamage + calc.PercentBiteDamage * target.missingHp' }],
      },
    },
  ],
  abilities: {
    Q: {
      dash: true,
      resetsAttack: true,
      // No dash speed in the data: the arrows hit ~0.25s in. She can cast any ability during the dash (wiki).
      attackLockout: 0.25,
      buff: { id: 'kindredQ', label: 'Dance of Arrows', duration: 'dv.BaseASDuration', stats: { attackSpeed: 'calc.TotalQAttackSpeed' } },
      components: [{ id: 'arrows', label: 'Dance of Arrows', type: 'physical', amount: 'calc.TotalDamage', aoe: true, delay: 0.25 }],
    },
    W: {
      notes: ['Wolf bites the last enemy Kindred attacked: base + % current health magic damage per bite.'],
      components: [
        {
          id: 'bite',
          label: "Wolf's Frenzy",
          type: 'magic',
          amount: 'calc.BaseWolfDamage + calc.PercentWolfDamage * target.hp',
          hits: 'opt.wolfBites',
          maxHits: 'dv.ZoneDuration',
          interval: '1 / (1 + dv.LambToWolfAttackSpeedConversionPercent * bonusAs)',
          // Wolf first dashes to the zone at his speed (wiki).
          delay: 'reach / missileSpeed',
          pet: true,
        },
      ],
    },
    E: {
      cc: [{ kind: 'slow', duration: 'dv.SlowDuration' }],
      debuff: { id: 'mountingDread', label: 'Mounting Dread', duration: 'dv.TotalDuration' },
      notes: ['Follow with 3 attacks: "E AA AA AA".'],
      components: [],
    },
    R: { noTarget: true, components: [] },
  },
};
export default kit;
