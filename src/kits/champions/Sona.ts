import type { ChampionKit } from '../../engine/kit-types.ts';

// Sona — patch 16.20.
// Power Chord: after 3 basic abilities her next attack deals bonus magic damage; the song cast last
// changes it (Q: Staccato replaces the bonus with higher damage, E: Tempo slows; W's damage-dealt
// reduction on the target is not modeled). The cast counter is a hook.
const kit: ChampionKit = {
  id: 'Sona',
  status: 'curated',
  notes: [
    'Power Chord charges after 3 basic abilities (R does not count); the next attack deals the bonus. Write e.g. "Q W E AA" or "W E Q AA" (Staccato).',
    'Hymn of Valor Melody also empowers Sona\'s own next attack (on-hit magic damage).',
    'Accelerando stacks (option) grant basic ability haste up to the cap.',
  ],
  options: [{ key: 'accelerando', label: 'Accelerando stacks', default: 40, min: 0, max: 120, step: 1, description: '+0.5 basic ability haste per stack, up to 60 at 120 stacks (further stacks shorten R\'s cooldown instead; not modeled).' }],
  buffStacks: { '{1705b20f}': 'opt.accelerando' },
  stats: ({ opt, evalExpr }) => ({ basicAbilityHaste: Math.min(evalExpr('P.dv.AccelerandoCap'), opt.accelerando * evalExpr('P.dv.AccelerandoAHPerStack')) }),
  abilities: {
    Q: {
      buff: {
        id: 'sonaMelodyQ',
        label: 'Hymn of Valor (Melody)',
        duration: 'dv.OnHitDuration',
        // The wiki: the Melody empowered attacks deal proc damage (the bolts are area damage).
        empowerAttacks: { count: 'dv.OnHitProcs', components: [{ id: 'melody', label: 'Hymn of Valor (on-hit)', type: 'magic', amount: 'Q.calc.TotalOnHitDamage', proc: true }] },
      },
      components: [{ id: 'bolt', label: 'Hymn of Valor', type: 'magic', amount: 'calc.TotalDamage', travel: true }],
    },
    W: { noTarget: true, components: [] },
    E: { noTarget: true, components: [] },
    R: {
      cc: [{ kind: 'immobilize', duration: 'dv.StunDuration' }],
      // Fired as the cast time starts (wiki: {{Effect at cast time start}}).
      components: [{ id: 'crescendo', label: 'Crescendo', type: 'magic', amount: 'calc.TotalDamage', aoe: true, travel: 'reach / missileSpeed - castTime' }],
    },
  },
  hooks: {
    onCast(sim, cast) {
      if (cast.slot !== 'Q' && cast.slot !== 'W' && cast.slot !== 'E') return;
      sim.setCounter('sonaChord', Math.min(3, sim.counter('sonaChord') + 1));
      sim.setCounter('sonaSong', cast.slot === 'Q' ? 1 : cast.slot === 'W' ? 2 : 3);
    },
    onAttack(sim, atk) {
      if (atk.fromAbility || atk.phantom) return;
      const max = sim.evalExpr('P.dv.PowerChordPassiveCountMax', { slot: 'P' });
      if (sim.counter('sonaChord') < max) return;
      sim.setCounter('sonaChord', 0);
      const song = sim.counter('sonaSong');
      const staccato = song === 1;
      atk.extra.push({
        source: 'P',
        sourceLabel: 'Power Chord',
        label: staccato ? 'Power Chord (Staccato)' : 'Power Chord',
        type: 'magic',
        amount: sim.evalExpr(staccato ? 'Q.calc.TotalStaccatoDamage' : 'P.calc.PowerChordDamage', { slot: staccato ? 'Q' : 'P' }),
        castId: atk.castId,
        flags: { kind: 'ability', slot: 'P', onHit: true, ability: false, proc: true },
      });
      if (song === 3) sim.applyCC('slow', sim.evalExpr('E.dv.TempoDuration', { slot: 'E' }), atk.castId, 'E');
    },
  },
};
export default kit;
