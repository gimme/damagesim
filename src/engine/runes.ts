// Rune effects for patch 16.20. Numbers come from the game's perk data; behaviour follows the
// research notes in docs/research/runes.md (trigger rules, damage types, stacking).

import type { RuneData } from './data-types.ts';
import { DISTANCE, IN_COMBAT, SELF_HP, selfHp, triggersOnAttack, type DamageInstance, type Effect, type SetupCtx } from './effects.ts';
import type { Sim } from './sim.ts';
import { GAME, type StatMods } from './stats.ts';
import { ITEM_STAT_TYPES } from './items.ts';
import { findItem } from './gamedata.ts';

type Factory = (rune: RuneData, setup: SetupCtx, sim: Sim) => Effect | null;

const lerpLevel = (level: number, a: number, b: number) => a + ((b - a) * (level - 1)) / 17;

/** "Adaptive damage": physical if bonus AD > AP, magic if AP > bonus AD, else the champion's type. */
function adaptiveType(sim: Sim): 'physical' | 'magic' {
  const s = sim.stats;
  if (s.bonusAd > s.ap) return 'physical';
  if (s.ap > s.bonusAd) return 'magic';
  return sim.champ.adaptive;
}

/** "Variable damage" (Electrocute, Arcane Comet): compares ratio contributions; ties are magic. */
function variableType(sim: Sim, adRatio: number, apRatio: number): 'physical' | 'magic' {
  const s = sim.stats;
  return adRatio * s.bonusAd > apRatio * s.ap ? 'physical' : 'magic';
}

/** The type each rune's adaptive damage takes. */
const ADAPTIVE_DAMAGE: Record<number, (sim: Sim, v: Record<string, number>) => 'physical' | 'magic'> = {
  8005: adaptiveType, // Press the Attack
  8008: adaptiveType, // Lethal Tempo
  8128: adaptiveType, // Dark Harvest
  8214: adaptiveType, // Summon Aery
  8112: (sim, v) => variableType(sim, v.BonusADRatio, v.APRatio), // Electrocute
  8229: (sim, v) => variableType(sim, v.ADRatio, v.APRatio), // Arcane Comet
};

/** The type a rune's adaptive damage takes at the attacker's current stats; null if it deals none. */
export function adaptiveDamageType(rune: RuneData, sim: Sim): 'physical' | 'magic' | null {
  return ADAPTIVE_DAMAGE[rune.id]?.(sim, rune.values) ?? null;
}

/** Numbers a rune scales with level that its data has no formula for (the game's script works them
 *  out in play): the names of their level 1 and level 18 values, linear in between (wiki). */
const LEVEL_SCALED: Record<number, [min: string, max: string]> = {
  8005: ['MinDamage', 'MaxDamage'], // Press the Attack's damage
  8010: ['MinAdaptivePerStack', 'MaxAdaptivePerStack'], // Conqueror's adaptive force per stack
  5001: ['StatGainMin', 'StatGainMax'], // Health Scaling
};

/** A rune's level-scaled number (LEVEL_SCALED) at a level. */
const levelScaled = (rune: RuneData, level: number) => {
  const [min, max] = LEVEL_SCALED[rune.id];
  return lerpLevel(level, rune.values[min], rune.values[max]);
};

/** The damage Dark Harvest's souls (an option) add, and its damage with them. */
const harvestSouls = (rune: RuneData, sim: Sim) => rune.values.DamagePerSoulEssence * (sim.opt['darkHarvest.souls'] ?? 0);
const harvestDamage = (rune: RuneData, sim: Sim) => calc(sim, rune, 'TotalDamage') + harvestSouls(rune, sim);

/** Which of two texts a script value picks by adaptive type: 0 for physical (AD), 1 for magic (AP). */
const adaptiveIndex = (type: 'physical' | 'magic') => (type === 'physical' ? 0 : 1);
/** Adaptive force as the stat it gives. */
const adaptiveStat = (force: number, type: 'physical' | 'magic') => force * (type === 'physical' ? GAME.adaptiveToAd : GAME.adaptiveToAp);

/** Game time, shared by Gathering Storm and Conditioning, in Gathering Storm's 10-minute steps. */
const GAME_TIME = { key: 'gameTime', label: 'Game time (minutes)', default: 20, min: 0, max: 60, step: 10 };

/**
 * The values the game's script sets in a rune's in-game tooltip (@f1@…, and the includes they pick),
 * as the simulator models them. Those it has no counterpart for (damage dealt so far…) are left out.
 */
