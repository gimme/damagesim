import type { ChampionKit } from '../../engine/kit-types.ts';
import type { Sim } from '../../engine/sim.ts';

// Syndra — patch 16.20.
// Splinters of Wrath: 5 per level (ability points) plus an option for splinters from champion hits.
const SPLINTERS = 'min(P.dv.MaxStackAmount, P.dv.PassiveStacksPerLevel * level + opt.extraSplinters)';

// Dark Spheres created by Q casts in the combo (cast times), to count the spheres Unleashed Power launches.
const sphereTimes = new WeakMap<Sim, number[]>();

const kit: ChampionKit = {
  id: 'Syndra',
  status: 'curated',
  notes: [
    'Splinters of Wrath = 5 per level (ability points) + the extraSplinters option (champion hits, large minions), max 120. Upgrades: 60 W true damage, 100 R execute, 120 +15% AP (40 Q charges / 80 E slow are not damage).',
    'Unleashed Power fires the 3 orbiting spheres plus every Dark Sphere from Q casts in the last 6s of the combo (plus the extraSpheres option), max 7.',
    'Not modeled: the Q ability haste from R ranks, Q ammo charges (use wait or accept the cooldown warning for Q Q).',
  ],
  options: [
    { key: 'extraSplinters', label: 'Splinters from champion hits/minions', default: 20, min: 0, max: 120, step: 1, description: 'Added to 5 Splinters per level from ability points (cap 120).' },
    { key: 'extraSpheres', label: 'Extra Dark Spheres on the field for R', default: 0, min: 0, max: 4, step: 1, description: 'Spheres already on the field before the combo (Q casts in the combo are counted automatically).' },
  ],
  stats: ({ evalExpr }) => (evalExpr(SPLINTERS) >= evalExpr('P.dv.MaxStackAmount') ? { apMult: [1 + evalExpr('P.dv.CapstoneAPPerc')] } : {}),
  hooks: {
    onCast(sim, cast) {
      if (cast.slot === 'Q') {
        const list = sphereTimes.get(sim) ?? [];
        list.push(sim.time);
        sphereTimes.set(sim, list);
      } else if (cast.slot === 'R') {
        const life = sim.evalExpr('Q.dv.SphereDuration', { slot: 'Q' });
        const alive = (sphereTimes.get(sim) ?? []).filter((t) => sim.time - t <= life).length;
        sim.setCounter('syndraSpheres', alive);
      }
    },
    // 100 Splinters: Unleashed Power executes champions it leaves below 15% health (checked after each sphere).
    afterDamage(sim, inst) {
      if (inst.source !== 'R' || inst.label !== 'Dark Sphere' || sim.target.hp <= 0) return;
      if (sim.evalExpr(SPLINTERS, { slot: 'P' }) < sim.evalExpr('P.dv.RUpgradeThreshold', { slot: 'P' })) return;
      if (sim.target.hp > sim.evalExpr('R.dv.UpgradeExecuteThreshold', { slot: 'R' }) * sim.target.maxHp) return;
      sim.deal({ source: 'R', sourceLabel: inst.sourceLabel, label: 'Execute', type: 'true', amount: sim.target.hp, castId: inst.castId, flags: { kind: 'ability', slot: 'R', ability: false } });
    },
  },
  abilities: {
    Q: {
      notes: ['The sphere lands ~0.6s after the cast.'],
      components: [{ id: 'sphere', label: 'Dark Sphere', type: 'magic', amount: 'calc.TotalDamage', aoe: true, delay: 0.6 }],
    },
    W: {
      castTime: 0.5, // grab (0.25s) + throw recast
      cc: [{ kind: 'slow', duration: 'dv.SlowDuration' }],
      notes: ['One W step = grab + throw (recast). At 60 Splinters the throw deals bonus true damage (W.calc.PassiveBonusDamage).'],
      components: [
        { id: 'throw', label: 'Force of Will', type: 'magic', amount: 'calc.ThrowDamage', aoe: true, delay: 0.3 },
        { id: 'true', label: 'Force of Will (true)', type: 'true', amount: 'calc.PassiveBonusDamage', aoe: true, delay: 0.3, hits: `${SPLINTERS} >= P.dv.WUpgradeThreshold ? 1 : 0`, condition: '60 Splinters' },
      ],
    },
    E: {
      cc: [{ kind: 'immobilize', duration: 'dv.StunDuration' }],
      notes: ['Assumes a Dark Sphere is pushed into the target (Q→E): stun. A champion takes E damage only once (wave or sphere).'],
      components: [{ id: 'scatter', label: 'Scatter the Weak', type: 'magic', amount: 'calc.TotalDamage', aoe: true, delay: 0.4 }],
    },
    R: {
      notes: ['3 orbiting spheres + spheres on the field (from Q casts within 6s, + extraSpheres), max 7. Override with R{sphere:N}.'],
      components: [
        {
          id: 'sphere',
          label: 'Dark Sphere',
          type: 'magic',
          amount: 'calc.DamageCalc',
          hits: 'dv.MinSpheresToUse + min(dv.MaxSpheresToUse - dv.MinSpheresToUse, stacks.syndraSpheres + opt.extraSpheres)',
          maxHits: 'dv.MaxSpheresToUse',
          delay: 0.25,
          interval: 0.08,
        },
      ],
    },
  },
};
export default kit;
