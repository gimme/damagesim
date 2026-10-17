import type { ChampionKit } from '../../engine/kit-types.ts';
import type { Sim } from '../../engine/sim.ts';

// Kalista — patch 16.20.
// Rend spears (mark): every attack and Pierce that hits adds a spear; spears last 4s (tooltip text),
// refreshed by each new spear. Rend deals calc.NormalDamage + calc.AdditionalDamage per spear beyond
// the first and removes them (hook). Spears still flying when Rend goes off are Rend's too (wiki: its
// cast empowers them to apply its effects as they hit): each deals what Rend would have dealt for it.
// Soul-Marked: dealt on-attack of the attack that applies the second mark (wiki): as Kalista's attack
// goes off, before it lands; as the Oathsworn's lands. Tagged proc on the wiki, but a note says it
// benefits from her spell effects: ability damage. The "P" step procs it (not a W cast); the damage
// is Sentinel's (W).

const ARMED = 'kalistaSoulMark';
/** When the last Rend went off, and how many spears it has ripped out (in flight ones as they land). */
const REND_AT = 'kalistaRendAt';
const REND_SPEARS = 'kalistaRendSpears';
const IN_FLIGHT = 'Rend (spear in flight)';
/** When each Pierce's spear was fired (by cast id). */
const pierces = new WeakMap<Sim, Map<number, number>>();
const pierceFired = (sim: Sim) => pierces.get(sim) ?? pierces.set(sim, new Map()).get(sim)!;

/** A spear fired before Rend went off lands after it: Rend rips it out, as one more spear. One landing
 *  as Rend goes off is in the target already: Rend's own hit counts it. */
function rendLanding(sim: Sim, fired: number, castId: number) {
  if (!(fired < sim.counter(REND_AT) && sim.time > sim.counter(REND_AT))) return;
  // After the spear's own hit has added it.
  sim.schedule(0, () => {
    const spears = sim.counter(REND_SPEARS);
    sim.setCounter(REND_SPEARS, spears + 1);
    sim.deal({
      source: 'E',
      sourceLabel: 'Rend',
      label: IN_FLIGHT,
      type: 'physical',
      amount: sim.evalExpr(spears > 0 ? 'E.calc.AdditionalDamage' : 'E.calc.NormalDamage', { slot: 'E' }),
      castId,
      flags: { kind: 'ability', slot: 'E', ability: true },
    });
    sim.applyCC('slow', sim.evalExpr('E.dv.SlowDuration', { slot: 'E' }), castId, 'E');
  });
}

function soulMark(sim: Sim, castId: number) {
  sim.deal({
    source: 'W',
    sourceLabel: 'Sentinel',
    label: 'Soul-Marked',
    type: 'magic',
    amount: sim.evalExpr('W.dv.MaxHealthDamage * target.maxHp', { slot: 'W' }),
    castId,
    flags: { kind: 'ability', slot: 'W', ability: true },
  });
}

const kit: ChampionKit = {
  id: 'Kalista',
  status: 'curated',
  notes: [
    'Rend only deals damage if the target has spears (attacks and Pierce add one each); spears still flying when it goes off count too, dealing their part as they land.',
    'Soul-Marked (Sentinel passive) needs the Oathsworn ally attacking the same target (10s per-target cooldown): "P AA" when Kalista\'s attack procs it (it lands as the attack goes off), "P:ally" when the Oathsworn\'s does (right away).',
    'Martial Poise hops and the Oathsworn\'s own damage are not modeled.',
  ],
  marks: [{ id: 'rend', label: 'Rend spears', slot: 'E', maxStacks: 'E.rank > 0 ? dv.MaxSpears : 0', duration: 4, appliedBy: ['attack', 'Q'] }],
  abilities: {
    P: {
      name: 'Soul-Marked',
      notes: ['Sentinel passive: Kalista and her Oathsworn both hit the target → W.dv.MaxHealthDamage of its max health as magic damage. P: on her next attack (within the 4s mark); P:ally: the Oathsworn\'s attack, now.'],
      // Her next attack within the Oathsworn's 4s mark procs it; P:ally deals it now (hooks).
      buff: { id: ARMED, label: 'Soul-Marked (next attack)', duration: 4 },
      components: [],
      variants: { ally: { label: 'Oathsworn', note: "The Oathsworn's attack procs it.", buff: [], components: [] } },
    },
    Q: {
      components: [{ id: 'pierce', label: 'Pierce', type: 'physical', amount: 'calc.TotalDamage', travel: true }],
    },
    W: { noTarget: true, notes: ['Active: scouting ghost (no damage). The passive is the "P" step.'], components: [] },
    E: {
      // Only when it rips out spears (in flight ones slow as they land).
      cc: [{ kind: 'slow', duration: `stacks.${REND_SPEARS} > 0 ? dv.SlowDuration : 0` }],
      components: [
        {
          id: 'rend',
          label: 'Rend',
          type: 'physical',
          // The spears in the target as it goes off, after its cast time (none: nothing).
          amount: 'stacks.rend > 0 ? calc.NormalDamage + calc.AdditionalDamage * (stacks.rend - 1) : 0',
        },
      ],
    },
    R: {
      noTarget: true,
      notes: ['The Oathsworn is launched; enemies hit are knocked up for dv.KnockupDuration s.'],
      cc: [{ kind: 'immobilize', duration: 'dv.KnockupDuration' }],
      components: [],
    },
  },
  hooks: {
    onCast(sim, cast) {
      if (cast.slot === 'P' && cast.variant?.toLowerCase() === 'ally') soulMark(sim, cast.castId);
      // Rend goes off after its cast time, with the spears in the target (none: the first one landing).
      if (cast.slot === 'E') {
        sim.setCounter(REND_AT, sim.time + (cast.castTime ?? 0));
        sim.setCounter(REND_SPEARS, 0);
      }
      // Pierce's spear flies from the end of its cast time.
      if (cast.slot === 'Q') pierceFired(sim).set(cast.castId, sim.time + (cast.castTime ?? 0));
    },
    onLaunch(sim, launch) {
      if (launch.fromAbility || !sim.getBuff(ARMED)) return;
      sim.removeBuff(ARMED);
      soulMark(sim, launch.castId);
    },
    onAttack(sim, atk) {
      if (!atk.fromAbility && !atk.phantom && atk.launched !== undefined) rendLanding(sim, atk.launched, atk.castId);
    },
    // Rend rips out all spears.
    afterDamage(sim, inst) {
      if (inst.fromMark) return;
      if (inst.flags.kind === 'ability' && inst.flags.slot === 'E') {
        if (inst.label !== IN_FLIGHT) sim.setCounter(REND_SPEARS, sim.markStacks('rend') ?? 0);
        sim.setMarkStacks('rend', 0);
      }
      if (inst.flags.kind === 'ability' && inst.flags.slot === 'Q') rendLanding(sim, pierceFired(sim).get(inst.castId) ?? 0, inst.castId);
    },
  },
};

export default kit;
