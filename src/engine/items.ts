// Item passives and actives for patch 16.20.
//
// Numbers come from each item's game data (data values + calculations); this file only encodes
// *behaviour*: what triggers a passive, how it stacks, and which damage category it is.
// Behaviour sources: the in-game tooltips and docs/research/items.md.

import type { ItemData } from "./data-types.ts";
import {
  addOnHitRepeat,
  DISTANCE,
  forceCrit,
  IN_COMBAT,
  optStacks,
  pct,
  SELF_HP,
  selfHp,
  startStacks,
  type AttackInfo,
  type DamageInstance,
  type DamageRequest,
  type Effect,
  type SetupCtx,
} from "./effects.ts";
import type { KitOption } from "./kit-types.ts";
import type { Sim } from "./sim.ts";
import type { StatMods } from "./stats.ts";

type Factory = (item: ItemData, setup: SetupCtx, sim: Sim) => Effect | null;

/** Item stat keys that count as distinct "stat types" (Jack of All Trades). */
export const ITEM_STAT_TYPES = new Set([
  "ad",
  "range",
  "attackSpeed",
  "abilityHaste",
  "ap",
  "armor",
  "armorPenPercent",
  "critChance",
  "critDamage",
  "healShieldPower",
  "hp",
  "baseHpRegen",
  "lifeSteal",
  "lethality",
  "magicPenFlat",
  "magicPenPercent",
  "mr",
  "mana",
  "baseMpRegen",
  "msFlat",
  "msPercent",
  "omnivamp",
  "tenacity",
]);

const dv = (item: ItemData, name: string) => item.dataValues[name] ?? 0;
const calc = (sim: Sim, item: ItemData, name: string) => sim.evalDataCalc(item.calcs, item.dataValues, name);
const lerpLevel = (level: number, a: number, b: number) => a + ((b - a) * (level - 1)) / 17;

function effect(item: ItemData, extra: Partial<Effect>): Effect {
  return { id: `item:${item.id}`, label: item.name, source: "item", ...extra };
}

function hit(item: ItemData, label: string, type: DamageRequest["type"], amount: number, flags: DamageRequest["flags"] = {}): DamageRequest {
  return { source: `item:${item.id}`, sourceLabel: item.name, label, type, amount, flags: { kind: "item", proc: true, ...flags } };
}

/** "Ability damage" from any source, incl. item actives like Rocketbelt (not item/rune procs). */
const isAbilityDamage = (inst: DamageInstance) => (inst.flags.ability && !inst.flags.proc) || inst.flags.pet;
/** Damage from a champion ability (Shojin, Bastionbreaker, Actualizer… need this). */
const isChampionAbilityDamage = (inst: DamageInstance) => inst.flags.kind === "ability" && ((inst.flags.ability && !inst.flags.proc) || inst.flags.pet);

/** End time stored in a counter by a timed effect; -Infinity if it never started. */
const timerEnd = (sim: Sim, key: string) => sim.counters.get(key) ?? -Infinity;

/**
 * Seconds in combat with champions, for "+X% per second in combat" passives. Combo start counts as
 * entering combat; `window` seconds without dealing damage drop you out of it (the count restarts).
 */
function combatTimer(window: number) {
  let start: number | undefined;
  let last = 0;
  return {
    seconds(sim: Sim) {
      start ??= sim.combatStart;
      if (sim.time - last > window) start = sim.time;
      return sim.time - start;
    },
    hit(sim: Sim, inst: DamageInstance) {
      if (!inst.flags.aura) last = sim.time;
    },
  };
}

// -----------------------------------------------------------------------------
// Spellblade (Sheen family). Only one Spellblade item works at a time.

function spellblade(
  item: ItemData,
  dmg: (sim: Sim) => { type: "physical" | "magic"; amount: number },
  opts: { repeatOnHit?: boolean; onProc?: (sim: Sim, castId: number) => void; attackSpeedWhileReady?: number } = {},
): Effect {
  let empoweredUntil = -Infinity;
  const cd = dv(item, "SpellbladeCooldown") || dv(item, "Cooldown") || 1.5;
  const ready = (sim: Sim) => empoweredUntil >= sim.time && sim.isReady("spellblade");
  return {
    id: "item:spellblade",
    label: item.name,
    source: "item",
    description: `After casting an ability, the next attack within 10s deals bonus damage on-hit (${cd}s cooldown).${opts.attackSpeedWhileReady ? ` +${opts.attackSpeedWhileReady * 100}% attack speed while empowered.` : ""}`,
    dynamicStats(sim) {
      if (opts.attackSpeedWhileReady && ready(sim)) return { attackSpeed: opts.attackSpeedWhileReady };
    },
    onCast(sim, cast) {
      if (cast.item || cast.noSpellblade) return; // item actives (Rocketbelt) aren't abilities
      if (sim.isReady("spellblade")) {
        empoweredUntil = sim.time + (dv(item, "SpellBladeDuration") || 10);
        sim.invalidateStats();
      }
    },
    preAttack(sim, atk) {
      if (opts.repeatOnHit && ready(sim) && !atk.phantom) addOnHitRepeat(atk);
    },
    onAttack(sim, atk) {
      if (atk.phantom || !ready(sim)) return;
      empoweredUntil = -Infinity;
      sim.startCooldown("spellblade", cd);
      sim.invalidateStats();
      const d = dmg(sim);
      atk.extra.push(hit(item, "Spellblade", d.type, d.amount, { onHit: true }));
      opts.onProc?.(sim, atk.castId);
    },
  };
}

// -----------------------------------------------------------------------------
// Energized attacks (Rapid Firecannon, Statikk Shiv, Stormrazor, Voltaic Cyclosword): when you're
// Energized, the next attack is Energized and every Energized item fires on it; Voltaic's Galvanize
// lets champion-ability damage fire them. You're Energized as the combo starts (an option), and again
// after an `energize` step (the game's Energize charges, mostly from moving, aren't simulated). They
// land together: Voltaic's Firmament before the attack's damage (wiki), the rest, being
// on-hit damage, first of its on-hits, right after it; fired by an ability, all before it, Firmament
// first.

/** The Energized items, which are Energized together. */
export const ENERGIZED_ITEMS = [3087, 3094, 3095, 6699];
/** 1 while you're Energized. */
const ENERGY_KEY = "energized";
/** Declared by each Energized item, so the option is credited to the items rather than the shared effect. */
const ENERGY_START: KitOption = {
  key: "energized.ready",
  label: "Energized at start",
  default: 1,
  min: 0,
  max: 1,
  step: 1,
  description: "The combo's first attack (or Voltaic's Galvanize) fires your Energized items. An energize step in the combo makes you Energized again.",
};

/** Energized item procs, registered by item id. */
const energizedProcs = new WeakMap<Sim, ((sim: Sim, push: (r: DamageRequest) => void) => void)[]>();

function registerEnergized(sim: Sim, proc: (sim: Sim, push: (r: DamageRequest) => void) => void) {
  const list = energizedProcs.get(sim) ?? [];
  list.push(proc);
  energizedProcs.set(sim, list);
}

/** Makes you Energized (the combo's energize step); false without an Energized item. */
export function energize(sim: Sim): boolean {
  if (!energizedProcs.get(sim)?.length) return false;
  sim.setCounter(ENERGY_KEY, 1);
  return true;
}

/** Every Energized item's hit, worked out before any lands (Firmament's current health is the
 *  target's before the attack): Firmament first. You're no longer Energized. */
function fireEnergized(sim: Sim): DamageRequest[] {
  sim.setCounter(ENERGY_KEY, 0);
  const hits: DamageRequest[] = [];
  for (const p of energizedProcs.get(sim) ?? []) p(sim, (r) => hits.push(r));
  return [...hits.filter((r) => r.beforeAttack), ...hits.filter((r) => !r.beforeAttack)];
}

/** An attack's Energized hits: Firmament before its damage, the rest first of its on-hits. */
function energizeAttack(sim: Sim, atk: AttackInfo) {
  for (const r of fireEnergized(sim)) atk.extra.push(r.beforeAttack ? r : { ...r, firstOnHit: true });
}

