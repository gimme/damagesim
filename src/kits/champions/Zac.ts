import type { ChampionKit } from '../../engine/kit-types.ts';

// Zac — patch 16.20.
const kit: ChampionKit = {
  id: 'Zac',
  status: 'curated',
  notes: [
    'Stretching Strikes: the arm hit and the empowered attack both deal Q damage to the same target (write "Q AA"). In game that attack cannot crit or apply on-hit; the simulator still lets it. Q:slam flings the target into another unit instead.',
    'Elastic Slingshot assumes a full charge (ChannelTime, used as the cast time) and the longest knock-up.',
    "Let's Bounce!: all four bounces hit by default (first bounce knocks back; later ones deal 50%). Use R{bounce:1} etc. for fewer.",
    'Cell Division healing/revive is not modeled.',
  ],
  abilities: {
    Q: {
      cc: [{ kind: 'slow', duration: 'dv.SlowDuration' }],
      // Wiki: unable to move or attack while the arm flies (the cast time + its range at its speed).
      lockout: 'castTime + castRange / missileSpeed',
      variants: {
        slam: {
          label: 'slam',
          note: 'Q a champion, then attack a different unit: both are slammed together.',
          // Wiki: slammed units are knocked up and stunned for 0.25s (not in the data).
          cc: [{ kind: 'slow', duration: 'dv.SlowDuration' }, { kind: 'immobilize', duration: 0.25 }],
          // The empowered attack goes to the other unit: no empowered attack on the target.
          buff: [],
          components: [
            { id: 'arm', label: 'Stretching Strikes', type: 'magic', amount: 'calc.TotalDamage', travel: true },
            // ~1s after the arm lands: the attack on the other unit, then the yank (not in the wiki).
            { id: 'slam', label: 'Stretching Strikes (slam)', type: 'magic', amount: 'calc.TotalDamage', aoe: true, delay: 1, travel: true },
          ],
        },
      },
      buff: {
        id: 'zacQ',
        label: 'Stretching Strikes',
        duration: 'dv.TetherDuration',
        empowerAttacks: { count: 1, components: [{ id: 'empowered', label: 'Stretching Strikes (attack)', type: 'magic', amount: 'Q.calc.TotalDamage' }] },
      },
      components: [{ id: 'arm', label: 'Stretching Strikes', type: 'magic', amount: 'calc.TotalDamage', travel: true }],
    },
    W: {
      components: [{ id: 'erupt', label: 'Unstable Matter', type: 'magic', amount: 'dv.BaseDamage + calc.DisplayPercentDamage * target.maxHp', aoe: true }],
    },
    E: {
      dash: true,
      castTime: 'dv.ChannelTime',
      // After the charge he leaps its max range (dv.MaxRange; the data's range isn't it) at the dash
      // speed, busy until he lands.
      lockout: 'dv.ChannelTime + dv.MaxRange / missileSpeed',
      cc: [{ kind: 'immobilize', duration: 'calc.MaxStun' }],
      components: [{ id: 'slingshot', label: 'Elastic Slingshot', type: 'magic', amount: 'calc.Damage', aoe: true, travel: 'dv.MaxRange / missileSpeed' }],
    },
    R: {
      // Wiki: free to move, but unable to declare attacks or cast Q/E (W can be cast) until the last
      // bounce: 0.3s cast time, then a bounce every TimeBetweenBounces.
      attackLockout: '0.3 + (dv.Bounces - 1) * dv.TimeBetweenBounces',
      castLockout: { Q: '0.3 + (dv.Bounces - 1) * dv.TimeBetweenBounces', E: '0.3 + (dv.Bounces - 1) * dv.TimeBetweenBounces' },
      cc: [{ kind: 'immobilize', duration: 'dv.KnockupDuration' }, { kind: 'slow', duration: 'dv.SlowDuration' }],
      components: [
        { id: 'first', label: "Let's Bounce! (first)", type: 'magic', amount: 'calc.DamagePerBounce', aoe: true },
        {
          id: 'bounce',
          label: "Let's Bounce! (bounce)",
          type: 'magic',
          amount: 'calc.DamagePerSubsequentBounce',
          hits: 'dv.Bounces - 1',
          maxHits: 'dv.Bounces - 1',
          interval: 'dv.TimeBetweenBounces',
          delay: 'dv.TimeBetweenBounces',
          aoe: true,
        },
      ],
    },
  },
};
export default kit;