const SCRIPT_VALUES: Record<number, (rune: RuneData, sim: Sim) => Record<string, number>> = {
  8005: (rune, sim) => ({ f4: levelScaled(rune, sim.level) }), // Press the Attack: damage
  8128: (rune, sim) => {
    // Dark Harvest: f2 its damage type, f8 its damage, f5 souls, f6 their damage.
    const type = ADAPTIVE_DAMAGE[rune.id](sim, rune.values);
    return { f2: adaptiveIndex(type), f8: harvestDamage(rune, sim), f5: sim.opt['darkHarvest.souls'] ?? 0, f6: harvestSouls(rune, sim) };
  },
  // Conqueror: f4 the stat its adaptive force gives, f5 how much per stack.
  8010: (rune, sim) => ({ f4: adaptiveIndex(sim.stats.adaptiveType), f5: adaptiveStat(levelScaled(rune, sim.level), sim.stats.adaptiveType) }),
  5001: (rune, sim) => ({ f1: levelScaled(rune, sim.level) }), // Health Scaling
  // Adaptive Force: f1 the stat it gives, f2 how much.
  5008: (rune, sim) => ({ f1: adaptiveIndex(sim.stats.adaptiveType), f2: adaptiveStat(rune.values.StatGain2, sim.stats.adaptiveType) }),
};

/** The values the game's script would set in a rune's in-game tooltip, as the simulator models them. */
export function runeScriptValues(rune: RuneData, sim: Sim): Record<string, number> {
  return SCRIPT_VALUES[rune.id]?.(rune, sim) ?? {};
}

/** Damage that can trigger "on damage" runes (not item/rune proc damage, except pets). */
const triggers = (inst: DamageInstance) => !inst.flags.proc || inst.flags.pet;

function calc(sim: Sim, rune: RuneData, name: string): number {
  return sim.evalDataCalc(rune.calcs, rune.values, name);
}

function base(rune: RuneData, extra: Partial<Effect> & Pick<Effect, never> = {}): Effect {
  return { id: `rune:${rune.id}`, label: rune.name, source: 'rune', ...extra };
}