function energyEffect(): Effect {
  /** Attacks launched Energized, until they hit. */
  const energizedAttacks = new Set<number>();
  return {
    id: "item:energized",
    label: "Energized",
    source: "item",
    description: "The first attack is Energized (an option), and the next after each energize step in the combo.",
    limitations: ["The game's Energize charges, mostly from moving, aren't simulated: an energize step in the combo makes you Energized."],
    onStart(sim) {
      sim.setCounter(ENERGY_KEY, (sim.opt[ENERGY_START.key] ?? ENERGY_START.default) ? 1 : 0);
    },
    // The Energized proc applies on-hit, to the attack launched while Energized (wiki "Attack
    // effects": Rapid Firecannon damage on-hit); abilities that apply on-hit use it as they hit.
    onLaunch(sim, launch) {
      if (launch.fromAbility || !sim.counter(ENERGY_KEY)) return;
      energizedAttacks.add(launch.castId);
      sim.setCounter(ENERGY_KEY, 0);
    },
    onAttack(sim, atk) {
      if (atk.phantom) return;
      if (energizedAttacks.delete(atk.castId) || (atk.fromAbility && sim.counter(ENERGY_KEY))) energizeAttack(sim, atk);
    },
  };
}

function energized(
  item: ItemData,
  sim: Sim,
  proc: (sim: Sim, push: (r: DamageRequest) => void) => void,
  description: string,
  extra: Partial<Effect> = {},
): Effect {
  registerEnergized(sim, proc);
  return effect(item, { description, options: [ENERGY_START], ...extra });
}

// -----------------------------------------------------------------------------
// Burns (Liandry's, Blackfire Torch, Fated Ashes): refreshed by ability damage, tick every 0.5s.
// Ticks that only aura damage (Unending Despair) sustained don't keep you in combat, so an aura and
// a burn can't keep each other going after the fight.

function burn(item: ItemData, sim: Sim, trigger: DamageInstance, label: string, perSecond: (sim: Sim) => number, duration: number, tick = 0.5) {
  const key = `burn:${item.id}`;
  const endKey = `${key}:end`;
  const combatKey = `${key}:combatEnd`;
  const active = sim.counter(key) === 1;
  sim.setCounter(endKey, sim.time + duration);
  if (!trigger.flags.aura) sim.setCounter(combatKey, sim.time + duration);
  if (active) return;
  sim.setCounter(key, 1);
  const step = () => {
    if (sim.time > sim.counter(endKey) + 1e-9) {
      sim.setCounter(key, 0);
      sim.invalidateStats();
      return;
    }
    sim.deal(hit(item, label, "magic", perSecond(sim) * tick, { dot: true, ...(sim.time > timerEnd(sim, combatKey) + 1e-9 ? { aura: true } : {}) }));
    sim.schedule(tick, step);
  };
  sim.schedule(tick, step);
}

// -----------------------------------------------------------------------------

