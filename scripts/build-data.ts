// Turns the raw game files from scripts/fetch-data.ts into the compact JSON the engine loads.
//
//   data/generated/<patch>/meta.json
//   data/generated/<patch>/champions.json        (index: id, name, icon, roles…)
//   data/generated/<patch>/champions/<id>.json   (stats + every ability's values, formulas and tooltip)
//   data/generated/<patch>/items.json
//   data/generated/<patch>/runes.json
//
// Usage: node scripts/build-data.ts [patch]   (default: newest folder in data/raw)

import { readFile, writeFile, mkdir, readdir, rm, rename } from 'node:fs/promises';
import { join } from 'node:path';
import type { CalcNode, CalcPart, ChampionData, ChampionIndexEntry, ItemData, RuneData, SpellData, AbilityData } from '../src/engine/data-types.ts';

const ROOT = new URL('..', import.meta.url).pathname;

const readJson = async (p: string) => JSON.parse(await readFile(p, 'utf8'));

// ---------------------------------------------------------------------------
// String table (tooltips)

let STRINGS: Record<string, string> = {};

function str(key: string | undefined): string {
  if (!key) return '';
  return STRINGS[key.toLowerCase()] ?? '';
}

/** Resolve {{ Include_Key }} references, which tooltips use to share sentences. */
function resolveIncludes(text: string, depth = 0): string {
  if (depth > 5) return text;
  return text.replace(/\{\{\s*([A-Za-z0-9_@.]+)\s*\}\}/g, (m, key: string) => {
    if (key.includes('@')) return m; // dynamic (e.g. per game mode) – leave as is
    const s = STRINGS[key.toLowerCase()];
    return s === undefined ? m : resolveIncludes(s, depth + 1);
  });
}

// ---------------------------------------------------------------------------
// Calculation trees: convert the bin representation into a compact, typed form.

const KNOWN_HASH_TYPES: Record<string, string> = {
  '{f3cbe7b2}': 'ref',
  '{9e9e2e5c}': 'extdv',
  '{ee18a47b}': 'lerpdv',
  '{4ce08984}': 'bpdv',
  '{b22609db}': 'lvldv',
};

/** GameCalculation variant whose result is multiplied by mRangedMultiplier for ranged champions. */
const RANGED_CALC_TYPE = '{e9a3c91d}';

const unknownParts = new Map<string, number>();

