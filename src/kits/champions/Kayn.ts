import type { ChampionKit } from '../../engine/kit-types.ts';

// Kayn — patch 16.20. Tooltips are templated per form, so behaviour follows the wiki; numbers are
// the game's calcs. Form: 0 = base Kayn, 1 = Shadow Assassin, 2 = Rhaast (Darkin).
const isRhaast = 'opt.form == 2';

const kit: ChampionKit = {
  id: 'Kayn',
  status: 'curated',
  options: [
    {
      key: 'form',
      label: 'Form (0 base, 1 Shadow Assassin, 2 Rhaast)',
      default: 0,
      min: 0,
      max: 2,
      step: 1,
      description: 'Rhaast: Q/R deal max-health damage instead, W knocks up (use W:darkin). Shadow Assassin: passive bonus magic damage.',
    },
  ],
  notes: [
    'Shadow Assassin passive (form 1): for 3s after the first damage to the champion, Kayn deals P.calc.KaynAssBonusDamage of his post-mitigation physical/magic damage as bonus magic damage. Re-arms after 8s out of combat or when Umbral Trespass emerges (hook).',
    'Rhaast healing, Shadow Assassin range/cast-time changes and wall walking are not modelled.',
  ],
  abilities: {
    Q: {
      dash: true,
      // Wiki: the swing after the dash has a 0.25s lockout; the dash and swing take about 0.66s.
      // No dash speed in the data: the dash hits ~0.25s in, the swing ~0.5s.
      lockout: 0.66,
      notes: ['Hits twice: on the dash and on the spin. Rhaast: each hit deals 65% AD + % max health instead.'],
      components: [
        { id: 'dash', label: 'Reaping Slash (dash)', type: 'physical', amount: `${isRhaast} ? calc.DarkinFlatDamage + calc.DarkinPercentDamage * target.maxHp : calc.TotalDamage`, aoe: true, delay: 0.25 },
        { id: 'spin', label: 'Reaping Slash (spin)', type: 'physical', amount: `${isRhaast} ? calc.DarkinFlatDamage + calc.DarkinPercentDamage * target.maxHp : calc.TotalDamage`, aoe: true, delay: 0.5 },
      ],
    },
    W: {
      cc: [{ kind: 'slow', duration: 'dv.SlowDuration' }],
      notes: ['Slows 90% decaying over 1.5s. Rhaast form also knocks up for 1s: use W:darkin.'],
      components: [{ id: 'reach', label: "Blade's Reach", type: 'physical', amount: 'calc.TotalDamage', aoe: true }],
      variants: {
        darkin: {
          label: 'Rhaast',
          cc: [{ kind: 'immobilize', duration: 'dv.KnockupDuration' }, { kind: 'slow', duration: 'dv.SlowDuration' }],
          components: [{ id: 'reach', label: "Blade's Reach", type: 'physical', amount: 'calc.TotalDamage', aoe: true }],
        },
      },
    },
    E: { noTarget: true, components: [] },
    R: {
      dash: true,
      // Earliest exit: 0.25s dash + 0.5s before the channel + 0.1s, then the damage 0.5s after the recast.
      castTime: 1.35,
      notes: [
        'Modelled as the earliest exit: Kayn is inside the target for 1.35s and deals the damage as he emerges. Rhaast: % max health damage instead.',
      ],
      components: [{ id: 'trespass', label: 'Umbral Trespass', type: 'physical', amount: `${isRhaast} ? calc.SlayerDamage * target.maxHp : calc.Damage` }],
    },
  },
  hooks: {
    // Shadow Assassin: bonus magic damage on post-mitigation damage during the 3s combat-start window.
    afterDamage(sim, inst) {
      if (sim.opt.form !== 1 || inst.sourceLabel === 'The Darkin Scythe' || inst.type === 'true' || !(inst.final! > 0)) return;
      const p = sim.spellFor('P');
      const duration = sim.dataValue(p, 'PAmpDurationAss', 1);
      const rearm = sim.dataValue(p, 'PAmpCooldownAss', 1);
      const start = sim.counters.has('kayn.window') ? sim.counter('kayn.window') : -Infinity;
      const last = sim.counters.has('kayn.last') ? sim.counter('kayn.last') : -Infinity;
      const expired = sim.time > start + duration;
      if (expired && (sim.time - last > rearm || inst.flags.slot === 'R')) sim.counters.set('kayn.window', sim.time);
      sim.counters.set('kayn.last', sim.time);
      if (sim.time > sim.counter('kayn.window') + duration) return;
      sim.deal({
        source: 'P',
        sourceLabel: 'The Darkin Scythe',
        label: 'Shadow Assassin',
        type: 'magic',
        amount: inst.final! * sim.evalExpr('P.calc.KaynAssBonusDamage', { slot: 'P' }),
        castId: inst.castId,
        flags: { kind: 'ability', slot: 'P', ability: false, proc: true },
      });
    },
  },
};
export default kit;
