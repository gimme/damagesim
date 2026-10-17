import type { ChampionKit } from '../../engine/kit-types.ts';
import type { DamageInstance } from '../../engine/effects.ts';
import type { Sim } from '../../engine/sim.ts';

// Hwei — patch 16.20.
// Each slot picks one of three paintings: variants QQ/QW/QE, WQ/WW/WE, EQ/EW/EE (defaults QQ, WE, EQ).
// Hooks:
//  * Signature of the Visionary — a damaging ability marks; a hit from a *different* cast detonates
//    the mark after 0.85s, and the detonating cast can't re-mark (debuff.consume would re-mark).
//  * Stirring Lights — its 3 charges are spent by attacks (empowerAttacks) and by ability hits.

const SIGNATURE_DELAY = 0.85; // wiki: the signature detonates 0.85s after it is completed
const LAVA_TICK = 0.25; // wiki: Molten Fissure lava ticks every 0.25s
const DESPAIR_TICK = 0.25; // wiki: Spiraling Despair ticks every 0.25s
const LIGHTS = 'stirringLights';
const LIGHTS_LABEL = 'Stirring Lights';

function damagingAbilityHit(inst: DamageInstance): boolean {
  return !inst.fromMark && !inst.flags.proc && !inst.flags.attack && inst.flags.kind === 'ability' && (inst.flags.slot === 'Q' || inst.flags.slot === 'E' || inst.flags.slot === 'R');
}

