// Champion stat computation: base stats + level growth + items + runes + dynamic buffs.

import type { ChampionBaseStats } from "./data-types.ts";
import { statProgression } from "./calc.ts";

/** Global game constants (patch 16.20). Sources: see docs/MECHANICS.md. */
export const GAME = {
  /** Global attack speed cap (2.5 → 3.0 in 25.S1.3). */
  attackSpeedCap: 3.0,
  /** Champions can reach level 20 with the Top lane role quest (26.1). */
  maxLevel: 20,
  /** 1 adaptive force = 0.6 bonus AD or 1 AP. */
  adaptiveToAd: 0.6,
  adaptiveToAp: 1,
};

/** Fully computed stats of a unit at a moment in time. Percentages are fractions (0.3 = 30%). */
export interface Stats {
  level: number;
  ranged: boolean;
  maxHp: number;
  baseHp: number;
  bonusHp: number;
  hp: number;
  maxMana: number;
  baseMana: number;
  bonusMana: number;
  ad: number;
  baseAd: number;
  bonusAd: number;
  ap: number;
  armor: number;
  baseArmor: number;
  bonusArmor: number;
  mr: number;
  baseMr: number;
  bonusMr: number;
  /** Attacks per second, after the cap. */
  attackSpeed: number;
  baseAttackSpeed: number;
  attackSpeedRatio: number;
  /** Bonus attack speed as a fraction, including level growth. */
  bonusAttackSpeed: number;
  attackSpeedCap: number;
  critChance: number;
  /** Total crit damage multiplier, e.g. 1.75. */
  critDamage: number;
  lethality: number;
  armorPenFlat: number;
  armorPenPercent: number;
  bonusArmorPenPercent: number;
  magicPenFlat: number;
  magicPenPercent: number;
  bonusMagicPenPercent: number;
  abilityHaste: number;
  basicAbilityHaste: number;
  ultimateHaste: number;
  moveSpeed: number;
  bonusMoveSpeed: number;
  range: number;
  bonusRange: number;
  lifeSteal: number;
  omnivamp: number;
  tenacity: number;
  healShieldPower: number;
  /** Adaptive force points granted (already converted into ad/ap above). */
  adaptiveForce: number;
  adaptiveType: "physical" | "magic";
  /** Outgoing damage multipliers that behave like stats (e.g. Rabadon's is AP, this is not). */
  critChanceCapExceeded?: boolean;
}

/** Additive stat modifications collected from items, runes, buffs and kit passives. */
export interface StatMods {
  hp: number;
  mana: number;
  ad: number;
  /** Bonus AD that counts as base AD (rare, e.g. some champion passives). */
  baseAd: number;
  ap: number;
  /** The part of ad and of ap that adaptive force's choice leaves out (adaptiveChoice): what a champion's
   *  kit gives (the sim marks its mods: championMods), and Staff of Flowing Water's Rapids. */
  uncountedAd: number;
  uncountedAp: number;
  armor: number;
  mr: number;
  /** Bonus attack speed fraction. */
  attackSpeed: number;
  /** Multiplier on total attack speed (rare). */
  attackSpeedMult: number;
  critChance: number;
  critDamage: number;
  lethality: number;
  armorPenFlat: number;
  /** Listed separately; combined multiplicatively. */
  armorPenPercent: number[];
  bonusArmorPenPercent: number[];
  magicPenFlat: number;
  magicPenPercent: number[];
  bonusMagicPenPercent: number[];
  abilityHaste: number;
  basicAbilityHaste: number;
  ultimateHaste: number;
  msFlat: number;
  msPercent: number;
  range: number;
  lifeSteal: number;
  omnivamp: number;
  tenacity: number;
  healShieldPower: number;
  adaptive: number;
  /** Multipliers on total AP (Rabadon's, Blackfire Torch). The % increases add up (wiki). */
  apMult: number[];
  /** Those of apMult that adaptive force's choice leaves out (Syndra's passive). */
  uncountedApMult: number[];
  /** Multipliers on bonus AD/HP/armor/MR (e.g. some champion ults; adaptive force's choice leaves out
   *  what they add). */
  bonusAdMult: number[];
  bonusHpMult: number[];
  armorMult: number[];
  mrMult: number[];
  /** Raises the attack speed cap (Lethal Tempo etc.). */
  attackSpeedCap: number;
  /** Lowers the attack speed cap, which then only attackSpeedPastCap raises (Zeri's Burst Fire: 1.5;
   *  Hail of Blades doesn't raise it, wiki). 0 = none; the lowest counts. */
  attackSpeedCapLimit: number;
  /** Bonus attack speed that raises the cap by as much as it adds (Zeri's Lightning Crash, Kennen's
   *  Lightning Rush). */
  attackSpeedPastCap: number;
  /** Multipliers on crit chance (Yasuo/Yone passive ×2). Combined multiplicatively. */
  critChanceMult: number[];
  /** Conversions applied after flat stats: e.g. 3% of bonus HP as AD. */
  conversions: Conversion[];
}

