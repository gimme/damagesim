import type { BuffSpec, ChampionKit } from '../../engine/kit-types.ts';
import type { Slot } from '../../engine/effects.ts';

// Elise — patch 16.20.
// R toggles Human ⇄ Spider form (hook below). Spider abilities are variants: Q:spider, W:spider, E:spider.
// Spider spells sit in the unslotted "X" group, so cross-spell references go through the slotted human
// spells (Q.dv.SpiderBaseDamage, E.dv.RappelDamageAmp), which carry the same per-rank values.
const spiderForm: BuffSpec = {
  id: 'eliseSpiderForm',
  label: 'Spider Form',
  duration: 3600,
  onHit: [
    {
      id: 'spiderQueen',
      label: 'Spider Queen',
      type: 'magic',
      // Rappel raises Spider Queen's bonus damage by RappelDamageAmp % for 5s.
      amount: 'R.calc.PassiveTotalDamage * (1 + (buff.eliseRappel ? E.dv.RappelDamageAmp / 100 : 0))',
    },
    {
      id: 'spiderling',
      label: 'Spiderling',
      type: 'magic',
      amount: 'R.calc.SpiderlingTotalDamage',
      hits: 'min(opt.spiderlings, R.dv.BaseSpiderlingsStored)',
      pet: true,
    },
  ],
};

const kit: ChampionKit = {
  id: 'Elise',
  status: 'curated',
  options: [{ key: 'spiderlings', label: 'Spiderlings', default: 3, min: 0, max: 5, description: 'Spiderlings summoned in Spider Form (capped by R.dv.BaseSpiderlingsStored).' }],
  notes: [
    'Combo: human Q W E, then R (Spider Form), then Q:spider W:spider E:spider; R again returns to Human Form. Each form keeps its own Q/W/E cooldowns.',
    'Spider Form: attacks deal Spider Queen bonus magic damage (+RappelDamageAmp % for 5s after Rappel). Spiderlings (option, default 3 = one per human ability hit) are approximated as each attacking once per Elise attack.',
    'Venomous Bite applies on-hit effects, including the Spider Form ones above.',
    'Volatile Spiderling is assumed to reach the target ~0.75s after the cast.',
    'Spider Form makes Elise melee in game; the simulator keeps her ranged (affects melee/ranged item effects).',
  ],
  hooks: {
    // Form switching: swap the Q/W/E cooldowns of the two forms and toggle the Spider Form buff.
    onCast(sim, cast) {
      if (cast.slot !== 'R') return;
      const toSpider = !sim.counter('eliseSpider');
      const stash = (spider: boolean, s: Slot) => `elise:${spider ? 'spider' : 'human'}:${s}`;
      for (const s of ['Q', 'W', 'E'] as Slot[]) {
        const key = `ability:${s}`;
        const current = sim.cooldownReadyAt(key);
        const other = sim.cooldownReadyAt(stash(toSpider, s));
        sim.startCooldown(stash(!toSpider, s), current - sim.time);
        sim.startCooldown(key, other - sim.time);
      }
      sim.setCounter('eliseSpider', toSpider ? 1 : 0);
      if (toSpider) sim.applyBuff(spiderForm, 'R', sim.spellFor('R'), sim.abilityRank('R'));
      else sim.removeBuff(spiderForm.id);
    },
  },
  abilities: {
    Q: {
      components: [{ id: 'neurotoxin', label: 'Neurotoxin', type: 'magic', amount: 'dv.BaseDamage + calc.HumanPercentHealth * target.hp', delay: 0.25 }],
      variants: {
        spider: {
          label: 'Venomous Bite',
          spell: 'EliseSpiderQCast',
          dash: true,
          components: [{ id: 'bite', label: 'Venomous Bite', type: 'magic', amount: 'Q.dv.SpiderBaseDamage + calc.MissingHPDamage * target.missingHp', onHit: true }],
        },
      },
    },
    W: {
      components: [{ id: 'spiderling', label: 'Volatile Spiderling', type: 'magic', amount: 'calc.TotalDamage', aoe: true, delay: 0.75 }],
      variants: {
        spider: {
          label: 'Skittering Frenzy',
          spell: 'EliseSpiderW',
          components: [],
          buff: { id: 'eliseFrenzy', label: 'Skittering Frenzy', duration: 'dv.BuffDuration', stats: { attackSpeed: 'dv.ActiveAttackSpeed' } },
        },
      },
    },
    E: {
      cc: [{ kind: 'immobilize', duration: 'calc.TotalStunDuration' }],
      components: [],
      variants: {
        spider: {
          label: 'Rappel',
          spell: 'EliseSpiderE',
          dash: true,
          cc: [], // don't inherit Cocoon's stun
          components: [],
          buff: { id: 'eliseRappel', label: 'Rappel', duration: 'dv.BuffDuration' },
        },
      },
    },
    R: { noTarget: true, components: [], notes: ['Toggles Human ⇄ Spider Form.'] },
  },
};
export default kit;