const ITEMS: Record<number, Factory> = {
  // ------------------------------------------------------------ Spellblade
  3057: (item) => spellblade(item, (sim) => ({ type: "physical", amount: calc(sim, item, "SpellbladeDamage") })),
  3078: (item) => spellblade(item, (sim) => ({ type: "physical", amount: calc(sim, item, "SpellbladeDamage") })),
  3100: (item) =>
    spellblade(item, (sim) => ({ type: "magic", amount: calc(sim, item, "SpellbladeDamage") }), { attackSpeedWhileReady: dv(item, "SheenASBuff") }),
  6662: (item) =>
    spellblade(item, (sim) => ({ type: "physical", amount: calc(sim, item, "SpellbladeDamage") }), {
      // The frost field is part of the attack's cast instance: it adds no Electrocute stack (in game, 16.20).
      onProc: (sim, castId) => sim.applyCC("slow", dv(item, "SlowFieldDuration"), castId),
    }),
  3508: (item) => spellblade(item, (sim) => ({ type: "physical", amount: calc(sim, item, "SpellbladeDamage") })),
  2510: (item) => spellblade(item, (sim) => ({ type: "magic", amount: calc(sim, item, "SpellbladeDamage") }), { repeatOnHit: true }),

  // Bloodsong: Spellblade + Expose Weakness (target takes more damage from all sources).
  3877: (item, setup) => {
    const base = spellblade(item, (sim) => ({ type: "physical", amount: calc(sim, item, "SpellbladeDamage") }), {
      onProc: (sim) => sim.setCounter(`expose:${item.id}`, sim.time + dv(item, "DebuffDuration")),
    });
    return {
      ...base,
      description: `${base.description} Spellblade hits expose the target: +${setup.ranged ? 5 : 8}% damage taken for 4s.`,
      beforeDamage(sim, inst) {
        // The triggering attack already benefits (wiki).
        if (sim.time <= timerEnd(sim, `expose:${item.id}`) || (inst.label === "Spellblade" && inst.source === `item:${item.id}`))
          inst.amps.push({
            id: `item:${item.id}`,
            source: `${item.name} (Expose Weakness)`,
            value: setup.ranged ? dv(item, "RangedDamageAmp") : dv(item, "MeleeDamageAmp"),
            kind: "taken",
          });
      },
    };
  },

  // ------------------------------------------------------------ On-hit
  1043: (item) =>
    effect(item, {
      description: "Attacks deal bonus physical damage on-hit.",
      onAttack(sim, atk) {
        atk.extra.push(hit(item, "On-hit", "physical", dv(item, "OnHitDamage"), { onHit: true }));
      },
    }),
  3153: (item, setup) =>
    effect(item, {
      description: `Attacks deal ${setup.ranged ? 6 : 9}% of the target's current health as physical damage on-hit.`,
      onAttack(sim, atk) {
        const pct = setup.ranged ? dv(item, "RangedValue") : dv(item, "MeleeValue");
        atk.extra.push(hit(item, "Mist's Edge", "physical", pct * Math.max(0, sim.target.hp), { onHit: true }));
        const n = sim.counter(`botrk:${item.id}`) + 1;
        if (n >= 3 && sim.isReady(`item:${item.id}`)) {
          sim.setCounter(`botrk:${item.id}`, 0);
          sim.startCooldown(`item:${item.id}`, dv(item, "Cooldown"));
          sim.schedule(1e-3, () => sim.applyCC("slow", dv(item, "MoveSpeedDuration"), atk.castId));
        } else sim.setCounter(`botrk:${item.id}`, n);
      },
    }),
  3115: (item) =>
    effect(item, {
      description: "Attacks deal bonus magic damage on-hit.",
      onAttack(sim, atk) {
        atk.extra.push(hit(item, "Icathian Bite", "magic", calc(sim, item, "TotalOnHitDamage"), { onHit: true }));
      },
    }),
  3091: (item) =>
    effect(item, {
      description: "Attacks deal bonus magic damage on-hit.",
      onAttack(sim, atk) {
        atk.extra.push(hit(item, "Fray", "magic", calc(sim, item, "OnHitDamage"), { onHit: true }));
      },
    }),
  3302: (item) => {
    let attacks = 0;
    let darkStacks = 0;
    let darkUntil = -Infinity;
    // A Dark attack's new stack applies only after its own hit (stats can be recomputed mid-attack).
    let lastDarkAt = -Infinity;
    let stacksBefore = 0;
    const maxDark = Math.round(dv(item, "PenMax") / dv(item, "PenPerHit"));
    const start = startStacks(
      item.name,
      "terminus.stacks",
      maxDark,
      `Dark stacks from attacks just before the combo, lasting ${dv(item, "BuffDuration")}s: ${pct(dv(item, "PenPerHit"))}% armor and magic penetration each. The combo's first attack is Light.`,
    );
    return effect(item, {
      description: "On-hit magic damage. Alternating Light/Dark attacks: Dark attacks grant 10% armor and magic penetration (max 30%) for 5s.",
      options: [start],
      onStart(sim) {
        darkStacks = optStacks(sim, start);
        darkUntil = sim.time + dv(item, "BuffDuration");
        sim.invalidateStats();
      },
      dynamicStats(sim) {
        const n = Math.abs(sim.time - lastDarkAt) < 1e-9 ? stacksBefore : darkStacks;
        if (sim.time > darkUntil || n <= 0) return;
        const pen = Math.min(dv(item, "PenMax"), n * dv(item, "PenPerHit"));
        return { armorPenPercent: [pen], magicPenPercent: [pen] };
      },
      onAttack(sim, atk) {
        atk.extra.push(hit(item, "Shadow", "magic", calc(sim, item, "OnHitDamage"), { onHit: true }));
        if (atk.phantom) return;
        attacks++;
        if (sim.time > darkUntil) darkStacks = 0;
        if (attacks % 2 === 0) {
          stacksBefore = darkStacks;
          darkStacks = Math.min(maxDark, darkStacks + 1);
          darkUntil = sim.time + dv(item, "BuffDuration");
          lastDarkAt = sim.time;
          sim.schedule(1e-4, () => sim.invalidateStats());
        }
      },
    });
  },
  3124: (item) => {
    let stacks = 0;
    let until = -Infinity;
    let count = 0;
    /** Attacks launched at max stacks whose on-hit effects apply twice (Phantom Hit). */
    const phantom = new Set<number>();
    const max = dv(item, "MaxStacks");
    // Past full stacks, the count goes on as Phantom Hit's: its every third attack at full stacks.
    const start = startStacks(
      item.name,
      "guinsoo.stacks",
      max + 2,
      `Seething Strike stacks from attacks just before the combo, lasting ${dv(item, "BuffDuration")}s: +${pct(dv(item, "AttackSpeedPerStack"))}% attack speed each, up to ${max}. Past ${max} they count toward Phantom Hit, every third attack at full stacks: at ${max + 2} the first attack is one.`,
    );
    return effect(item, {
      description: "On-hit magic damage; attacks stack attack speed (4×8%). At max stacks every third attack applies on-hit effects twice.",
      options: [start],
      onStart(sim) {
        const n = optStacks(sim, start);
        stacks = Math.min(max, n);
        count = n - stacks;
        until = sim.time + dv(item, "BuffDuration");
        sim.invalidateStats();
      },
      dynamicStats(sim) {
        if (sim.time > until || !stacks) return;
        return { attackSpeed: stacks * dv(item, "AttackSpeedPerStack") };
      },
      onLaunch(sim, launch) {
        if (sim.time > until) {
          stacks = 0;
          count = 0;
        }
        if (stacks >= max) {
          count++;
          if (count % 3 === 0) phantom.add(launch.castId);
        }
        stacks = Math.min(max, stacks + 1);
        until = sim.time + dv(item, "BuffDuration");
        sim.invalidateStats();
      },
      preAttack(sim, atk) {
        if (!atk.phantom && phantom.delete(atk.castId)) addOnHitRepeat(atk);
      },
      onAttack(sim, atk) {
        atk.extra.push(hit(item, "Wrath", "magic", dv(item, "OnHitDamage"), { onHit: true }));
      },
    });
  },
  6672: (item) => {
    let stacks = 0;
    let until = -Infinity;
    const ready = dv(item, "AttackCount") - 1;
    const start = startStacks(
      item.name,
      "kraken.stacks",
      ready,
      `Bring It Down stacks from attacks just before the combo, lasting ${dv(item, "BuffDuration")}s: at ${ready} the first attack procs.`,
    );
    return effect(item, {
      description: "Every third attack deals bonus physical damage on-hit, up to +75% against low-health targets.",
      limitations: ["Damage increase assumed linear with the target's missing health %."],
      options: [start],
      onStart(sim) {
        stacks = optStacks(sim, start);
        until = sim.time + dv(item, "BuffDuration");
      },
      onAttack(sim, atk) {
        if (sim.time > until) stacks = 0;
        until = sim.time + dv(item, "BuffDuration");
        // Guinsoo's Phantom Hit adds a stack but never consumes them.
        if (atk.phantom || stacks < ready) {
          stacks = Math.min(ready, stacks + 1);
          return;
        }
        stacks = 0;
        const missing = 1 - Math.max(0, sim.target.hp) / sim.target.maxHp;
        const amount = calc(sim, item, "DamageAmount") * (1 + (dv(item, "MaxAmpNumber") - 1) * missing);
        atk.extra.push(hit(item, "Bring It Down", "physical", amount, { onHit: true, basic: true }));
      },
    });
  },
  3181: (item) => {
    let n = 0;
    let lastAttack = -Infinity;
    const start = startStacks(
      item.name,
      "hullbreaker.stacks",
      4,
      `Skipper stacks from attacks on champions just before the combo, lasting ${dv(item, "SkipperStackDuration")}s: at 4 the first attack procs.`,
    );
    return effect(item, {
      description: "Every fifth attack against champions deals bonus physical damage (stacks last 10s).",
      options: [start],
      onStart(sim) {
        n = optStacks(sim, start);
        lastAttack = sim.time;
      },
      onAttack(sim, atk) {
        if (atk.phantom) return;
        if (sim.time - lastAttack > dv(item, "SkipperStackDuration")) n = 0;
        lastAttack = sim.time;
        n++;
        if (n % 5 !== 0) return;
        atk.extra.push(hit(item, "Skipper", "physical", calc(sim, item, "MaxStackDamage"), { onHit: true }));
      },
    });
  },
  3748: (item) => {
    let empoweredUntil = -Infinity;
    const cd = dv(item, "Cooldown");
    return effect(item, {
      description: `Attacks deal 1% max health physical damage on-hit (ranged 0.5%). Active: within 10s the next attack's Cleave deals 4% max health instead (${cd}s cooldown, starting once it's used).`,
      onAttack(sim, atk) {
        if (sim.time <= empoweredUntil && !atk.phantom) {
          empoweredUntil = -Infinity;
          sim.startCooldown(`active:item:${item.id}`, cd);
          atk.extra.push(hit(item, "Titanic Crescent", "physical", calc(sim, item, "CalcValueC"), { onHit: true }));
          return;
        }
        atk.extra.push(hit(item, "Cleave", "physical", calc(sim, item, "OnHitDamageCalc"), { onHit: true }));
      },
      active: {
        label: "Titanic Crescent",
        cooldown: cd,
        cast(sim) {
          empoweredUntil = sim.time + 10;
          // The cooldown starts when the empowered attack is used (or the 10s window ends).
          sim.startCooldown(`active:item:${item.id}`, 10 + cd);
          sim.resetAttack();
        },
      },
    });
  },
  3084: (item) => {
    let ready = true;
    return effect(item, {
      description: "After being near a champion for a few seconds, the next attack deals 70 + 6% max health physical damage (30s per target).",
      options: [
        { key: "heartsteel.ready", label: "Heartsteel charged at start", default: 1, min: 0, max: 1, step: 1 },
        { key: "heartsteel.stacks", label: "Heartsteel bonus health stacked", default: 0, min: 0, max: 3000, step: 10 },
      ],
      stats(ctx) {
        return { hp: ctx.opt["heartsteel.stacks"] ?? 0 };
      },
      onStart(sim) {
        ready = !!(sim.opt["heartsteel.ready"] ?? 1);
      },
      onAttack(sim, atk) {
        if (!ready || atk.phantom) return;
        ready = false;
        atk.extra.push(hit(item, "Colossal Consumption", "physical", calc(sim, item, "DamageProcCalc"), { onHit: true, fullOnHit: true }));
      },
    });
  },
  3742: (item) => {
    let used = false;
    return effect(item, {
      description: "Next attack discharges built-up momentum for bonus physical damage.",
      options: [{ key: "deadmans.stacks", label: "Dead Man's momentum (0-100)", default: 100, min: 0, max: 100 }],
      onAttack(sim, atk) {
        if (used || atk.phantom) return;
        used = true;
        const frac = Math.min(1, (sim.opt["deadmans.stacks"] ?? 100) / dv(item, "MaxStacks"));
        atk.extra.push(hit(item, "Shipwrecker", "physical", calc(sim, item, "MaxDamageCalc") * frac, { onHit: true }));
      },
    });
  },
  3179: (item) => {
    let used = false;
    return effect(item, {
      description: "After being unseen briefly, the next attack against a champion deals bonus true damage.",
      options: [{ key: "umbral.unseen", label: "Umbral Glaive: start unseen", default: 0, min: 0, max: 1, step: 1 }],
      onAttack(sim, atk) {
        if (used || atk.phantom || !sim.opt["umbral.unseen"]) return;
        used = true;
        atk.extra.push(hit(item, "Nightstalker", "true", calc(sim, item, "ProcDamage"), { onHit: true }));
      },
    });
  },
  6610: (item) =>
    effect(item, {
      description: "The first attack against a champion (10s cooldown) is a guaranteed critical strike for 80% of your crit damage, and heals.",
      preAttack(sim, atk) {
        if (atk.fromAbility || atk.phantom || !sim.isReady(`item:${item.id}`)) return;
        sim.startCooldown(`item:${item.id}`, dv(item, "Cooldown"));
        forceCrit(atk, dv(item, "CritModifier"));
      },
    }),
  2512: (item) => {
    let charges = 0;
    let until = -Infinity;
    return effect(item, {
      description:
        "+30 ultimate haste. After your ultimate, the next 3 attacks gain 50% attack speed and crit for 80% damage (or deal +15% true damage if they would crit anyway).",
      stats: () => ({ ultimateHaste: dv(item, "UltimateHaste") }),
      dynamicStats(sim) {
        if (charges > 0 && sim.time <= until) return { attackSpeed: dv(item, "BonusAS") };
      },
      onCast(sim, cast) {
        if (cast.slot !== "R" || !sim.isReady(`item:${item.id}`)) return;
        sim.startCooldown(`item:${item.id}`, dv(item, "Cooldown"));
        charges = dv(item, "NumberOfAttacks");
        until = sim.time + dv(item, "Duration");
        sim.invalidateStats();
      },
      preAttack(sim, atk) {
        // Attacks that can't crit don't use a charge.
        if (atk.fromAbility || atk.phantom || !atk.canCrit || charges <= 0 || sim.time > until) return;
        charges--;
        sim.invalidateStats();
        // Natural crits keep full crit damage and add 15% of the attack as true damage; others crit
        // for 80%. Guaranteed crits (Sundered Sky) don't count as natural.
        forceCrit(atk, dv(item, "CritModifier"), 1);
        const natural = atk.naturalCrit;
        if (natural > 0)
          atk.extra.push(hit(item, "Opening Barrage", "true", natural * dv(item, "BonusTrueDamage") * sim.stats.ad * atk.critMultiplier, { onHit: true }));
      },
    });
  },
  3032: (item) => {
    let flurryUntil = -Infinity;
    return effect(item, {
      description: "Permanently gains crit chance from attacks (up to 25%). Attacking a champion grants 30% attack speed for 6s (30s cooldown).",
      options: [{ key: "yuntal.crit", label: "Yun Tal crit chance stacked (%)", default: 25, min: 0, max: 25 }],
      stats: (ctx) => ({ critChance: Math.min(dv(item, "CritMax"), ctx.opt["yuntal.crit"] ?? 25) / 100 }),
      dynamicStats(sim) {
        if (sim.time <= flurryUntil) return { attackSpeed: dv(item, "ASMod") };
      },
      onLaunch(sim) {
        if (sim.isReady(`item:${item.id}`)) {
          sim.startCooldown(`item:${item.id}`, dv(item, "Cooldown"));
          flurryUntil = sim.time + dv(item, "ASDuration");
          sim.invalidateStats();
        }
      },
    });
  },
  2523: (item) =>
    effect(item, {
      description: "Basic damage (attacks, Kraken Slayer…) deals up to 10% more based on distance (max at 500 range).",
      options: [DISTANCE],
      beforeDamage(sim, inst) {
        if (!inst.flags.attack && !inst.flags.basic) return;
        const dist = sim.distance;
        inst.amps.push({ id: `item:${item.id}`, source: item.name, value: dv(item, "MaxDamageAmp") * Math.min(1, dist / dv(item, "MaxRange")), kind: "dealt" });
      },
    }),
  6675: (item) =>
    effect(item, {
      description: "Attacks reduce basic ability cooldowns by 15% of their remaining cooldown.",
      onLaunch(sim) {
        for (const s of ["Q", "W", "E"] as const) {
          if (sim.kit.abilities[s]?.attackTimer) continue; // Zeri's Burst Fire (wiki)
          const key = `ability:${s}`;
          const ready = sim.cooldownReadyAt(key);
          if (ready > sim.time) sim.startCooldown(key, (ready - sim.time) * (1 - dv(item, "CDRAmount")));
        }
      },
    }),

  // ------------------------------------------------------------ Energized
  3094: (item, _s, sim) =>
    energized(
      item,
      sim,
      (_sim, push) => push(hit(item, "Sharpshooter", "magic", dv(item, "BonusDamage"), { onHit: true })),
      "Energized attacks deal bonus magic damage.",
    ),
  3095: (item, _s, sim) =>
    energized(
      item,
      sim,
      (s2, push) => push(hit(item, "Bolt", "magic", calc(s2, item, "TotalProcDamage"), { onHit: true })),
      "Energized attacks deal bonus magic damage.",
    ),
  3087: (item, _s, sim) =>
    energized(
      item,
      sim,
      (_sim, push) => push(hit(item, "Electrospark", "magic", dv(item, "ChainDamage"), { onHit: true, aoe: true, fullOnHit: true })),
      "Energized attacks fire chain lightning (hits the target first) for magic damage.",
    ),
  6699: (item, setup, sim) => {
    let lethUntil = -Infinity;
    return energized(
      item,
      sim,
      (s2, push) => {
        // Lethality is granted first, so the triggering hit benefits.
        lethUntil = s2.time + dv(item, "LethalityBonusDuration");
        s2.invalidateStats();
        const pct = (setup.ranged ? dv(item, "PercentCurrentHPRanged") : dv(item, "PercentCurrentHPMelee")) / 100;
        // Before the triggering attack's or ability's damage (wiki).
        push({ ...hit(item, "Firmament", "physical", pct * Math.max(0, s2.target.hp), { onHit: true }), beforeAttack: true });
      },
      "Energized hits deal 9% (ranged 7%) current health physical damage and grant lethality for 4s. Champion-ability damage fires all ready Energized effects (Galvanize) before its own damage.",
      {
        dynamicStats(s2) {
          if (s2.time <= lethUntil) return { lethality: setup.ranged ? dv(item, "LethalityBonusModRanged") : dv(item, "LethalityBonusModMelee") };
        },
        beforeDamage(s2, inst) {
          // Firmament lands before the triggering ability, which then also gets the lethality
          // (wiki), with the other Energized hits; Galvanize is a cast instance of its own (wiki).
          if (!isChampionAbilityDamage(inst) || !s2.counter(ENERGY_KEY)) return;
          const hits = fireEnergized(s2);
          const castId = s2.newCastId();
          for (const r of hits) s2.deal({ ...r, castId });
        },
      },
    );
  },

  // ------------------------------------------------------------ Ability-damage procs
  6653: (item) => {
    const combat = combatTimer(dv(item, "BuffCounterDuration"));
    return effect(item, {
      description: "Ability damage burns for 2% max health per second for 3s; +2% damage per second in combat (max 6%).",
      options: [IN_COMBAT],
      afterDamage(sim, inst) {
        combat.hit(sim, inst);
        if (!isAbilityDamage(inst)) return;
        burn(item, sim, inst, "Torment", () => dv(item, "BurnPercentHealthDamage") * sim.target.maxHp, dv(item, "BurnDuration"), dv(item, "TickFrequency"));
      },
      beforeDamage(sim, inst) {
        if (inst.flags.unamplified) return;
        const amp = Math.min(dv(item, "DamageIncreaseMax"), Math.floor(combat.seconds(sim) + 1e-9) * dv(item, "DamageIncreasePerSecond"));
        if (amp > 0) inst.amps.push({ id: `item:${item.id}`, source: `${item.name} (Suffering)`, value: amp, kind: "dealt" });
      },
    });
  },
  2503: (item) =>
    effect(item, {
      description: "Ability damage burns for magic damage over 3s; +4% AP while the target burns.",
      dynamicStats(sim) {
        if (sim.counter(`burn:${item.id}`) === 1) return { apMult: [1 + dv(item, "APPerStack")] };
      },
      afterDamage(sim, inst) {
        if (!isAbilityDamage(inst)) return;
        const was = sim.counter(`burn:${item.id}`) === 1;
        burn(item, sim, inst, "Baleful Blaze", () => calc(sim, item, "BurnDamagePerSecondCalc"), dv(item, "BurnDuration"), dv(item, "TickFrequency"));
        if (!was) sim.invalidateStats();
      },
    }),
  2508: (item) =>
    effect(item, {
      description: "Ability damage deals bonus magic damage over 3s.",
      afterDamage(sim, inst) {
        if (!isAbilityDamage(inst)) return;
        burn(item, sim, inst, "Inflame", () => dv(item, "BurnFlatDamagePerSecond"), dv(item, "BurnDuration"), dv(item, "TickFrequency"));
      },
    }),
  3147: (item) => {
    const combat = combatTimer(dv(item, "BuffCounterDuration"));
    return effect(item, {
      description: "+2% damage per second in combat with champions (max 6%).",
      options: [IN_COMBAT],
      afterDamage: (sim, inst) => combat.hit(sim, inst),
      beforeDamage(sim, inst) {
        if (inst.flags.unamplified) return;
        const amp = Math.min(dv(item, "DamageIncreaseMax"), Math.floor(combat.seconds(sim) + 1e-9) * dv(item, "DamageIncreasePerSecond"));
        if (amp > 0) inst.amps.push({ id: `item:${item.id}`, source: item.name, value: amp, kind: "dealt" });
      },
    });
  },
  4633: (item) => {
    const combat = combatTimer(dv(item, "BuffCounterDuration"));
    return effect(item, {
      description: "+2% damage per second in combat (max 8%); 2% of bonus health as AP.",
      options: [IN_COMBAT],
      stats: () => ({ conversions: [{ from: "bonusHp", to: "ap", ratio: dv(item, "HealthToAPConversionPercent"), source: item.name }] }),
      afterDamage: (sim, inst) => combat.hit(sim, inst),
      beforeDamage(sim, inst) {
        if (inst.flags.unamplified) return;
        const amp = Math.min(dv(item, "EternityDamageIncreaseMax"), Math.floor(combat.seconds(sim) + 1e-9) * dv(item, "EternityDamageIncreasePerSecond"));
        if (amp > 0) inst.amps.push({ id: `item:${item.id}`, source: item.name, value: amp, kind: "dealt" });
      },
    });
  },
  6655: (item) =>
    effect(item, {
      description: "Damaging abilities fire 6 Echoes (12s cooldown). Against a single target: one full Echo plus 5 at 20% (2× damage total).",
      options: [{ key: "luden.targets", label: "Luden's: enemies hit by Echoes", default: 1, min: 1, max: 6 }],
      afterDamage(sim, inst) {
        if (!isAbilityDamage(inst) || !sim.isReady(`item:${item.id}`)) return;
        sim.startCooldown(`item:${item.id}`, dv(item, "Cooldown"));
        const targets = Math.max(1, Math.min(dv(item, "MaxCharges"), sim.opt["luden.targets"] ?? 1));
        const leftover = dv(item, "MaxCharges") - targets;
        sim.deal(hit(item, "Echo", "magic", calc(sim, item, "Damage")));
        // Leftover Echoes hit the primary target for 20% each, 0.25s apart.
        for (let i = 1; i <= leftover; i++)
          sim.schedule(0.25 * i, () => sim.deal(hit(item, "Echo (repeat)", "magic", calc(sim, item, "Damage") * dv(item, "RepeatDamageReduction"))));
      },
    }),
  4646: (item) => {
    const window: { t: number; v: number }[] = [];
    return effect(item, {
      description: "Dealing 25% of the target's max health within 2.5s triggers Squall: magic damage after 2s (30s cooldown).",
      afterDamage(sim, inst) {
        if (inst.source === `item:${item.id}`) return;
        window.push({ t: sim.time, v: inst.final ?? 0 });
        while (window.length && sim.time - window[0].t > dv(item, "WindowDuration")) window.shift();
        const total = window.reduce((s, x) => s + x.v, 0);
        if (total < dv(item, "DamageThreshold") * sim.target.maxHp || !sim.isReady(`item:${item.id}`)) return;
        sim.startCooldown(`item:${item.id}`, dv(item, "Cooldown"));
        window.length = 0;
        const mod = sim.stats.ranged ? dv(item, "RangedProcDamageMod") : 1;
        sim.schedule(dv(item, "DelayDuration"), () =>
          sim.deal(hit(item, "Squall", "magic", calc(sim, item, "SquallDamage") * mod, { ability: true, proc: false, kind: "item" })),
        );
      },
    });
  },
  3145: (item) =>
    effect(item, {
      description: "Damaging a champion deals bonus magic damage (40s cooldown).",
      afterDamage(sim, inst) {
        if (inst.flags.proc || !sim.isReady(`item:${item.id}`)) return;
        sim.startCooldown(`item:${item.id}`, dv(item, "Cooldown"));
        sim.deal(hit(item, "Revved", "magic", calc(sim, item, "DamageAmount")));
      },
    }),
  2520: (item) =>
    effect(item, {
      description: "Ability damage to a champion deals additional true damage (20s cooldown).",
      afterDamage(sim, inst) {
        if (!isChampionAbilityDamage(inst) || !sim.isReady(`item:${item.id}`)) return;
        sim.startCooldown(`item:${item.id}`, dv(item, "Cooldown"));
        sim.deal(hit(item, "Shaped Charge", "true", calc(sim, item, "AbilityDamageCalc")));
      },
    }),
  3161: (item, setup) => {
    let stacks = 0;
    let until = -Infinity;
    const lastByCast = new Map<number, number>();
    // Innate abilities don't grant stacks, except these special cases (wiki).
    const innateStacks = setup.champion === "Urgot" || setup.champion === "Rengar";
    const start = startStacks(
      item.name,
      "shojin.stacks",
      dv(item, "StackCount"),
      `Stacks from champion-ability hits just before the combo, lasting ${dv(item, "StackDuration")}s: +${pct(dv(item, "SpellDamageIncrease"))}% ability damage each.`,
    );
    return effect(item, {
      description: "Damage from a non-innate champion ability grants a stack (max 4, 6s): +3% ability damage per stack. +25 basic ability haste.",
      options: [{ key: "shojin.rangedPenalty", label: "Shojin: apply ranged 50% (tooltip-only per wiki)", default: 0, min: 0, max: 1, step: 1 }, start],
      stats: () => ({ basicAbilityHaste: dv(item, "AHBase") }),
      onStart(sim) {
        stacks = optStacks(sim, start);
        until = sim.time + dv(item, "StackDuration");
      },
      beforeDamage(sim, inst) {
        // Ability damage that is also basic damage (Garen Q, Darius W) is amplified too.
        if (inst.flags.kind !== "ability" || sim.time > until || !stacks) return;
        const per = dv(item, "SpellDamageIncrease") * (setup.ranged && sim.opt["shojin.rangedPenalty"] ? dv(item, "RangedMod") : 1);
        inst.amps.push({ id: `item:${item.id}`, source: item.name, value: per * stacks, kind: "dealt" });
      },
      afterDamage(sim, inst) {
        if (!isChampionAbilityDamage(inst) || (inst.flags.slot === "P" && !innateStacks)) return;
        const last = lastByCast.get(inst.castId);
        if (last !== undefined && sim.time - last < dv(item, "CastIDLockout")) return;
        lastByCast.set(inst.castId, sim.time);
        if (sim.time > until) stacks = 0;
        stacks = Math.min(dv(item, "StackCount"), stacks + 1);
        until = sim.time + dv(item, "StackDuration");
      },
    });
  },
  3118: (item) => {
    // The target is cursed (damaged, -MR) while Hatefog lasts and it stays inside.
    let fogEnd = -Infinity;
    let inZoneUntil = -Infinity;
    const TICK = 0.25;
    const cursed = (sim: Sim) => sim.time <= Math.min(fogEnd, inZoneUntil) + 1e-9;
    return effect(item, {
      description:
        "+20 ultimate haste. Ultimate damage creates Hatefog under the target: magic damage per second for 3s and -10 magic resist; ultimate damage to a target inside refreshes it.",
      options: [{ key: "malignance.stay", label: "Seconds the target stays in Hatefog after your last ultimate hit", default: 3, min: 0, max: 3, step: 0.25 }],
      stats: () => ({ ultimateHaste: dv(item, "UltimateHaste") }),
      targetResist(sim) {
        if (cursed(sim)) return { mrFlat: calc(sim, item, "MagicResistanceShred") };
      },
      afterDamage(sim, inst) {
        if (inst.flags.slot !== "R" || !isChampionAbilityDamage(inst)) return;
        const duration = dv(item, "GroundDuration");
        const stay = Math.min(duration, sim.opt["malignance.stay"] ?? duration);
        if (cursed(sim)) {
          // Ultimate damage to the target inside its zone refreshes the zone.
          fogEnd = sim.time + duration;
          inZoneUntil = sim.time + stay;
          return;
        }
        if (!sim.isReady(`item:${item.id}`)) return;
        sim.startCooldown(`item:${item.id}`, duration);
        fogEnd = sim.time + duration;
        inZoneUntil = sim.time + stay;
        // (60 + 5% AP) per second, dealt every 0.25s; the first tick lands right away.
        const tick = () => {
          if (!cursed(sim)) return;
          sim.deal(hit(item, "Hatefog", "magic", TICK * calc(sim, item, "GroundBurnDamagePerTickTooltipOnly"), { dot: true, aoe: true }));
          sim.schedule(TICK, tick);
        };
        sim.schedule(1e-3, tick);
      },
    });
  },
  2502: (item) =>
    effect(item, {
      description: "Every 4s in champion combat, deals magic damage (3% bonus health) to nearby champions.",
      onStart(sim) {
        const tick = () => {
          // Only pulses while in champion combat (approximated as: damage dealt within the last 3s).
          if (sim.time - sim.lastCombatTime > 3) return;
          sim.deal(hit(item, "Anguish", "magic", calc(sim, item, "DrainCalc"), { ability: true, proc: false, aoe: true, aura: true }));
          sim.schedule(dv(item, "Cooldown"), tick);
        };
        sim.schedule(dv(item, "Cooldown"), tick);
      },
      limitations: ["Assumes you stay within range of the target for the whole combo; first pulse after 4s in combat."],
    }),
  3068: (item) => immolate(item, "DamagePerTick"),
  6664: (item) => immolate(item, "DamagePerTick"),
  6660: (item) => immolate(item, "DamagePerTick"),
  3050: (item) =>
    effect(item, {
      description: "Casting your ultimate summons a storm: 30 magic damage per second for 5s to nearby champions.",
      stats: () => ({ ultimateHaste: dv(item, "UltimateHaste") }),
      onCast(sim, cast) {
        if (cast.slot !== "R" || !sim.isReady(`item:${item.id}`)) return;
        sim.startCooldown(`item:${item.id}`, dv(item, "Cooldown"));
        for (let i = 1; i <= dv(item, "Duration"); i++)
          sim.schedule(i, () => sim.deal(hit(item, "Frostfire Tempest", "magic", dv(item, "DamagePerSecond"), { dot: true, aoe: true })));
      },
    }),

  // ------------------------------------------------------------ Resist shred & amplifiers
  3071: (item) => {
    let stacks = 0;
    let until = -Infinity;
    let lastStack = -Infinity;
    const start = startStacks(
      item.name,
      "blackCleaver.stacks",
      dv(item, "MaxStacks"),
      `Carve stacks on the target from physical damage just before the combo, lasting ${dv(item, "DebuffDuration")}s: ${pct(dv(item, "ShredPerStack"))}% armor reduction each.`,
    );
    return effect(item, {
      description: "Physical damage to champions shreds 6% armor per stack (5 stacks, 6s).",
      options: [start],
      onStart(sim) {
        stacks = optStacks(sim, start);
        until = sim.time + dv(item, "DebuffDuration");
      },
      targetResist(sim) {
        if (sim.time <= until && stacks) return { armorPercent: stacks * dv(item, "ShredPerStack") };
      },
      afterDamage(sim, inst) {
        if (inst.type !== "physical") return;
        // Once per frame, except a few effects that add a stack on top of the attack's.
        const extraAllowed = /Spellblade|Bring It Down|Colossal Consumption|Shipwrecker|Firmament|Ever Rising Moon/.test(inst.label);
        if (Math.abs(sim.time - lastStack) < 1e-6 && !extraAllowed) return;
        lastStack = sim.time;
        if (sim.time > until) stacks = 0;
        stacks = Math.min(dv(item, "MaxStacks"), stacks + 1);
        until = sim.time + dv(item, "DebuffDuration");
      },
    });
  },
  8010: (item) => {
    let stacks = 0;
    let until = -Infinity;
    const lastByCast = new Map<number, number>();
    const start = startStacks(
      item.name,
      "bloodletter.stacks",
      dv(item, "MaxStacks"),
      `Stacks on the target from ability magic damage just before the combo, lasting ${dv(item, "DebuffDuration")}s: ${pct(dv(item, "ShredPerStack"))}% magic resist reduction each.`,
    );
    return effect(item, {
      description: "Magic damage from abilities or passives shreds 7.5% magic resist per stack (4 stacks, 6s; once per cast instance every 0.3s).",
      options: [start],
      onStart(sim) {
        stacks = optStacks(sim, start);
        until = sim.time + dv(item, "DebuffDuration");
      },
      targetResist(sim) {
        if (sim.time <= until && stacks) return { mrPercent: stacks * dv(item, "ShredPerStack") };
      },
      afterDamage(sim, inst) {
        if (inst.type !== "magic" || inst.flags.kind !== "ability") return;
        const last = lastByCast.get(inst.castId);
        if (last !== undefined && sim.time - last < dv(item, "InternalCD") - 1e-9) return;
        lastByCast.set(inst.castId, sim.time);
        if (sim.time > until) stacks = 0;
        stacks = Math.min(dv(item, "MaxStacks"), stacks + 1);
        until = sim.time + dv(item, "DebuffDuration");
      },
    });
  },
  8020: (item) =>
    effect(item, {
      description: "Nearby enemy champions take 12% more magic damage.",
      beforeDamage(sim, inst) {
        if (inst.type === "magic") inst.amps.push({ id: `item:${item.id}`, source: item.name, value: dv(item, "DamageAmp"), kind: "taken" });
      },
    }),
  4645: (item) =>
    effect(item, {
      description: "Magic and true damage critically strike targets below 40% health for +20% (scales with bonus crit damage).",
      beforeDamage(sim, inst) {
        // Unamplified hits (First Strike's bonus) would lose it.
        if (inst.type === "physical" || inst.flags.kind === "summoner" || inst.flags.unamplified) return;
        if (Math.max(0, sim.target.hp) / sim.target.maxHp >= dv(item, "HealthThreshold")) return;
        // The wiki: damage × (1 + amp × the crit damage modifiers' product), Infinity Edge's 1.3 making
        // it 26%; damage over time and pets have their own amp. The results show it as its own hit:
        // what its crits add is most of what the item is worth.
        const amp = dv(item, inst.flags.dot || inst.flags.pet ? "DamageOverTimeAmp" : "SpellItemDamageAmp");
        const bonusCrit = sim.stats.critDamage - sim.champ.stats.critDamageMultiplier;
        inst.amps.push({ id: `item:${item.id}`, source: item.name, value: amp * (1 + Math.max(0, bonusCrit)), kind: "multiplier", hit: "Cinderbloom" });
        for (const e of sim.effects) e.onCrit?.(sim, inst);
      },
    }),
  3036: (item) =>
    effect(item, {
      description: "Up to 15% bonus damage against champions with bonus health (max at 1500).",
      beforeDamage(sim, inst) {
        if (inst.flags.unamplified) return;
        const amp = dv(item, "MaxBonusDamagePercent") * Math.min(1, Math.max(0, sim.target.bonusHp) / dv(item, "MaxBonusHealth"));
        if (amp > 0) inst.amps.push({ id: `item:${item.id}`, source: item.name, value: amp, kind: "dealt" });
      },
    }),
  4005: (item) =>
    effect(item, {
      description: "Immobilizing a champion marks them 7% vulnerable for 4s.",
      onCrowdControl(sim, cc) {
        if (cc.kind === "immobilize") sim.setCounter(`mandate:${item.id}`, sim.time + dv(item, "DamageAmpDuration"));
      },
      beforeDamage(sim, inst) {
        if (sim.time <= timerEnd(sim, `mandate:${item.id}`))
          inst.amps.push({ id: `item:${item.id}`, source: item.name, value: dv(item, "DamageAmp"), kind: "taken" });
      },
    }),
  // The damage counted past the kill stands for a target with more health, which the same hits
  // would leave below 5% too: the execute is worth its 5% whenever the target gets there, not only
  // the health a hit happens to leave, or nothing when a hit takes it past 0.
  6676: (item) =>
    effect(item, {
      description: "Your damage executes champions below 5% health.",
      limitations: [
        "The execute counts as 5% of the target's max health the first time it falls below 5%, also when the hit that took it there killed: what the rest of a bigger health bar would no longer need. A larger execute (Smolder's, Pyke's…) counts instead of it.",
      ],
      afterDamage(sim) {
        sim.deal(hit(item, "Execute", "true", dv(item, "ExecuteThreshold") * sim.target.maxHp, { execute: true }));
      },
    }),
  3168: (item) =>
    effect(item, {
      description: "Deal 4% increased damage while above half health.",
      options: [SELF_HP],
      beforeDamage(sim, inst) {
        if (selfHp(sim.opt) > 0.5 && !inst.flags.unamplified)
          inst.amps.push({ id: `item:${item.id}`, source: item.name, value: dv(item, "DamageMod"), kind: "dealt" });
      },
    }),
  2522: (item) => {
    let until = -Infinity;
    return effect(item, {
      description: "Active: for 8s abilities deal increased damage (15% + 0.5% per 100 bonus mana) and basic ability cooldowns progress 30% faster.",
      limitations: ["The doubled mana costs are not modeled."],
      beforeDamage(sim, inst) {
        if (sim.time > until || inst.flags.kind !== "ability" || inst.flags.attack) return;
        inst.amps.push({ id: `item:${item.id}`, source: item.name, value: calc(sim, item, "ManaCalc"), kind: "dealt" });
      },
      active: {
        label: "Mana Made Real",
        cooldown: dv(item, "Cooldown"),
        cast(sim) {
          until = sim.time + dv(item, "Duration");
          sim.speedUpBasicCooldowns(until, dv(item, "CooldownTick"));
        },
      },
    });
  },
  3073: (item, setup) => {
    let until = -Infinity;
    return effect(item, {
      description: "+30 ultimate haste. After casting your ultimate gain attack speed for 8s.",
      stats: () => ({ ultimateHaste: dv(item, "UltimateHaste") }),
      dynamicStats(sim) {
        if (sim.time <= until) return { attackSpeed: (setup.ranged ? dv(item, "BonusASRanged") : dv(item, "BonusASMelee")) / 100 };
      },
      onCast(sim, cast) {
        if (cast.slot === "R" && sim.isReady(`item:${item.id}`)) {
          sim.startCooldown(`item:${item.id}`, dv(item, "Cooldown"));
          until = sim.time + dv(item, "HasteDuration");
          sim.invalidateStats();
        }
      },
    });
  },

  3116: (item) =>
    effect(item, {
      description: "Ability damage slows by 30% for 1s (no damage).",
      afterDamage(sim, inst) {
        if (isAbilityDamage(inst)) sim.applyCC("slow", dv(item, "SlowDuration"), inst.castId);
      },
    }),
  6694: (item) =>
    effect(item, {
      description: "35% armor penetration. Ability damage slows targets below 50% health.",
      afterDamage(sim, inst) {
        if (isAbilityDamage(inst) && Math.max(0, sim.target.hp) / sim.target.maxHp <= dv(item, "SlowThreshold"))
          sim.applyCC("slow", dv(item, "SlowDuration"), inst.castId);
      },
    }),
  6692: (item, setup) => {
    let first: { t: number; castId: number } | null = null;
    return effect(item, {
      description: "Hitting a champion with 2 separate attacks/abilities within 2s deals 8% (ranged 5%) max health physical damage and shields (6s cooldown).",
      afterDamage(sim, inst) {
        if (inst.flags.proc && !inst.flags.pet) return;
        if (!sim.isReady(`item:${item.id}`)) return;
        if (!first || sim.time - first.t > dv(item, "WindowDuration")) {
          first = { t: sim.time, castId: inst.castId };
          return;
        }
        if (first.castId === inst.castId) return;
        first = null;
        sim.startCooldown(`item:${item.id}`, dv(item, "Cooldown"));
        const pct = dv(item, "MeleePercMaxHP") * (setup.ranged ? dv(item, "RangedPercMaxHPMult") : 1);
        sim.deal(hit(item, "Ever Rising Moon", "physical", pct * sim.target.maxHp));
      },
    });
  },
  4628: (item) =>
    effect(item, {
      description: "Champion-ability damage from 600+ range marks the target: you deal 10% more damage to it for 6s.",
      options: [DISTANCE],
      afterDamage(sim, inst) {
        // Every long-range hit marks the target again for the full duration.
        if (!isChampionAbilityDamage(inst) || sim.distance < dv(item, "SnipeRange")) return;
        sim.setCounter(`horizon:${item.id}`, sim.time + dv(item, "BuffDuration"));
      },
      beforeDamage(sim, inst) {
        // The triggering ability also benefits.
        const marked = sim.time <= timerEnd(sim, `horizon:${item.id}`) || (isChampionAbilityDamage(inst) && sim.distance >= dv(item, "SnipeRange"));
        if (marked && !inst.flags.unamplified) inst.amps.push({ id: `item:${item.id}`, source: item.name, value: dv(item, "DamageAmp"), kind: "dealt" });
      },
    }),
  3871: (item) =>
    effect(item, {
      description:
        "Ability damage to a champion causes an explosion 0.5s later: 10 + 15% AP + 3% of the target's max health magic damage (10s cooldown). Counts as ability damage.",
      afterDamage(sim, inst) {
        if (!isAbilityDamage(inst) || !sim.isReady(`item:${item.id}`)) return;
        sim.startCooldown(`item:${item.id}`, 10);
        sim.schedule(0.5, () =>
          sim.deal(
            hit(item, "Void Explosion", "magic", calc(sim, item, "TooltipDamage") + dv(item, "PercentHPDamage") * sim.target.maxHp, {
              ability: true,
              proc: false,
              aoe: true,
            }),
          ),
        );
      },
    }),
  3504: (item) =>
    effect(item, {
      description: "Healing or shielding an ally buffs you: +25% attack speed and 20 magic damage on-hit for 6s (option).",
      options: [{ key: "ardent.active", label: "Ardent Censer buff active", default: 0, min: 0, max: 1, step: 1 }],
      dynamicStats(sim) {
        if (sim.opt["ardent.active"] && sim.time <= dv(item, "Duration")) return { attackSpeed: dv(item, "AttackSpeedMin") };
      },
      onAttack(sim, atk) {
        if (sim.opt["ardent.active"] && sim.time <= dv(item, "Duration")) atk.extra.push(hit(item, "Sanctify", "magic", dv(item, "OnHitMin"), { onHit: true }));
      },
    }),
  3144: (item) =>
    effect(item, {
      description: "Damaging a champion deals 40 magic damage (40s cooldown, reduced 1s per attack). Counts as ability damage.",
      afterDamage(sim, inst) {
        if (inst.flags.proc || !sim.isReady(`item:${item.id}`)) return;
        sim.startCooldown(`item:${item.id}`, 40);
        sim.deal(hit(item, "Bullseye", "magic", calc(sim, item, "DamageAmount"), { ability: true, proc: false }));
      },
    }),
  2139: (item) =>
    effect(item, {
      description: "Damaging a champion deals 25 bonus true damage (5s cooldown).",
      afterDamage(sim, inst) {
        if (inst.source === `item:${item.id}` || !sim.isReady(`item:${item.id}`)) return;
        sim.startCooldown(`item:${item.id}`, 5);
        sim.deal(hit(item, "Elixir of Sorcery", "true", 25));
      },
    }),

  // ------------------------------------------------------------ Actives
  3152: (item) =>
    effect(item, {
      description: "Active: dash and fire missiles for magic damage.",
      active: {
        label: "Supersonic",
        cooldown: 50,
        cast(sim, castId) {
          // The dash arms Sudden Impact; it isn't an ability cast (no Spellblade, no kit hooks).
          for (const e of sim.effects)
            if (e.source !== "kit") e.onCast?.(sim, { castId, slot: "P", hitsTarget: true, isUltimate: false, label: item.name, dash: true, item: true });
          sim.schedule(0.25, () =>
            sim.deal({ ...hit(item, "Supersonic", "magic", calc(sim, item, "FireboltDamage"), { ability: true, proc: false, aoe: true }), castId }),
          );
        },
      },
    }),
  3146: (item) =>
    effect(item, {
      description: "Active: magic damage and a 25% slow.",
      active: {
        label: "Lightning Bolt",
        cooldown: 60,
        cast(sim, castId) {
          sim.deal({ ...hit(item, "Lightning Bolt", "magic", calc(sim, item, "ActiveDamage"), { ability: true, proc: false }), castId });
          sim.applyCC("slow", dv(item, "SlowDuration"), castId);
        },
      },
    }),
  3077: (item) => hydraActive(item, "PrimaryDamage", "Crescent"),
  3074: (item) => hydraActive(item, "PrimaryDamage", "Ravenous Crescent"),
  6698: (item) => hydraActive(item, "SlashDamageBase", "Heretical Cleave"),
  6631: (item) => hydraActive(item, "SlashDamage", "Breaking Shockwave", true),
  3107: (item) =>
    effect(item, {
      description: "Active: after 2.5s deal 10% max health true damage to enemy champions in the area.",
      active: {
        label: "Intervention",
        cooldown: 90,
        cast(sim, castId) {
          sim.schedule(2.5, () =>
            sim.deal({
              ...hit(item, "Intervention", "true", dv(item, "DamageToChampions") * sim.target.maxHp, { ability: true, proc: false, aoe: true }),
              castId,
            }),
          );
        },
      },
    }),

  // ------------------------------------------------------------ Stat passives
  3089: (item) => effect(item, { description: "+30% total AP.", stats: () => ({ apMult: [1 + dv(item, "APAmp")] }) }),
  3053: (item) =>
    effect(item, {
      description: "Bonus AD equal to 50% base AD.",
      stats: () => ({ conversions: [{ from: "baseAd", to: "ad", ratio: dv(item, "ADtoAD"), source: item.name }] }),
    }),
  3004: (item) =>
    effect(item, {
      description: "Bonus AD equal to 2% max mana.",
      stats: () => ({ conversions: [{ from: "maxMana", to: "ad", ratio: 0.02, source: item.name }] }),
    }),
  3042: (item) =>
    effect(item, {
      description:
        "Bonus AD equal to 2% max mana. Attacks deal 1.2% max mana physical damage on-hit; abilities deal 4% (ranged 3%) max mana bonus physical damage.",
      limitations: ["Shock on abilities assumed once per cast."],
      stats: () => ({ conversions: [{ from: "maxMana", to: "ad", ratio: 0.02, source: item.name }] }),
      onAttack(sim, atk) {
        if (atk.fromAbility) return;
        atk.extra.push(hit(item, "Shock", "physical", calc(sim, item, "OnHitDamage"), { onHit: true }));
      },
      afterDamage(sim, inst) {
        if (!isChampionAbilityDamage(inst) || sim.counter(`muramana:${inst.castId}`)) return;
        sim.setCounter(`muramana:${inst.castId}`, 1);
        sim.deal({
          ...hit(item, "Shock (ability)", "physical", calc(sim, item, sim.stats.ranged ? "RangedItemCalcValue" : "MeleeItemCalcValue")),
          castId: inst.castId,
        });
      },
    }),
  3003: (item) =>
    effect(item, {
      description: "AP equal to 1% bonus mana.",
      stats: () => ({ conversions: [{ from: "bonusMana", to: "ap", ratio: dv(item, "APFromMana"), source: item.name }] }),
    }),
  3040: (item) =>
    effect(item, {
      description: "AP equal to 2% bonus mana.",
      stats: () => ({ conversions: [{ from: "bonusMana", to: "ap", ratio: 0.02, source: item.name }] }),
    }),
  3119: (item) =>
    effect(item, {
      description: "Health equal to 15% bonus mana.",
      stats: () => ({ conversions: [{ from: "bonusMana", to: "hp", ratio: 0.15, source: item.name }] }),
    }),
  3121: (item) =>
    effect(item, {
      description: "Health equal to 15% bonus mana.",
      stats: () => ({ conversions: [{ from: "bonusMana", to: "hp", ratio: 0.15, source: item.name }] }),
    }),
  6657: (item) =>
    effect(item, {
      description: "Gains health, mana and AP every minute (max 10 stacks).",
      options: [{ key: "rodofages.stacks", label: "Rod of Ages stacks", default: 10, min: 0, max: 10 }],
      stats(ctx) {
        const n = Math.min(dv(item, "MaxStacks"), ctx.opt["rodofages.stacks"] ?? 10);
        return { hp: n * dv(item, "HealthPerStack"), mana: n * dv(item, "ManaPerStack"), ap: n * dv(item, "APPerStack") };
      },
    }),
  2501: (item) =>
    effect(item, {
      description: "AD equal to 2.5% bonus health; up to +12% AD based on your missing health.",
      options: [SELF_HP],
      stats(ctx) {
        const missing = 1 - selfHp(ctx.opt);
        const scale = Math.min(1, missing / dv(item, "MissingHealthThreshold"));
        const conversions: StatMods["conversions"] = [{ from: "bonusHp", to: "ad", ratio: dv(item, "HPToADPercentage"), source: item.name }];
        if (scale > 0) conversions.push({ from: "totalAd", to: "ad", ratio: dv(item, "MissingHealthAD") * scale, source: `${item.name} (Retribution)` });
        return { conversions };
      },
    }),
  3083: (item, _setup, sim) =>
    effect(item, {
      description: "Bonus health equal to 12% of health from items.",
      stats() {
        const itemHp = sim.items.reduce((s2, i) => s2 + (i.stats.hp ?? 0), 0);
        return { hp: itemHp * dv(item, "HPAmp") };
      },
    }),
  6697: (item) =>
    effect(item, {
      description: "After a takedown: +12 AD plus 3 per statue for 90s.",
      options: [
        { key: "hubris.active", label: "Hubris buff active", default: 0, min: 0, max: 1, step: 1 },
        { key: "hubris.stacks", label: "Hubris statues", default: 0, min: 0, max: 50 },
      ],
      stats(ctx) {
        if (!ctx.opt["hubris.active"]) return;
        return { ad: dv(item, "BaseADBonus") + dv(item, "ADPerStatue") * (ctx.opt["hubris.stacks"] ?? 0) };
      },
    }),
  3041: (item) => glory(item, 25),
  1082: (item) => glory(item, 10),
  6621: (item) =>
    effect(item, {
      description: "AP per 100% base mana regen.",
      limitations: ["Base mana regen from other items/runes is not tracked; uses this item's own +100%."],
      stats: () => ({ ap: dv(item, "APPerManaRegen") * (item.stats.baseMpRegen ?? 1) }),
    }),
  3170: (item, _setup, sim) =>
    effect(item, {
      description: "Adaptive force equal to 5% of your move speed (item move speed only; temporary speed-ups ignored).",
      stats() {
        const flat = sim.items.reduce((s2, i) => s2 + (i.stats.msFlat ?? 0), 0);
        const pct = sim.items.reduce((s2, i) => s2 + (i.stats.msPercent ?? 0), 0);
        return { adaptive: dv(item, "MSAdaptiveRatio") * (sim.champ.stats.ms + flat) * (1 + pct) };
      },
    }),
  // Famine values aren't in the item's data; wiki (V26.20): 5 + 13% bonus AD (ranged 10%).
  2517: (item, setup) =>
    effect(item, {
      description: "Ability haste equal to 5 + 13% bonus AD (ranged 10%).",
      stats: () => ({ abilityHaste: 5, conversions: [{ from: "bonusAd", to: "abilityHaste", ratio: setup.ranged ? 0.1 : 0.13, source: item.name }] }),
    }),
  6616: (item) =>
    effect(item, {
      description: "Healing or shielding an ally grants 40 AP and 15 ability haste for 6s (option).",
      options: [{ key: "flowingWater.active", label: "Staff of Flowing Water buff active", default: 0, min: 0, max: 1, step: 1 }],
      stats: (ctx) => (ctx.opt["flowingWater.active"] ? { ap: dv(item, "APMod"), abilityHaste: dv(item, "AHMod") } : {}),
    }),
};