const RUNES: Record<number, Factory> = {
  // ---------------------------------------------------------------- Keystones
  // Press the Attack
  8005: (rune) => {
    let stacks = 0;
    let lastHit = -Infinity;
    // The amp starts after the proc's frame and ends OutOfCombatTimer seconds after combat.
    let ampFrom = Infinity;
    const v = rune.values;
    const key = `rune:${rune.id}`;
    const ampActive = (sim: Sim) => sim.time >= ampFrom && sim.time - sim.lastCombatTime <= v.OutOfCombatTimer;
    return base(rune, {
      description: '3 consecutive basic attacks deal adaptive damage (6s cooldown), then +8% damage dealt until 5s after combat ends.',
      limitations: ['Combat with the target is assumed to end at your last damage to it.'],
      onAttack(sim, atk) {
        // Single-target on-hits stack it, including abilities that apply on-hit and repeated
        // applications (Guinsoo's Phantom Hit); area on-hits don't (wiki).
        if (atk.areaOnHit || !sim.isReady(key)) return;
        if (sim.time - lastHit > v.TimeBetweenHits) stacks = 0;
        stacks++;
        lastHit = sim.time;
        if (stacks < v.HitsRequired) return;
        stacks = 0;
        sim.startCooldown(key, v.Cooldown);
        atk.extra.push({
          source: key,
          sourceLabel: rune.name,
          label: 'Proc',
          type: ADAPTIVE_DAMAGE[rune.id](sim, rune.values),
          amount: levelScaled(rune, sim.level),
          flags: { kind: 'rune', proc: true },
        });
        // The triggering attack and proc are not amplified; everything afterwards is.
        if (!ampActive(sim)) ampFrom = sim.time + 1e-6;
      },
      beforeDamage(sim, inst) {
        if (inst.time < ampFrom) return;
        // lastCombatTime is still the previous damage here.
        if (!ampActive(sim)) {
          ampFrom = Infinity;
          return;
        }
        if (!inst.flags.unamplified) inst.amps.push({ id: `rune:${rune.id}`, source: rune.name, value: v.BonusPercentDamage, kind: 'dealt' });
      },
    });
  },

  // Lethal Tempo
  8008: (rune) => {
    let stacks = 0;
    let expires = -Infinity;
    const v = rune.values;
    // When the duration ends one stack expires, then one more every 0.3s (wiki).
    const DECAY = 0.3;
    const current = (t: number) => (t <= expires ? stacks : Math.max(0, stacks - 1 - Math.floor((t - expires) / DECAY + 1e-9)));
    return base(rune, {
      description: 'Each attack grants a stack of attack speed (max 6). At max stacks attacks fire an adaptive bolt that scales with bonus attack speed.',
      dynamicStats(sim) {
        const n = current(sim.time);
        if (!n) return;
        return { attackSpeed: n * sim.evalDataCalc(rune.calcs, rune.values, 'ASPerStack', { noStats: true }) };
      },
      onAttack(sim, atk) {
        if (!triggersOnAttack(atk)) return;
        stacks = current(sim.time);
        if (stacks >= v.MaxStacks) {
          atk.extra.push({
            source: `rune:${rune.id}`,
            sourceLabel: rune.name,
            label: 'Bolt',
            type: ADAPTIVE_DAMAGE[rune.id](sim, rune.values),
            amount: calc(sim, rune, 'NoteDamage'),
            flags: { kind: 'rune', proc: true },
          });
        }
        stacks = Math.min(v.MaxStacks, stacks + 1);
        expires = sim.time + v.Duration;
        sim.invalidateStats();
      },
    });
  },

  // Fleet Footwork: heal + move speed only.
  8021: (rune) => base(rune, { description: 'Heals and grants move speed; no damage.' }),

  // Conqueror
  8010: (rune, setup) => {
    let stacks = 0;
    let expires = -Infinity;
    const perCast = new Map<number, number>();
    const v = rune.values;
    return base(rune, {
      description: 'Attacks (2 melee / 1 ranged) and other damage (2, once per 4s per cast) grant adaptive force stacks, max 12.',
      dynamicStats(sim) {
        const n = sim.time <= expires ? stacks : 0;
        if (!n) return;
        return { adaptive: n * levelScaled(rune, sim.level) };
      },
      afterDamage(sim, inst) {
        if (inst.flags.proc && !inst.flags.pet) return;
        if (sim.time > expires) stacks = 0;
        let gain = 0;
        if (inst.flags.attack) {
          // Basic attacks always stack; the rest of their cast instance (an empowered attack's
          // ability damage, DoT ticks it started) counts as already stacked for 4s.
          gain = setup.ranged ? 1 : 2;
          perCast.set(inst.castId, sim.time);
        } else if (inst.flags.onHit && !inst.flags.ability) return; // passive on-hit extras are part of the attack
        else {
          const last = perCast.get(inst.castId);
          if (last === undefined || sim.time - last >= v.TimeUntilNextStackFromSameSpell) {
            perCast.set(inst.castId, sim.time);
            gain = 2;
          }
        }
        if (!gain) {
          expires = sim.time + v.BuffDuration;
          return;
        }
        stacks = Math.min(v.MaxStacks, stacks + gain);
        expires = sim.time + v.BuffDuration;
        sim.invalidateStats();
      },
    });
  },

  // Electrocute
  8112: (rune) => {
    let windowStart = -Infinity;
    const casts = new Set<number>();
    const v = rune.values;
    const stack = (sim: Sim, castId: number) => {
      if (!sim.isReady(`rune:${rune.id}`)) return;
      if (sim.time - windowStart > v.WindowDuration) {
        windowStart = sim.time;
        casts.clear();
      }
      casts.add(castId);
      if (casts.size >= 3) {
        casts.clear();
        windowStart = -Infinity;
        sim.startCooldown(`rune:${rune.id}`, v.Cooldown);
        sim.schedule(0.25, () =>
          sim.deal({
            source: `rune:${rune.id}`,
            sourceLabel: rune.name,
            label: 'Strike',
            type: ADAPTIVE_DAMAGE[rune.id](sim, v),
            amount: calc(sim, rune, 'TotalDamage'),
            flags: { kind: 'rune', proc: true },
          }),
        );
      }
    };
    return base(rune, {
      description: '3 separate attacks/abilities within 3s strike for bonus damage after 0.25s (20s cooldown).',
      afterDamage(sim, inst) {
        if (triggers(inst)) stack(sim, inst.castId);
      },
      onCrowdControl(sim, cc) {
        stack(sim, cc.castId);
      },
    });
  },

  // Dark Harvest
  8128: (rune) => {
    const v = rune.values;
    return base(rune, {
      description: 'Damaging a champion below 50% health deals adaptive damage (+11 per soul); 35s cooldown.',
      options: [{ key: 'darkHarvest.souls', label: 'Dark Harvest souls', default: 0, min: 0, max: 100 }],
      afterDamage(sim, inst) {
        if (!triggers(inst) || (inst.final ?? 0) < 2 || !sim.isReady(`rune:${rune.id}`)) return;
        if ((inst.targetHpBefore ?? 0) / sim.target.maxHp >= v.HarvestThreshold) return;
        sim.startCooldown(`rune:${rune.id}`, v.Cooldown);
        sim.deal({
          source: `rune:${rune.id}`,
          sourceLabel: rune.name,
          label: 'Harvest',
          type: ADAPTIVE_DAMAGE[rune.id](sim, rune.values),
          amount: harvestDamage(rune, sim),
          flags: { kind: 'rune', proc: true },
        });
      },
    });
  },

  // Hail of Blades
  9923: (rune, setup) => {
    let active = false;
    let charges = 0;
    let bonusResets = 0;
    let expires = -Infinity;
    let asFrom = Infinity;
    const v = rune.values;
    /** The effect ended at `at` (last stack used, or timed out); the cooldown starts then. */
    const end = (sim: Sim, at = sim.time) => {
      active = false;
      sim.startCooldown(`rune:${rune.id}`, v.Cooldown - (sim.time - at));
      sim.invalidateStats();
    };
    return base(rune, {
      description: 'The first attack on a champion and the next 2 deal bonus true damage; +90% (ranged 60%) attack speed after the first.',
      dynamicStats(sim) {
        if (!active || sim.time > expires || sim.time < asFrom) return;
        return { attackSpeed: setup.ranged ? v.ASBoostRanged : v.ASBoost, attackSpeedCap: 90 };
      },
      onAttack(sim, atk) {
        // Basic attacks only: abilities that trigger on-attack effects don't, except Yasuo's and
        // Yone's Q, which are special cased (wiki).
        if (!triggersOnAttack(atk)) return;
        if (atk.fromAbility && !(atk.fromAbility === 'Q' && (setup.champion === 'Yasuo' || setup.champion === 'Yone'))) return;
        if (active && sim.time > expires) end(sim, expires);
        if (!active) {
          if (!sim.isReady(`rune:${rune.id}`)) return;
          active = true;
          charges = v.NumHits;
          bonusResets = 0;
          asFrom = sim.time + 1e-6;
        }
        atk.extra.push({
          source: `rune:${rune.id}`,
          sourceLabel: rune.name,
          label: 'Bonus',
          type: 'true',
          amount: calc(sim, rune, 'BonusDamage'),
          flags: { kind: 'rune', proc: true },
        });
        charges--;
        expires = sim.time + v.Duration;
        sim.invalidateStats();
        if (charges <= 0) end(sim);
      },
      onCast(sim, cast) {
        if (active && cast.resetsAttack && bonusResets < v.MaxBonusHits) {
          bonusResets++;
          charges++;
        }
      },
    });
  },

  // Summon Aery
  8214: (rune) => {
    let readyAt = -Infinity;
    return base(rune, {
      description: 'Damaging a champion with an attack, ability or item effect sends Aery (0.45s flight) for adaptive damage; she returns before she can be sent again.',
      options: [{ key: 'aery.cycle', label: 'Aery round trip (s)', default: 3, min: 1, max: 8, step: 0.25 }],
      limitations: ['Aery availability is approximated with a fixed round-trip time (option aery.cycle).'],
      afterDamage(sim, inst) {
        // Attacks, abilities (their damage over time included) and item effects send her; rune
        // damage and persistent proc damage don't, except Ignite's first tick (wiki).
        if (inst.flags.kind === 'rune') return;
        if (inst.flags.kind === 'summoner' ? inst.flags.dot && !inst.label.endsWith(' 1') : inst.flags.dot && inst.flags.proc) return;
        if (sim.time < readyAt) return;
        readyAt = sim.time + (sim.opt['aery.cycle'] ?? 3);
        sim.schedule(0.45, () =>
          sim.deal({
            source: `rune:${rune.id}`,
            sourceLabel: rune.name,
            label: 'Aery',
            type: ADAPTIVE_DAMAGE[rune.id](sim, rune.values),
            amount: calc(sim, rune, 'DamageCalc'),
            flags: { kind: 'rune', proc: true },
          }),
        );
      },
    });
  },

  // Arcane Comet
  8229: (rune) => {
    const v = rune.values;
    return base(rune, {
      description: 'Ability damage calls a comet (lands after 0.8s); damage grows up to +100% with distance (750 units).',
      options: [DISTANCE],
      limitations: ['Assumes the comet hits (it can be dodged).'],
      afterDamage(sim, inst) {
        if (!(inst.flags.ability || inst.flags.pet) || (inst.flags.proc && !inst.flags.pet)) return;
        if (!sim.isReady(`rune:${rune.id}`)) return;
        sim.startCooldown(`rune:${rune.id}`, calc(sim, rune, 'CooldownCalc'));
        const dist = sim.opt['distance'] ?? DISTANCE.default;
        sim.schedule(0.8, () =>
          sim.deal({
            source: `rune:${rune.id}`,
            sourceLabel: rune.name,
            label: 'Comet',
            type: ADAPTIVE_DAMAGE[rune.id](sim, v),
            amount: calc(sim, rune, 'DamageCalc') * (1 + v.MaxDamageAmp * Math.min(dist / v.MaxRange, 1)),
            flags: { kind: 'rune', proc: true, aoe: true },
          }),
        );
      },
    });
  },

  // Stormraider's Surge (replaced Phase Rush): move speed only.
  8230: (rune) => base(rune, { description: 'Move speed after heavy damage; no damage.' }),

  // Deathfire Touch
  8992: (rune) => {
    const v = rune.values;
    let burnStart = -Infinity;
    let burnEnd = -Infinity;
    // Ticks after this were only extended by aura damage and don't keep you in combat.
    let combatEnd = -Infinity;
    let dps = 0;
    let burnId = 0;
    const tick = (sim: Sim, id: number) => {
      if (id !== burnId || sim.time > burnEnd + 1e-9) return;
      // Ticks after the burn has lingered for 3s are amplified; the tick at exactly 3s isn't.
      const amped = sim.time - burnStart > v.TimeToAmp + 1e-9;
      sim.deal({
        source: `rune:${rune.id}`,
        sourceLabel: rune.name,
        label: amped ? 'Burn (amplified)' : 'Burn',
        type: 'magic',
        amount: (dps / v.TicksPerSecond) * (amped ? 1 + v.DamageMultiplier : 1),
        flags: { kind: 'rune', proc: true, dot: true, ...(sim.time > combatEnd + 1e-9 ? { aura: true } : {}) },
      });
      sim.schedule(1 / v.TicksPerSecond, () => tick(sim, id));
    };
    return base(rune, {
      description: 'Ability damage burns for magic damage per second (4s spell / 2s area / 1s over-time or pet); ticks after 3s deal +75%. Damage is fixed when the burn starts.',
      afterDamage(sim, inst) {
        if (!(inst.flags.ability || inst.flags.pet) || (inst.flags.proc && !inst.flags.pet)) return;
        const dur = inst.flags.dot || inst.flags.pet ? v.DotDuration : inst.flags.aoe ? v.AoEDuration : v.Duration;
        if (sim.time > burnEnd + 1e-9) {
          // A new burn (the previous one has ended), with damage from the current stats.
          burnId++;
          burnStart = sim.time;
          burnEnd = sim.time + dur;
          dps = calc(sim, rune, 'DamageCalc');
          const id = burnId;
          sim.schedule(1 / v.TicksPerSecond, () => tick(sim, id));
        } else if (burnEnd - sim.time < dur) {
          // Refresh: a longer burn type overrides a shorter one; a shorter one only tops up the
          // remaining duration (equivalent to the wiki's rule). The 3s amp timer keeps running.
          burnEnd = sim.time + dur;
        }
        if (!inst.flags.aura) combatEnd = Math.max(combatEnd, sim.time + dur);
      },
    });
  },

  // Grasp of the Undying
  8437: (rune) => {
    let readyAt = -Infinity;
    const v = rune.values;
    return base(rune, {
      description: 'After 4s in combat, the next attack on a champion deals 3.5% of your max health as magic damage (ranged 40%).',
      options: [{ key: 'grasp.charged', label: 'Grasp charged at start', default: 1, min: 0, max: 1, step: 1 }, IN_COMBAT],
      onStart(sim) {
        readyAt = (sim.opt['grasp.charged'] ?? 1) ? -Infinity : sim.combatStart + v.TriggerTime;
      },
      onAttack(sim, atk) {
        if (atk.phantom || sim.time < readyAt) return;
        readyAt = sim.time + v.TriggerTime;
        atk.extra.push({
          source: `rune:${rune.id}`,
          sourceLabel: rune.name,
          label: 'Grasp',
          type: 'magic',
          amount: calc(sim, rune, 'DamageCalc'),
          // Not reduced by on-hit effectiveness (Urgot W, Akshan E…).
          flags: { kind: 'rune', proc: true, onHit: true, fullOnHit: true },
        });
      },
    });
  },

  // Aftershock
  8439: (rune) => {
    const v = rune.values;
    return base(rune, {
      description: 'Immobilizing a champion detonates after 2.5s for magic damage (+8% bonus health); applies spell effects.',
      onCrowdControl(sim, cc) {
        if (cc.kind !== 'immobilize' || !sim.isReady(`rune:${rune.id}`)) return;
        sim.startCooldown(`rune:${rune.id}`, v.Cooldown);
        sim.schedule(v.DelayBeforeBurst, () =>
          sim.deal({
            source: `rune:${rune.id}`,
            sourceLabel: rune.name,
            label: 'Shockwave',
            type: 'magic',
            amount: calc(sim, rune, 'DamageCalc'),
            flags: { kind: 'rune', ability: true, aoe: true },
          }),
        );
      },
    });
  },

  8465: (rune) => base(rune, { description: 'Shields; no damage.' }),
  8351: (rune) => base(rune, { description: 'Slow zones; no damage dealt.' }),
  8360: (rune) => base(rune, { description: 'Summoner spell swaps; not modeled.' }),

  // First Strike
  8369: (rune) => {
    let windowEnd = -Infinity;
    let started = false;
    const v = rune.values;
    return base(rune, {
      description: 'If you damage the champion first, for 3s your damage also deals 7% of it as true damage (lands 0.4s later).',
      options: [{ key: 'firstStrike.active', label: 'First Strike: you hit first', default: 1, min: 0, max: 1, step: 1 }],
      limitations: ['The 7% bonus is not itself amplified by damage modifiers (unverified in-game).'],
      afterDamage(sim, inst) {
        if (inst.source === `rune:${rune.id}`) return;
        if (!(sim.opt['firstStrike.active'] ?? 1)) return;
        if (!started) {
          started = true;
          windowEnd = sim.time + v.Duration;
        }
        if (sim.time > windowEnd) return;
        const bonus = (inst.final ?? 0) * v.DamageAmp;
        if (bonus <= 0) return;
        sim.schedule(0.4, () =>
          sim.deal({
            source: `rune:${rune.id}`,
            sourceLabel: rune.name,
            label: 'Bonus',
            type: 'true',
            amount: bonus,
            flags: { kind: 'rune', proc: true, unamplified: true },
          }),
        );
      },
    });
  },

  // ---------------------------------------------------------------- Precision minors
  // Coup de Grace (health checked before the hit)
  8014: (rune) =>
    base(rune, {
      description: '+8% damage to champions below 40% health.',
      beforeDamage(sim, inst) {
        if (inst.flags.unamplified) return;
        if (Math.max(0, sim.target.hp) / sim.target.maxHp < rune.values.EnemyHealthPercentageThreshold)
          inst.amps.push({ id: `rune:${rune.id}`, source: rune.name, value: rune.values.BonusPercentDamage, kind: 'dealt' });
      },
    }),
  // Cut Down
  8017: (rune) =>
    base(rune, {
      description: '+8% damage to champions above 60% health.',
      beforeDamage(sim, inst) {
        if (inst.flags.unamplified) return;
        if (Math.max(0, sim.target.hp) / sim.target.maxHp > rune.values.EnemyHealthPercentageThreshold)
          inst.amps.push({ id: `rune:${rune.id}`, source: rune.name, value: rune.values.BonusPercentDamage, kind: 'dealt' });
      },
    }),
  // Last Stand (depends on your own health)
  8299: (rune) =>
    base(rune, {
      description: '+5% to +11% damage while you are below 60% health (your health is option self.hpPercent).',
      options: [SELF_HP],
      beforeDamage(sim, inst) {
        if (inst.flags.unamplified) return;
        const v = rune.values;
        const hp = selfHp(sim.opt);
        if (hp >= v.HealthThresholdStart) return;
        const t = Math.min(1, Math.max(0, (v.HealthThresholdStart - hp) / (v.HealthThresholdStart - v.HealthThresholdEnd)));
        inst.amps.push({ id: `rune:${rune.id}`, source: rune.name, value: v.MinBonusDamagePercent + (v.MaxBonusDamagePercent - v.MinBonusDamagePercent) * t, kind: 'dealt' });
      },
    }),
  // Legend: Alacrity
  9104: (rune) =>
    base(rune, {
      description: 'Attack speed per Legend stack.',
      options: [{ key: 'legend.stacks', label: 'Legend stacks', default: 10, min: 0, max: rune.values.MaxLegendStacks }],
      stats(ctx) {
        const v = rune.values;
        const n = Math.min(v.MaxLegendStacks, ctx.opt['legend.stacks'] ?? 10);
        return { attackSpeed: v.AttackSpeedBase + v.AttackSpeedPerStack * n };
      },
    }),
  // Legend: Haste
  9105: (rune) =>
    base(rune, {
      description: 'Basic ability haste per Legend stack.',
      options: [{ key: 'legend.stacks', label: 'Legend stacks', default: 10, min: 0, max: rune.values.MaxLegendStacks }],
      stats(ctx) {
        const v = rune.values;
        const n = Math.min(v.MaxLegendStacks, ctx.opt['legend.stacks'] ?? 10);
        return { basicAbilityHaste: v.HasteBase + v.HastePerStack * n };
      },
    }),
  // Legend: Bloodline
  9103: (rune) =>
    base(rune, {
      description: 'Life steal per Legend stack; +85 health at 15 stacks.',
      options: [{ key: 'legend.stacks', label: 'Legend stacks', default: 10, min: 0, max: rune.values.MaxLegendStacks }],
      stats(ctx) {
        const v = rune.values;
        const n = Math.min(v.MaxLegendStacks, ctx.opt['legend.stacks'] ?? 10);
        return { lifeSteal: (v.LifeStealPerStack * n) / 100, hp: n >= v.MaxLegendStacks ? v.BonusHealth : 0 };
      },
    }),

  // ---------------------------------------------------------------- Domination minors
  // Cheap Shot
  8126: (rune) =>
    base(rune, {
      description: 'Damaging a champion that is already slowed/immobilized/impaired deals bonus true damage (4s cooldown).',
      limitations: ['Only crowd control applied by your modeled abilities counts.'],
      afterDamage(sim, inst) {
        if (inst.flags.proc || !sim.isReady(`rune:${rune.id}`)) return;
        if (!sim.targetHasCC(['immobilize', 'slow', 'impair'], inst.castId)) return;
        sim.startCooldown(`rune:${rune.id}`, rune.values.Cooldown);
        sim.deal({ source: `rune:${rune.id}`, sourceLabel: rune.name, label: 'Cheap Shot', type: 'true', amount: calc(sim, rune, 'DamageCalc'), flags: { kind: 'rune', proc: true } });
      },
    }),
  8139: (rune) => base(rune, { description: 'Heal; no damage.' }),
  // Sudden Impact
  8143: (rune) => {
    let armedUntil = -Infinity;
    const v = rune.values;
    const key = `rune:${rune.id}`;
    // Dashes don't arm it again until the cooldown after the bonus damage has run out (wiki).
    const arm = (sim: Sim) => {
      if (sim.isReady(key)) armedUntil = sim.time + v.ArmedDuration;
    };
    return base(rune, {
      description: 'After a dash/blink (or Flash), the next damage within 4s deals bonus true damage (10s cooldown; dashes during it do nothing).',
      options: [{ key: 'suddenImpact.armed', label: 'Sudden Impact armed at start (Flash/dash in)', default: 0, min: 0, max: 1, step: 1 }],
      onStart(sim) {
        if (sim.opt['suddenImpact.armed']) arm(sim);
      },
      onCast(sim, cast) {
        if (cast.dash) arm(sim);
      },
      afterDamage(sim, inst) {
        if (inst.source === key || sim.time > armedUntil) return;
        armedUntil = -Infinity;
        sim.startCooldown(key, v.Cooldown);
        sim.deal({ source: `rune:${rune.id}`, sourceLabel: rune.name, label: 'Sudden Impact', type: 'true', amount: calc(sim, rune, 'BaseDamage'), flags: { kind: 'rune', proc: true } });
      },
    });
  },
  // Ultimate Hunter
  8106: (rune) =>
    base(rune, {
      description: 'Ultimate haste per unique champion takedown.',
      options: [{ key: 'ultimateHunter.stacks', label: 'Ultimate Hunter stacks', default: 0, min: 0, max: 5 }],
      stats(ctx) {
        return { ultimateHaste: rune.values.StartingUltAH + rune.values.AdditionalUltAH * Math.min(5, ctx.opt['ultimateHunter.stacks'] ?? 0) };
      },
    }),

  // ---------------------------------------------------------------- Sorcery minors
  // Axiom Arcanist
  8224: (rune) =>
    base(rune, {
      description: 'Ultimate damage +12% (+8% if the ultimate damage is area).',
      beforeDamage(sim, inst) {
        if (inst.flags.slot !== 'R' || inst.flags.kind !== 'ability' || inst.flags.unamplified) return;
        inst.amps.push({ id: `rune:${rune.id}`, source: rune.name, value: inst.flags.aoe ? rune.values.AOEAmp : rune.values.DamageAmp, kind: 'dealt' });
      },
    }),
  // Scorch
  8237: (rune) =>
    base(rune, {
      description: 'Ability damage burns the champion for magic damage after 1s (10s cooldown).',
      afterDamage(sim, inst) {
        if (!inst.flags.ability || inst.flags.proc || !sim.isReady(`rune:${rune.id}`)) return;
        sim.startCooldown(`rune:${rune.id}`, rune.values.BurnlockoutDuration);
        sim.schedule(rune.values.DotDuration, () =>
          sim.deal({ source: `rune:${rune.id}`, sourceLabel: rune.name, label: 'Scorch', type: 'magic', amount: calc(sim, rune, 'DamageCalc'), flags: { kind: 'rune', proc: true, dot: true } }),
        );
      },
    }),
  // Gathering Storm
  8236: (rune) =>
    base(rune, {
      description: 'Adaptive force every 10 minutes (8, 24, 48, 80… AP).',
      options: [GAME_TIME],
      stats(ctx) {
        // Tier k (every 10 minutes) adds k × 8 adaptive force: 8, 24, 48, 80…
        const k = Math.floor((ctx.opt['gameTime'] ?? 20) / rune.values.UpdateAfterMinutes);
        return { adaptive: (rune.values.AdaptiveAP * k * (k + 1)) / 2 };
      },
    }),
  // Absolute Focus
  8233: (rune) =>
    base(rune, {
      description: 'Adaptive force while above 70% health.',
      options: [SELF_HP],
      stats(ctx) {
        if (selfHp(ctx.opt) <= rune.values.HealthPercent) return;
        return { adaptive: lerpLevel(ctx.level, rune.values.MinAdaptive, rune.values.MaxAdaptive) };
      },
    }),
  // Waterwalking
  8232: (rune) =>
    base(rune, {
      description: 'Adaptive force and move speed in the river.',
      options: [{ key: 'waterwalking.inRiver', label: 'In river', default: 0, min: 0, max: 1, step: 1 }],
      stats(ctx) {
        if (!ctx.opt['waterwalking.inRiver']) return;
        return { adaptive: lerpLevel(ctx.level, rune.values.MinAdaptive, rune.values.MaxAdaptive), msFlat: rune.values.MovementSpeed };
      },
    }),
  // Transcendence
  8210: (rune) =>
    base(rune, {
      description: '+5 ability haste at level 5 and 8.',
      stats(ctx) {
        const v = rune.values;
        return { abilityHaste: (ctx.level >= v.LevelToTurnOn ? v.HasteBonus1 * 100 : 0) + (ctx.level >= v.LevelToTurnOn2 ? v.HasteBonus2 * 100 : 0) };
      },
    }),
  8234: (rune) => base(rune, { description: 'Move speed; no damage.', stats: () => ({ msPercent: 0.01 }) }),

  // ---------------------------------------------------------------- Resolve minors
  // Conditioning
  8429: (rune) =>
    base(rune, {
      description: '+8 armor/MR and +3% resists after 12 minutes.',
      options: [GAME_TIME],
      stats(ctx) {
        const v = rune.values;
        if ((ctx.opt['gameTime'] ?? 20) < v.MinutesRequired) return;
        return { armor: v.ArmorBase, mr: v.MRBase, armorMult: [1 + v.ExtraResist], mrMult: [1 + v.ExtraResist] };
      },
    }),
  // Overgrowth
  8451: (rune) =>
    base(rune, {
      description: '+3 health per 8 nearby unit deaths; +3.5% max health at 120.',
      options: [{ key: 'overgrowth.units', label: 'Overgrowth units', default: 120, min: 0, max: 400, step: rune.values.UnitsPerTier }],
      stats(ctx) {
        const v = rune.values;
        const units = ctx.opt['overgrowth.units'] ?? 120;
        return { hp: Math.floor(units / v.UnitsPerTier) * v.FlatHealthPerTier, bonusHpMult: units >= v.ThresholdUnits ? [1 + v.ThresholdMaxHealthRatio] : [] };
      },
      limitations: ['The 3.5% bonus is applied to bonus health only.'],
    }),
  8401: (rune) => base(rune, { description: 'Shield-triggered damage; not modeled (needs shields).', limitations: ['Shield Bash is not modeled.'] }),
  8446: (rune) => base(rune, { description: 'Turret damage; not relevant.' }),

  // ---------------------------------------------------------------- Inspiration minors
  // Jack of All Trades
  8316: (rune) =>
    base(rune, {
      description: '+1 ability haste per unique item stat; +8 adaptive at 5, +20 at 10.',
      stats() {
        return {};
      },
    }),
  // Triple Tonic (Elixir of Skill's skill point: bonusSkillPoints, used for the default ranks)
  8313: (rune, _setup, sim) => {
    const force = findItem(sim.data, ELIXIR_OF_FORCE).dataValues.AdaptiveAmount ?? 0;
    return base(rune, {
      description: `Elixir of Force (level ${rune.values.SecondElixirLevel}): +${force} adaptive force for 60s (option). Elixir of Skill (level ${rune.values.ThirdElixirLevel}): one extra skill point.`,
      options: [{ key: 'tripleTonic.force', label: 'Elixir of Force active', default: 0, min: 0, max: 1, step: 1 }],
      stats(ctx) {
        if (ctx.level >= rune.values.SecondElixirLevel && ctx.opt['tripleTonic.force']) return { adaptive: force };
      },
    });
  },
  // Biscuit Delivery
  8345: (rune) =>
    base(rune, {
      description: '+30 max health per biscuit eaten.',
      options: [{ key: 'biscuits', label: 'Biscuits eaten', default: 3, min: 0, max: 3 }],
      stats(ctx) {
        return { hp: rune.values.PermanentHP * (ctx.opt['biscuits'] ?? 3) };
      },
    }),
  8347: (rune) => base(rune, { description: 'Summoner and item haste.' }),

  // ---------------------------------------------------------------- Stat shards
  5008: (rune) => base(rune, { stats: () => ({ adaptive: rune.values.StatGain2 }) }),
  5005: (rune) => base(rune, { stats: () => ({ attackSpeed: rune.values.StatGain / 100 }) }),
  5007: (rune) => base(rune, { stats: () => ({ abilityHaste: rune.values.HasteGain }) }),
  5010: (rune) => base(rune, { stats: () => ({ msPercent: rune.values.StatGain1 / 100 }) }),
  5001: (rune) => base(rune, { stats: (ctx) => ({ hp: levelScaled(rune, ctx.level) }) }),
  5011: (rune) => base(rune, { stats: () => ({ hp: rune.values.StatGain }) }),
  5013: (rune) => base(rune, { stats: () => ({ tenacity: rune.values.StatGain / 100 }) }),
};

