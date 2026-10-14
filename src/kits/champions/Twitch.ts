import type { ChampionKit } from '../../engine/kit-types.ts';
import type { Sim } from '../../engine/sim.ts';

// Twitch — patch 16.20.
// Deadly Venom is tracked by hooks (counter `venom`, read as stacks.venom) because Venom Cask adds
// stacks without dealing damage, which marks can't express. Each stack refreshes the 6s duration;
// the poison ticks every second for P.calc.DamagePerSecond per stack (true damage).
const CASK_DELAY = 0.3; // cask flight time (not in data)

/** `castId`: the attack or cask adding the stack; the poison's ticks share the one that started it. */
function addVenom(sim: Sim, castId: number) {
  const max = sim.evalExpr('P.dv.MaxStacks', { slot: 'P' });
  sim.setCounter('venom', Math.min(max, sim.counter('venom') + 1));
  sim.setCounter('venomUntil', sim.time + sim.evalExpr('P.dv.Duration', { slot: 'P' }));
  if (!sim.counter('venomTicking')) {
    sim.setCounter('venomTicking', 1);
    sim.setCounter('venomCast', castId);
    sim.schedule(1, () => venomTick(sim));
  }
}

function venomTick(sim: Sim) {
  if (sim.time > sim.counter('venomUntil') + 1e-9) {
    sim.setCounter('venom', 0);
    sim.setCounter('venomTicking', 0);
    return;
  }
  const amount = sim.evalExpr('P.calc.DamagePerSecond', { slot: 'P' }) * sim.counter('venom');
  sim.deal({ source: 'P', sourceLabel: 'Deadly Venom', label: `Venom (${sim.counter('venom')})`, type: 'true', amount, castId: sim.counter('venomCast'), flags: { kind: 'ability', slot: 'P', dot: true } });
  sim.schedule(1, () => venomTick(sim));
}

const kit: ChampionKit = {
  id: 'Twitch',
  status: 'curated',
  notes: [
    'Deadly Venom: every attack adds a stack (max 6, 6s, refreshing); ticks every second for true damage per stack.',
    'Venom Cask: 1 stack on impact + 1 per second for 3s (target assumed to stay in the cloud).',
    'Contaminate deals its per-stack damage for the current Venom stacks (stacks are not consumed); no damage without Venom.',
    'Ambush: cast before the fight; its attack speed buff is assumed to start at the cast. Spray and Pray: single target (no pierce falloff).',
  ],
  hooks: {
    onAttack(sim, atk) {
      if (!atk.phantom) addVenom(sim, atk.castId);
    },
    onCast(sim, cast) {
      if (cast.slot !== 'W' || !cast.hitsTarget) return;
      const castTime = sim.spellFor('W').castTime ?? 0;
      const cloud = sim.evalExpr('W.dv.Duration', { slot: 'W' });
      for (let i = 0; i <= cloud; i++) sim.schedule(castTime + CASK_DELAY + i, () => addVenom(sim, cast.castId));
    },
  },
  abilities: {
    Q: {
      noTarget: true,
      castTime: 0,
      buff: { id: 'ambush', label: 'Ambush', duration: 'dv.AttackSpeedDuration', stats: { attackSpeed: 'dv.AttackSpeedMod' } },
      components: [],
    },
    W: {
      cc: [{ kind: 'slow', duration: 'dv.Duration' }],
      notes: ['No damage: applies Deadly Venom stacks and slows while in the cloud.'],
      components: [],
    },
    E: {
      notes: ['Damage uses the Venom stacks at cast.'],
      components: [
        { id: 'physical', label: 'Contaminate', type: 'physical', amount: 'dv.BaseDamage + calc.PhysicalDamagePerStack * stacks.venom', hits: 'stacks.venom > 0 ? 1 : 0', aoe: true },
        { id: 'magic', label: 'Contaminate (magic)', type: 'magic', amount: 'calc.MagicDamagePerStack * stacks.venom', hits: 'stacks.venom > 0 && calc.MagicDamagePerStack > 0 ? 1 : 0', aoe: true },
      ],
    },
    R: {
      noTarget: true,
      castTime: 0,
      buff: { id: 'sprayAndPray', label: 'Spray and Pray', duration: 'dv.Duration', stats: { ad: 'dv.BonusAD', range: 'dv.BonusRange' } },
      components: [],
    },
  },
};
export default kit;