function immolate(item: ItemData, calcName: string): Effect {
  return effect(item, {
    description: "While in combat, deals magic damage per second to nearby enemies.",
    limitations: ["Assumes the target stays within the burn radius for the whole combo."],
    options: [{ key: "immolate.inRange", label: "Immolate target in range", default: 1, min: 0, max: 1, step: 1 }],
    onStart(sim) {
      if (!(sim.opt["immolate.inRange"] ?? 1)) return;
      // Immolate stays active for 3s after dealing (or taking) damage.
      const linger = dv(item, "AuraDuration") || 3;
      const tick = () => {
        if (sim.time - sim.lastCombatTime > linger) return;
        sim.deal(hit(item, "Immolate", "magic", calc(sim, item, calcName), { dot: true, aoe: true, aura: true }));
        sim.schedule(1, tick);
      };
      sim.schedule(1, tick);
    },
  });
}

function hydraActive(item: ItemData, calcName: string, label: string, slow = false): Effect {
  return effect(item, {
    description: `Active: ${label} deals physical damage around you.`,
    active: {
      label,
      cooldown: dv(item, "Cooldown") || 10,
      cast(sim, castId) {
        sim.deal({ ...hit(item, label, "physical", calc(sim, item, calcName), { ability: true, proc: false, aoe: true }), castId });
        if (slow) sim.applyCC("slow", dv(item, "Duration") || 3, castId);
        sim.resetAttack();
      },
    },
  });
}