function convPart(p: any): CalcPart {
  if (p == null) return { t: 'num', v: 0 };
  const type: string = p.__type;
  switch (KNOWN_HASH_TYPES[type] ?? type) {
    case 'NamedDataValueCalculationPart':
      return { t: 'dv', name: p.mDataValue };
    case 'StatByCoefficientCalculationPart':
      return { t: 'stat', stat: p.mStat ?? 0, formula: p.mStatFormula ?? 0, coef: p.mCoefficient ?? 0, ...(p['{a8cb9c14}'] ? { target: true } : {}) };
    case 'StatByNamedDataValueCalculationPart':
      return { t: 'statdv', stat: p.mStat ?? 0, formula: p.mStatFormula ?? 0, dv: p.mDataValue, ...(p['{a8cb9c14}'] ? { target: true } : {}) };
    case 'StatBySubPartCalculationPart':
      return { t: 'statsub', stat: p.mStat ?? 0, formula: p.mStatFormula ?? 0, sub: convPart(p.mSubpart), ...(p['{a8cb9c14}'] ? { target: true } : {}) };
    case 'NumberCalculationPart':
      return { t: 'num', v: p.mNumber ?? 0 };
    case 'SumOfSubPartsCalculationPart':
      return { t: 'sum', parts: (p.mSubparts ?? []).map(convPart) };
    case 'ProductOfSubPartsCalculationPart':
      return { t: 'prod', a: convPart(p.mPart1), b: convPart(p.mPart2) };
    case 'ByCharLevelInterpolationCalculationPart':
      return {
        t: 'lerp',
        start: p.mStartValue ?? 0,
        end: p.mEndValue ?? 0,
        ...(p.mScaleByStatProgressionMultiplier ? { statProgression: true } : {}),
      };
    case 'ByCharLevelBreakpointsCalculationPart':
      return {
        t: 'bp',
        l1: p.mLevel1Value ?? 0,
        init: p.mInitialBonusPerLevel ?? 0,
        bps: (p.mBreakpoints ?? []).map((b: any) => ({ level: b.mLevel ?? 1, perLevel: b.mBonusPerLevelAtAndAfter ?? 0, add: b.mAdditionalBonusAtThisLevel ?? 0 })),
      };
    case 'ByCharLevelFormulaCalculationPart':
      return { t: 'lvltable', values: p.values ?? [] };
    case 'EffectValueCalculationPart':
      return { t: 'effect', idx: p.mEffectIndex ?? 0 };
    case 'CooldownMultiplierCalculationPart':
      return { t: 'cdmult' };
    case 'AbilityResourceByCoefficientCalculationPart':
      return { t: 'resource', coef: p.mCoefficient ?? 0, formula: p.mStatFormula ?? 0, resource: p.mAbilityResource ?? 0 };
    case 'BuffCounterByCoefficientCalculationPart':
      return { t: 'buff', buff: p.mBuffName, coef: p.mCoefficient ?? 0 };
    case 'BuffCounterByNamedDataValueCalculationPart':
      return { t: 'buffdv', buff: p.mBuffName, dv: p.mDataValue };
    case 'ClampSubPartsCalculationPart':
      return { t: 'clamp', floor: p.mFloor ?? null, ceil: p.mCeiling ?? null, parts: (p.mSubparts ?? []).map(convPart) };
    case 'ExponentSubPartsCalculationPart':
      return { t: 'pow', parts: (p.mSubparts ?? []).map(convPart), exp: p.mExponent ?? p.mPart2 ?? 1 };
    case 'ref':
      return { t: 'ref', name: p.mSpellCalculationKey };
    case 'extdv':
      return { t: 'extdv', spell: p.SourceObject, name: p.DataValue };
    case 'lerpdv':
      // Field names are sometimes unhashed (StartDataValue) and sometimes hashed.
      return { t: 'lerpdv', start: p.StartDataValue ?? p['{0589a59c}'], end: p.EndDataValue ?? p['{0b65bc23}'] };
    case 'bpdv':
      return {
        t: 'bpdv',
        l1: p['{91d404a5}'],
        init: p['{bbd778a2}'],
        bps: (p['{9823b29a}'] ?? []).map((b: any) => ({ level: b.level, perLevel: b['{b0d8b2ac}'], add: b['{ae9b464d}'] })),
      };
    case 'lvldv':
      return { t: 'lvldv', base: p['{91d404a5}'], perLevel: p['{b2cd0eb0}'] };
    case 'PercentageOfBuffNameElapsed':
      return { t: 'buffelapsed', buff: p.buffName, coef: p.Coefficient ?? 1 };
    case 'ByItemEpicnessCountCalculationPart':
      return { t: 'itemcount', epicness: p.epicness ?? 0, coef: p.Coefficient ?? 1 };
    default:
      unknownParts.set(type, (unknownParts.get(type) ?? 0) + 1);
      return { t: 'unknown', type };
  }
}

function convCalc(c: any): CalcNode {
  const common: any = {};
  if (c.mDisplayAsPercent) common.pct = true;
  if (c.tooltipOnly) common.tooltipOnly = true;
  if (c.DamageType !== undefined) common.damageType = c.DamageType;
  if (c.mPrecision !== undefined) common.precision = c.mPrecision;
  switch (c.__type) {
    case 'GameCalculation':
    case RANGED_CALC_TYPE:
      return {
        t: 'calc',
        parts: (c.mFormulaParts ?? []).map(convPart),
        ...(c.mMultiplier ? { mult: convPart(c.mMultiplier) } : {}),
        ...(c.mRangedMultiplier ? { rangedMult: convPart(c.mRangedMultiplier) } : {}),
        ...common,
      };
    case 'GameCalculationModified':
      return {
        t: 'mod',
        of: c.mModifiedGameCalculation,
        mult: convPart(c.mMultiplier),
        ...(c.mOverrideSpellLevel !== undefined ? { rank: c.mOverrideSpellLevel } : {}),
        ...common,
      };
    case 'GameCalculationConditional': {
      const req = c.mConditionalCalculationRequirements ?? {};
      return {
        t: 'cond',
        default: c.mDefaultGameCalculation ?? null,
        conditional: c.mConditionalGameCalculation,
        requirement: { type: req.__type, ...(req.mBuffName ? { buff: req.mBuffName } : {}) },
        ...common,
      };
    }
    default:
      unknownParts.set(c.__type, (unknownParts.get(c.__type) ?? 0) + 1);
      return { t: 'calc', parts: [], ...common };
  }
}

