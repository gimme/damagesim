import type { ChampionKit, ComponentSpec } from '../../engine/kit-types.ts';

// Caitlyn — patch 16.20.
// Headshot bonus damage is added after the attack's crit roll (wiki): only the attack portion crits.
const headshot: ComponentSpec = { id: 'headshot', label: 'Headshot', type: 'physical', amount: 'P.calc.HeadShotBonusDamage' };
const HEADSHOT_WINDOW = 1.8; // wiki: trapped/netted targets can be headshot within 1.8s

const kit: ChampionKit = {
  id: 'Caitlyn',
  status: 'curated',
  notes: [
    'Headshot every 5th attack (P.dv.AttacksPerHeadshot; brush stacking not modeled). The bonus damage does not crit; its crit-chance scaling is in the formula.',
    "Trap (W) and net (E) each grant one extra Headshot on the next attack within 1.8s without consuming the normal counter; trapped targets take Yordle Snap Trap's extra Headshot damage.",
    'Piltover Peacemaker: a single target is the first one hit and takes the full damage (the reduced secondary damage only hits others).',
  ],
  attack: {
    // n = P.dv.AttacksPerHeadshot (5); everyNth takes a literal.
    everyNth: { n: 5, label: 'Headshot', components: [headshot] },
  },
  abilities: {
    Q: {
      // Fired as the cast time starts (wiki: {{Effect at cast time start}}).
      components: [{ id: 'peacemaker', label: 'Piltover Peacemaker', type: 'physical', amount: 'calc.InitialDamage', aoe: true, travel: 'reach / missileSpeed - castTime' }],
    },
    W: {
      cc: [{ kind: 'immobilize', duration: 'dv.RootDuration' }],
      notes: ['Assumes the target steps on the trap right away; follow with AA for the trap Headshot.'],
      debuff: { id: 'caitTrapped', label: 'Yordle Snap Trap', duration: HEADSHOT_WINDOW },
      buff: {
        id: 'caitHeadshot',
        label: 'Headshot (trap)',
        duration: HEADSHOT_WINDOW,
        empowerAttacks: {
          count: 1,
          components: [{ ...headshot, amount: 'P.calc.HeadShotBonusDamage + W.calc.HeadShotBonusDamage' }],
        },
      },
      components: [],
    },
    E: {
      dash: true,
      // Wiki: recoils 390 units at 1000 speed after the cast time; she can cast her abilities during
      // the recoil, and an attack waits for it to end.
      attackLockout: 'castTime + 390 / 1000',
      cc: [{ kind: 'slow', duration: 'dv.SlowDuration' }],
      buff: {
        id: 'caitHeadshot',
        label: 'Headshot (net)',
        duration: HEADSHOT_WINDOW,
        empowerAttacks: {
          count: 1,
          // A target that is also trapped keeps the trap's bonus (one Headshot per method, not stacked).
          components: [{ ...headshot, amount: 'P.calc.HeadShotBonusDamage + (debuff.caitTrapped ? W.calc.HeadShotBonusDamage : 0)' }],
        },
      },
      components: [{ id: 'net', label: '90 Caliber Net', type: 'magic', amount: 'calc.NetDamage', travel: true }],
    },
    R: {
      castTime: 1.375, // 0.375s cast + 1s channel (wiki)
      components: [{ id: 'ace', label: 'Ace in the Hole', type: 'physical', amount: 'calc.RTotalDamage', travel: true }],
    },
  },
};
export default kit;