function glory(item: ItemData, max: number): Effect {
  return effect(item, {
    description: "AP per Glory stack.",
    options: [{ key: `glory.stacks`, label: "Glory stacks", default: max, min: 0, max }],
    stats: (ctx) => ({ ap: dv(item, "APPerGlory") * Math.min(max, ctx.opt["glory.stacks"] ?? max) }),
  });
}

/** Item ids whose passives only change stats already in the data (no behaviour to model). */
const STATS_ONLY_NOTE = "stats only";

export function createItemEffect(item: ItemData, setup: SetupCtx, sim: Sim): Effect | null {
  const f = ITEMS[item.id];
  if (!f) return null;
  const e = f(item, setup, sim);
  if (!e) return null;
  // The shared Energize counter is created once, alongside the first Energized item.
  if (ENERGIZED_ITEMS.includes(item.id) && !sim.effects.some((x) => x.id === "item:energized")) sim.effects.push(energyEffect());
  return e;
}

export function hasItemModel(id: number): boolean {
  return id in ITEMS;
}

export { STATS_ONLY_NOTE };

/** Item groups: you can own only one item of each group (wiki "Item group", patch 16.20). */
export const ITEM_GROUPS: Record<string, number[]> = {
  Spellblade: [3057, 3078, 3100, 6662, 3508, 2510, 3877],
  Hydra: [3077, 6698, 3074, 6631, 3748],
  Fatality: [3035, 3071, 3036, 3033, 6694, 3302],
  Blight: [4630, 3135, 3137, 8010, 3302],
  Immolate: [6660, 3068, 6664],
  Lifeline: [3003, 3040, 3155, 6673, 3156, 2525, 3053],
  Manaflow: [3070, 3003, 3004, 2526, 3119],
  Annul: [4632, 3102, 3814],
  Glory: [1082, 3041],
  Eternity: [3803, 6657],
  Quicksilver: [3140, 3139],
};