export interface Conversion {
  from:
    | "bonusHp"
    | "maxHp"
    | "maxMana"
    | "bonusMana"
    | "bonusArmor"
    | "bonusMr"
    | "ap"
    | "bonusAd"
    | "baseAd"
    | "totalAd"
    | "critChanceOverCap"
    | "bonusAttackSpeed"
    | "bonusAttackSpeedOverCap"
    | "lethality";
  to: "ad" | "ap" | "hp" | "abilityHaste" | "armor" | "mr" | "attackSpeed" | "msPercent" | "lethality" | "critDamage";
  ratio: number;
  source?: string;
  /** Left out of adaptive force's choice. Item passives count unless the wiki says otherwise (Manamune,
   *  Muramana, Archangel's Staff, Seraph's Embrace, Riftmaker); champion passives never do (the sim
   *  marks a kit's). */
  uncounted?: boolean;
}

export function emptyMods(): StatMods {
  return {
    hp: 0,
    mana: 0,
    ad: 0,
    baseAd: 0,
    ap: 0,
    uncountedAd: 0,
    uncountedAp: 0,
    armor: 0,
    mr: 0,
    attackSpeed: 0,
    attackSpeedMult: 0,
    critChance: 0,
    critDamage: 0,
    lethality: 0,
    armorPenFlat: 0,
    armorPenPercent: [],
    bonusArmorPenPercent: [],
    magicPenFlat: 0,
    magicPenPercent: [],
    bonusMagicPenPercent: [],
    abilityHaste: 0,
    basicAbilityHaste: 0,
    ultimateHaste: 0,
    msFlat: 0,
    msPercent: 0,
    range: 0,
    lifeSteal: 0,
    omnivamp: 0,
    tenacity: 0,
    healShieldPower: 0,
    adaptive: 0,
    apMult: [],
    uncountedApMult: [],
    bonusAdMult: [],
    bonusHpMult: [],
    armorMult: [],
    mrMult: [],
    attackSpeedCap: 0,
    attackSpeedCapLimit: 0,
    attackSpeedPastCap: 0,
    critChanceMult: [],
    conversions: [],
  };
}

export function mergeMods(into: StatMods, from: Partial<StatMods>): StatMods {
  for (const [k, v] of Object.entries(from) as [keyof StatMods, any][]) {
    if (v === undefined) continue;
    const cur = into[k] as any;
    if (Array.isArray(cur)) cur.push(...(Array.isArray(v) ? v : [v]));
    else if (k === "attackSpeedCap") into.attackSpeedCap = Math.max(into.attackSpeedCap, v);
    else if (k === "attackSpeedCapLimit")
      into.attackSpeedCapLimit = into.attackSpeedCapLimit > 0 && v > 0 ? Math.min(into.attackSpeedCapLimit, v) : into.attackSpeedCapLimit || v;
    else (into as any)[k] = cur + v;
  }
  return into;
}

/** Map normalized item stat keys (from the item data) to StatMods. */
export function itemStatsToMods(stats: Record<string, number>): Partial<StatMods> {
  const m: Partial<StatMods> = {};
  const add = (k: keyof StatMods, v: number) => ((m as any)[k] = ((m as any)[k] ?? 0) + v);
  for (const [k, v] of Object.entries(stats)) {
    switch (k) {
      case "hp":
      case "mana":
      case "ad":
      case "ap":
      case "armor":
      case "mr":
      case "attackSpeed":
      case "critChance":
      case "critDamage":
      case "lethality":
      case "armorPenFlat":
      case "magicPenFlat":
      case "abilityHaste":
      case "msFlat":
      case "msPercent":
      case "lifeSteal":
      case "omnivamp":
      case "tenacity":
      case "healShieldPower":
      case "range":
        add(k, v);
        break;
      case "attackSpeedMult":
        add("attackSpeedMult", v);
        break;
      case "armorPenPercent":
        m.armorPenPercent = [...(m.armorPenPercent ?? []), v];
        break;
      case "magicPenPercent":
        m.magicPenPercent = [...(m.magicPenPercent ?? []), v];
        break;
      default:
        break; // regen etc. – irrelevant for damage
    }
  }
  return m;
}

const combinePct = (xs: number[]) => 1 - xs.reduce((p, x) => p * (1 - x), 1);
const product = (xs: number[]) => xs.reduce((p, x) => p * x, 1);

