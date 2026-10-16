# Item mechanics for a damage simulator: patch 16.20 (wiki "V26.20")

Research date: 2026-10-14.

**Where the numbers and rules come from**
- **Numbers:** `dumps/items.txt`. This file is authoritative. The data value names below (for example `BurnPercentHealthDamage`) are the names used in items.txt.
- **Behaviour:** the League of Legends Wiki (`wiki.leagueoflegends.com/en-us`). I fetched each page as raw wikitext (`?action=raw`) so that the notes are verbatim, without a summarizer in between. The pages I used:
  - `Module:ItemData/data`, which holds the live item descriptions
  - each item page's `notes` and `patchhistory` sections
  - the shared note templates (Spellblade, Energized, Manaflow and "ultimate-cast" info)
  - the patch pages V26.09, V26.10 and V26.17 to V26.20
  - these mechanics pages: Critical strike, Armor penetration, Magic penetration, Damage, Damage modifier, Ability damage, Ability effects, Named item effect, Item group, Combat status and Adaptive force

  Local copies are in `scratchpad/wiki_raw/`.

**Patch alignment.** The client's 16.20 is the wiki's V26.20 (the 2026 annual cycle). The wiki already includes the V26.20 changes, and all of them match items.txt:
- Rocketbelt: 135 + 15% AP, 10 AH
- Runaan's: 60% AD
- Hexplate (ranged): 25% AS and 10% MS

A script compared every `STATS` block in items.txt with the wiki's stat tables and found **0 base-stat mismatches**. The disagreements are only in passive data values; they are listed in §14.

**Confidence levels**
- **H:** the items.txt number agrees with the wiki, and the behaviour is written down explicitly on the wiki.
- **M:** the behaviour is documented, but there is a small data/wiki disagreement, or part of the rule is my inference.
- **L:** not documented anywhere; this is my best guess. Make it a configuration flag in the simulator.

---

## 1. Decoding items.txt CALCS and DATA (inferred, then checked against wiki values)

| Field | Meaning |
|---|---|
| `mStat` | Which stat a part scales with. Absent or 0 = AP, 1 = Armor, 2 = AD, 6 = MR, 7 = Move Speed, 8 = Crit Chance (0–1), 12 = Max Health, 13 = Current Health, 29 = Lethality. 31 appears only in tooltip-only calcs, so ignore it. |
| `{a8cb9c14}: true` on a stat part | Read the **target's** stat instead of yours (BotRK's current health, World Atlas). |
| `mStatFormula` | Absent = total, 1 = base, 2 = bonus. Example: Sheen `mStat 2, mStatFormula 1` is base AD. |
| `AbilityResourceByCoefficientCalculationPart` | Scales with mana. Total mana by default; `mStatFormula: 2` means bonus mana. |
| `ByCharLevelBreakpointsCalculationPart` | `v(L) = mLevel1Value + Σ[mBonusPerLevelAtAndAfter·max(0, L−mLevel+1)] + Σ[mAdditionalBonusAtThisLevel if L ≥ mLevel] + mInitialBonusPerLevel·(L−1)`. Checks: Kraken 150 → 155 at level 9 → 200 at level 18 ✓. Bloodthirster 165 → 315 ✓. Statikk bounces 4/5/6/7 at levels 1/6/10/14 ✓. Terminus 6/7/8 ✓. |
| `ByCharLevelInterpolationCalculationPart` | Linear from `mStartValue` at level 1 to `mEndValue` at level 18: `start + (end−start)·(L−1)/17`. Gunblade 175 → 253 ✓. |
| `__type {e9a3c91d}` with `mRangedMultiplier` | The whole formula is multiplied by `mRangedMultiplier` when the holder is ranged (a melee/ranged split). |
| `GameCalculationConditional` + `IsRangedCastRequirement` | Chooses the ranged calc for ranged holders. |
| `ChampRange` calc (1 or 2) | Only picks which tooltip text to show. Not a gameplay value. |
| `DamageType` | 0 = physical, 1 = magic, 2 = true. |
| `tooltipOnly`, `*TOOLTIPONLY`, `mDisplayAsPercent`, `*Tooltip` | Display only. Do not simulate from these. |
| Floats | The values are float32. Round them (0.44999998807907104 → 0.45). |
| `Cooldown` / `ItemCooldown` / `SpellbladeCooldown` | Flat seconds. **Item cooldowns are not reduced by Ability Haste.** |

---

## 2. Global rules the simulator needs

### 2.1 Damage pipeline, per damage instance
```
raw        = formula (from the CALCS above)
crit       = × critMultiplier, only if this instance can crit (see 2.4)
outgoing   = × (1 + Σ outgoing amps)        ← ADDITIVE since V26.09 (see 2.2)
mitigation = × resistMultiplier(effectiveResist)   (physical: armor, magic: MR, true: none)
incoming   = × Π(1 + incoming amps on target) × Π(1 − target damage reduction)
then flat reductions (Warden's Mail and similar), then shields, then health
resistMultiplier(R) = 100/(100+R)  if R ≥ 0;   2 − 100/(100−R)  if R < 0
```
Shadowflame's Cinderbloom is a crit-style multiplier and is applied as a separate factor (§4). Caps that depend on the target's health (monster caps) are applied before mitigation.

