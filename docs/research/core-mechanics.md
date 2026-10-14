# LoL core damage and stat formulas, live patch 26.20 (game version 16.20)

Researched 2026-10-14. Riot calls its 2026 patches 26.x, the client and game data call them 16.x, and the wiki writes them as V26.xx. So "16.20" is the same patch as "26.20". The CommunityDragon `latest` content metadata reads `16.20.8248524+branch.releases-16-20`, so the game data below is from the live patch.

How I checked: wiki.leagueoflegends.com pages (read as rendered pages and as raw wikitext), official Riot patch notes, and the 16.20 game data on CommunityDragon (`raw.communitydragon.org/latest/...`: champion `.bin.json` files, `items.cdtb.bin.json`, `perks.cdtb.bin.json`, and the `items.json`/`perks.json` tooltips). Where the wiki and the game data disagree, I say so.

---

## 1. Champion stat growth per level

**Formula:**
```
Stat(n) = base + bonus + g × (n − 1) × (0.7025 + 0.0175 × (n − 1))
Gain when levelling up to level n = g × (0.65 + 0.035 × n)
```
- It applies directly to **AD, armor, MR, HP, HP regen, mana and mana regen** (the wiki's "first seven growing stats").
- **Attack speed** uses the same growth term, but the term goes inside the bracket that is multiplied by the AS ratio (see §2).
- At level 18 the total is base + 17·g.
- **New in 2026:** completing the Top lane Role Quest raises the level cap to **20** (V26.01). The formula keeps going: level 20 = base + 19.665·g, and the level-19→20 gain is 135% of g.
- CharacterRecord fields in the 16.20 data: `baseHPModifiable`/`hpPerLevelModifiable`, `baseDamageModifiable`/`damagePerLevelModifiable`, `baseArmorModifiable`/`armorPerLevelModifiable`, `baseMR`/`mrPerLevel`, `baseStaticHPRegenModifiable`/`hpRegenPerLevelModifiable`, `attackSpeedModifiable`, `attackSpeedRatioModifiable`, `attackSpeedPerLevelModifiable`. The AS growth is stored in **percent** (e.g. `3.0` means 3%).
- Sources: https://wiki.leagueoflegends.com/en-us/Champion_statistic (the quadratic growth formula dates from V4.20) · level cap: https://wiki.leagueoflegends.com/en-us/Experience_(champion), https://wiki.leagueoflegends.com/en-us/Role_Quests
- **Confidence: high.**
- Notes: compute with unrounded values (the HUD rounds). Growth values can't be modified, except for Gnar's forms.

## 2. Attack speed

**Formula:**
```
TotalAS = AS_base + [ AS_bonus + g_AS × (n−1) × (0.7025 + 0.0175 × (n−1)) ] × AS_ratio
TotalAS = clamp(TotalAS, 0.2, cap)
```
- `AS_bonus` is the sum of every percent bonus AS (items, runes, buffs), stacked additively, written as a fraction.
- Per-level growth counts as bonus AS. It is added to the item and rune bonus **before** the ratio is applied.
- `AS_ratio` is set per champion. For most champions it equals base AS. Exceptions include Twisted Fate (0.625/0.651), Aphelios (0.665/0.658) and Tryndamere (ratio 0.725 since V26.06). Read it from `attackSpeedRatioModifiable`.
- **Cap: 3.0.** Patch 25.S1.3 (Feb 2025) changed "Baseline Attack Speed Cap: 2.5 ⇒ 3.0". In the engine it is 1/0.333 s, which is **3.003** (wiki). The minimum is **0.2**.
- **Effects that raise or bypass the cap:**
  - Hail of Blades: cap becomes 90 while active. The rune text says "Allows you to temporarily exceed the Attack Speed limit".
  - Bel'Veth passive: 9999.
  - Jinx's *Get Excited!*: 90.
  - Kennen's E: the cap rises by the amount of AS gained.
  - Varus's *Living Vengeance*: 3.33.
  - Zeri: special case.
- **Fixed AS:** Urgot's W attacks at 3.0.
- **Lower caps:** Sion's passive (1.75), Zeri's *Burst Fire* (1.5), Jhin (AS only grows with level), Graves (reload timer).
- **Lethal Tempo no longer raises the cap.** That was removed in the V14.19 re-add. Bonus AS above the cap still increases its bolt damage. It currently gives 6% (melee) / 4.8% (ranged) per stack, ×6.
- Sources: https://wiki.leagueoflegends.com/en-us/Attack_speed · https://www.leagueoflegends.com/en-us/news/game-updates/patch-2025-s1-3-notes/ · https://wiki.leagueoflegends.com/en-us/V25.S1.3 · https://wiki.leagueoflegends.com/en-us/Lethal_Tempo
- **Confidence: high** for the formula and the cap; **medium** that the list of cap exceptions is complete.

## 3. Critical strike

**Base crit damage is 200% on live.** It was 175% from V10.23 and went back to 200% in **V26.01 (patch 26.1, January 2026)**. The wiki V26.01 page says: "Base critical strike damage increased to 200% from 175%."

**Infinity Edge (16.20):** 75 AD, 25% crit chance, **+30% crit damage**, 3500g. V26.01 changed crit damage 40%→30% and AD 65→75. The game data has `mFlatCritDamageMod: 0.3`. With IE, a normal crit deals 230%.

**Formula** (checked against the Yasuo and Jhin tooltip numbers):
```
CritMult = (critDamageMultiplier_record + Σ bonus crit damage) × champMod × (target has Randuin's ? 0.7 : 1)
Expected per-attack multiplier = 1 + min(critChance, 1) × (CritMult − 1)
```
- Crit chance stacks additively and is capped at 100%. Rolls use a pseudo-random algorithm, but the long-run average equals the listed chance.
- Bonus crit damage stacks additively. The champion modifier then multiplies the total. For example, Yasuo deals 0.95 × (200 + 30) = 190% + 28.5% = 218.5%.

**The `critDamageMultiplier: 2.0` field.** This CharacterRecord field is the base crit stat, so there is no separate 175% global to apply. In the 16.20 data every champion record has it set explicitly to 2.0, except **Ashe at 1.0**. In the 15.24 data (still the 175% era), normal champions had no such field at all and only Ashe had an explicit 1.0. That suggests the engine default (1.75) was used in 2025, and V26.01 made 2.0 explicit. (This is my inference from the data; medium confidence.) For 16.20, use the record value as-is.

**Champion crit modifiers on live (16.20 data and the wiki agree):**

| Champion | Mechanic | Crit (no IE / with IE) | Patch |
|---|---|---|---|
| Yasuo | Total crit ×0.95 (`CritDamageMod 0.95`). Crit chance ×2. Each 1% crit above 100% gives 0.5 bonus AD | 190% / 218.5% | V26.01 set −10%; V26.17 cut it to −5% |
| Yone | Same as Yasuo (×0.95). Every second attack is 50% physical / 50% magic | 190% / 218.5% | V26.17 |
| Senna | Total crit ×0.80 | 160% / 184% | V26.13 (0.85), V26.14 (0.80) |
| Jhin | Total crit ×0.75 (`CritReductionPercent 0.25`). His 4th shot always crits | 150% / 172.5% | V26.01 (was 14% off 175%) |
| Ashe | Record crit multiplier is 1.0, so crits add no damage (they only strengthen the slow). Instead **every** attack deals bonus damage equal to critChance × (100% + bonus crit damage) of the attack's damage | 100% on crit; passive bonus 0–100% (+0–30% with IE) | V26.01 raised the ratio from 75% to 100% |
| Graves | A crit fires 6 pellets instead of 4. Each pellet × (1 + 0.5 × (CritMult − 1)) (`CritDamageRatio 0.5`), so 150% / 165% per pellet. If all pellets hit, about 2× a normal 4-pellet attack | ≈279.8–399.8% AD (all pellets, by level) | V26.01, Jan 9 hotfix (35%→50%) |
| Fiora | E's second attack is a guaranteed crit for **160/170/180/190/200% total AD** (game data `AttackTwoPercentTAD`). Neither the wiki nor the data shows it scaling with IE | fixed | — (IE interaction: low confidence) |
| Aphelios | Basic attacks crit normally. Only his R (*Moonlight Vigil*) computes crit as if he had 30% crit chance: 100–130% (+0–9% with IE) | 200% / 230% on attacks | V26.01 |
| Akshan | The passive second shot crits at 100% effectiveness. *Heroic Swing* uses 50% of bonus crit; *Comeuppance* uses 30% | — | V26.01 |
| Kalista | No crit modifier. Basic attacks deal 100% AD (since V13.11) | 200% / 230% | — |
| Tryndamere | No crit damage modifier. He only gains crit **chance** from Fury | 200% / 230% | — |
| Shaco | Backstab crit 2.0 / 2.3×. Deceive's backstab uses 60% of bonus crit (1.6 / 1.78×) | — | V26.01 |

Other ability crit scalings were also rewritten in 26.1 as a percentage of bonus crit damage: Caitlyn, Miss Fortune, Samira, Sivir, Xayah, Tristana, Smolder (changed again V26.10, V26.11 and V26.20), Nilah, Lucian, Viego, Garen and Kindred. Zeri's W wall crit has been 150% base and 50% bonus since V26.09. Kennen's W can crit for 140% (+40% bonus) since V26.09.

Defensive and item effects:
- **Randuin's Omen:** crits deal 30% less damage to the wearer.
- **Fiendhunter Bolts:** *Opening Barrage* crits for 80% of normal crit damage.
- **Sundered Sky:** *Lightshield Strike* is a guaranteed crit (80% of crit damage since V26.01).

Sources: https://wiki.leagueoflegends.com/en-us/Critical_strike · https://wiki.leagueoflegends.com/en-us/V26.01 · https://www.leagueoflegends.com/en-us/news/game-updates/patch-26-1-notes/ · https://wiki.leagueoflegends.com/en-us/Infinity_Edge · https://wiki.leagueoflegends.com/en-us/Yasuo/Patch_history (and the matching pages for Yone, Senna, Jhin, Graves, Ashe, Aphelios) · `raw.communitydragon.org/latest/game/data/characters/<champ>/<champ>.bin.json`

**Confidence: high** for base 200%, IE +30%, and the Yasuo, Yone, Senna, Jhin, Graves and Ashe values (wiki and data agree). **Medium** for how the 175% was implemented in 2025. **Low** for Fiora E with IE.

## 4. Lethality

- **1 lethality = 1 flat armor penetration at every level**, since **V14.1** (January 2024).
- History:
  - V6.22: lethality replaced flat armor pen and scaled with the *target's* level (40.33–100%).
  - V7.14: scaling switched to the *user's* level, `Lethality × (0.6 + 0.4 × level / 18)`.
  - V14.1: the level scaling was removed.
  - V14.9: lethality became an innate stat.
- I found no system change to lethality in 2025 or 2026 (the Armor penetration page was last updated V26.01).
- In the item data the stat is `PhysicalLethality` (e.g. Youmuu's has 18).
- Lethality is applied last and cannot take armor below 0 (see §5).
- Current lethality sources:
  - Bastionbreaker: 22 (new in 26.1).
  - Youmuu's Ghostblade, Umbral Glaive, Hubris, Axiom Arc, Profane Hydra: 18 each.
  - Voltaic Cyclosword: 10, plus 15 (melee) / 12 (ranged) temporary lethality while Energized (V26.09).
  - Aphelios: 4.5 lethality per passive rank.
- Sources: https://wiki.leagueoflegends.com/en-us/Lethality · https://wiki.leagueoflegends.com/en-us/Armor_penetration
- **Confidence: high.**

## 5. Order of resist reduction and penetration; damage multiplier

Armor and MR use the same rules (MR with magic pen). Order:
1. **Flat reduction.** Stacks additively and changes the target's real stat, so it affects everyone. It **can take resist below 0**. The wiki examples split it proportionally between base and bonus resist (15 reduction on 20 base + 40 bonus leaves 15 + 30). The same page also has one sentence saying "bonus first", which contradicts those examples; I followed the examples.
2. **Percent reduction.** Stacks multiplicatively (`r1 + r2 − r1·r2`) and changes the real stat. **Skipped if resist ≤ 0.**
3. **Percent penetration**, including **percent bonus armor penetration**, which only applies to the bonus portion. Applies to the attacker only and stacks multiplicatively:
   `eff = base × Π(1 − p_i) + bonus × Π(1 − p_i) × Π(1 − pb_j)`.
   **Skipped if resist ≤ 0.** One champion exception: Yasuo's R bonus armor pen stacks *additively* with other percent pen (V25.11, undocumented).
4. **Flat penetration / lethality.** Subtracted, but **cannot take resist below 0**. Skipped if resist ≤ 0.

So flat reduction is the only step that can make resist negative, and penetration never applies to negative resist.

**Damage multiplier (R = effective resist):**
```
R ≥ 0 :  mult = 100 / (100 + R)
R < 0 :  mult = 2 − 100 / (100 − R)      (never more than 2×)
```
Worked example from the wiki: 300 armor (100 base / 200 bonus), 30 flat reduction, 30% reduction, 45% bonus pen and 10 lethality gives 122.3 effective armor. Starting from 18 armor with the same effects gives −12.

Sources: https://wiki.leagueoflegends.com/en-us/Armor_penetration · https://wiki.leagueoflegends.com/en-us/Magic_penetration · https://wiki.leagueoflegends.com/en-us/Armor · https://wiki.leagueoflegends.com/en-us/V25.11 (Yasuo)

**Confidence: high.** The only soft spot is the flat-reduction split (the wiki contradicts itself).

## 6. Magic penetration items (values from the 16.20 game data)

| Item | Stats | Notes / patch |
|---|---|---|
| Sorcerer's Shoes | **12 flat MPen**, 45 MS, 1100g | V14.21 cut it 15→12. The Triumphant +2 version went away with Feats of Strength in V26.01 |
| Spellslinger's Shoes (tier 3) | **20 flat + 8% MPen**, 45 MS | Mid lane Role Quest upgrades Sorcerer's to it for free (V26.01). V26.16: flat 18→20. V26.01: 7→8% |
| Void Staff | 95 AP, **40% MPen**, 3000g | Unchanged since V14.15 |
| Cryptbloom | 75 AP, 20 AH, **30% MPen**, 3000g | V25.10 / V25.08. *Life From Death* heals 100 (+20% AP) on takedown |
| Shadowflame | 110 AP, **15 flat MPen**, 3200g | See Cinderbloom below |
| Stormsurge | 90 AP, 15 flat MPen | — |
| Blighting Jewel | 13% MPen | Component |
| Terminus | Dark attacks give 10% armor pen and MPen for 5s | — |

**Shadowflame's Cinderbloom is a crit-like effect.** Magic and true damage "critically strike" targets below **40% of maximum health** for **+20%**. The wiki's exact formula:
```
dmg = base + base × 0.2 × Π(crit damage modifiers)
```
- With IE that is 100 + 20 × 1.3 = 126%.
- Against Randuin's it is 114%.
- With IE against Randuin's it is 118.2%.
- On a damage instance that already crits, it multiplies: 2.0 × 1.2 = 240%.
- It does not apply to summoner spells or structures.
- V14.19 set damage-over-time and pet damage to the same 120%. V26.11 fixed a bug with on-hit effects.

Percent MPen sources stack multiplicatively: Void Staff + Spellslinger's = 1 − 0.60 × 0.92 = 44.8%.

Sources: https://wiki.leagueoflegends.com/en-us/Magic_penetration · https://wiki.leagueoflegends.com/en-us/Sorcerer%27s_Shoes · https://wiki.leagueoflegends.com/en-us/Spellslinger%27s_Shoes · https://wiki.leagueoflegends.com/en-us/Void_Staff · https://wiki.leagueoflegends.com/en-us/Cryptbloom · https://wiki.leagueoflegends.com/en-us/Shadowflame · `raw.communitydragon.org/latest/game/items.cdtb.bin.json`

**Confidence: high.**

## 7. How damage amplifiers stack

**Current behaviour (since V26.09, not in Riot's patch notes; documented by the wiki):**
- **Damage-dealt modifiers now stack additively with each other** ("Modifiers to damage dealt now stack additively instead of multiplicatively").
- **Damage-received modifiers still stack multiplicatively**, with each other and with armor/MR mitigation.
- The amplified portion is now dealt as a **separate damage instance**, which interacts with effects like Illaoi's E and Zed's R. The same patch fixed Cut Down applying its amplification twice.

Which modifiers fall into each group:
- **Damage dealt (add together):**
  - Runes: Press the Attack 8%, Coup de Grace 8% (target below 40% HP), Cut Down 8% (target above 60% HP), Last Stand 5–11%, Axiom Arcanist (ult +12%).
  - Items: Liandry's *Suffering* 2%/s up to 6%, Riftmaker up to 8%, Lord Dominik's *Giant Slayer* up to 15%, Shojin, Horizon Focus, Actualizer, Hexoptics C44.
  - Neutral: Chemtech Soul.
  - Decreasing damage dealt: Exhaust.
- **Damage received (multiply):**
  - Abyssal Mask (+12% magic damage taken), Bloodsong, Imperial Mandate, Vladimir's R.
  - All percent damage reduction (Alistar R, Braum E, etc.) and resist mitigation.
- **Crit and Cinderbloom** are crit multipliers. They apply to the raw damage and multiply with everything else.

Suggested pipeline:
```
post = raw × CritMult × CinderbloomMult × (1 + Σ dealt_amps) × resistMult × Π(1 + received_mods)
```
**Before V26.09, and for all of 2025, damage-dealt amplifiers multiplied with each other.**

Sources: https://wiki.leagueoflegends.com/en-us/Damage_modifier · https://wiki.leagueoflegends.com/en-us/V26.09 · https://wiki.leagueoflegends.com/en-us/Damage

**Confidence: medium.**
- The change is "Undocumented". The Damage_modifier page is tagged *Outdated* and has a "pending for test: are there any exceptions after V26.09?" note.
- The general wiki Stacking page still says amplifiers multiply.
- How damage-dealt *reductions* such as Exhaust combine with amplifiers after V26.09 is unclear.

I'd make this a switch in the simulator (additive vs multiplicative).

## 8. Ability haste → cooldown

```
Cooldown = BaseCD × 100 / (100 + AH)
CDR%     = AH / (100 + AH)
```
- Basic ability haste and ultimate haste are added to AH for the abilities they cover. The total is capped at 500 (83.3% CDR).
- Item haste, summoner spell haste and trinket haste use the same formula on their own cooldowns.
- The haste formula has been unchanged since Pre-Season 2021. 2026 only changed individual items and runes (e.g. V26.09 removed Arcane Comet's cooldown refund).
- Source: https://wiki.leagueoflegends.com/en-us/Haste (Ability_haste redirects there)
- **Confidence: high.**

## 9. Adaptive force and stat shards

**Conversion:** 1 adaptive force = **0.6 bonus AD or 1 AP**. The shard gives 9 adaptive, which is 5.4 AD or 9 AP (game data `StatGain1 5.4` / `StatGain2 9`).

**Which stat you get:**
- The game compares the champion's **current bonus AD and AP** and gives whichever is higher. Most item passives count toward this; champion passives don't.
- It is recomputed as stats change.
- On a tie, including 0/0, the champion's adaptive type decides. The CharacterRecord has `mAdaptiveForceToAbilityPowerWeight: 1.0` for magic-type champions (e.g. Annie); the field is absent for physical ones. The wiki's champion data counts 95 Physical and 80 Magic.
- Adaptive *damage* uses the same rule. Arcane Comet and Electrocute are exceptions.

**Stat shards on live (16.20 `perks.cdtb.bin.json`):**

| Row | Option 1 | Option 2 | Option 3 |
|---|---|---|---|
| Offense | Adaptive 9 | 10% bonus AS | 8 ability haste |
| Flex | Adaptive 9 | 2.5% bonus MS | Health scaling 10–180 |
| Defense | 65 HP | 15% tenacity and slow resist | Health scaling 10–180 |

- Health scaling is `StatGainMin 10` / `StatGainMax 180`, i.e. 10 × level up to level 18. The wiki shows "10–200" because its template runs to level 20 (Top quest cap). I couldn't confirm what happens at levels 19–20; the wiki implies it keeps rising 10 per level.
- Patch history: V25.22 raised MS 2%→2.5% and tenacity/slow resist 10%→15%. The current row layout dates from V14.2.

Sources: https://wiki.leagueoflegends.com/en-us/Adaptive_force · https://wiki.leagueoflegends.com/en-us/Rune · https://wiki.leagueoflegends.com/en-us/V25.22 · `raw.communitydragon.org/latest/game/perks.cdtb.bin.json`

**Confidence: high.** Medium for the health shard at levels 19–20.

## 10. On-hit, on-attack, basic and ability damage (summary)

- **Basic damage** (`BasicAttack` tag): champion basic attacks. They apply life steal and on-hit effects and can crit.
- **On-attack** effects fire when the windup completes: Rageblade, Navori, Runaan's, Yun Tal, Rapid Firecannon/Voltaic stacks, Fleet Footwork, Hail of Blades, Lethal Tempo.
- **On-hit** effects fire when the attack lands: BotRK, Black Cleaver, Wit's End, Nashor's, Terminus, Spellblade procs (Essence Reaver, Dusk and Dawn), Bastionbreaker, Doran's items and others. On-hit damage does not crit unless stated otherwise.
- **Ability damage** (spell, area and persistent damage) triggers **ability/spell effects**:
  - Liandry's, Rylai's, Luden's, Blackfire Torch, Serylda's, Fated Ashes, Zaz'Zak's.
  - Arcane Comet, Dark Harvest, Cheap Shot, Scorch, Deathfire Touch.
  - Hextech Soul, spell vamp.
- Some items need damage from a **champion ability** specifically: Bastionbreaker, Shojin, Horizon Focus, Malignance, Muramana, Actualizer.
- The rule: *every damaging ability except attack effects deals ability damage.*
- **Item and rune proc damage** is tagged Proc/Item and **does not trigger spell effects**. For example, the Lethal Tempo bolt is proc damage and doesn't trigger spell effects.
- **Exceptions that do trigger spell effects:** Hextech Gunblade, Rocketbelt, Tiamat/Ravenous/Profane Hydra actives, Stridebreaker active, Redemption, Unending Despair, Stormsurge, Scout's Slingshot, Zaz'Zak's, Aftershock, Mark/Dash.
- **Empowered attacks that count as ability damage:** Darius W, Nasus Q, Jax W, Garen Q, Trundle Q, Vayne Q, Blitzcrank's *Power Fist* and others (see the source list).
- **Sheen-style Spellblade** triggers on ability **cast**; its proc is on-hit damage.
- Since V26.01, omnivamp works at 33% against minions and monsters for area, damage-over-time and pet damage.

Sources: https://wiki.leagueoflegends.com/en-us/Ability_damage · https://wiki.leagueoflegends.com/en-us/Ability_effects · https://wiki.leagueoflegends.com/en-us/Attack_effects · https://wiki.leagueoflegends.com/en-us/Damage

**Confidence: medium-high.** The wiki lists are maintained by hand.

## 11. Basic attack damage

- **Default:** 100% **total AD** as physical damage, multiplied by CritMult when it crits. On-hit damage is added separately.
- **Against turrets:** champions deal 100% AD (+60% AP). It is physical damage if bonus AD > 60% AP, otherwise magic.

Champion cases worth flagging:
- **Graves:** 4 pellets.
  - First pellet deals `0.6895 + 0.01765·L·(0.595 + 0.0225(L−1))` × AD, which is 70% at level 1 and 100% at level 18.
  - Each extra pellet on the same target adds 33.302% of that, so 4 pellets deal 139.9–199.9% AD.
  - −25% against structures. Crits fire 6 pellets (§3). He uses a reload timer instead of normal attack timing.
- **Jhin:** AS only grows with level; bonus AS and crit chance convert to AD. His 4th shot always crits (150% / 172.5%) and adds 15–25% of missing HP.
- **Kled:** while dismounted, his attacks deal **85–100%** damage to champions (by level 1/6/11/16).
- **Kalista:** **100% AD** since V13.11. The old "90% AD" figure is outdated.
- **Yone:** every second attack is 50% physical / 50% magic.
- **Ashe:** a crit adds nothing (100%); her passive adds damage based on crit chance (§3).
- **Jinx (Fishbones):** 110% AD area damage; crit modifiers apply.
- **Zeri:** basic attacks are magic damage (*Living Battery*).
- **Annie:** nothing special; plain 100% AD physical.

Other champions with modified attacks: Akshan, Aphelios (Infernum), K'Sante, Lucian, Master Yi, Samira, Viego, Zaahen and others.

Sources: https://wiki.leagueoflegends.com/en-us/Basic_attack · wiki templates `Template:Data_Graves/New_Destiny`, `Template:Data_Kled/Skaarl_the_Cowardly_Lizard`, `Template:Data_Jinx/Switcheroo!` · https://wiki.leagueoflegends.com/en-us/Kalista/LoL

**Confidence: high.**

## 12. 2025–2026 system changes a simulator must reflect

**2025**
- **25.S1.1:** Feats of Strength and tier-3 boots added. Spellslinger's was 19 + 10%, hotfixed to 18 + 8%. Triumphant Sorcerer's gave +2.
- **25.S1.3:** **AS cap 2.5 → 3.0** (engine value 3.003).
- **25.04 / 25.07:** Yasuo and Yone's old −10% crit penalty removed.
- **25.09:** Spellslinger's 8% → 7%.
- **25.10:** Cryptbloom 75 AP.
- **25.11:** Yasuo's R bonus armor pen made additive.
- **25.22:** shards changed: MS 2% → 2.5%, tenacity/slow resist 10% → 15%.

**2026**
- **26.01 (season start):**
  - **Base crit 175% → 200%.**
  - **IE crit damage 40% → 30%**, AD 65 → 75.
  - Champion crit ratios rewritten as a percentage of bonus crit damage.
  - Yasuo, Yone and Senna get −10% total crit; Jhin −25%; Graves' pellet crit ratio set (50% after the Jan 9 hotfix).
  - LDR 40% → 35% armor pen plus *Giant Slayer*; Mortal Reminder 35% → 30%.
  - New items, including Bastionbreaker (22 lethality).
  - Feats of Strength removed.
  - **Role Quests:**
    - Top: level cap 20, +11% XP (set in V26.09).
    - Mid: free tier-3 boots, plus % bonus AD/AP from V26.09.
    - Bot: boots move to a 7th slot, plus gold.
  - **Omnivamp rework:** full value, but 33% against minions and monsters for area, damage-over-time and pet damage.
  - XP changes; turret plates on every non-Nexus turret.
- **26.04:** omnivamp no longer heals from Smite or Ignite.
- **26.09:**
  - **Damage-dealt amplifiers stack additively** (not in patch notes).
  - Arcane Comet reworked: no cooldown refund, up to +100% damage by distance.
  - Hail of Blades AS reduced. New keystones Deathfire Touch and Stormraider's Surge.
  - Mid quest gives 6% bonus AD/AP.
- **26.11:** Mid quest 6% → **8% bonus AD / 8% AP**. Whether this is a percentage boost to existing AD/AP is my reading; please check it in-game.
- **26.13 / 26.14:** Senna crit modifier 0.90 → 0.85 → **0.80**.
- **26.16:** Spellslinger's flat pen 18 → **20**.
- **26.17:** Yasuo and Yone crit modifier 0.90 → **0.95**.
- **26.20:** Smolder crit-scaling buffs. No system changes.

**Not changed in 2025–2026** (as far as I found):
- Lethality 1:1 (since V14.1).
- Armor/MR formulas and the order of penetration.
- Haste formula.
- Adaptive force 0.6 / 1.
- Grievous Wounds at 40% from every source (since V13.3).
- How tenacity stacks: modifiers within the same group multiply, the groups add.

Sources: https://wiki.leagueoflegends.com/en-us/V26.01 … https://wiki.leagueoflegends.com/en-us/V26.20 (each V26.xx page) · https://www.leagueoflegends.com/en-us/news/game-updates/patch-26-1-notes/ · https://www.leagueoflegends.com/en-us/news/game-updates/league-of-legends-patch-26-9-notes/ · https://wiki.leagueoflegends.com/en-us/Grievous_Wounds · https://wiki.leagueoflegends.com/en-us/Tenacity

**Confidence: high** for the patch-noted items; **medium** for the undocumented V26.09 damage-modifier change.