export interface BaseStatsInput {
  base: ChampionBaseStats;
  level: number;
  adaptiveDefault: "physical" | "magic";
  ranged: boolean;
}

/** Stats from level alone (no items). */
export function levelStats(base: ChampionBaseStats, level: number) {
  const g = statProgression(level) * 17; // = (n)(0.7025 + 0.0175 n)
  return {
    hp: base.hp + base.hpPerLevel * g,
    mana: base.mp + base.mpPerLevel * g,
    ad: base.ad + base.adPerLevel * g,
    armor: base.armor + base.armorPerLevel * g,
    mr: base.mr + base.mrPerLevel * g,
    attackSpeedBonus: base.attackSpeedPerLevel * g,
  };
}

export function computeStats(input: BaseStatsInput, mods: StatMods, currentHpPct = 1): Stats {
  const { base, level } = input;
  const lv = levelStats(base, level);

  const baseAd = lv.ad + mods.baseAd;
  let bonusAd = mods.ad;
  let ap = mods.ap;
  let bonusHp = mods.hp;
  let bonusMana = mods.mana;
  let bonusArmor = mods.armor;
  let bonusMr = mods.mr;
  let bonusAs = lv.attackSpeedBonus + mods.attackSpeed + mods.attackSpeedPastCap;
  let abilityHaste = mods.abilityHaste;
  let msPercent = mods.msPercent;
  let lethality = mods.lethality;
  let critDamageBonus = mods.critDamage;

  // The attack speed cap: lowered (Zeri's), or raised, then raised by what attackSpeedPastCap adds.
  const asMult = 1 + mods.attackSpeedMult;
  const raised = Math.max(GAME.attackSpeedCap, mods.attackSpeedCap);
  const capBefore = mods.attackSpeedCapLimit > 0 ? Math.min(mods.attackSpeedCapLimit, raised) : raised;
  const asCap = capBefore + mods.attackSpeedPastCap * base.attackSpeedRatio * asMult;

  // Conversions (Titanic Hydra, Manamune, Archangel's, Heartsteel…), evaluated on pre-conversion values,
  // adaptive force's included (its choice evaluates those it counts without it).
  const critChanceRaw = mods.critChance * product(mods.critChanceMult);
  const pre: Record<Conversion["from"], number> = {
    bonusHp,
    maxHp: lv.hp + bonusHp,
    maxMana: lv.mana + bonusMana,
    bonusMana,
    bonusArmor,
    bonusMr,
    ap,
    bonusAd,
    baseAd,
    totalAd: baseAd + bonusAd,
    critChanceOverCap: Math.max(0, critChanceRaw - 1),
    bonusAttackSpeed: bonusAs,
    // Bonus attack speed past what reaches the cap, without what raises the cap as it adds
    // (Zeri's Burst Fire: wiki, after cripples).
    bonusAttackSpeedOverCap: Math.max(0, bonusAs - mods.attackSpeedPastCap - (capBefore / asMult - base.attackSpeed) / base.attackSpeedRatio),
    lethality,
  };
  const adaptiveType = adaptiveChoice(input.adaptiveDefault, mods, pre);
  if (adaptiveType === "physical") bonusAd += mods.adaptive * GAME.adaptiveToAd;
  else ap += mods.adaptive * GAME.adaptiveToAp;
  pre.ap = ap;
  pre.bonusAd = bonusAd;
  pre.totalAd = baseAd + bonusAd;
  for (const c of mods.conversions) {
    const v = pre[c.from] * c.ratio;
    switch (c.to) {
      case "ad":
        bonusAd += v;
        break;
      case "ap":
        ap += v;
        break;
      case "hp":
        bonusHp += v;
        break;
      case "abilityHaste":
        abilityHaste += v;
        break;
      case "armor":
        bonusArmor += v;
        break;
      case "mr":
        bonusMr += v;
        break;
      case "attackSpeed":
        bonusAs += v;
        break;
      case "msPercent":
        msPercent += v;
        break;
      case "lethality":
        lethality += v;
        break;
      case "critDamage":
        critDamageBonus += v;
        break;
    }
  }

  bonusAd *= product(mods.bonusAdMult);
  bonusHp *= product(mods.bonusHpMult);
  ap *= 1 + mods.apMult.reduce((s, m) => s + (m - 1), 0);
  const armorMult = product(mods.armorMult);
  const mrMult = product(mods.mrMult);

  const maxHp = lv.hp + bonusHp;
  const asUncapped = (base.attackSpeed + bonusAs * base.attackSpeedRatio) * asMult;
  const ms = (base.ms + mods.msFlat) * (1 + msPercent);

  return {
    level,
    ranged: input.ranged,
    maxHp,
    baseHp: lv.hp,
    bonusHp,
    hp: maxHp * currentHpPct,
    maxMana: lv.mana + bonusMana,
    baseMana: lv.mana,
    bonusMana,
    ad: baseAd + bonusAd,
    baseAd,
    bonusAd,
    ap,
    armor: (lv.armor + bonusArmor) * armorMult,
    baseArmor: lv.armor * armorMult,
    bonusArmor: bonusArmor * armorMult,
    mr: (lv.mr + bonusMr) * mrMult,
    baseMr: lv.mr * mrMult,
    bonusMr: bonusMr * mrMult,
    attackSpeed: Math.min(asUncapped, asCap),
    baseAttackSpeed: base.attackSpeed,
    attackSpeedRatio: base.attackSpeedRatio,
    bonusAttackSpeed: bonusAs,
    attackSpeedCap: asCap,
    critChance: Math.min(1, critChanceRaw),
    // Base crit damage is the champion record's multiplier (2.0 = 200% since 26.1; Ashe 1.0).
    // Champion-specific crit modifiers (Yasuo ×0.95, Jhin ×0.75…) are applied by kits.
    critDamage: base.critDamageMultiplier + critDamageBonus,
    lethality,
    armorPenFlat: mods.armorPenFlat,
    armorPenPercent: combinePct(mods.armorPenPercent),
    bonusArmorPenPercent: combinePct(mods.bonusArmorPenPercent),
    magicPenFlat: mods.magicPenFlat,
    magicPenPercent: combinePct(mods.magicPenPercent),
    bonusMagicPenPercent: combinePct(mods.bonusMagicPenPercent),
    abilityHaste,
    basicAbilityHaste: mods.basicAbilityHaste,
    ultimateHaste: mods.ultimateHaste,
    moveSpeed: ms,
    bonusMoveSpeed: ms - base.ms,
    range: base.range + mods.range,
    bonusRange: mods.range,
    lifeSteal: mods.lifeSteal,
    omnivamp: mods.omnivamp,
    tenacity: mods.tenacity,
    healShieldPower: mods.healShieldPower,
    adaptiveForce: mods.adaptive,
    adaptiveType,
    critChanceCapExceeded: critChanceRaw > 1,
  };
}

