import type { BuffSpec, ChampionKit } from '../../engine/kit-types.ts';

// Pantheon — patch 16.20.
// Mortal Will is tracked by a hook: attacks that land and ability casts add a stack (max
// ActionsToEmpower); at full stacks the next Q/W/E consumes them and is empowered. Grand Starfall
// readies it instantly. Option "mortalWill" sets the stacks at combat start (full by default).

const MW = 'pantheon.mortalWill';
const EMPOWERED = 'pantheon.empoweredCast';
const Q_BONUS_DONE = 'pantheon.qBonusDone';

// Empowered Shield Vault: the next attack strikes EmpoweredNumHits times instead of once.
const wEmpowered: BuffSpec = {
  id: 'shieldVaultMW',
  label: 'Shield Vault (Mortal Will)',
  duration: 'W.dv.BuffDuration',
  empowerAttacks: {
    count: 1,
    replaceBase: true,
    // Each strike applies on-hit effects.
    onHitRepeats: 'W.dv.EmpoweredNumHits - 1',
    components: [{ id: 'strikes', label: 'Shield Vault (strike)', type: 'physical', amount: "W.calc['{1b016817}']", hits: 'W.dv.EmpoweredNumHits', canCrit: true }],
  },
};

const execute = (normal: string) => `target.hpPct < dv.CritHealthThreshold ? calc.ExecuteDamageCalcModified : ${normal}`;

const kit: ChampionKit = {
  id: 'Pantheon',
  status: 'curated',
  notes: [
    'Mortal Will: the first basic ability after 5 attacks/casts is empowered automatically (full stacks at combat start; option "mortalWill"). Empowered Q: bonus damage; empowered W: the next attack strikes 3 times; empowered E: resists and move speed (not modeled).',
    'Empowered W strikes: crit is rolled once for all three; each strike applies on-hit effects.',
  ],
  options: [{ key: 'mortalWill', label: 'Mortal Will stacks at start', default: 5, min: 0, max: 5 }],
  stats: ({ ranks, evalExpr }) => (ranks.R > 0 ? { armorPenPercent: [evalExpr('R.dv.ArmorPenetration')] } : {}),
  abilities: {
    Q: {
      // Tapping refunds TapCooldownRefund of the cooldown.
      cooldown: 'cooldown * (1 - dv.TapCooldownRefund)',
      notes: ['Default: tap (thrust). Variant "hold": thrown spear. Below 20% health both deal the execute damage instead.'],
      variants: {
        hold: {
          label: 'hold',
          // Minimum hold time (dv.MinTimeHoldCast).
          castTime: 0.35,
          cooldown: 'cooldown',
          components: [{ id: 'spear', label: 'Comet Spear (hold)', type: 'physical', amount: execute('calc.HoldDamageCalc'), delay: 0.2 }],
        },
      },
      components: [{ id: 'spear', label: 'Comet Spear', type: 'physical', amount: execute('calc.TapDamageCalc'), aoe: true }],
    },
    W: {
      dash: true,
      cc: [{ kind: 'immobilize', duration: 'dv.StunDuration' }],
      components: [{ id: 'vault', label: 'Shield Vault', type: 'physical', amount: 'calc.MaxHealthDamageCalc * target.maxHp' }],
    },
    E: {
      // Channel + 0.25 s shield slam (wiki); no attacks meanwhile.
      lockout: 'dv.ShieldDuration + 0.25',
      notes: ['6 spear strikes (AttacksPerSecond × ShieldDuration) totalling the tooltip damage over 1.5 s, then the shield slam.'],
      components: [
        {
          id: 'strikes',
          label: 'Aegis Assault',
          type: 'physical',
          amount: 'calc.DamageCalc / (dv.AttacksPerSecond * dv.ShieldDuration)',
          hits: 'dv.AttacksPerSecond * dv.ShieldDuration',
          interval: '1 / dv.AttacksPerSecond',
          delay: '1 / dv.AttacksPerSecond',
          aoe: true,
        },
        { id: 'slam', label: 'Aegis Assault (slam)', type: 'physical', amount: 'calc.ShieldDamageCalc', aoe: true, delay: 'dv.ShieldDuration + 0.25' },
      ],
    },
    R: {
      dash: true,
      // 0.1 s cast + 2 s channel + 2.25 s leap/fall (wiki): the spear lands ~3.1 s and the meteor ~4.35 s after the cast starts.
      lockout: 4.35,
      cc: [{ kind: 'slow', duration: 'dv.SpearSlowDuration' }],
      notes: ['Default: meteor centre (full damage). Variant "edge": target at the edge of the area (−50%).'],
      variants: {
        edge: {
          label: 'edge',
          dash: true,
          components: [
            { id: 'spear', label: 'Grand Starfall (spear)', type: 'physical', amount: 'Q.calc.HoldDamageCalc', delay: 3 },
            { id: 'meteor', label: 'Grand Starfall', type: 'magic', amount: 'calc.MinDamage', aoe: true, delay: 4.25 },
          ],
        },
      },
      components: [
        { id: 'spear', label: 'Grand Starfall (spear)', type: 'physical', amount: 'Q.calc.HoldDamageCalc', delay: 3 },
        { id: 'meteor', label: 'Grand Starfall', type: 'magic', amount: 'calc.DamageCalc', aoe: true, delay: 4.25 },
      ],
    },
  },
  hooks: {
    onStart(sim) {
      sim.setCounter(MW, sim.opt.mortalWill ?? 5);
    },
    onCast(sim, cast) {
      const full = sim.evalExpr('P.dv.ActionsToEmpower', { slot: 'P' });
      if (cast.slot === 'R') return sim.setCounter(MW, full);
      if (cast.slot === 'P') return;
      if (sim.counter(MW) >= full) {
        sim.setCounter(MW, 0);
        sim.setCounter(EMPOWERED, cast.castId);
        if (cast.slot === 'W') sim.applyBuff(wEmpowered, 'W', sim.spellFor('W'), sim.rankOf('W'));
      } else sim.setCounter(MW, Math.min(full, sim.counter(MW) + 1));
    },
    afterDamage(sim, inst) {
      if (inst.fromMark) return;
      if (inst.flags.attack) {
        sim.setCounter(MW, Math.min(sim.evalExpr('P.dv.ActionsToEmpower', { slot: 'P' }), sim.counter(MW) + 1));
        return;
      }
      // Empowered Comet Spear: bonus physical damage on the hit.
      if (inst.flags.slot === 'Q' && inst.flags.kind === 'ability' && inst.castId === sim.counter(EMPOWERED) && sim.counter(Q_BONUS_DONE) !== inst.castId) {
        sim.setCounter(Q_BONUS_DONE, inst.castId);
        sim.deal({
          source: 'Q',
          sourceLabel: inst.sourceLabel,
          label: 'Comet Spear (Mortal Will)',
          type: 'physical',
          amount: sim.evalExpr('Q.calc.EmpoweredDamageCalc', { slot: 'Q' }),
          castId: inst.castId,
          flags: { kind: 'ability', slot: 'Q', ability: true },
        });
      }
    },
  },
};
export default kit;
