import type { ChampionKit } from '../../engine/kit-types.ts';
import type { Sim } from '../../engine/sim.ts';

// Syndra — patch 16.20.
// Splinters of Wrath: the option's total, but at least the 5 per level from ability points.
const SPLINTERS = 'min(P.dv.MaxStackAmount, max(P.dv.PassiveStacksPerLevel * level, opt.splinters))';

// Dark Spheres created by Q casts in the combo (cast times), to count the spheres Unleashed Power launches.
const sphereTimes = new WeakMap<Sim, number[]>();

const kit: ChampionKit = {
  id: 'Syndra',
  status: 'curated',
  notes: [
    'Splinters of Wrath = the splinters option (champion hits and large minions add to the 5 per level from ability points; at least that many), max 120. Upgrades: 60 W true damage, 100 R execute, 120 +15% AP (40 Q charges / 80 E slow are not damage).',
    'Unleashed Power fires the 3 orbiting spheres plus every Dark Sphere from Q casts in the last 6s of the combo (plus the extraSpheres option), max 7.',
    'Not modeled: the Q ability haste from R ranks, Q ammo charges (use wait or accept the cooldown warning for Q Q).',
  ],
  options: [
    { key: 'splinters', label: 'Splinters of Wrath', default: 60, min: 0, max: 120, step: 20, description: 'Total Splinters; at least 5 per level from ability points (cap 120). Upgrades at 40, 60, 80, 100 and 120.' },
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
      if (inst.source !== 'R' || inst.label !== 'Dark Sphere') return;
      if (sim.evalExpr(SPLINTERS, { slot: 'P' }) < sim.evalExpr('P.dv.RUpgradeThreshold', { slot: 'P' })) return;
      const line = sim.evalExpr('R.dv.UpgradeExecuteThreshold', { slot: 'R' }) * sim.target.maxHp;
      if (sim.target.hp > line) return;
      sim.deal({ source: 'R', sourceLabel: inst.sourceLabel, label: `${inst.sourceLabel} (execute)`, type: 'true', amount: line, castId: inst.castId, flags: { kind: 'ability', slot: 'R', execute: true } });
    },
  },
  abilities: {
    Q: {
      notes: ['The sphere appears 0.6s after the cast (wiki).'],
      components: [{ id: 'sphere', label: 'Dark Sphere', type: 'magic', amount: 'calc.TotalDamage', aoe: true, delay: 0.6 }],
    },
    W: {
      // Grab and throw recast: neither has a cast time (wiki). The thrown target lands ~0.3s later (no data).
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
      // The wave's damage, as it reaches the target.
      components: [{ id: 'scatter', label: 'Scatter the Weak', type: 'magic', amount: 'calc.TotalDamage', aoe: true, travel: true }],
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
          // No sphere speed in the data: ~0.25s to the target.
          delay: 0.25,
          interval: 0.08,
        },
      ],
    },
  },
};
export default kit;