/**
 * The stat adaptive force gives: AD if bonus AD > AP, AP if AP > bonus AD, the champion's type on a tie,
 * counting only what the wiki says counts (Adaptive_force, 2026-09): what items and runes give, not what
 * champion passives give (uncountedAd/Ap, a kit's conversions and AP multipliers), nor a few item passives
 * (Staff of Flowing Water's Rapids, Riftmaker's Void Infusion, Archangel's Staff, Seraph's Embrace,
 * Manamune and Muramana's Awe), nor the adaptive force itself; items' conversions that count (Sterak's
 * Gage, Overlord's Bloodmail) are evaluated on `pre` before it. Rabadon's Deathcap's Magical Opus counts,
 * of all AP, so its share of AP that doesn't count does too: the wiki's example, Veigar with Rabadon's
 * (130 AP) compares 169 AP with 160 bonus AD from items and keeps AP; with 170 AD it turns AD; with 10 AP
 * from Phenomenal Evil, which doesn't count by itself, it compares 169 + 10 × 0.3 = 172: AP again.
 */
function adaptiveChoice(adaptiveDefault: "physical" | "magic", mods: StatMods, pre: Record<Conversion["from"], number>): "physical" | "magic" {
  let ad = mods.ad - mods.uncountedAd;
  let ap = mods.ap - mods.uncountedAp;
  let uncountedAp = mods.uncountedAp;
  for (const c of mods.conversions) {
    if (c.to === "ad" && !c.uncounted) ad += pre[c.from] * c.ratio;
    else if (c.to === "ap" && c.uncounted) uncountedAp += pre[c.from] * c.ratio;
    else if (c.to === "ap") ap += pre[c.from] * c.ratio;
  }
  // Magical Opus (and Blackfire Torch's Baleful Blaze) on all of it: (counted + uncounted) × (1 + mult) − uncounted.
  const mult = mods.apMult.reduce((s, m) => s + (m - 1), 0) - mods.uncountedApMult.reduce((s, m) => s + (m - 1), 0);
  if (mult) ap += (ap + uncountedAp) * mult;
  return ad > ap ? "physical" : ap > ad ? "magic" : adaptiveDefault;
}

/** Cooldown after ability haste. */
export function hasteCooldown(base: number, haste: number): number {
  return base * (100 / (100 + haste));
}
