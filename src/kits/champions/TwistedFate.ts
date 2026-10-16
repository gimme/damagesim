import type { BuffSpec, CCSpec, ChampionKit, ComponentSpec } from '../../engine/kit-types.ts';

// Twisted Fate — patch 16.20.
// Pick a Card: the locked card replaces the next attack's damage (the crit-chance scaling is inside
// the game formula; the card itself can't crit). The card's CC lands with that attack.
const card = (id: string, label: string, calc: string, cc: CCSpec[] = [], aoe = false): BuffSpec => {
  const comp: ComponentSpec = { id, label, type: 'magic', amount: `W.calc.${calc}`, ...(aoe ? { aoe: true } : {}) };
  return {
    id: 'pickACard',
    label: 'Pick a Card',
    duration: 6, // "next basic attack within 6 seconds" (wiki; not in data)
    empowerAttacks: { count: 1, replaceBase: true, resetsAttack: true, components: [comp], cc },
  };
};

const kit: ChampionKit = {
  id: 'TwistedFate',
  status: 'curated',
  notes: [
    'Pick a Card defaults to the Gold Card (W:blue, W:red for the others); follow W with AA. Card attacks count as basic attacks (on-hit, Stacked Deck) and cannot crit.',
    'Wild Cards: one of the three cards hits a single target (Q{card:3} at point-blank range).',
    'Destiny / Gate deal no damage.',
  ],
  stats: ({ ranks, evalExpr }) => (ranks.E > 0 ? { attackSpeed: evalExpr('E.dv.AttackSpeedBonus', 'E') / 100 } : {}),
  attack: {
    everyNth: {
      n: 4, // every 4th attack (tooltip; 3 stacks + empowered attack)
      label: 'Stacked Deck',
      components: [{ id: 'stackedDeck', label: 'Stacked Deck', type: 'magic', amount: 'E.calc.BonusDamage', hits: 'E.rank > 0 ? 1 : 0', proc: true }],
    },
  },
  abilities: {
    Q: {
      components: [{ id: 'card', label: 'Wild Cards', type: 'magic', amount: 'calc.TotalDamage', hits: 1, maxHits: 3, aoe: true, delay: 0.3 }],
    },
    W: {
      resetsAttack: true,
      defaultVariant: 'gold',
      notes: ['Cast + lock-in (castTime from data); the empowered attack must follow within 6s.'],
      variants: {
        gold: { label: 'gold', resetsAttack: true, buff: card('gold', 'Gold Card', 'GoldDamage', [{ kind: 'immobilize', duration: 'W.dv.Effect3Amount' }]), components: [] },
        blue: { label: 'blue', resetsAttack: true, buff: card('blue', 'Blue Card', 'BlueDamage'), components: [] },
        // Red Card slow lasts 2.5s (tooltip text).
        red: { label: 'red', resetsAttack: true, buff: card('red', 'Red Card', 'RedDamage', [{ kind: 'slow', duration: 2.5 }], true), components: [] },
      },
    },
    E: { noTarget: true, notes: ['Stacked Deck is passive (attack speed + every 4th attack).'], components: [] },
    R: { noTarget: true, dash: true, notes: ['Destiny + Gate teleport (counts as a blink); no damage.'], components: [] },
  },
};
export default kit;
