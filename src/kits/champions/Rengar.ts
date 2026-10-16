import type { BuffSpec, ChampionKit, DebuffSpec } from '../../engine/kit-types.ts';

// Rengar — patch 16.20.
// Ferocity: the empowered (4 Ferocity) version of an ability is chosen with the ":emp" variants.

// Savagery attack speed: the next two attacks within 3s (approximated as 3s of attack speed).
const savageryAs: BuffSpec = { id: 'rengarQAs', label: 'Savagery (attack speed)', duration: 'Q.dv.BuffDuration', stats: { attackSpeed: 'Q.dv.ASBonus / 100' } };
const savageryEmpAs: BuffSpec = { id: 'rengarQEmpAs', label: 'Savagery (Ferocity attack speed)', duration: 'Q.dv.ASDuration', stats: { attackSpeed: 'Q.calc.EmpoweredQAS' } };
const thrillShred: DebuffSpec = { id: 'rengarR', label: 'Thrill of the Hunt shred', duration: 'R.dv.ArmorShredDuration', armorReductionFlat: 'R.dv.ArmorShred' };

const savagery = (emp: boolean): BuffSpec => ({
  id: 'rengarQ',
  label: 'Savagery',
  duration: 'Q.dv.BuffDuration',
  empowerAttacks: {
    count: 1,
    replaceBase: true,
    resetsAttack: true,
    components: [
      {
        id: 'savagery',
        label: emp ? 'Savagery (Ferocity)' : 'Savagery',
        type: 'physical',
        amount: emp ? 'Q.calc.EmpoweredQTotalDamage' : 'Q.calc.QTotalDamage',
        canCrit: true,
      },
    ],
  },
});

const kit: ChampionKit = {
  id: 'Rengar',
  status: 'curated',
  notes: [
    'Ferocity is not tracked: use Q:emp / W:emp / E:emp for the empowered (4 Ferocity) casts.',
    'Savagery replaces the next attack\'s damage; it is assumed to crit like a normal attack (the wiki says it "will critically strike … based on crit chance" without a formula).',
    'Thrill of the Hunt: "R AA" = the leap attack out of camouflage (add wait:2 for the fade-in if needed). The leap adds bonus damage and shreds flat armor.',
    'Bonetooth Necklace AD from takedowns is not modeled.',
  ],
  abilities: {
    Q: {
      resetsAttack: true,
      notes: ['Empowers the next attack (write "Q AA"); the next two attacks gain attack speed.'],
      buff: savagery(false),
      components: [],
      noTarget: true,
      variants: {
        emp: { label: 'Ferocity', buff: savagery(true), resetsAttack: true, components: [], note: 'Higher damage and 5s of bonus attack speed.' },
      },
    },
    W: {
      components: [{ id: 'roar', label: 'Battle Roar', type: 'magic', amount: 'calc.TotalDamage', aoe: true }],
      variants: {
        emp: { label: 'Ferocity', components: [{ id: 'roar', label: 'Battle Roar (Ferocity)', type: 'magic', amount: 'calc.TotalDamageEmpowered', aoe: true }] },
      },
    },
    E: {
      cc: [{ kind: 'slow', duration: 'dv.CCDuration' }],
      components: [{ id: 'bola', label: 'Bola Strike', type: 'physical', amount: 'calc.TotalDamage', delay: 0.2 }],
      variants: {
        emp: {
          label: 'Ferocity',
          cc: [{ kind: 'immobilize', duration: 'dv.CCDuration' }],
          components: [{ id: 'bola', label: 'Bola Strike (Ferocity)', type: 'physical', amount: 'calc.TotalEmpoweredDamage', delay: 0.2 }],
        },
      },
    },
    R: {
      noTarget: true,
      notes: ['The next attack (the leap) deals bonus physical damage and shreds armor, then ends the ultimate.'],
      buff: {
        id: 'rengarRLeap',
        label: 'Thrill of the Hunt',
        duration: 'dv.StealthDuration',
        // The wiki tags the bonus damage proc ("unlike other ability empowered attacks": no Malignance).
        empowerAttacks: { count: 1, components: [{ id: 'leap', label: 'Thrill of the Hunt', type: 'physical', amount: 'R.calc.BonusDamage', proc: true }] },
      },
      components: [],
    },
  },
  hooks: {
    onCast(sim, cast) {
      if (cast.slot !== 'Q') return;
      const rank = sim.rankOf('Q');
      sim.applyBuff(savageryAs, 'Q', sim.spellFor('Q'), rank);
      if (cast.variant === 'emp') sim.applyBuff(savageryEmpAs, 'Q', sim.spellFor('Q'), rank);
    },
    // The leap attack out of R shreds armor (applied right after the leap's damage).
    onAttack(sim, atk) {
      if (atk.extra.some((x) => x.sourceLabel === 'Thrill of the Hunt')) sim.schedule(0, () => sim.applyDebuff(thrillShred, 'R', sim.spellFor('R'), sim.rankOf('R')));
    },
  },
};
export default kit;