const kit: ChampionKit = {
  id: 'Hwei',
  status: 'curated',
  options: [{ key: 'isolated', label: 'Target isolated', default: 0, toggle: true, description: 'Severing Bolt (Q:QW) gets its missing-health bonus (also automatic on immobilized targets).' }],
  notes: [
    'Paintings are variants: Q:QQ (default) / Q:QW / Q:QE, W:WE (default) / W:WQ / W:WW, E:EQ (default) / E:EW / E:EE.',
    'Severing Bolt bonus (isolated option or immobilized target) is assumed to scale linearly with missing health, from calc.Damage to calc.BonusDamage at 0 health.',
    'Signature: a damaging ability marks for P.dv.Duration s; a hit from another ability cast detonates it 0.85s later for P.calc.TotalDamage. Each cast marks or detonates at most once (the detonating cast does not re-mark).',
    'Stirring Lights: the next 3 attacks or ability casts that hit (one charge per cast) deal W.calc.Tooltip_WEOnHitDamage bonus magic damage.',
    'Molten Fissure: one eruption per target plus the full lava duration; Crushing Maw\'s pull is treated as a 0.25s displacement (not in the data).',
  ],
  abilities: {
    Q: {
      defaultVariant: 'QQ',
      variants: {
        QQ: {
          label: 'Devastating Fire',
          spell: 'HweiQQ',
          components: [{ id: 'fire', label: 'Devastating Fire', type: 'magic', amount: 'calc.Damage + dv.BonusDamage / 100 * target.maxHp', aoe: true, travel: true }],
        },
        QW: {
          label: 'Severing Bolt',
          spell: 'HweiQW',
          components: [
            {
              id: 'bolt',
              label: 'Severing Bolt',
              type: 'magic',
              amount: "opt.isolated || target.immobilized ? calc.Damage * (1 + (dv.BonusDamageMult - 1) * target.missingHpPct) : calc.Damage",
              aoe: true,
              // Wiki: strikes dv.Delay after the start of the cast time.
              delay: 'dv.Delay - castTime',
            },
          ],
        },
        QE: {
          label: 'Molten Fissure',
          spell: 'HweiQE',
          cc: [{ kind: 'slow', duration: 'dv.Duration' }],
          // Wiki: the path erupts 0.6s after the start of the cast time, then one explosion every 0.2s
          // (estimated) from the caster out: the 7th, at max range, 1.2s later.
          components: [
            { id: 'eruption', label: 'Molten Fissure', type: 'magic', amount: 'calc.Damage', aoe: true, delay: '0.6 - castTime', travel: 1.2 },
            {
              id: 'lava',
              label: 'Molten Fissure (lava)',
              type: 'magic',
              amount: `calc.DamagePerSecond * ${LAVA_TICK}`,
              hits: `dv.Duration / ${LAVA_TICK}`,
              interval: LAVA_TICK,
              delay: `0.6 - castTime + ${LAVA_TICK}`,
              travel: 1.2,
              aoe: true,
              dot: true,
            },
          ],
        },
      },
    },
    W: {
      noTarget: true,
      defaultVariant: 'WE',
      variants: {
        WE: {
          label: 'Stirring Lights',
          spell: 'HweiWE',
          components: [],
          buff: {
            id: LIGHTS,
            label: LIGHTS_LABEL,
            duration: 'dv.Duration',
            empowerAttacks: { count: 3, components: [{ id: 'light', label: LIGHTS_LABEL, type: 'magic', amount: 'W.calc.Tooltip_WEOnHitDamage', proc: true }] },
          },
        },
        WQ: { label: 'Fleeting Current', spell: 'HweiWQ', components: [], note: 'Move speed only.' },
        WW: { label: 'Pool of Reflection', spell: 'HweiWW', components: [], note: 'Shield only.' },
      },
    },
    E: {
      defaultVariant: 'EQ',
      variants: {
        EQ: {
          label: 'Grim Visage',
          spell: 'HweiEQ',
          cc: [{ kind: 'immobilize', duration: 'dv.FleeDuration' }],
          components: [{ id: 'visage', label: 'Grim Visage', type: 'magic', amount: 'calc.Damage', travel: true }],
        },
        EW: {
          label: 'Gaze of the Abyss',
          spell: 'HweiEW',
          cc: [{ kind: 'immobilize', duration: 'dv.RootDuration' }],
          // The eye flies its max range, locks on after SetupDelay and launches FireDelay later (wiki;
          // the target under it).
          components: [{ id: 'gaze', label: 'Gaze of the Abyss', type: 'magic', amount: 'calc.Damage', delay: 'dv.SetupDelay + dv.FireDelay', travel: true }],
        },
        EE: {
          label: 'Crushing Maw',
          spell: 'HweiEE',
          cc: [
            { kind: 'immobilize', duration: 0.25 },
            { kind: 'slow', duration: 1.25 }, // tooltip: "Slowing … decaying over 1.25 seconds"
          ],
          // Wiki: snaps dv.Delay after the start of the cast time.
          components: [{ id: 'maw', label: 'Crushing Maw', type: 'magic', amount: 'calc.Damage', aoe: true, delay: 'dv.Delay - castTime' }],
        },
      },
    },
    R: {
      cc: [{ kind: 'slow', duration: 'dv.Duration' }],
      components: [
        {
          id: 'despair',
          label: 'Spiraling Despair',
          type: 'magic',
          amount: `calc.DamageOverTime * ${DESPAIR_TICK}`,
          hits: `dv.Duration / ${DESPAIR_TICK}`,
          interval: DESPAIR_TICK,
          delay: DESPAIR_TICK,
          travel: true,
          aoe: true,
          dot: true,
        },
        { id: 'shatter', label: 'Spiraling Despair (shatter)', type: 'magic', amount: 'calc.Damage', aoe: true, delay: 'dv.Duration', travel: true },
      ],
    },
  },
  hooks: {
    afterDamage(sim: Sim, inst) {
      if (!damagingAbilityHit(inst)) return;
      // Stirring Lights: one charge per ability cast that hits.
      const lights = sim.getBuff(LIGHTS);
      if (lights && (lights.charges ?? 0) > 0 && sim.counter('hweiLights.lastCast') !== inst.castId) {
        sim.setCounter('hweiLights.lastCast', inst.castId);
        lights.charges = (lights.charges ?? 1) - 1;
        if (lights.charges <= 0) sim.removeBuff(LIGHTS);
        sim.deal({
          source: 'W',
          sourceLabel: LIGHTS_LABEL,
          label: LIGHTS_LABEL,
          type: 'magic',
          amount: sim.evalExpr('W.calc.Tooltip_WEOnHitDamage', { slot: 'W' }),
          castId: inst.castId,
          flags: { kind: 'ability', slot: 'W', ability: false, proc: true },
          markSource: LIGHTS,
        });
      }
      // Signature of the Visionary: each cast marks or detonates at most once.
      const usedKey = `hweiSig.used${inst.castId}`;
      if (sim.counter(usedKey)) return;
      const marked = sim.counter('hweiSig.cast');
      if (marked && marked !== inst.castId && sim.time <= sim.counter('hweiSig.until')) {
        sim.setCounter('hweiSig.cast', 0);
        sim.setCounter(usedKey, 1);
        const amount = sim.evalExpr('P.calc.TotalDamage', { slot: 'P' });
        sim.schedule(SIGNATURE_DELAY, () =>
          sim.deal({
            source: 'P',
            sourceLabel: 'Signature of the Visionary',
            label: 'Signature',
            type: 'magic',
            amount,
            flags: { kind: 'ability', slot: 'P', ability: true, aoe: true }, // area damage, with spell effects (wiki)
            markSource: 'hweiSignature',
          }),
        );
      } else if (!marked || sim.time > sim.counter('hweiSig.until')) {
        sim.setCounter('hweiSig.cast', inst.castId);
        sim.setCounter('hweiSig.until', sim.time + sim.evalExpr('P.dv.Duration', { slot: 'P' }));
        sim.setCounter(usedKey, 1);
      }
    },
  },
};
export default kit;
