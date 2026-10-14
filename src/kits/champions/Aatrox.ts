import type { ChampionKit } from '../../engine/kit-types.ts';
import type { Sim } from '../../engine/sim.ts';

// Aatrox — patch 16.20.
// Deathbringer Stance has its own cooldown that hits shorten, so it is tracked with a hook
// (counter 'aatroxP.readyAt' = time the empowered attack is available again).
const passiveReady = (sim: Sim) => sim.time >= sim.counter('aatroxP.readyAt') - 1e-9;
const reducePassive = (sim: Sim, seconds: number) => sim.setCounter('aatroxP.readyAt', sim.counter('aatroxP.readyAt') - seconds);

const kit: ChampionKit = {
  id: 'Aatrox',
  status: 'curated',
  notes: [
    'Deathbringer Stance is ready at combo start; afterwards attacks reduce its cooldown by 2s and ability hits by 2s (4s for Darkin Blade sweet-spot hits).',
    'Healing (passive, Umbral Dash spell vamp, World Ender heal amp) is not modeled.',
  ],
  abilities: {
    P: {
      notes: ['Empowered attack: bonus magic damage equal to a % of the target\'s max Health (see hooks).'],
    },
    Q: {
      // Scripted windup (wiki: 0.6s cast time for each cast); data castTime is 0.
      castTime: 0.6,
      recasts: 3,
      recastDelay: 1, // wiki: 1s static cooldown between casts
      // Each recast must follow the previous one within QExtensionTime.
      recastWindow: 'dv.QExtensionTime',
      recastWindowFrom: 'previous',
      notes: [
        'Cast "Q Q Q" for the three swings; the 2nd and 3rd deal 125% / 150% (QRampBonus per previous cast, additive).',
        'Default: hit by the inner area. "Q:edge" = sweet spot (175% damage, short knock-up, 4s passive cooldown reduction).',
      ],
      components: [{ id: 'blade', label: 'The Darkin Blade', type: 'physical', amount: 'calc.QDamage * (1 + dv.QRampBonus * (recast - 1))', aoe: true }],
      variants: {
        edge: {
          label: 'sweet spot',
          cc: [{ kind: 'immobilize', duration: 'dv.QKnockupDuration' }],
          components: [{ id: 'edge', label: 'The Darkin Blade (sweet spot)', type: 'physical', amount: 'calc.QEdgeDamage * (1 + dv.QRampBonus * (recast - 1))', aoe: true }],
        },
      },
    },
    W: {
      cc: [{ kind: 'slow', duration: 'dv.WSlowDuration' }],
      notes: ['The second hit (pull back after 1.5s if the target stays in the area) is optional: W+pull.'],
      components: [
        { id: 'chain', label: 'Infernal Chains', type: 'physical', amount: 'calc.WDamage', delay: 0.25 },
        { id: 'pull', label: 'Infernal Chains (pull)', type: 'physical', amount: 'calc.WDamage', delay: '0.25 + dv.WSlowDuration', optional: true, condition: 'target stays in the area' },
      ],
    },
    E: { dash: true, noTarget: true, notes: ['Dash only; the passive spell vamp is healing (not modeled).'] },
    R: {
      noTarget: true,
      notes: ['+X% total AD for the duration (evaluated from your AD when cast). Fear only affects minions.'],
      buff: { id: 'worldEnder', label: 'World Ender', duration: 'dv.RDuration', stats: { ad: 'dv.RTotalADAmp * ad' } },
    },
  },
  hooks: {
    onStart(sim) {
      sim.setCounter('aatroxP.readyAt', -Infinity);
    },
    // Sweet-spot hits reduce the passive cooldown twice as much.
    onCast(sim, cast) {
      if (cast.slot === 'Q') sim.setCounter('aatroxQ.edge', cast.variant === 'edge' ? 1 : 0);
    },
    onAttack(sim, atk) {
      if (atk.fromAbility || atk.phantom) return;
      if (!passiveReady(sim)) {
        reducePassive(sim, 2);
        return;
      }
      atk.extra.push({
        source: 'P',
        sourceLabel: 'Deathbringer Stance',
        label: 'Deathbringer Stance',
        type: 'magic',
        amount: sim.evalExpr('P.calc.PDamage * target.maxHp', { slot: 'P' }),
        castId: atk.castId,
        flags: { kind: 'ability', slot: 'P', onHit: true, ability: false },
      });
      sim.setCounter('aatroxP.readyAt', sim.time + sim.evalExpr('P.calc.PCooldown', { slot: 'P' }));
    },
    afterDamage(sim, inst) {
      if (inst.flags.kind !== 'ability' || inst.flags.attack || inst.flags.onHit || inst.fromMark) return;
      if (inst.flags.slot !== 'Q' && inst.flags.slot !== 'W') return;
      if (passiveReady(sim)) return;
      reducePassive(sim, inst.flags.slot === 'Q' && sim.counter('aatroxQ.edge') ? 4 : 2);
    },
  },
};
export default kit;