function convCalcs(obj: any): Record<string, CalcNode> {
  const out: Record<string, CalcNode> = {};
  for (const [k, v] of Object.entries(obj ?? {})) out[k] = convCalc(v);
  return out;
}

/** Riot hashes names with 32-bit FNV-1a over the lowercase string; CDragon prints unknown ones as {xxxxxxxx}. */
export function fnv1a(name: string): string {
  let h = 0x811c9dc5;
  for (const b of Buffer.from(name.toLowerCase(), 'utf8')) {
    h ^= b;
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return `{${h.toString(16).padStart(8, '0')}}`;
}

const HASHED = /^\{[0-9a-f]{8}\}$/;
let unresolvedHashes = 0;
const unresolvedNames = new Set<string>();
let resolvedHashes = 0;

/**
 * Replace hashed data-value / calculation names inside calc trees with their real names, using the
 * names that exist on the same entity (and optionally sibling spells).
 */
function unhashCalcs(calcs: Record<string, CalcNode>, dvNames: string[], extraCalcNames: string[] = []) {
  const dvMap = new Map(dvNames.map((n) => [fnv1a(n), n]));
  for (const n of dvNames) if (HASHED.test(n)) dvMap.set(n, n);
  const calcMap = new Map([...Object.keys(calcs), ...extraCalcNames].map((n) => [fnv1a(n), n]));
  for (const n of Object.keys(calcs)) if (HASHED.test(n)) calcMap.set(n, n);
  const fix = (name: any, map: Map<string, string>) => {
    if (typeof name !== 'string' || !HASHED.test(name)) return name;
    const real = map.get(name);
    if (real === name) return name;
    if (!real) unresolvedNames.add(name);
    if (real) resolvedHashes++;
    else unresolvedHashes++;
    return real ?? name;
  };
  const walk = (p: any): any => {
    if (!p || typeof p !== 'object') return p;
    if (Array.isArray(p)) return p.map(walk);
    const o: any = { ...p };
    switch (o.t) {
      case 'dv':
        o.name = fix(o.name, dvMap);
        break;
      case 'statdv':
      case 'buffdv':
        o.dv = fix(o.dv, dvMap);
        break;
      case 'lerpdv':
        o.start = fix(o.start, dvMap);
        o.end = fix(o.end, dvMap);
        break;
      case 'lvldv':
        o.base = fix(o.base, dvMap);
        o.perLevel = fix(o.perLevel, dvMap);
        break;
      case 'bpdv':
        o.l1 = fix(o.l1, dvMap);
        o.init = fix(o.init, dvMap);
        o.bps = o.bps.map((b: any) => ({ ...b, perLevel: fix(b.perLevel, dvMap), add: fix(b.add, dvMap) }));
        break;
      case 'ref':
        o.name = fix(o.name, calcMap);
        break;
      case 'mod':
        o.of = fix(o.of, calcMap);
        break;
      case 'cond':
        o.default = fix(o.default, calcMap);
        o.conditional = fix(o.conditional, calcMap);
        break;
    }
    for (const [k, v] of Object.entries(o)) if (v && typeof v === 'object') o[k] = walk(v);
    return o;
  };
  for (const k of Object.keys(calcs)) calcs[k] = walk(calcs[k]);
}

// ---------------------------------------------------------------------------
// Champions

const mf = (v: any, dflt = 0): number => (v == null ? dflt : typeof v === 'number' ? v : (v.baseValue ?? dflt));

const RESOURCE_TYPES: Record<number, string> = {
  0: 'mana',
  1: 'energy',
  2: 'none',
  3: 'shield',
  4: 'battlefury',
  5: 'dragonfury',
  6: 'rage',
  7: 'heat',
  8: 'gnarfury',
  9: 'ferocity',
  10: 'bloodwell',
  11: 'wind',
  12: 'ammo',
  13: 'moonlight',
  14: 'other',
};

function convSpell(path: string, obj: any): SpellData | null {
  const sp = obj?.mSpell;
  if (!sp) return null;
  const tip = sp.mClientData?.mTooltipData;
  const keys = tip?.mLocKeys ?? {};
  const dataValues: Record<string, number[]> = {};
  for (const dv of sp.DataValues ?? []) if (dv.name) dataValues[dv.name] = (dv.values ?? []).map((x: number) => x ?? 0);
  const effects: number[][] = (sp.mEffectAmount ?? []).map((e: any) => (e?.value ?? []).map((x: number) => x ?? 0));
  const levelCount = tip?.mLists?.LevelUp?.levelCount;
  const calcs = convCalcs(sp.mSpellCalculations);
  unhashCalcs(calcs, Object.keys(dataValues));
  const spell: SpellData = {
    path,
    scriptName: obj.mScriptName ?? path.split('/').pop()!,
    name: str(keys.keyName) || obj.mScriptName || path.split('/').pop()!,
    tooltip: resolveIncludes(str(keys.keyTooltip)),
    ...(levelCount ? { levelCount } : {}),
    dataValues,
    calcs,
    ...(effects.some((e) => e.some((x) => x !== 0)) ? { effects } : {}),
    // The bin omits fields equal to their default; cooldownTime's default is 10s at every rank
    // (verified against the wiki for Morgana Q, Milio Q, Yi W, Jayce hammer W, Yunara W, Yuumi E).
    cooldown: sp.cooldownTime ?? [10, 10, 10, 10, 10, 10, 10],
    ...(sp.mana ? { cost: sp.mana } : {}),
    castTime: sp.mCastTime ?? sp.spellCastTime ?? 0,
    ...(sp.mChannelDuration ? { channel: sp.mChannelDuration } : {}),
    ...(sp.mMaxAmmo ? { maxAmmo: sp.mMaxAmmo, ammoRecharge: sp.mAmmoRechargeTime } : {}),
    ...(sp.mSpellTags ? { tags: sp.mSpellTags } : {}),
    ...(sp.mCooldownNotAffectedByCDR ? { cooldownFixed: true } : {}),
  };
  return spell;
}

function slotOfAbility(rec: any, abilityPath: string, rootSpell: string | undefined, mType: number | undefined): AbilityData['slot'] {
  const slots = ['Q', 'W', 'E', 'R'] as const;
  const idx = (rec.spells ?? []).indexOf(rootSpell);
  if (idx >= 0 && idx < 4) return slots[idx];
  if (mType === 3) return 'P';
  if (rootSpell && rec.mCharacterPassiveSpell && rootSpell === rec.mCharacterPassiveSpell) return 'P';
  return 'X';
}

function buildChampion(dd: any, bin: any): ChampionData {
  const rec = Object.entries(bin).find(([k, v]: [string, any]) => k.endsWith('/CharacterRecords/Root') && v?.__type === 'CharacterRecord')?.[1] as any;
  if (!rec) throw new Error(`no CharacterRecord for ${dd.id}`);
  const par = rec.primaryAbilityResource ?? {};
  const stats = {
    hp: mf(rec.baseHPModifiable),
    hpPerLevel: mf(rec.hpPerLevelModifiable),
    hpRegen: mf(rec.baseStaticHPRegenModifiable),
    hpRegenPerLevel: mf(rec.hpRegenPerLevelModifiable),
    resource: RESOURCE_TYPES[par.arType ?? 0] ?? 'other',
    mp: mf(par['{726ee5cd}']),
    mpPerLevel: mf(par['{6216bf7b}']),
    mpRegen: mf(par['{c4ab3550}']),
    mpRegenPerLevel: mf(par['{3a509002}']),
    ad: mf(rec.baseDamageModifiable),
    adPerLevel: mf(rec.damagePerLevelModifiable),
    armor: mf(rec.baseArmorModifiable),
    armorPerLevel: mf(rec.armorPerLevelModifiable),
    mr: mf(rec.baseMR),
    mrPerLevel: mf(rec.mrPerLevel),
    ms: mf(rec.baseMoveSpeedModifiable),
    range: mf(rec.attackRangeModifiable),
    attackSpeed: mf(rec.attackSpeedModifiable),
    attackSpeedRatio: mf(rec.attackSpeedRatioModifiable, mf(rec.attackSpeedModifiable)),
    attackSpeedPerLevel: mf(rec.attackSpeedPerLevelModifiable) / 100,
    critDamageMultiplier: rec.critDamageMultiplier ?? 2,
    attackWindupOffset: rec.basicAttack?.mAttackDelayCastOffsetPercent ?? 0,
    ...(rec.basicAttack?.mAttackCastTime ? { attackCastTime: rec.basicAttack.mAttackCastTime, attackTotalTime: rec.basicAttack.mAttackTotalTime } : {}),
  };

  // Abilities: every AbilityObject, with its root + child spells.
  const abilities: AbilityData[] = [];
  const seenSpells = new Set<string>();
  for (const path of rec.mAbilities ?? []) {
    const ab = bin[path];
    if (!ab) continue;
    const spells: SpellData[] = [];
    for (const sp of [ab.mRootSpell, ...(ab.mChildSpells ?? [])]) {
      if (!sp || seenSpells.has(sp)) continue;
      seenSpells.add(sp);
      const s = convSpell(sp, bin[sp]);
      if (s) spells.push(s);
    }
    if (!spells.length) continue;
    abilities.push({ name: ab.mName ?? path.split('/').pop(), slot: slotOfAbility(rec, path, ab.mRootSpell, ab.mType), spells });
  }
  // Spells referenced by the record but not owned by an AbilityObject (older champions).
  const loose: SpellData[] = [];
  for (const [k, v] of Object.entries(bin) as [string, any][]) {
    if (v?.__type !== 'SpellObject' || seenSpells.has(k)) continue;
    const sp = v.mSpell;
    const hasEffects = (sp?.mEffectAmount ?? []).some((e: any) => (e?.value ?? []).some((x: number) => x));
    const hasTooltip = !!sp?.mClientData?.mTooltipData?.mLocKeys?.keyTooltip;
    if (!sp?.mSpellCalculations && !sp?.DataValues && !hasEffects && !hasTooltip) continue;
    if (/Skin\d|Manager$|VFX|Emote/i.test(k)) continue;
    const s = convSpell(k, v);
    if (s) loose.push(s);
  }
  // Older champions keep Q/W/E/R spells directly in record.spells without AbilityObjects.
  const slotOrder = ['Q', 'W', 'E', 'R'] as const;
  (rec.spells ?? []).slice(0, 4).forEach((sp: string, i: number) => {
    if (abilities.some((a) => a.slot === slotOrder[i])) return;
    const j = loose.findIndex((s) => s.path === sp);
    const s = j >= 0 ? loose.splice(j, 1)[0] : convSpell(sp, bin[sp]);
    if (s) abilities.push({ name: s.scriptName, slot: slotOrder[i], spells: [s] });
  });
  if (!abilities.some((a) => a.slot === 'P') && rec.mCharacterPassiveSpell) {
    const sp = rec.mCharacterPassiveSpell;
    const j = loose.findIndex((s) => s.path === sp);
    const s = j >= 0 ? loose.splice(j, 1)[0] : convSpell(sp, bin[sp]);
    if (s) abilities.push({ name: s.scriptName, slot: 'P', spells: [s] });
  }
  if (loose.length) abilities.push({ name: 'Other', slot: 'X', spells: loose });

  const passiveName = str(rec.passiveName) || abilities.find((a) => a.slot === 'P')?.spells[0]?.name || 'Passive';
  const passiveText = resolveIncludes(str(rec.passiveToolTip));

  return {
    id: dd.id,
    key: Number(dd.key),
    name: dd.name,
    title: dd.title,
    tags: dd.tags,
    partype: dd.partype,
    icon: `champion/${dd.image.full}`,
    attackType: stats.range >= 300 ? 'ranged' : 'melee',
    adaptive: (rec.mAdaptiveForceToAbilityPowerWeight ?? 0) >= 0.5 ? 'magic' : 'physical',
    stats,
    passive: { name: passiveName, description: passiveText },
    abilities,
  };
}

// ---------------------------------------------------------------------------
// Items

const ITEM_STAT_FIELDS: Record<string, string> = {
  mFlatHPPoolMod: 'hp',
  mFlatMPPoolMod: 'mana',
  flatMPPoolMod: 'mana',
  mFlatPhysicalDamageMod: 'ad',
  mFlatMagicDamageMod: 'ap',
  mFlatArmorMod: 'armor',
  mFlatSpellBlockMod: 'mr',
  mPercentAttackSpeedMod: 'attackSpeed',
  mPercentMultiplicativeAttackSpeedMod: 'attackSpeedMult',
  mFlatCritChanceMod: 'critChance',
  mFlatCritDamageMod: 'critDamage',
  PhysicalLethality: 'lethality',
  mFlatArmorPenetrationMod: 'armorPenFlat',
  mPercentArmorPenetrationMod: 'armorPenPercent',
  mFlatMagicPenetrationMod: 'magicPenFlat',
  mPercentMagicPenetrationMod: 'magicPenPercent',
  mAbilityHasteMod: 'abilityHaste',
  mFlatMovementSpeedMod: 'msFlat',
  mPercentMovementSpeedMod: 'msPercent',
  mPercentLifeStealMod: 'lifeSteal',
  PercentOmnivampMod: 'omnivamp',
  mFlatHPRegenMod: 'hpRegen',
  mPercentBaseHPRegenMod: 'baseHpRegen',
  percentBaseMPRegenMod: 'baseMpRegen',
  flatMPRegenMod: 'mpRegen',
  mPercentHealingAmountMod: 'healShieldPower',
  mPercentTenacityItemMod: 'tenacity',
  mPercentSlowResistMod: 'slowResist',
  mFlatAttackRangeMod: 'range',
  mPercentCooldownMod: 'cdr',
};

function buildItems(ddItems: any, bin: any): Record<string, ItemData> {
  const out: Record<string, ItemData> = {};
  for (const [id, dd] of Object.entries(ddItems.data) as [string, any][]) {
    if (Number(id) >= 100000) continue; // other modes (Arena etc.)
    if (!dd.maps?.['11']) continue; // Summoner's Rift only
    const b = bin[`Items/${id}`];
    if (!b) continue;
    const stats: Record<string, number> = {};
    for (const [field, key] of Object.entries(ITEM_STAT_FIELDS)) if (typeof b[field] === 'number' && b[field] !== 0) stats[key] = (stats[key] ?? 0) + b[field];
    const dataValues: Record<string, number> = {};
    for (const dv of b.mDataValues ?? []) if (dv.mName) dataValues[dv.mName] = dv.mValue ?? 0;
    const calcs = convCalcs(b.mItemCalculations);
    unhashCalcs(calcs, Object.keys(dataValues));
    const tooltip = resolveIncludes(str(`item_${id}_tooltip`) || '');
    const resolved = str(`generatedtip_item_${id}_externaldescription`);
    out[id] = {
      id: Number(id),
      name: dd.name,
      icon: `item/${dd.image.full}`,
      gold: { total: dd.gold.total, base: dd.gold.base, sell: dd.gold.sell, purchasable: !!dd.gold.purchasable },
      tags: dd.tags ?? [],
      from: (dd.from ?? []).map(Number),
      into: (dd.into ?? []).map(Number),
      depth: dd.depth ?? 1,
      inStore: dd.inStore !== false && !!dd.gold.purchasable,
      requiredChampion: dd.requiredChampion,
      stats,
      dataValues,
      calcs,
      tooltip,
      description: resolved,
      plaintext: dd.plaintext ?? '',
    };
  }
  return out;
}

// ---------------------------------------------------------------------------
// Runes

function buildRunes(ddRunes: any, bin: any): RuneData[] {
  const byId = new Map<number, any>();
  for (const v of Object.values(bin) as any[]) if (v?.__type === 'Perk' && v.mPerkId) byId.set(v.mPerkId, v);
  const out: RuneData[] = [];
  for (const tree of ddRunes) {
    tree.slots.forEach((slot: any, row: number) => {
      for (const r of slot.runes) {
        const b = byId.get(r.id);
        const sd = b?.mScript?.mSpellScriptData ?? {};
        const calcs = convCalcs(sd.mCalculations);
        unhashCalcs(calcs, Object.keys(sd.mEffectAmount ?? {}));
        out.push({
          id: r.id,
          key: r.key,
          name: r.name,
          tree: tree.key,
          treeId: tree.id,
          row,
          icon: r.icon,
          values: sd.mEffectAmount ?? {},
          calcs,
          description: resolveIncludes(str(b?.mLongDescLocalizationKey) || r.longDesc || ''),
        });
      }
    });
  }
  // Stat shards are not part of runesReforged.json.
  for (const v of Object.values(bin) as any[]) {
    if (v?.__type !== 'Perk' || !v.mPerkId || v.mPerkId < 5000 || v.mPerkId > 5999) continue;
    const sd = v.mScript?.mSpellScriptData ?? {};
    out.push({
      id: v.mPerkId,
      key: v.mPerkName,
      name: str(v.mDisplayNameLocalizationKey) || v.mPerkName,
      tree: 'Shards',
      treeId: 0,
      row: -1,
      icon: (v.mIconTextureName ?? '').replace(/\.tex$/, '.png'),
      values: sd.mEffectAmount ?? {},
      calcs: convCalcs(sd.mCalculations),
      description: resolveIncludes(str(v.mLongDescLocalizationKey) || str(v.mShortDescLocalizationKey) || ''),
      ...(v.mStatModifiers ? { statModifiers: v.mStatModifiers } : {}),
    });
  }
  return out;
}

// ---------------------------------------------------------------------------

async function main() {
  const rawRoot = join(ROOT, 'data/raw');
  const patch =
    process.argv[2] ??
    (await readdir(rawRoot))
      .filter((d) => /^\d+\.\d+$/.test(d))
      .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
      .pop();
  if (!patch) throw new Error('no raw data; run npm run data:fetch first');
  const raw = join(rawRoot, patch);
  // Build into a temporary folder and swap it in at the end, so readers never see a half-written patch.
  const finalDir = join(ROOT, 'data/generated', patch);
  const outDir = `${finalDir}.tmp`;
  await rm(outDir, { recursive: true, force: true });
  await mkdir(join(outDir, 'champions'), { recursive: true });

  STRINGS = (await readJson(join(raw, 'stringtable.json'))).entries;
  const meta = await readJson(join(raw, 'meta.json'));
  const ddChamps = await readJson(join(raw, 'dd_champion.json'));

  const index: ChampionIndexEntry[] = [];
  for (const dd of Object.values(ddChamps.data) as any[]) {
    const bin = await readJson(join(raw, 'champions', `${dd.id.toLowerCase()}.bin.json`));
    const champ = buildChampion(dd, bin);
    await writeFile(join(outDir, 'champions', `${champ.id}.json`), JSON.stringify(champ));
    index.push({ id: champ.id, key: champ.key, name: champ.name, title: champ.title, tags: champ.tags, icon: champ.icon, attackType: champ.attackType, adaptive: champ.adaptive, resource: champ.stats.resource });
  }
  index.sort((a, b) => a.name.localeCompare(b.name));
  await writeFile(join(outDir, 'champions.json'), JSON.stringify(index));

  const items = buildItems(await readJson(join(raw, 'dd_item.json')), await readJson(join(raw, 'items.bin.json')));
  await writeFile(join(outDir, 'items.json'), JSON.stringify(items));

  const runes = buildRunes(await readJson(join(raw, 'dd_runes.json')), await readJson(join(raw, 'perks.bin.json')));
  await writeFile(join(outDir, 'runes.json'), JSON.stringify(runes));

  // Summoner spells (Ignite) live in the shared bin.
  const shared = await readJson(join(raw, 'shared.bin.json'));
  const summoners: Record<string, SpellData> = {};
  for (const name of ['SummonerDot']) {
    const path = `Shared/Spells/${name}`;
    const s = convSpell(path, shared[path]);
    if (s) summoners[name] = s;
  }
  await writeFile(join(outDir, 'summoners.json'), JSON.stringify(summoners));

  await writeFile(join(outDir, 'meta.json'), JSON.stringify({ ...meta, builtAt: new Date().toISOString(), champions: index.length, items: Object.keys(items).length, runes: runes.length }, null, 2));
  await rm(`${finalDir}.old`, { recursive: true, force: true });
  await rename(finalDir, `${finalDir}.old`).catch(() => {});
  await rename(outDir, finalDir);
  await rm(`${finalDir}.old`, { recursive: true, force: true });
  await writeFile(join(ROOT, 'data/generated/current.json'), JSON.stringify({ patch }, null, 2));

  console.log(`patch ${patch}: ${index.length} champions, ${Object.keys(items).length} items, ${runes.length} runes -> ${finalDir}`);
  if (unknownParts.size) console.warn('unknown calculation part types:', Object.fromEntries(unknownParts));
  console.log(`hashed names resolved: ${resolvedHashes}, unresolved: ${unresolvedHashes}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