### 2.2 Outgoing vs incoming damage modifiers (important)
- The wiki's V26.09 patch page records an **undocumented change: "Modifiers to damage dealt now stack additively instead of multiplicatively. Modifiers to damage received still stack multiplicatively."** It also says damage amplifiers are now dealt as a separate damage instance. In V26.10 Riot fixed Riftmaker, Corki and Yone being amplified twice, which is consistent with that system change.
- Some item pages still say "stacks multiplicatively" (Liandry's, Haunting Guise). Those notes were written before V26.09 and are **outdated**.
- Make this a configuration flag and default to additive. Confidence M.
- **Outgoing (additive pool):**
  - Liandry's Suffering: up to 6%
  - Haunting Guise Madness: up to 6%
  - Riftmaker Void Corruption: up to 8%
  - Lord Dominik's Giant Slayer: up to 15%, against champions only
  - Spear of Shojin Focused Will: up to 12%, for ability, proc and pet damage that comes from your ability casts
  - Hexoptics Magnification: up to 10%, basic damage only
  - Horizon Focus: 10% against marked targets
  - Actualizer: 15% + 0.5% per 100 bonus mana, ability and pet damage only
  - Immortal Path: 4% while you are above 50% health
  - Runes in the same pool (wiki list): Coup de Grace, Cut Down, Last Stand, Axiom Arcanist, Press the Attack
- **Incoming (multiplicative, sitting on the target):**
  - Abyssal Mask: +12%, magic damage only
  - Bloodsong Expose Weakness: +8% melee holder / +5% ranged holder
  - Imperial Mandate Vulnerable: +7%
  - Armor and MR multipliers

### 2.3 Resistance reduction and penetration (wiki: Armor/Magic penetration)
- Order of application:
  1. flat reduction
  2. % reduction
  3. % penetration
  4. flat penetration (lethality, flat magic pen)
- Flat reduction can take a resistance below 0. Percentage effects and penetration do nothing if the resistance is ≤ 0. Penetration can never take it below 0.
- Several % penetration or % reduction sources multiply: `1 − (1−a)(1−b)`.
- **Lethality is 1:1 flat armor penetration** and does not scale with level. That has been true since V14.1.
- Armor sources:
  - % penetration: LDR 35%, Serylda 35%, Mortal Reminder 30%, Last Whisper 18%, Terminus Dark stacks up to 30%
  - % reduction: Black Cleaver 6% × 5
  - lethality: see §6
- Magic resist sources:
  - % penetration: Void Staff 40%, Cryptbloom 30%, Blighting Jewel 13%, Spellslinger's 8%, Terminus up to 30%
  - flat penetration: Spellslinger's 20, Sorcerer's 12, Shadowflame 15, Stormsurge 15
  - % reduction: Bloodletter's 7.5% × 4
  - flat reduction: Malignance −10 while the target stands in Hatefog

### 2.4 Critical strikes
- Base crit damage is **200%**. Infinity Edge adds +30% for 230%. Crit damage bonuses add together.
- Average-damage multiplier for crit-capable attacks: `1 + critChance·(critDamage − 1)`.
- The game uses pseudo-random rolls rather than independent chances. Over many attacks the average matches the expected value; per-attack streaks differ.
- Things that **can** crit:
  - basic attacks
  - Runaan's bolts, only when the main attack crits
  - Sundered Sky and Fiendhunter Bolts forced crits, at 80% of your crit damage
  - Shadowflame's special crit on magic and true damage
- Things that **cannot** crit: all item on-hit and proc damage, including Spellblade ("not affected by critical strike modifiers"), Kraken, BotRK, Nashor's, Energized procs, Cleave and so on.
- Randuin's Omen cuts incoming crit damage by 30% and also counts as a crit-damage modifier for Shadowflame.
- Basic attacks never crit against structures.

### 2.5 Damage tags: what triggers what (wiki: Damage, Ability damage, Ability effects)
- **Ability damage** means spell, area or persistent damage. It is what "Damaging Abilities…" item effects need.
- Besides champion abilities, these **items deal ability damage** and so trigger ability effects:
  - Hextech Gunblade and Hextech Rocketbelt
  - the actives of Tiamat, Profane, Ravenous and Stridebreaker
  - Stormsurge's Squall
  - Scout's Slingshot's Bullseye
  - Zaz'Zak's Void Explosion
  - Unending Despair's Anguish
  - Redemption's Intervention
- **Triggered by ability damage from any source** (champion or item): Liandry's, Blackfire Torch, Fated Ashes, Luden's Echo, Rylai's, Serylda's slow, Zaz'Zak's (plus the runes Comet, Cheap Shot, Dark Harvest, Deathfire Touch and Scorch).
- **Triggered only by champion-ability damage:** Actualizer, Bastionbreaker, Horizon Focus, Malignance (ultimate only), Muramana's ability proc, Spear of Shojin.
- **Proc damage** never triggers ability or attack effects. Almost every item effect is proc damage: on-hits, burns, Echo, Revved, Cleave, Immolate, Energized and Spellblade. So, for example, a Luden's echo cannot start a Liandry burn.
- **Periodic** (damage over time) and **AoE** tags reduce some vamp effects. Periodic damage does not wake targets from sleep.

### 2.6 On-hit vs on-attack
- **On-attack** effects fire when the attack is launched: Guinsoo's stacks, Navori, Yun Tal stacks, Kraken stacks for ranged users, Runaan's bolts, Energized stack gain and Scout's cooldown reduction.
- **On-hit** effects fire when the attack lands: Spellblade, Nashor's, Wit's End, BotRK and the rest.
- Abilities that "apply on-hit effects" trigger on-hits but usually not on-attack effects. They also consume Spellblade.
- On-hit item damage does not apply to structures, except Spellblade, Energized, Hullbreaker and Titanic's on-hit part.

### 2.7 Item groups: only one item from each group (wiki: Item group)
On top of these, every Legendary item can be owned only once.

| Group | Items |
|---|---|
| Spellblade | Sheen, Trinity Force, Lich Bane, Iceborn Gauntlet, Essence Reaver, Dusk and Dawn, Bloodsong |
| Hydra | Tiamat, Profane, Ravenous, Stridebreaker, Titanic |
| Fatality | Last Whisper, Black Cleaver, Lord Dominik's, Mortal Reminder, Serylda's, Terminus |
| Blight | Blighting Jewel, Void Staff, Cryptbloom, Bloodletter's, **Terminus** (so Terminus is in two groups) |
| Immolate | Bami's, Sunfire, Hollow Radiance |
| Lifeline | Archangel's, Seraph's, Hexdrinker, Shieldbow, Maw, Protoplasm, Sterak's |
| Manaflow | Tear, Archangel's, Manamune, Whispering Circlet, Winter's Approach. Muramana, Seraph's and Fimbulwinter are not in the group. |
| Annul | Verdant Barrier, Banshee's, Edge of Night |
| Others | Glory (Dark Seal / Mejai's); Eternity (Catalyst / Rod of Ages); Quicksilver (Quicksilver Sash / Mercurial Scimitar); Boots; Dirk; Elixir; Starter; Guardian |

**Named effects that are unique and do not stack with copies of themselves:**
- **Energized** is shared by Rapid Firecannon, Statikk Shiv, Stormrazor, Voltaic Cyclosword and the Fleet Footwork rune. There is one stack pool; when it is full, every Energized effect you own fires on the same attack.
- **Grievous Wounds** is 40% for 3 s from every source. Chempunk's version is called Hackshorn but is the same debuff.
- **Cleave**, **Immolate**, **Awe** and **Manaflow** work the same way.

### 2.8 Combat timers and stat multipliers
- **In combat with champions** (Liandry's, Haunting Guise, Riftmaker, Unending Despair, Jak'Sho) means you dealt or took damage to or from an enemy champion. That includes 0-damage instances. Being blocked by a spell shield does not count.
- **% AP multipliers add together:** `AP = ΣflatAP × (1 + 0.30 Rabadon's + 0.04·n Blackfire + …)`. Rabadon's also multiplies AP that other passives convert from health or mana (Riftmaker, Archangel's/Seraph's, Glory stacks, Staff of Flowing Water).
- **Adaptive force** (Swiftmarch): 1 point = 0.6 bonus AD or 1 AP. You get AD if your bonus AD > AP, and AP if AP is higher.

---

## 3. Spellblade family

**Rules shared by every Spellblade item** (wiki "Spellblade info" plus item notes; confidence H):
- **Trigger:** the buff is granted when you **start** casting any ability, even if the cast is cancelled. It lasts 10 s (`SpellBladeDuration`). Casting again refreshes the 10 s.
- **Consumption:** the next basic attack consumes it, or an ability that applies on-hit effects.
- **Damage:** dealt on-hit as proc damage, so it does not trigger ability effects. Life steal applies. **It cannot crit.**
- **Cooldown:** `Cooldown`/`SpellbladeCooldown` = 1.5 s, starting after the empowered hit. Ability Haste does not affect it.
- **Spell shields:** not blocked when the attack is a basic attack; blocked when an on-hit ability carries it.
- **Block/dodge:** a block consumes the buff and starts the cooldown. Dodge or blind does not consume it.
- **Structures and plants:** it works on structures. It is not consumed on plants.
- **Only one Spellblade item can be owned**, so the effects never stack. Bloodsong also belongs to this group.
- **Black Cleaver interaction:** the Spellblade hit can apply a second Carve stack on the same attack, because it is a non-basic instance that follows the basic damage.

| Item (id) | Spellblade damage (items.txt names) | Extra | Conf |
|---|---|---|---|
| **Sheen (3057)** | `SpellbladeDamage` = 1.0 × base AD, physical | – | H |
| **Trinity Force (3078)** | `SpellbladeMultiplier` 2.0 × base AD, physical | Quicken: attacking (on-hit) gives +`MoveSpeedBonus` 20 flat MS for `MSDuration` 2 s | H |
| **Iceborn Gauntlet (6662)** | `SpellbladeMultiplier` 1.5 × base AD, physical | Creates a frost field (`AoERadius` 300, `SlowFieldDuration` 2 s) that slows by `SlowAmount` 25% (`RangedSlowAmount` 12.5%). The wiki says the slow counts as a separate cast instance, but in game (16.20) it adds no Electrocute stack, so it is modeled as part of the attack's. `MonsterMod` 1.5 is unexplained; only matters vs monsters. | H |
| **Lich Bane (3100)** | `SpellbladeADRatio` 0.75 × base AD + `LichBaneAPValue` 0.45 × AP, **magic** | While the buff is up, +`SheenASBuff` 50% bonus attack speed, even if the attack doesn't consume it | H |
| **Essence Reaver (3508)** | `BaseADRatio` 1.25 × base AD + `CritChanceMultiplier` 50 × critChance (0–1), physical. At 100% crit that is +50 flat. | Restores mana equal to `TotalManaRefund` = 0.5 × the Spellblade damage (the formula value). `FlatManaRefund` 15 and `ManaRefundRatio` 0.15 are left over from the Essence Drain passive removed in V26.01. | H |
| **Dusk and Dawn (2510)** | 0.75 × base AD + 0.10 × AP, **magic**. Heals 0.10 × AP + 0.03 × bonus HP. | **0.2 s later it applies all your on-hit effects to the target again** (Nashor's, Wit's End, BotRK, Guinsoo's Wrath, Recurve, Terminus Shadow, Titanic and so on). The Spellblade damage itself is not repeated. Single-use empowered on-hits (Kraken's empowered hit, Energized) are probably not doubled either; I inferred that from the matching Guinsoo Phantom Hit rules (M). The repeat does not happen against structures. | H/M |
| **Bloodsong (3877)** (support starter) | `SheenMult` 1.0 × base AD, physical | If the target is a champion it gets **Expose Weakness** for `DebuffDuration` 4 s: takes `MeleeDamageAmp` 8% (`RangedDamageAmp` 5%) more post-mitigation damage from **all** sources. This is an incoming modifier, so it multiplies. The triggering attack already benefits. `BaseADRatio` 0.1 (calc `{ce8aadac}`) is unexplained and not on the wiki; ignore it. | H |

---

## 4. Ability-power items

#### Liandry's Torment (6653), H for the numbers, M for amp stacking
- **Torment burn**
  - **Trigger:** ability damage from any source (including item actives) **or pet damage**.
  - **Damage:** `BurnPercentHealthDamage` 0.02 × target max HP **per second** as magic damage, ticking every `TickFrequency` 0.5 s (1% per tick) for `BurnDuration` 3 s. Total 6% max HP.
  - **Tags:** proc and periodic. It does not trigger ability effects and is not blocked by spell shields.
  - **Monster cap:** `MonsterDamageCap` 40 per second, which is 20 per tick.
  - **Reapplying:** burns from different owners stack. Your own reapplication refreshes the burn. Whether the tick timer restarts on refresh is not documented (L); a reasonable model is to restart the 3 s duration and keep the 0.5 s tick phase. The first tick lands 0.5 s after application (L).
- **Suffering**
  - **Effect:** +`DamageIncreasePerSecond` 2% per second in combat with champions, up to `MaxStackNumber` 3 for `DamageIncreaseMax` 6%. Stacks fall off `BuffCounterDuration` 3 s after champion combat ends.
  - **Scope:** amplifies **all** your damage (any type), including the burn. The wiki gives 6% × 1.06 = 6.36% total for the burn.
  - **Stacking:** outgoing, so additive since V26.09 (the wiki note saying "multiplicative" is outdated).
  - **Stack timing:** whether the first stack is instant is not documented (L). Default: n stacks after n seconds.
- **`MaxDamageHPThreshold` 1250: vestigial.** It comes from the old Liandry's Anguish passive "Agony" (0–12% bonus magic damage based on the target's bonus health, maxing at 1250 bonus HP). The current tooltip and the wiki have no such effect.
- **Item groups and combos:** a normal legendary. Liandry's and Blackfire both burn and both apply at once.

#### Haunting Guise (3147), H
Madness works exactly like Suffering:
- 2% per second in combat with champions, up to 6% (`SecondsInCombat` 3, `BuffCounterDuration` 3).
- It is an outgoing modifier, so it goes into the additive pool.
- You can own only one Haunting Guise.

#### Blackfire Torch (2503), H
- **Baleful Blaze**
  - **Trigger:** ability damage from any source.
  - **Damage per second:** `BurnDamagePerSecondCalc` = `BurnFlatDamagePerSecond` 20 + `APRatio` 0.02 × AP, as magic damage.
  - **Ticks:** every `TickFrequency` 0.5 s, so 10 + 1% AP per tick, for `BurnDuration` 3 s. Total 60 + 6% AP.
  - **Monsters:** +`MonsterDamageBonus` 20 per second.
  - **Tags:** proc and periodic; not blocked by spell shields. Burns from different owners stack.
  - **Bug:** the first tick is sometimes dealt on the same instance as the triggering ability.
- **Blackfire:** +`APPerStack` 4% AP for each champion, epic monster or large monster currently burning. It adds to Rabadon's 30% (§2.8).

#### Fated Ashes (2508), H
- Burn: `BurnFlatDamagePerSecond` 5 per second for 3 s, which is 15 total (2.5 per tick). Monsters take +`MonsterDamageBonus` 15 per second.
- Proc and periodic.

#### Luden's Echo (6655), H
- **Charges:** you hold `MaxCharges` 6 Echoes. Ability damage from any source to an enemy consumes all of them.
- **Primary hit:** `Damage` = `BaseDamage` 75 + `APRatio` 0.05 × AP, magic damage to the target.
- **Secondary targets:** one extra enemy per Echo beyond the first, within 600 units (wiki) or `MissileRange` 650 (items.txt) ⚠. Each gets an orb (~0.5 s travel) for the same damage.
- **Leftover Echoes:** if there are fewer extra targets than Echoes, each leftover Echo hits the **primary** for `RepeatDamageReduction` 0.2 × Damage, at **0.25 s intervals**.
- **Single target:** 1 + 5 × 0.2 = `SingleTargetMax` = 2 × Damage, spread over 1.25 s.
- **Cooldown:** `Cooldown` 12 s, starting when consumed.
- **Tags:** proc, so it does not trigger Liandry's or Blackfire. Blocked by spell shields. Projectile.

#### Stormsurge (4646), H/M
- **Stormraider:** if you deal at least `DamageThreshold` 25% of a champion's max HP within `WindowDuration` 2.5 s, you apply Squall. `Cooldown` 30 s, starting when Squall is applied.
  - Whether pre- or post-mitigation damage counts is not documented (L). Assume post-mitigation.
- **Squall:** after `DelayDuration` 2 s it deals `BaseDamage` 125 + `APRatio` 0.10 × AP magic damage. `RangedProcDamageMod` 1.0, so ranged users deal the same.
  - If the target dies first, champions within 600 take the same damage.
  - It is **spell damage**, so it triggers Liandry's, Luden's and Blackfire. It does not wake sleeping targets.
- **Vestigial:** `GoldReward` and `ProcMoveSpeedAmount` are null; those effects were removed in V25.10.

#### Hextech Alternator (3145), H
- Revved: damaging a champion with anything, including 0-damage effects, deals `DamageAmount` 65 magic damage. `Cooldown` 40 s.
- Proc; not blocked by spell shields.
- Finished items built from Alternator do not keep Revved.

#### Hextech Rocketbelt (3152), H
- **Active Supersonic** (`Cooldown` 50 s): dash 275 units and fire 7 rockets.
- **Damage:** `FireboltDamage` = `BaseDamage` 135 + `APRatio` 0.15 × AP, magic damage. Each enemy is hit at most once per cast; the item can only damage the same enemy once every 3 s.
- **Tags:** area damage, so it triggers ability effects from any source (Liandry's, Luden's, Blackfire, Rylai's) but not the champion-ability-only effects (Shojin, Horizon, Bastionbreaker). Blocked by spell shields.
- **Other:** resets the basic attack timer, but that reset does not count for Hail of Blades.

#### Hextech Gunblade (3146), H
- **Active Lightning Bolt** (`Cooldown` 60 s, range 700, no cast time): `ActiveDamage` = lerp(175 → 253 over levels 1–18) + 0.30 × AP, magic damage. Also slows by `SlowAmount` 25% for `SlowDuration` 1.5 s.
- **Tags:** spell damage, so it triggers ability effects. Unit-targeted; not a projectile.
- **Stats:** 10% omnivamp.

#### Malignance (3118), H
- **Scorn:** +`UltimateHaste` 20.
- **Hatefog trigger:** non-proc damage or pet damage from your **ultimate** to a champion creates a zone under them.
- **Zone size:** radius 250 + 2^(damage/100), capped at 550 (`AOESize` 250, `MaxRadius` 550). Lasts `GroundDuration` 3 s.
- **Damage:** enemies in the zone take calc `{8e8f7a34}` = 0.25 × (`BaseDamage` 60 + `APRatio` 0.05 × AP) magic damage **every 0.25 s**, which is 15 + 1.25% AP per tick and 180 + 15% AP over 3 s. The first tick hits immediately.
- **MR reduction:** `MagicResistanceShred` 10 flat while cursed. The first ultimate hit gets no benefit from it.
- **Limits:** 3 s cooldown per target. A target can only be cursed by one zone at a time.
- **Tags:** proc, periodic, AoE; not blocked by spell shields.
- Many ultimates cannot trigger it; the wiki page has the per-champion list.

#### Rabadon's Deathcap (3089), H
- `APAmp` 0.30: total AP × 1.30.
- The multiplier adds to other % AP sources (Blackfire, Infernal Might) and applies to AP converted by other passives.

#### Void Staff (3135) / Blighting Jewel (4630) / Cryptbloom (3137), H
- Magic penetration: 40% / 13% / 30%. All three are in the Blight group.
- Cryptbloom's Life From Death is a heal nova on takedown (100 + 20% AP, 60 s cooldown), not damage.

#### Shadowflame (4645), M
- **Stats:** 15 flat magic penetration.
- **Cinderbloom:**
  - **When:** your **magic and true** damage against a target that is already below `HealthThreshold` 40% max HP *before* that instance.
  - **Effect:** that damage "crits" for `damage × (1 + 0.20 × Πcrit-damage modifiers)`. `SpellItemDamageAmp` 0.20 applies to direct and item damage, `DamageOverTimeAmp` 0.20 to damage over time and pets.
  - **Crit-damage modifiers:** Infinity Edge raises it to 0.2 × 1.3 = 26%. A target with Randuin's lowers it by ×0.7.
  - **If the instance already crits:** multiply instead (200% × 1.2 = 240%).
  - **Scope:** applies to every source except summoner spells, so burns, item procs and magic on-hits all qualify. Does not apply against structures.
- **Stacking with the outgoing pool:** not documented. Treat it as its own multiplier.

#### Riftmaker (4633), H/M
- **Void Corruption:**
  - **Effect:** +`EternityDamageIncreasePerSecond` 2% per second in champion combat, up to `EternityDamageIncreaseMax` 8% (4 stacks). It is outgoing and amplifies all damage types.
  - **At full stacks:** omnivamp `VampAmountMelee` 10% / `VampAmountRanged` 6%.
  - **Stack duration** ⚠: the wiki says stacks last 3 s when not full and 5 s when full; items.txt has `BuffCounterDuration` 4 and `SecondsInCombat` 4.
- **Void Infusion:** AP += `HealthToAPConversionPercent` 2% × bonus HP. Rabadon's multiplies this AP too.
- `MaxAPMultiplier` 0.05 is unexplained and likely vestigial.

#### Horizon Focus (4628), M
- **Hypershot:**
  - **Trigger:** **champion-ability** damage to a champion where the distance from your cast position to the hit position is at least `SnipeRange` 600.
  - **Effect:** marks the target for `BuffDuration` 6 s: they are revealed and **you deal `DamageAmp` 10% more damage to them**. The triggering ability also benefits.
  - **Limits:** does not trigger against pets or traps. For lingering area abilities, only the initial cast counts.
- **Focus** (`ItemCooldown` 30 s): when Hypershot triggers, reveal `VisionRadius` 1400 around the target for `VisionDuration` 2 s, and mark other champions in that area for `SecondaryBuffDuration` 3 s. Those marks also apply the 10% amp.
- ⚠ The tooltip in items.txt leaves out the 10% amp. `DamageAmp` 0.1 is in the data, and the wiki (re-added in V26.01) confirms it. It is an outgoing modifier, so it goes into the additive pool.

#### Rylai's Crystal Scepter (3116), H
- Ability damage from any source slows by `SlowAmount` 30% for 1 s. Every damage-over-time tick reapplies it.
- No damage.

#### Nashor's Tooth (3115), H
- On-hit: `TotalOnHitDamage` = `NashorsBaseValue` 15 + `NashorsAPValue` 0.15 × AP, magic damage.
- Proc. Life steal applies. Does not hit structures. Cannot crit.

#### Archangel's Staff (3003) → Seraph's Embrace (3040, not in the dump), H
- **Archangel's Awe:** AP = `APFromMana` 1% × bonus mana.
- **Manaflow:** see §9.
- **Seraph's** (wiki values): 1000 mana; Awe 2% of bonus mana as AP; Lifeline shield of 18% max mana (90 s cooldown).

#### Rod of Ages (6657), H
- **Timeless:** every `SecondsPerStack` 60 s, gain +10 HP, +30 mana and +3 AP. Up to `MaxStacks` 10 (+30 AP), then you gain one level.
- **Eternity:** mana and heal sustain only.

#### Cosmic Drive (4629), H
- Dealing magic or true damage to a champion gives +20 flat move speed (`MoveSpeedAmount`) for 4 s.
- `MovespeedToGrant`, `MaxStacks` and `ItemCooldown` are vestigial.

#### Morellonomicon (3165), H
- Any magic damage to a champion (including on-hits, even if a shield absorbs it) applies 40% Grievous Wounds for 3 s.
- This is the shared Grievous Wounds effect, so it does not stack with other sources.

#### Bloodletter's Curse (8010), H
- **Trigger:** magic damage from **champion abilities, including innates** (for example passive empowered autos).
- **Effect:** each stack is `ShredPerStack` 7.5% **% MR reduction** for `DebuffDuration` 6 s, up to `MaxStacks` 4 (30%).
- **Limits:** at most one stack per cast instance every `InternalCD` 0.3 s.
- **Timing:** the instance that applies a stack does not benefit from it.
- **Item procs:** they do not apply stacks; inferred from "abilities or passives".
- **Item group:** Blight.

#### Abyssal Mask (8020), H
- Enemy champions within `Radius` 700 of you take `DamageAmp` 12% more **magic** damage, post-mitigation, from **all** sources including your allies.
- It is an incoming modifier, so it multiplies.

#### Actualizer (2522), M
- **Active Mana Made Real** (`Cooldown` 60 s, `Duration` 8 s):
  - **Mana cost:** +`ManaCostIncrease` 100%.
  - **Damage amp:** +`ManaCalc` = (15 + 0.005 × bonus mana)% to **champion-ability and pet damage**, which is 15% + 0.5% per 100 bonus mana. Outgoing, so it goes into the additive pool. Healing and shielding get the same bonus.
  - **Cooldowns:** basic ability cooldowns progress `CooldownTick` 30% faster.
- Manaless champions cannot activate it.
- `OverflowAddition` 3 and `OverflowRevert` 1 are unexplained.

#### Imperial Mandate (4005), H
- **Control:** abilities that immobilize get +20 Ability Haste.
- **Command:** immobilizing an enemy champion makes them Vulnerable for `DamageAmpDuration` 4 s: they take `DamageAmp` 7% more damage from all sources. Later immobilizes extend it. It is an incoming modifier, so it multiplies.

#### Dark Seal (1082) / Mejai's Soulstealer (3041), H
- Dark Seal: `APPerGlory` 4 per stack, up to 10 stacks.
- Mejai's: `APPerGlory` 5 per stack, up to 25 stacks, plus 10% move speed at 10 or more stacks.

#### Dawncore (6621), H
+`APPerManaRegen` 10 AP for every 100% bonus base mana regen. Its own 100% already gives +10.

---

## 5. On-hit, attack-speed and crit items

#### Blade of the Ruined King (3153), H
- **Mist's Edge:**
  - **Damage:** on-hit physical damage of `MeleeValue` 9% (`RangedValue` 6%) × the target's **current** HP.
  - **Timing:** it is calculated at the **start** of the damage event, so this part can't be what kills on its own.
  - **Cap:** `MonsterDamageCap` 100 against minions and monsters; no cap against champions.
  - **Tags:** proc, on-hit, item. Life steal applies. Does not hit structures. Cannot crit.
- **Clawing Shadows:** each on-hit against a champion adds a stack (`AttackCounterDuration` 6 s). The third stack slows 30% for 1 s. `Cooldown` 15 s. ⚠ items.txt has `RangedMoveSpeedMod` −0.15, but the wiki says 30% for everyone; it is a slow either way, not damage.

#### Kraken Slayer (6672), H/M
- **Stacks:** each attack gives a stack (`BuffDuration` 4 s), up to 2. The next attack, every third (`AttackCount` 3), consumes them.
- **Damage:** on-hit physical = `DamageAmount` (150 at level 1, +5 per level from level 9, so 200 at 18) × (ranged `RangedDamageMultiplier` 0.8) × (1 + (`MaxAmpNumber` 1.75 − 1) × the target's missing-HP fraction), up to `MaximumDamage` = 1.75×.
  - I treat the missing-health scaling as linear; the wiki shows it in 5% steps, so the granularity is L.
  - It is also not documented whether missing health is measured before or after the attack's own damage (L).
- **Melee vs ranged:** melee users stack and consume on-hit. Ranged users stack and consume on-attack, and the damage lands on-hit.
- **On-hit abilities:** abilities that don't trigger on-attack always stack and consume on-hit.
- **Interactions:** Guinsoo's Phantom Hit is special-cased to add a stack, but it does not double the empowered hit. Runaan's bolts do not interact.
- **Tags:** item damage tagged as basic damage; proc. Life steal applies. Does not hit structures, but attacking structures refreshes the stacks. Cannot crit.

#### Wit's End (3091), H
On-hit `OnHitDamage` 45 magic damage. Proc. Life steal applies. Does not hit structures.

#### Terminus (3302), H/M
- **Shadow:** on-hit magic damage = 30 + 0.10 × bonus AD + 0.10 × AP (calc `OnHitDamage`). Proc. Life steal applies.
- **Juxtaposition:**
  - **Alternation:** on-hits against champions alternate Light and Dark. Each stack lasts `BuffDuration` 5 s, up to 3 of each, and is refreshed by the next hit of the same kind.
  - **Light:** +`ARMRPerHitScaling` 6 armor and MR per stack (7 from level 11, 8 from level 14).
  - **Dark:** +`PenPerHit` 10% armor **and** magic penetration per stack, up to `PenMax` 30% (percentage penetration).
  - **Runaan's:** does not interact with Runaan's bolts.
  - **First hit:** which type the first hit is, Light or Dark, is not documented (L).
- **Item groups:** Fatality **and** Blight.

#### Guinsoo's Rageblade (3124), H
- **Wrath:** on-hit `OnHitDamage` 30 magic damage. Proc. Life steal applies.
- **Seething Strike, step 1:** on-attack +`AttackSpeedPerStack` 8% bonus attack speed for `BuffDuration` 4 s, up to `MaxStacks` 4 (32%).
- **Seething Strike, step 2:** once all 4 stacks are active, each attack (on-attack) grants a Phantom stack (4 s, max 2). The next attack consumes both and triggers a **Phantom Hit**.
- **Phantom Hit:** applies your on-hit effects again 0.15 s after the attack is fired. It still happens if the projectile is destroyed.
- **Rhythm:** the first Phantom Hit is on attack 7, then every third attack (10, 13, …).
- **Doubles:** BotRK, Wrath, Nashor's, Wit's End, Recurve, Muramana Shock, Titanic (on-hit and cone), and Tiamat/Stridebreaker Cleave. Ravenous Cleave is not on the wiki's list but probably doubles too, since it also fires on 0-damage hits (M). It adds a Kraken stack.
- **Does not double:** on-attack effects, and single-use empowered on-hits (Spellblade, Energized, Kraken's empowered hit). Profane Cleave does not fire because the Phantom Hit deals no damage.
- **Structures:** attacks on structures do not grant Phantom stacks.
- **Vestigial:** the null `Mythic*` and `Crit*` values.

#### Statikk Shiv (3087), H
- **Energized (§2.7):** Electroshock adds `BonusEnergizedStacks` +9 per attack, so 15 per attack in total.
- **Electrospark (on the Energized attack, on-hit):**
  - **Damage:** chain lightning for `ChainDamage` 60 magic damage, or `NonChampChainDamage` 90 against non-champions.
  - **Bounces:** hits the primary target, then jumps to the nearest enemy within `BounceRange` 500. Total targets = `BounceCount`: 4 at level 1, 5 from 6, 6 from 10, 7 from 14, 8 at 20. Each jump takes 0.05 s.
  - **On-hits:** your on-hit effects apply to the **secondary** targets.
- **Tags:** proc and AoE. On-hit damage modifiers don't affect it. Not blocked by spell shields. Cannot crit. It also fires against structures.

#### Rapid Firecannon (3094), H
- **Energized attack:** +`BonusDamage` 40 magic on-hit (proc). The attack also gets +`RangePercentIncrease` 35% range, capped at `MaxRangeIncrease` 150.
- It can also fire through Voltaic's Galvanize.

#### Stormrazor (3095), H
- **Energized attack:** +`TotalProcDamage` 100 magic on-hit (proc) and +`BuffStrength` 45% move speed for 1.5 s.
- It is not consumed on wards or plants.

#### Runaan's Hurricane (3085), H
- **Wind's Fury (ranged users only):** on-attack, fire bolts at up to 2 more enemies, the nearest to you within a 180° arc.
- **Damage:** `BoltDamage` = 0.60 × total AD, physical.
- **Tags:** basic damage and AoE. The bolts apply on-hit effects (except Vayne W) and life steal. **They crit only if the main attack crits.** They do not trigger on-attack effects.
- **Other:** projectiles (speed 2000). They do not target structures. The primary target takes 0 physical damage on-hit, which can still stack Black Cleaver.
- **Vestigial:** `BoltMinPercent`/`BoltMaxPercent` 40 and `OnHitDamage` null.

#### Infinity Edge (3031), H
`mFlatCritDamageMod` +0.30 crit damage, taking crits from 2.00 to 2.30. No passive.

#### Navori Flickerblade (6675), H
- **Effect:** each attack (on-attack) multiplies the **remaining** cooldowns of your basic abilities by (1 − `CDRAmount` 0.15).
- **Does not work:** while blinded, or against structures and plants (abilities that apply on-attack effects do still work against structures; listed as a bug).

#### Phantom Dancer (3046), H
Stats plus permanent Ghosting. No damage passive.

#### Yun Tal Wildarrows (3032), H
- **Practice Makes Lethal:** each attack (on-attack) permanently adds `CritPerStackMelee` 0.4% crit chance (×`StackRangedMultiplier` 0.5 = 0.2% ranged), capped at `CritMax` 25%. That takes 63 melee or 125 ranged attacks.
- **Flurry:** launching an attack at an enemy champion gives +`ASMod` 30% attack speed for `ASDuration` 6 s.
  - **Cooldown:** 30 s, reduced by `AACDR` 1 s per on-hit and by `CritCDR` 2 s per crit.
  - On Zeri it needs every bolt to hit.

#### Fiendhunter Bolts (2512), H
- **Night Vigil:** +`UltimateHaste` 30.
- **Opening Barrage** (`Cooldown` 45 s, starting when you cast your ultimate):
  - **Window:** your next `NumberOfAttacks` 3 attacks within `Duration` 8 s get +`BonusAS` 50%.
  - **Forced crit:** those attacks crit for `CritModifier` 0.8 × your crit damage (160% base, 184% with IE).
  - **Natural crit:** if an attack would already crit naturally, it does a normal crit plus `BonusTrueDamage` 15% of that attack's pre-mitigation damage as bonus true damage.
  - **Guaranteed crits:** these (Sundered Sky, Fiora) don't count as natural crits.
  - **Attacks that cannot crit:** they don't use up a charge.
  - **Turrets:** attacking turrets removes the charges.
- **Activation timing:** for some ultimates the trigger is delayed; see the wiki "Ultimate cast item info" table.

#### Hexoptics C44 (2523), H/M
- **Magnification:** basic damage × (1 + `MaxDamageAmp` 0.10 × min(edge-to-edge distance / `MaxRange` 500, 1)), which is 1% per 50 units.
  - **Stacking:** outgoing, so additive pool.
  - **Scope:** basic damage only; for example Jinx Fishbones splash doesn't get it.
  - **Granularity:** whether it is continuous or stepped every 50 units is unknown (L).
- **Arcane Aim:** a takedown within `TakedownWindow` 3 s gives +`ExtraRange` 100 attack range for `Duration` 8 s.

---

## 6. Lethality and armor-penetration items

#### Lord Dominik's Regards (3036), H/M
- **Stats:** 35% armor penetration.
- **Giant Slayer:** damage to champions × (1 + `MaxBonusDamagePercent` 0.15 × min(target bonus HP / `MaxBonusHealth` 1500, 1)), which is 1% per 100 bonus HP.
  - **Stacking:** outgoing, so additive pool.
  - **Scope:** all damage types.
  - **Granularity:** continuous vs per-100 steps is unknown (L).
- **Item group:** Fatality.

#### Mortal Reminder (3033), H
- 30% armor penetration.
- Physical damage to champions applies 40% Grievous Wounds for 3 s, even if shielded.
- Fatality group.

#### Serylda's Grudge (6694), H
- **Stats:** 35% armor penetration.
- **Bitter Cold:** ability damage from any source to an enemy at or below `SlowThreshold` 50% HP slows 30% for 1 s. Damage-over-time ticks reapply it.
- **Vestigial:** `LethalityAmount` 15 and calc `PenCalc`. The item gives **no lethality**; the Rancor passive was removed in V14.19.
- **Item group:** Fatality.

#### Last Whisper (3035), H
18% armor penetration. Fatality group.

#### Black Cleaver (3071), H
- **Carve:**
  - **Effect:** physical damage to a champion adds a stack for `DebuffDuration` 6 s, up to `MaxStacks` 5. Each stack is `ShredPerStack` 6% **% armor reduction**, 30% total.
  - **Timing:** a **basic-damage** instance does not benefit from the stack it applies. A non-basic instance does benefit from its own stack (listed as a bug).
  - **Same-frame stacking:** `InternalCD` 0.01 means once per frame. Exceptions that can add an extra stack in the same frame include Spellblade, Kraken, Heartsteel, Dead Man's Plate, Eclipse, Voltaic, Runaan's 0-damage hit and Press the Attack. Most multi-hit abilities and the on-hit procs right after the basic damage (BotRK, Recurve, Muramana, Titanic, Hullbreaker) do **not** add extra stacks.
- **Fervor:** physical damage gives +`MoveSpeedBonus` 20 move speed (ranged ×`RangedMod` 0.5 = 10) for 2 s.
- **Item group:** Fatality.

#### Youmuu's Ghostblade (3142), H
- 18 lethality.
- Haunt: out-of-combat move speed of 20 (10 ranged).
- Active (`Cooldown` 45 s): +20% move speed (15% ranged) and Ghosting for 6 s (×0.667 ranged, so 4 s).
- No damage.

#### Edge of Night (3814), H
- 15 lethality.
- Annul: a spell shield on a 40 s cooldown that restarts whenever you take champion damage.

#### Hubris (6697), H
- **Eminence:** a takedown within 3 s of damaging the champion gives a permanent stack and +`BaseADBonus` 12 + `ADPerStatue` 3 × stacks bonus AD for `BuffDuration` 90 s.
- Another takedown refreshes the buff and updates its value. The buff is lost on death.
- **Unused data values:** `SpellMaxAmp`, `MinHealthThreshold`, `MSDuration`, `SpeedAmount` and `BonusLethality` are not in the current effect.

#### Axiom Arc (6696), H
- **Flux:** a takedown within `ResetWindow` 3 s refunds (`UltimateRefundBase` 10 + 0.25 × lethality)% of your ultimate's **total** cooldown.
- If that would fully refresh the ultimate, its cooldown is set to 0.5 s instead.

#### Profane Hydra (6698), H
- **Cleave:**
  - **Damage:** on-hit physical damage of 0.40 × AD (ranged 0.20) to **other** enemies within `CleaveRadius` 350 of the target.
  - **Limits:** at most `MaxProcPerAuto` 10 splashes per cast instance, and each target only once per frame.
  - **Unlike the other Hydras:** it does not trigger when the attack deals no damage, for example a Guinsoo's Phantom Hit or an invulnerable target.
  - **Tags:** proc and AoE.
- **Active Heretical Cleave** (`Cooldown` 10 s, starting at the beginning of the cast):
  - **Damage:** `SlashDamageBase` 0.80 × AD physical in a radius of `ActiveRadius` 450, centred 100 units in front of you.
  - **Tags:** area damage, so it triggers ability effects from any source. Cast time equals your attack windup.
- **Vestigial:** `HealthThreshold` 0.5 and `SlashDamageMax`. The execute bonus was removed in V14.19.
- **Item group:** Hydra.

#### Umbral Glaive (3179), H
- **Nightstalker:**
  - **Readiness:** after you have been unseen by enemies for `OutOfVisionDuration` 1 s, your next attack on a champion is empowered. It stays ready until `AttackReadyDuration` 4 s after you are seen again.
  - **Damage:** calc `ProcDamage` = 50 + 1.5 × lethality as bonus **true** damage on-hit. Melee and ranged are the same.
- **Blackout** (90 s cooldown): deals with wards; not relevant here.

#### Serpent's Fang (6695), H
- **Shield Reaver:** damaging an enemy champion applies venom for 3 s.
  - **Venom:** new shields the target gains are reduced by `ShieldShred` 50% (ranged 35%).
  - **On application:** if the target wasn't already venomed, their current shields are also cut by that amount *before* the damage lands.
- **Limits:** magic-only shields are not affected. The debuff can't be refreshed while it is active. A spell shield blocks it.

#### Voltaic Cyclosword (6699), H
- **Energized:** see §2.7.
- **Galvanize:** **champion-ability damage to an enemy champion** fires all of your ready Energized effects on that champion (RFC, Stormrazor, Statikk chain and Voltaic itself). It counts as a separate cast instance.
- **Firmament (Energized hit):**
  - **Lethality:** first grants +15 lethality (`LethalityBonusModMelee`; ranged 12) for `LethalityBonusDuration` 4 s.
  - **Damage:** then deals bonus physical damage of `PercentCurrentHPMelee` 9% (ranged 7%) × target current HP, capped at `NonChampCap` 200 against non-champions.
  - **Timing:** this damage lands **before** the damage of the triggering attack or ability, and both get the new lethality.
  - **Tags:** proc; not blocked by spell shields.

#### Bastionbreaker (2520), H
- **Shaped Charge** (`Cooldown` 20 s): your next champion-ability damage instance on a champion or epic monster deals bonus **true** damage of `AbilityDamageCalc` = 50 + 1.5 × lethality (ranged ×`AbilityDamageRangeMod` 0.5, so 25 + 0.75 × lethality).
  - Tags: proc. Blocked by spell shields.
- **Sabotage:** only works on turrets and epic monsters (300 + 25 × lethality over 3 s; ranged ×`RangeModifier` 0.8).

#### The Collector (6676), H
- **Death:** if your post-mitigation damage would leave a champion below `ExecuteThreshold` 5% max HP, they are executed.
- **Exceptions:** Energized bonus damage, 0-damage instances and parried attacks do not trigger it.
- **Taxes:** +25 gold per kill.

#### Opportunity
Not in items.txt. The wiki records it as **removed in V26.09**.

---

## 7. Fighter and bruiser items

#### Eclipse (6692), H
- **Ever Rising Moon stacks:**
  - **What counts:** attacks, abilities, item effects, summoner spells, crowd-control applications and damage over time each give at most one stack per cast instance per champion.
  - **What doesn't:** proc damage, unless it is pet damage or applies a debuff such as Black Cleaver.
  - **Timing:** a stack is added *before* the damage instance that caused it.
- **Trigger:** 2 stacks within `WindowDuration` 2 s.
- **Effect:**
  - bonus physical damage of `MeleePercMaxHP` 8% (ranged ×`RangedPercMaxHPMult` 0.625 = 5%) of the target's max HP
  - a shield of `MeleeBaseShield` 150 + `MeleeBonusADShieldRatio` 0.40 × bonus AD (ranged ×0.5) for 2 s
- **Cooldown:** `Cooldown` 6 s, global rather than per target. If several champions are hit at once, the closest one takes the damage.
- **Tags:** proc. Listed as a bug: on-hit damage modifiers affect it.

#### Sundered Sky (6610), H/M
- **Lightshield Strike:** your next **basic attack** on a champion (per-target `Cooldown` 10 s) is a guaranteed crit at `CritModifier` 0.8 × crit damage (160% base, 184% with IE).
- **Heal:** 0.9 × base AD (ranged ×0.5) + `MissingHealthHeal` 4% missing HP. Overheal becomes bonus HP for 8 s, stacking up to 5 times.
- **Crit status:** it counts as a crit for everything. On-hit abilities don't get it.
- **Natural crits:** what happens if the attack would have crit naturally anyway is not documented (L). Assume 0.8× always applies.

#### Spear of Shojin (3161), M
- **Dragonforce:** +`AHBase` 25 **basic** ability haste.
- **Focused Will:**
  - **Gaining stacks:** damage from a non-innate champion ability, or pet damage, gives a stack for `StackDuration` 6 s, up to `StackCount` 4. Each cast instance can give at most one stack per `CastIDLockout` 1 s.
  - **Effect:** each stack is +`SpellDamageIncrease` 3% to ability, proc and pet damage **that comes from your ability casts**, up to 12%. Outgoing, so additive pool.
  - **Timing:** the hit that gives a stack does not benefit from it.
  - **Item damage:** Shojin does not amplify it, except Dead Man's Plate (listed as a bug).
- ⚠ items.txt has `RangedMod` 0.5 and a ranged tooltip value of 1.5% per stack. The wiki says this was a tooltip-only bug, fixed in V14.4, and that the real value is 3% for ranged users too; the current wiki text has no ranged reduction. **Default to 3% for everyone and make it a flag.**

#### Sterak's Gage (3053), H
- **The Claws that Catch:** bonus AD = `ADtoAD` 0.5 × base AD.
- **Lifeline** (`Cooldown` 90 s): when damage would take you below 30%, gain a shield of `BaseShieldRatio` 0.6 × bonus HP that decays over 4.5 s.
- **Unused data values:** `RangedEffectiveness` 0.6, `HealthPercent` and `HealPercent` are not in the current effect.
- **Item group:** Lifeline.

#### Hullbreaker (3181), H
- **Skipper:**
  - **Stacks:** each on-hit against **any** enemy gives a stack for 10 s, up to 5. Once you have 4 or more, the next on-hit on a **champion**, epic monster or structure consumes all of them. That works out to every fifth attack.
  - **Damage:** calc `MaxStackDamage` = (`SkipperADRatio` 1.2 × base AD + `MaxStackDamageHPRatio` 0.05 × your max HP) as bonus physical damage, ×0.7 for ranged users. Against structures it is 3.0 × base AD + 10% max HP.
  - **Tags:** proc. Life steal applies. It hits structures.

#### Experimental Hexplate (3073), H
- **Hexcharged:** +30 ultimate haste.
- **Overdrive** (`Cooldown` 30 s, starting when you cast your ultimate): +`BonusASMelee` 50% / `BonusASRanged` 25% attack speed and +20% / 10% move speed for `HasteDuration` 8 s.

#### Stridebreaker (6631), H
- **Cleave:** 0.40 × AD (ranged 0.20), radius 350.
- **Active Breaking Shockwave** (`Cooldown` 15 s): `SlashDamage` 0.80 × AD physical in a radius of 450, centred 100 units in front of you.
  - Also slows by 35% for 3 s and gives +35% decaying move speed per champion hit.
  - It is area damage, so it triggers ability effects. You can move while casting it.

#### Titanic Hydra (3748), H
- **Cleave:**
  - **Primary target:** on-hit bonus physical damage of `PrimaryTargetHPRatio` 1% of **your** max HP (ranged 0.5%). Life steal applies to this part, and it also hits structures.
  - **Cone:** enemies behind the target take `SplashHPRatio` 3% (ranged 1.5%).
- **Titanic Crescent active:**
  - **Effect:** your next attack within 10 s does `ActivePrimaryTargetHPRatio` 4% (2% ranged) to the primary and `ActiveSplashHPRatio` 9% (4.5% ranged) to the cone.
  - **Cooldown:** `Cooldown` 10 s, starting after the empowered attack. Using it resets your attack timer.
- **Other:** proc and AoE. Up to 10 splashes. It fires even when the attack deals no damage.

#### Ravenous Hydra (3074), H
- **Cleave:** 0.40 × AD (ranged 0.20) to other enemies within 350.
- **Active** (`Cooldown` 10 s): `ActiveADRatio` 0.80 × AD in a radius of 450, centred 100 units in front of you.
- **Life steal:** applies to Cleave and the active at `VampAmp` 100% effectiveness.

#### Tiamat (3077), H
- Cleave: 0.40 × AD (ranged 0.20).
- Active Crescent (`Cooldown` 10 s): `ActiveADRatio` 0.75 × AD in a radius of 450.
- Hydra group.

#### Chempunk Chainsword (6609), H
Physical damage to champions applies 40% Grievous Wounds for 3 s.

#### Maw of Malmortius (3156), H
- **Lifeline** (`Cooldown` 90 s): when **magic** damage would take you below 30%, gain a magic shield of `ShieldSize` 200 + `ShieldADScaling` 1.5 × bonus AD (ranged ×0.75) for 3 s.
- Triggering it also gives `BuffVamp` 10% omnivamp until the end of combat.

#### Endless Hunger (2517), H
- Famine: Ability Haste = 5 + 0.13 × bonus AD (ranged 0.10).
- Feast: a takedown gives `OmnivampOnTakedown` 15% omnivamp for 8 s.

#### Overlord's Bloodmail (2501), H
- **Tyranny:** bonus AD = `HPToADPercentage` 2.5% × bonus HP.
- **Retribution:** bonus AD = 12% × min(missingHP% / 70%, 1) × your **total AD from all other sources**.
  - It is not recursive; the tooltip shows it as recursive, which is a bug.
  - Model it as linear (the wiki display steps by 1%).

#### Death's Dance (6333)
- On the target's side; see §13.
- Defy: a takedown heals 75% bonus AD over 2 s.

#### Bloodthirster (3072) and Mercurial Scimitar (3139), H
- Bloodthirster's Ichorshield is a life-steal overheal shield of up to 165 + 15 per level from level 9.
- Mercurial's Quicksilver active is a cleanse plus +50% move speed.
- Neither deals damage.

---

## 8. Tank items that deal damage

#### Heartsteel (3084), H
- **Colossal Consumption:**
  - **Stacks:** while you are within `DistanceToChampion` 700 of an enemy champion you build stacks on them: `NumTicksToTrigger` 6 × `TrackerTickRate` 0.5 = 3 s. Stacks linger 3 s after you leave range.
  - **Damage:** the next attack on that champion deals `DamageProcCalc` = 70 + 0.06 × **your** max HP as bonus physical damage on-hit.
  - **Health gain:** you gain `DamageToMaxHealthRatio` 10% of that amount as permanent max HP.
  - **Cooldown:** `PerTargetCooldown` 30 s per target.
  - **Tags:** item damage tagged as basic damage; proc. On-hit damage modifiers don't affect it. Life steal applies.
- **Goliath:** +3% size per 1000 HP, up to 30%.

#### Sunfire Aegis (3068), H
- **Immolate:**
  - **Activation:** taking or dealing damage turns it on for `AuraDuration` 3 s.
  - **Damage:** `DamagePerTick` = 20 + 0.015 × bonus HP magic damage, every 1 s, within 325 + bonus size.
  - **Non-champions:** ×1.5 against minions (`MinionMod` +0.5) and ×1.8 against monsters.
  - **Tags:** proc and periodic.
- **Vestigial:** `MaxStacks`, `DamageAmpPerStack` and `StackDuration`.

#### Hollow Radiance (6664), H
- **Immolate:** `DamagePerTick` = 15 + 0.01 × bonus HP per second (×1.25 against minions and monsters).
- **Desolate:**
  - Killing a non-champion deals ×`ProcDPSMultiplier` 2 of that within `ProcAoE` 350.
  - A champion takedown (3 s window) deals ×`ChampProcDPSMultiplier` 4 within `ChampProcAoE` 500.
- ⚠ `BaseDamagePerTickTOOLTIPONLY` 10 and `HPRatioPerTickTOOLTIPONLY` 1.75 are stale tooltip values. Use the calc.

#### Bami's Cinder (6660), H
Immolate: 15 per second. Minions ×1.5, monsters ×2.

#### Unending Despair (2502), H/M
- **Anguish:** every `Cooldown` 4 s while in champion combat, deals `DrainCalc` = 0.03 × bonus HP magic damage to every enemy champion within `DrainRange` 650.
- **Heal:** `HealMultiplier` 2.5 × the post-mitigation damage dealt.
- **Tags:** area damage, so it **triggers ability effects** (Liandry's, Luden's and so on).
- **Timer:** leaving combat resets it. Whether the first pulse comes at 0 s or 4 s is not documented (L); the wiki wording suggests 4 s.

#### Dead Man's Plate (3742), H
- **Shipwrecker build-up:** moving builds Momentum (7 per 0.25 s, up to `MaxStacks` 100 after about 3.75 s), giving up to 20 move speed.
- **Damage:** the next attack consumes it for on-hit bonus physical damage of `BonusDamagePerStack` 0.4 × stacks + (stacks/100) × `MaxStacksADRatio` 1.0 × base AD. At most 40 + 100% base AD.
- **Interactions:** Shojin amplifies it (bug). It can add an extra Black Cleaver stack.

#### Protoplasm Harness (2525)
Lifeline gives health and healing. Defensive only.

---

## 9. Mana-charge items (Manaflow / Awe)

**Shared Manaflow rules** (H):
- **Charges:** you get a charge every `ManaChargeAmmoCD` 8 s, up to `ManaChargeMaxAmmo`.
- **Spending a charge:** dealing ability damage, or applying a buff or debuff with a non-innate ability, spends one charge for +`ManaPerCharge` max mana (double against champions). Manamune and Winter's also spend charges **on-hit**.
- **Limits:** once per cast instance (`InternalCDPerCastID` 6.5 s; the same cast instance can't do it again within 6.5 s). Capped at `MaxMana` 360 bonus mana, at which point the item transforms. Current mana goes up by the same amount.
- **Selling:** you lose the bonus mana but keep the progress.
- **Manaless champions:** can't use it.

| Item | Charges / mana | Awe and the transformed item |
|---|---|---|
| **Tear of the Goddess (3070)** | 4 charges, 3 mana (6 vs champions) | Helping Hand: +5 physical on-hit vs minions only |
| **Manamune (3004)** | 4 charges, 3 (6), on-hit too | `BonusADFromMana` = 2% of **max** mana as bonus AD. At 360 it becomes **Muramana (3042, not in the dump; wiki):** 1000 mana, same Awe. **Shock:** on-hits vs champions add 1.2% max mana bonus physical (proc, life steal). Champion-ability damage vs champions (not proc or indirect) adds 4% max mana (ranged 3%) bonus physical, once per target per cast instance every 6.5 s. Ability rules: if on-hit and ability effects are in the same instance, it uses the ability version; on-hit-only abilities use the attack version; if they are separate instances, both apply. |
| **Archangel's Staff (3003)** | 5 charges, 5 mana (10) | `APFromMana` 1% of bonus mana as AP → **Seraph's (3040):** 2% of bonus mana as AP |
| **Winter's Approach (3119)** | 4 charges, 3 (6) | `BonusHPFromMana` 15% of bonus mana as health → Fimbulwinter (3121): shield only. No damage. |
| **Whispering Circlet (2526)** | 5 charges, 4 (8) | Heal and shield power. No damage. |

---

## 10. Support items that affect damage

| Item | Effect | Conf |
|---|---|---|
| **Zaz'Zak's Realmspike (3871)** | Ability damage to a champion causes an explosion 0.5 s later: `TooltipDamage` = `BaseDamage` 10 + `APRatio` 0.15 × AP + `PercentHPDamage` 3% of **each target's** max HP, magic, in an area. `Cooldown` 10 s. Monster cap 300. Area damage, so it triggers ability effects. | H |
| **Zeke's Convergence (3050)** | +15 ultimate haste. When you cast your ultimate, a storm starts (it waits up to 5 s for an enemy to be in range) and lasts 5 s: `DamagePerSecond` 30 magic (7.5 per 0.25 s) in `StormRadius` 350, plus a 30% slow. `Cooldown` 45 s. Proc and AoE. | H |
| **Redemption (3107)** | Active (`Cooldown` 90 s), 2.5 s delay: enemy champions in `AOESize` 550 take `DamageToChampions` 10% max HP **true** damage. Area damage; triggers ability effects. | H |
| **Ardent Censer (3504)** | Healing or shielding an ally buffs you both for `Duration` 6 s: +`AttackSpeedMin` 25% attack speed and +`OnHitMin` 20 magic on-hit (proc, life steal). | H |
| **Dream Maker (3870)** | Healing or shielding an ally gives them, for 3 s, a Purple bubble: their next damaging attack **or ability** deals `ProcDmg` bonus magic damage (40; +10 per **your** level from level 7; 160 at level 18). It is reduced to 33.3% for AoE damage against non-champions and applies once per cast instance. It is no longer on-hit (since V26.11). | H |
| **Staff of Flowing Water (6616)** | Healing or shielding an ally gives you both +`APMod` 40 AP and +`AHMod` 15 Ability Haste for 6 s. | H |
| **Bandlepipes (2524)** | Slowing or immobilizing a champion gives Fanfare for 8 s (ranged ×0.5, so 4 s): +20 move speed for you, and an aura of +30% attack speed for nearby allies including you (ranged holder ×0.667, so 20%). The attack speed lingers `ASDuration` 1 s. | H |
| **Imperial Mandate / Bloodsong / Abyssal Mask** | See §4 and §3. | H |

---

## 11. Components, starters, consumables (only the parts relevant to damage)

| Item | Damage-relevant part | Conf |
|---|---|---|
| Recurve Bow (1043) | On-hit `OnHitDamage` 15 **physical** (proc, life steal, not vs structures) | H |
| Hearthbound Axe (3051) | 20 AD and 20% AS only | H |
| Scout's Slingshot (3144) | Bullseye: damaging a champion deals `DamageAmount` 40 magic. `Cooldown` 40 s, minus 1 s per attack (on-attack). It is **spell damage**, so it triggers ability effects. Not blocked by spell shields. Finished items don't keep it. | H |
| Last Whisper (3035) / Serrated Dirk (3134) / The Brutalizer (2020) | 18% armor penetration / 10 lethality / 5 lethality. Groups: Fatality / Dirk / none. | H |
| Executioner's Calling (3123) / Oblivion Orb (3916) | 40% Grievous Wounds for 3 s on physical / magic damage | H |
| Phage (3044) | On-hit +20 move speed (ranged 10) for 2 s | H |
| Sheen, Tiamat, Bami's Cinder, Lost Chapter, Haunting Guise, Fated Ashes, Hextech Alternator | Covered in their own sections. Lost Chapter only restores mana on level-up. | H |
| Noonquiver / Zeal / Cloak / Pickaxe / B. F. Sword / tomes / Kindlegem | Stats only | H |
| Doran's Blade (1055) | 10 AD, 80 HP, 2.5% omnivamp (the old Life Draining passive is gone) | H |
| Doran's Ring (1056) | 18 AP. Helping Hand +5 vs minions. Drain is mana only. | H |
| Doran's Bow (1086) | 8 AD, 15% AS, 1.5% omnivamp. ⚠ `HealthOnHit` 3 appears in DATA but not in the tooltip or on the wiki; probably vestigial (L). | M |
| Doran's Shield / Doran's Helm / Tear | Helping Hand +5 physical vs **minions** only | H |
| Cull (1083) | 7 AD, +3 HP on-hit | H |
| Elixir of Sorcery (2139) | +50 AP. Damaging a champion or turret deals +25 **true** damage, with a 5 s cooldown per champion. | H |
| Elixir of Wrath (2140) | +30 AD. Heals 12% of physical damage dealt to champions (33% effectiveness for AoE). | H |
| Guardian's Blade / Hammer / Orb (ARAM) | Stats only (30 AD 15 AH / 25 AD 5% LS / 50 AP) | H |
| Scorchclaw Pup (1101), via the Scorchclaw's Slash buff after it evolves | Every 0.5 s gain `StacksPerHalfSec` 3 Ember stacks, up to 100. At 100, your next damage to a champion (it has to apply ability effects or be basic attack damage) burns the target and enemies within 250 for `AvatarMaxHPBurnTotal` 5% max HP **true** damage over 4 s, plus a decaying 30% slow. The variant id 1107 has 4% and a 2 s slow (probably for another queue). The wiki has 5% since V26.01. | M |

---

## 12. Boots
Tier-3 boots come from the **Midlane Quest**, which upgrades your tier-2 boots for free. The **Botlane Quest** moves boots into a separate quest slot. You can own only one pair of boots.

| Boots | Offensive part | Conf |
|---|---|---|
| Sorcerer's Shoes (3020) → **Spellslinger's Shoes (3175)** | 12 flat magic penetration → 20 flat + 8% magic penetration | H |
| Berserker's Greaves (3006) → **Gunmetal Greaves (3172)** | 30% AS → 45% AS + 5% life steal. ⚠ `MeleeMS`/`RangedMSMultiplier`/`Duration` are left over from the Noxian Gait passive removed in V26.01. | H |
| Boots of Swiftness (3009) → **Swiftmarch (3170)** | 55 → 65 move speed. Swiftmarch's Noxian Fervor gives adaptive force = `MSAdaptiveRatio` 5% × **total** move speed (0.6 AD or 1 AP per point). `MoveSpeedMultiplier` 0.04 is unexplained. | H/M |
| Ionian Boots (3158) → **Crimson Lucidity (3171)** | 10 → 20 Ability Haste, 10 → 20 summoner spell haste. Crimson adds 10% move speed (ranged 8%) for 4 s on ability damage or allied buffs. | H |
| Gluttonous Greaves (3008) → **Immortal Path (3168)** | 4% omnivamp + 0.6% per takedown (up to 10). Immortal Path's "Now and Forever": while above 50% max HP you deal `DamageMod` **4% more damage** (outgoing, additive pool); below 50% you get 12% more healing. | H |
| Plated Steelcaps / Armored Advance / Mercury's / Chainlaced Crushers | Defensive; see §13 | H |

---

## 13. Modifiers on the target's side (brief)
- **Randuin's Omen:** crits deal `PercentCritDamageReduction` 30% less. Also reduces Shadowflame's 20% to 14%.
- **Plated Steelcaps / Armored Advance:** basic damage −10%, including magic basic damage but not true damage or on-hit effects. Multiplies with armor. Turret shots are excluded.
- **Warden's Mail:** the first post-mitigation basic-damage instance per cast instance is reduced by `BlockBase` 15, capped at `WardenDamageMax` 20%. ⚠ items.txt also has `MaxHPRatio` 0.005, possibly +0.5% max HP added to the block; the wiki says flat 15.
- **Death's Dance:** 30% (melee wearer) or 10% (ranged wearer) of post-mitigation physical and magic damage is stored and taken as true damage over 3 s, one third per second. It applies after Warden's and Randuin's, and nothing modifies the stored damage. Defy (takedown) clears it.
- **Guardian's Horn (ARAM):** −15 per champion attack or ability (3.75 against damage over time).
- **Jak'Sho:** after 5 s of champion combat, +30% bonus armor and MR. **Force of Nature:** +70 MR after 8 stacks of magic damage.
- **Lifeline shields:** Sterak's 60% bonus HP; Shieldbow 400 (+30 per level from 9, so 700) (ranged 80%); Maw (magic) 200 + 1.5 bonus AD; Seraph's 18% max mana; Hexdrinker 110–280 (magic); Protoplasm (health and heal). One per group.
- **Annul spell shields:** Banshee's, Edge of Night and Verdant Barrier each block one ability.
- **Not covered, as requested:** Thornmail, Kaenic Rookern, Zhonya's, Frozen Heart (−20% attack speed to nearby enemy champions).

---

## 14. Where items.txt and the wiki disagree, and data values whose meaning is unclear

| Item | items.txt | Wiki / meaning | What to do |
|---|---|---|---|
| Horizon Focus | Tooltip has no damage amp; DATA has `DamageAmp` 0.1 | 10% more damage to Hypershot-marked targets (re-added in V26.01) | Use 0.1 (outgoing) |
| Spear of Shojin | `RangedMod` 0.5 and a ranged tooltip of 1.5% per stack | The ranged display was a tooltip bug fixed in V14.4; real value 3% for everyone | Default 3%; flag |
| Luden's Echo | `MissileRange` 650 | Secondary targets within 600 | Use 650 (data) and note the difference |
| Riftmaker | `BuffCounterDuration` 4, `SecondsInCombat` 4, `MaxAPMultiplier` 0.05 | Stacks last 3 s (not full) / 5 s (full); `MaxAPMultiplier` not described | Use the data value for timing; ignore `MaxAPMultiplier` |
| Liandry's | `MaxDamageHPThreshold` 1250 | Leftover from Liandry's Anguish "Agony" (max at 1250 bonus HP) | Ignore |
| BotRK | `RangedMoveSpeedMod` −0.15 | Slow is 30% for everyone | Slow only, not damage |
| Hollow Radiance | `*TOOLTIPONLY` 10 / 1.75 | Real damage: 15 + 1% bonus HP | Use the `DamagePerTick` calc |
| Profane Hydra | `HealthThreshold` 0.5, `SlashDamageMax` | Execute bonus removed in V14.19 | Ignore |
| Serylda's | `LethalityAmount` 15, `PenCalc` | Rancor removed in V14.19; no lethality | Ignore |
| Essence Reaver | `FlatManaRefund` 15, `ManaRefundRatio` 0.15 | Essence Drain removed in V26.01 | Ignore; mana = 50% of Spellblade damage |
| Gunmetal Greaves | `MeleeMS` 0.15, `RangedMSMultiplier`, `Duration` | Noxian Gait removed in V26.01 | Ignore |
| Runaan's | `BoltMinPercent`/`BoltMaxPercent` 40, `OnHitDamage` null | The bolt is 60% AD (V26.20) | Use the `BoltDamage` calc |
| Guinsoo's | `Mythic*`, `Crit*` null | Removed systems | Ignore |
| Hubris | `SpellMaxAmp`, `MinHealthThreshold`, `MSDuration`, `SpeedAmount`, `BonusLethality` | Not in the current effect | Ignore |
| Sterak's | `RangedEffectiveness` 0.6, `HealthPercent`, `HealPercent` | Wiki: shield 60% bonus HP, no ranged penalty | Use `ShieldSize` |
| Sunfire | `MaxStacks` 1, `DamageAmpPerStack`/`StackDuration` null | Old stacking Sunfire | Ignore |
| Stormsurge | `GoldReward`/`ProcMoveSpeedAmount` null | Removed in V25.10 | Ignore |
| Cosmic Drive | `MovespeedToGrant` 40, `MaxStacks` 3, `ItemCooldown` 10 | Current effect is a flat 20 move speed for 4 s | Ignore |
| Umbral Glaive | Ward damage 3 / 2 | Wiki: 2 / 1 | Wards only |
| Warden's Mail | `MaxHPRatio` 0.005 | Wiki: flat 15 | Flag (target side) |
| Bloodsong | `BaseADRatio` 0.1 (calc `{ce8aadac}`) | Not mentioned | Ignore |
| Iceborn | `MonsterMod` 1.5 | Not mentioned | Monsters only |
| Actualizer | `OverflowAddition` 3, `OverflowRevert` 1 | Not mentioned | Ignore |
| Swiftmarch | `MoveSpeedMultiplier` 0.04 | Not mentioned | Ignore |
| Doran's Bow | `HealthOnHit` 3 | Not mentioned | L; probably vestigial |
| Statikk | `BounceDelay` null | 0.05 s per bounce | Use 0.05 |

Data values that are not obvious but **are** explained:
- `InternalCDPerCastID` 6.5: a Manaflow or Muramana proc can't come from the same cast instance again within 6.5 s.
- `CastIDLockout` 1: Shojin, one stack per cast instance per second.
- `InternalCD` 0.01 (Black Cleaver): once per frame.
- `InternalCD` 0.3 (Bloodletter's): once every 0.3 s per cast instance.
- `MaxProcPerAuto` 10: Hydra splash cap.
- `VampAmp` 1.0: Ravenous life steal at 100% effectiveness.
- `RepeatDamageReduction` 0.2: Luden's leftover Echo damage.
- `ChampProcDPSMultiplier` 4: Hollow Radiance champion-takedown eruption.
- `RangeModifier` 0.8 / `AbilityDamageRangeMod` 0.5: Bastionbreaker ranged multipliers for Sabotage / Shaped Charge.
- `MonsterDamageCap` 40 (Liandry's): per second, which is 20 per tick.

---

## 15. Items missing from items.txt, or removed
- **Transformed items that the dump doesn't include** (numbers from the wiki): **Muramana (3042)**, **Seraph's Embrace (3040)**, **Fimbulwinter (3121)**, **Diadem of Songs (2530)**. Their effects are in §9.
- **Opportunity:** removed in V26.09.
- **Kircheis Shard:** removed in V14.10. There is no Energized component any more; Scout's Slingshot has its own Bullseye.
- **Navori Quickblades:** replaced by Navori Flickerblade in V14.10.
- The wiki item module lists no other Summoner's Rift items that the dump lacks, apart from Gangplank-only upgrades, turret and objective items, Slightly Magical Boots (+10 move speed), and the elixirs granted by the **Triple Tonic** rune:
  - **Elixir of Force:** +25 adaptive force for 60 s, which is damage-relevant if you simulate that rune.
  - **Elixir of Avarice:** +5 true damage on-hit vs minions.
  - **Elixir of Skill:** one skill point.
