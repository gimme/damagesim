import type { BuffSpec, ChampionKit } from '../../engine/kit-types.ts';

// Taric — patch 16.20.
// Bravado: every ability cast empowers the next 2 attacks (bonus magic damage, +100% attack speed,
// each hit reduces basic ability cooldowns by P.calc.CDR seconds). Recasting refreshes it to 2 attacks.
const bravado: BuffSpec = {
  id: 'bravado',
  label: 'Bravado',
  duration: 'P.dv.Duration',
  stats: { attackSpeed: 1 }, // "100% Attack Speed" (tooltip text, not in data)
  empowerAttacks: {
    count: 2, // tooltip text
    components: [{ id: 'bravado', label: 'Bravado', type: 'magic', amount: 'P.calc.TotalDamage', proc: true }],
  },
};

const kit: ChampionKit = {
  id: 'Taric',
  status: 'curated',
  notes: [
    'Bravado: after any ability cast, the next 2 attacks within 5s deal bonus magic damage, gain 100% attack speed and reduce basic ability cooldowns by 1s each.',
    'Bastion: the passive armor is modeled as a total-armor multiplier (bonus armor scaling slightly underestimated); the linked ally echoing spells is not modeled.',
    "Starlight's Touch, Bastion and Cosmic Radiance deal no damage (they still trigger Bravado).",
  ],
  stats: ({ ranks, evalExpr }) => (ranks.W > 0 ? { armorMult: [1 + evalExpr('W.dv.ArmorBonusPercentage', 'W')] } : {}),
  hooks: {
    // Bravado hits reduce basic ability cooldowns.
    onAttack(sim, atk) {
      if (atk.phantom || !atk.extra.some((x) => x.sourceLabel === 'Bravado')) return;
      const cdr = sim.evalExpr('P.calc.CDR', { slot: 'P' });
      for (const slot of ['Q', 'W', 'E']) {
        const key = `ability:${slot}`;
        const left = sim.cooldownReadyAt(key) - sim.time;
        if (left > 0) sim.startCooldown(key, Math.max(0, left - cdr));
      }
    },
  },
  abilities: {
    Q: { noTarget: true, buff: bravado, notes: ["Starlight's Touch heals; no damage."], components: [] },
    W: { noTarget: true, buff: bravado, notes: ['Bastion shields an ally; no damage.'], components: [] },
    E: {
      buff: bravado,
      cc: [{ kind: 'immobilize', duration: 'dv.StunDuration' }],
      notes: ['The beam bursts dv.ChargeDuration after the cast.'],
      components: [{ id: 'dazzle', label: 'Dazzle', type: 'magic', amount: 'calc.TotalDamage', aoe: true, delay: 'dv.ChargeDuration' }],
    },
    R: { noTarget: true, buff: bravado, notes: ['Cosmic Radiance (invulnerability) deals no damage.'], components: [] },
  },
};
export default kit;