const ELIXIR_OF_FORCE = 2152;

/** Skill points beyond one per level: Triple Tonic's Elixir of Skill (consumed at level 9). */
export function bonusSkillPoints(runes: RuneData[], level: number): number {
  const tonic = runes.find((r) => r.id === 8313);
  return tonic && level >= tonic.values.ThirdElixirLevel ? 1 : 0;
}

/** Runes that exist in the data but are not live on Summoner's Rift (16.20). */
export const NOT_LIVE_RUNES = new Set([8124, 8134, 8136, 8120, 8138, 8359, 8339, 8472, 8430, 8435, 5002, 5003, 5004, 5006, 5009, 5012]);

export function createRuneEffects(runes: RuneData[], setup: SetupCtx, sim: Sim): Effect[] {
  const out: Effect[] = [];
  let shardIndex = 0;
  for (const r of runes) {
    if (NOT_LIVE_RUNES.has(r.id)) sim.warn(`${r.name} is not available on Summoner's Rift in this patch`);
    const f = RUNES[r.id];
    if (!f) {
      sim.note(`${r.name}: no combat effect modeled.`);
      continue;
    }
    const eff = f(r, setup, sim);
    if (!eff) continue;
    // Shards can be taken more than once; give each its own id.
    if (r.tree === 'Shards') eff.id = `${eff.id}#${shardIndex++}`;
    else if (out.some((e) => e.id === eff.id)) continue;
    out.push(eff);
  }
  // Jack of All Trades needs the item list.
  const jack = out.find((e) => e.id === 'rune:8316');
  if (jack) {
    const rune = runes.find((r) => r.id === 8316)!;
    jack.stats = () => {
      const types = new Set<string>();
      for (const it of sim.items) for (const k of Object.keys(it.stats)) if (ITEM_STAT_TYPES.has(k)) types.add(k === 'msFlat' || k === 'msPercent' ? 'ms' : k);
      const n = types.size;
      const v = rune.values;
      const mods: Partial<StatMods> = { abilityHaste: n * v.HastePerStack };
      if (n >= 10) mods.adaptive = v.Adaptive10;
      else if (n >= 5) mods.adaptive = v.Adaptive5;
      return mods;
    };
  }
  return out;
}

export function hasRuneModel(id: number): boolean {
  return id in RUNES;
}
