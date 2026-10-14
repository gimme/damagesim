import type { ChampionKit } from '../../engine/kit-types.ts';

// Swain — patch 16.20.
const kit: ChampionKit = {
  id: 'Swain',
  status: 'curated',
  notes: [
    'Soul Fragments (option "souls") only add max health; their healing is not modeled.',
    'Demonic Ascension lasts as long as Swain drains a champion; its length is option "rDuration" (default 6s).',
  ],
  options: [
    { key: 'souls', label: 'Soul Fragments collected', default: 10, min: 0, max: 200, step: 1 },
    { key: 'rDuration', label: 'Demonic Ascension duration (s)', default: 6, min: 0.5, max: 30, step: 0.5, description: 'Seconds the demon drains the target.' },
  ],
  buffStacks: { '{0dc6979e}': 'opt.souls' },
  stats: ({ opt, evalExpr }) => ({ hp: opt.souls * evalExpr('P.dv.HealthIncrement') }),
  abilities: {
    Q: {
      notes: [
        'All 5 bolts hit by default (point blank); total = first-bolt damage + 25% per extra bolt (max 200%), split evenly among the bolts that hit. Override the hit count for fewer bolts.',
      ],
      components: [
        {
          id: 'bolts',
          label: "Death's Hand",
          type: 'magic',
          amount: 'min(calc.MaxDamage, calc.InitialDamage + calc.ExtraBoltDamage * (hits - 1)) / hits',
          hits: 5,
          maxHits: 5,
          // 5 bolts over 0.264s (wiki).
          interval: 0.066,
          aoe: true,
          delay: 0.1,
        },
      ],
    },
    W: {
      cc: [{ kind: 'slow', duration: 'dv.SlowDuration' }],
      // Reveals for 1.5s (tooltip text), then strikes.
      components: [{ id: 'eye', label: 'Vision of Empire', type: 'magic', amount: 'calc.TotalDamage', aoe: true, delay: 1.5 }],
    },
    E: {
      notes: ['Damage only on the returning wave (≈0.8s assumed). The recast pull (no damage) is not modeled.'],
      cc: [{ kind: 'immobilize', duration: 'dv.RootDuration' }],
      components: [{ id: 'nevermove', label: 'Nevermove', type: 'magic', amount: 'calc.SecondaryDamage', aoe: true, delay: 0.8 }],
    },
    R: {
      recasts: 2,
      recastDelay: 'dv.DemonflareCastDelay',
      notes: [
        'Drains every TimeBetweenTicks (0.5s) for option rDuration seconds. Recast "R:demonflare" (available after 2s) for Demonflare; one Demonflare per cast is modeled.',
        'Demonflare also auto-casts when the form ends if it is off cooldown — enable with R+endFlare when it was not recast.',
      ],
      components: [
        {
          id: 'drain',
          label: 'Demonic Ascension',
          type: 'magic',
          amount: 'calc.DamageCalc * dv.TimeBetweenTicks',
          hits: 'round(opt.rDuration / dv.TimeBetweenTicks)',
          interval: 'dv.TimeBetweenTicks',
          delay: 'dv.TimeBetweenTicks',
          dot: true,
          aoe: true,
        },
        { id: 'endFlare', label: 'Demonflare (end of form)', type: 'magic', amount: 'calc.DemonflareDamageTotal', aoe: true, optional: true, delay: 'opt.rDuration' },
      ],
      variants: {
        demonflare: {
          label: 'Demonflare',
          // SwainRSoulFlare cast time.
          castTime: 0.25,
          cc: [{ kind: 'slow', duration: 'dv.DemonflareSlowDuration' }],
          components: [{ id: 'flare', label: 'Demonflare', type: 'magic', amount: 'calc.DemonflareDamageTotal', aoe: true }],
        },
      },
    },
  },
};
export default kit;
