import type { ChampionKit } from '../../engine/kit-types.ts';

// Soraka — patch 16.20.
const kit: ChampionKit = {
  id: 'Soraka',
  status: 'curated',
  notes: ['Astral Infusion and Wish only heal allies; they are not modeled beyond casting.'],
  abilities: {
    Q: {
      notes: ['The star lands 0.25–1s after the cast depending on range (wiki); 0.6s assumed.'],
      cc: [{ kind: 'slow', duration: 'dv.SlowDuration' }],
      components: [{ id: 'star', label: 'Starcall', type: 'magic', amount: 'calc.TotalDamage', aoe: true, delay: 0.6 }],
    },
    W: { noTarget: true, components: [] },
    E: {
      notes: [
        'Default: the initial hit and silence. E:root = the champion is still inside when the zone erupts after RootDelay — second hit and root.',
      ],
      cc: [{ kind: 'impair', duration: 'dv.RootDelay' }],
      components: [{ id: 'field', label: 'Equinox', type: 'magic', amount: 'calc.TotalDamage', aoe: true }],
      variants: {
        root: {
          label: 'root',
          cc: [
            { kind: 'impair', duration: 'dv.RootDelay' },
            { kind: 'immobilize', duration: 'dv.RootDuration', delay: 'dv.RootDelay' },
          ],
          components: [
            { id: 'field', label: 'Equinox', type: 'magic', amount: 'calc.TotalDamage', aoe: true },
            { id: 'erupt', label: 'Equinox (eruption)', type: 'magic', amount: 'calc.TotalDamage', aoe: true, delay: 'dv.RootDelay' },
          ],
        },
      },
    },
    R: { noTarget: true, components: [] },
  },
};
export default kit;
