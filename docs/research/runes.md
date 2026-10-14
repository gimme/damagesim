# Rune mechanics reference: League of Legends 16.20 (wiki V26.20)

Researched 2026-10-14 for a damage simulator.

- **Numbers** come from `dumps/perks.txt` (game files), which is authoritative.
- **Behaviour** comes from the official wiki (wiki.leagueoflegends.com/en-us). For every current rune I read the raw wikitext of the rune page and of `Template:Rune data <Name>`, which holds the exact per-level formula.
- I also read the raw pages for Rune, Damage, Damage modifier, Adaptive force, Combat status and Experience (champion), plus every 2026 patch page (V26.01 to V26.20).
- Client patch 16.20 is the wiki's V26.20. No rune changes appear in V26.17 to V26.20, so the wiki rune pages are current for 16.20. The only exceptions are champion-specific bug fixes, which are not relevant here.

**Confidence levels**

| Level | Meaning |
|---|---|
| **H** | perks.txt and the wiki formula agree, and the behaviour is explicitly documented. |
| **M** | Documented, but with gaps or partly inferred (from wording, the formula template, or old patch notes). |
| **L** | Not documented on the wiki. It is my inference or "wiki silent", so verify it in-game. |

**Notation**

- `L` is champion level.
- `bAD` is bonus AD, `AP` is ability power, `maxHP` is maximum health and `bonusHP` is bonus health.
- `bAS` is bonus attack speed as a fraction (0.80 means 80%).
- `lerp(a,b)` means `a + (b-a)*(L-1)/17`. See G1.
- `sgrow(a,b)` means `a + (b-a)*(L-1)*(0.7025+0.0175*(L-1))/17`, the champion stat-growth curve. See G1.

---

## 1. Global rules (read these first; they apply to every rune below)

### G1. Level interpolation (H)

- `ByCharLevelInterpolationCalculationPart` (start→end) is **linear on (L-1)/17**. Every wiki data template writes the formula this way, for example Electrocute `60 + 10*x`, PtA `40 + (160-40)/17*(x-1)`, and Cheap Shot `10 + (45-10)/17*(x-1)`.
- **It is not clamped at level 18.** The wiki evaluates these formulas for levels 1 to 20 and shows the extrapolated level-20 values: Electrocute 70–**260**, PtA 40–174.12, Cheap Shot 10–49.12, HoB 2–22.12, and Comet cooldown 20 → **6.59** at level 20.
  - The exception is a part flagged `mScalePastDefaultMaxLevel: false`. In perks.txt only **First Strike's cooldown** carries this flag, so it clamps at level 18.
  - Arcane Comet's cooldown uses `ClampSubParts` with floor 0.3 and ceiling 20, so it still extrapolates to 6.59.
- **Why it matters:** the default level cap on SR is 18, but completing the **Top-lane Role Quest raises the cap to 20** (wiki "Experience (champion)", level-cap section). So a top laner at level 19 or 20 gets extrapolated rune values.
- One exception on the wiki side: the Aftershock page still shows 25–120 and 80–150, not extended to level 20. Treat Aftershock above level 18 as **M** (probably extrapolates like everything else).
- `mScaleByStatProgressionMultiplier: true` (only Fleet Footwork's heal) uses the champion stat-growth curve `sgrow`. At L=18 the factor `(L-1)*(0.7025+0.0175*(L-1))` equals exactly 17.
- `mRangedMultiplier` (the `{e9a3c91d}` calc type) multiplies the **whole** calculation for ranged champions, ratios included. The wiki confirms this: Fleet ranged ratios are 6%/3% = 0.6 × 10%/5%.

### G2. How damage types are resolved (H)

Three different rules exist. Do not merge them.

1. **"Adaptive damage"** is used by Dark Harvest, Press the Attack, Lethal Tempo, Summon Aery and Shield Bash.
   - Physical if `bAD > AP`; magic if `AP > bAD`. This is a raw comparison with no 0.6 weighting.
   - On a tie (including 0 = 0), the **champion's adaptive type** decides. That is a per-champion attribute you need in your champion data.
2. **"Variable damage"** is used by Electrocute and Arcane Comet. It compares the ratio contributions (for both, `0.10*bAD` against `0.05*AP`).
   - The larger contribution wins.
   - **On a tie or 0 = 0 it defaults to magic**, not to the adaptive type.
   - The wiki states explicitly that these two do **not** use the adaptive formula.
3. **Fixed type.**
   - True: Cheap Shot, Sudden Impact, Hail of Blades, First Strike.
   - Magic: Grasp, Aftershock, Scorch, Deathfire Touch (adaptive until V26.11).
   - Physical: Demolish.

### G3. Adaptive Force as a stat (H)

- 1 AF = **0.6 bonus AD or 1 AP**. It goes to AD if bonus AD is greater than AP, otherwise to AP. On a tie it follows the champion's adaptive type.
- **What counts for that comparison:** AD and AP from champion passives do **not** count. AD and AP from item passives mostly **do** count.
  - Counted: Dark Seal/Mejai's Glory, Sterak's, Rod of Ages, Dawncore, Rabadon's Opus, Overlord's Bloodmail.
  - Not counted: Staff of Flowing Water, Riftmaker, Archangel's/Seraph's, Manamune/Muramana.
- Rune sources of AF: the AF shards, Conqueror, Absolute Focus, Waterwalking, Gathering Storm, Jack of All Trades, and Triple Tonic's Elixir of Force.
- The AD values in rune tooltips are always 0.6 × the AP value.

### G4. Damage amplification stacking (M, important)

- Since **V26.09**, **outgoing "damage dealt" modifiers stack ADDITIVELY**. Before that they stacked multiplicatively.
  - **Incoming** "damage received" modifiers (Exhaust, Plated Steelcaps, Death's Dance, Abyssal Mask and so on) and resist mitigation still stack **multiplicatively**.
  - Source: the V26.09 patch page, entry marked *Undocumented*, and the Damage modifier page. That page is tagged "Outdated" and has a "pending for test: any exceptions after V26.09?" note, hence M.
- Also since V26.09, the **amplifier portion is dealt as a separate damage instance**. The wiki's examples: it no longer feeds "pre-modifier" effects such as Illaoi E and Zed R.
- Runes that are damage-dealt modifiers: **Press the Attack, Coup de Grace, Cut Down, Last Stand, Axiom Arcanist.**
  - Item modifiers on the same additive pool include Shojin, Riftmaker, Horizon Focus, LDR, Liandry's, Haunting Guise, Actualizer, Hexoptics, Immortal Path, the jungle pets and the Chemtech soul.
- Model for one hit:

  ```
  amp       = Σ(all active dealt-modifiers that apply to this hit)      # e.g. 0.08 PtA + 0.08 CutDown + 0.12 Axiom = 0.28
  base_inst = raw * mitigation(type) * Π(1 - received_reductions)
  amp_inst  = raw * amp * mitigation(type) * Π(1 - received_reductions)   # separate instance, same damage type
  ```

  - The total equals `raw*(1+amp)*...`.
  - The split only matters for per-instance effects: flat damage reduction (Bone Plating, Fizz passive, Amumu, Leona E, Guardian's Horn, Warden's Mail), shields consumed in order, and "pre-modifier" copies.
- **Ignite and Smite are not affected by damage modifiers.** PtA, Coup de Grace, Cut Down and Last Stand **do amplify true damage** (since V25.S1.3), Smite excepted.
- **First Strike is not a modifier.** It is extra true damage equal to 7% of post-mitigation damage (see its section), so it effectively applies on top of the amplified total.

### G5. Damage tags and what triggers what (H unless marked)

The wiki's damage tags are: BasicAttack ("basic damage"), ActiveSpell ("spell damage"), AOE ("area"), Periodic ("persistent"), Proc, Indirect, Pet, Item, OnHit.

- **Proc damage does not trigger spell effects.** It does not stack Electrocute unless it is also Pet damage or applies a debuff such as Black Cleaver. It does not trigger Dark Harvest (except Teemo E) and does not trigger Cheap Shot.
- Almost every rune's own damage is Proc. **The exception is Aftershock** (Proc + ActiveSpell + AOE), which **does apply spell effects**.
- Omnivamp still heals from proc damage. Omnivamp is 33% effective against minions and monsters for area, pet and persistent damage.
- Several rune procs are explicitly **not affected by "on-hit"/"on-attack" damage modifiers** (attack-modifier penalties such as Akshan's Heroic Swing, Urgot's Purge and Azir's soldiers): PtA, Grasp, Cheap Shot, Sudden Impact and HoB (fixed V26.09 to V26.14).
- Trigger matrix. "Y" = triggers or counts; "N" = does not; "?" = wiki silent.

| Rune | Basic attack | Ability (spell) | Ability AoE | DoT ticks | Pet dmg | Item active/effect | Summoner spell | Rune/other Proc | 0-dmg instance | Champion only |
|---|---|---|---|---|---|---|---|---|---|---|
| Electrocute (stack) | Y on-hit | Y | Y (1/cast) | application only | Y | Y | Y | N (unless pet/debuff) | ? (CC/DoT application counts) | Y |
| Dark Harvest | Y | Y | Y | Y if non-proc | Y | Y (non-proc) | ? | N (Teemo E exception) | N (needs ≥2 dmg) | Y |
| Hail of Blades | Y (attack windup) | N (Yasuo/Yone Q special) | N | N | N | N | N | N | – | trigger: champion |
| Press the Attack | Y on-hit, single-target | N | N (AoE on-hit excluded, Azir W exception) | N | ? | N | N | N | – | Y |
| Lethal Tempo | Y on-attack | N | N | N | N | N | N | N | – | stacks: Y |
| Conqueror | Y on-hit (2 melee / 1 ranged) | Y (2, ≤1 per 4s per cast instance) | Y | Y (≤1 per 4s per cast) | Y non-basic pet; N pet basic attacks (bug) | Y | ? | N | Y (default dmg) | Y |
| Summon Aery | Y | Y | Y | Y unless proc-persistent | ? | Y | Ignite 1st tick only | N for persistent proc | ? | Y |
| Arcane Comet | N | Y | Y | Y (ability dmg) | Y | N | N | N | N | Y |
| Deathfire Touch | N | Y (4s burn) | Y (2s) | Y (1s) | Y (1s) | N | N | N | ? | Y |
| Scorch | N | Y | Y (first champion) | ? | ? | N | N | N | ? | Y |
| Grasp | Y on-hit | N | N | N | N | N | N | N | – | Y |
| Shield Bash | Y on-hit | N | N | N | N | N | N | N | – | Y |
| Cheap Shot | Y | Y | Y | Y (ticks after CC applied) | ? | Y | ? | N | ? | Y |
| Sudden Impact | Y | Y | Y | Y | ? | Y | ? | ? | **Y** | Y |
| First Strike (start) | Y | Y | Y | Y | ? | Y | ? | ? | **Y** | Y |
| Stormraider's Surge | Y | Y | Y | Y | ? | Y | ? | ? | – | Y |
| Taste of Blood | Y | Y | Y | Y | ? | Y | ? | ? | ? | Y |

### G6. Combat status (H)

- **What puts a unit in combat:** dealing or receiving damage, or applying or receiving CC, to or from an enemy champion, minion, monster or turret (wards do not count).
- **0-damage instances count.** Damage blocked by a spell shield does **not** count.
- Most "out of combat" effects need **5 s** without combat. Pets put their owner in combat; clones enter combat independently.
- Runes split between two meanings of combat:
  - Combat with *any* unit: Grasp.
  - Champion-only combat: PtA's amp, First Strike, Relentless Hunter.

### G7. Melee vs ranged (M)

- There is no single rule. Each rune applies its ranged multiplier according to the champion's **current** form.
- The wiki gives one example: Jayce switching forms changes Lethal Tempo values immediately, including for stacks already held. The same can be expected for Elise, Gnar, Kayle, Nidalee and the like, but only the Lethal Tempo case is documented (M).

### G8. Rune cooldowns (M)

- Rune cooldowns are fixed seconds and are **not reduced by ability, item or summoner haste** unless stated. The wiki never states that haste applies to any keystone cooldown.
- Special cases are listed per rune: Dark Harvest's takedown reset and Hail of Blades' cooldown starting after the effect ends.

### G9. perks.txt reading notes

- **Stat codes** in `StatByNamedDataValueCalculationPart`, each cross-checked against the wiki:
  - no `mStat` = AP
  - `mStat 2, mStatFormula 2` = **bonus AD**
  - `mStat 12` = max HP
  - `mStat 12, mStatFormula 2` = **bonus HP**
  - `mStat 1` / `6` = total armor / MR; with `mStatFormula 2` = bonus armor / MR
  - `mStat 4, mStatFormula 2` = bonus attack speed
  - `mStat 34` = heal and shield power
- **Fields prefixed `TT…`/`TOOLTIP…` are tooltip-only and can be wrong.** The computational values are in `CALCS`. The known case is Lethal Tempo ranged (see its section).
- Some fields are **vestigial** (no longer used by the live effect): Arcane Comet's refund fields, PtA's `AmpPotency…Others`, Cut Down's Min/Max/HealthDifference fields, Predator's `ChannelDuration`, and possibly Gathering Storm's `AdaptiveAD 6`. Each is flagged where it appears.

---

## 2. Current Summoner's Rift rune tree (16.20), from the wiki's `Rune path infobox` templates

| Path | Keystones | Row 1 | Row 2 | Row 3 |
|---|---|---|---|---|
| Precision | Press the Attack, Lethal Tempo, Fleet Footwork, Conqueror | Absorb Life, Triumph, Presence of Mind | Legend: Alacrity, Legend: Haste, Legend: Bloodline | Coup de Grace, Cut Down, Last Stand |
| Domination | Electrocute, Dark Harvest, Hail of Blades | Cheap Shot, Taste of Blood, Sudden Impact | Sixth Sense, Grisly Mementos, Deep Ward | Treasure Hunter, Relentless Hunter, Ultimate Hunter |
| Sorcery | Summon Aery, Arcane Comet, **Stormraider's Surge**, **Deathfire Touch** | Axiom Arcanist, Manaflow Band, Nimbus Cloak | Transcendence, Celerity, Absolute Focus | Scorch, Waterwalking, Gathering Storm |
| Resolve | Grasp of the Undying, Aftershock, Guardian | Demolish, Font of Life, Shield Bash | Conditioning, Second Wind, Bone Plating | Overgrowth, Revitalize, Unflinching |
| Inspiration | Glacial Augment, Unsealed Spellbook, First Strike | Hextech Flashtraption, Magical Footwear, Cash Back | Triple Tonic, Time Warp Tonic, Biscuit Delivery | Cosmic Insight, Approach Velocity, Jack of All Trades |

**Changes from your list:**

- **Phase Rush no longer exists.** It was replaced in V26.09 by **Stormraider's Surge**, which reuses perk id 8230 (internal path `PhaseRush`).
- **Deathfire Touch (8992)** is a new Sorcery keystone (V26.09). It is damage-relevant, so I added it.
- **Axiom Arcanist (8224)** exists. It replaced Nullifying Orb in V25.S1.1 and reuses that id.
- **Last Stand (8299)** exists.
- **Font of Life** and **Unflinching** are live (non-damage).
- **Predator, Zombie Ward, Ghost Poro, Eyeball Collection, Ingenious Hunter, Kleptomancy, Celestial Body, Chrysalis, Iron Skin and Mirror Shell are present in perks.txt but are not live.** See §6.

**Game substitutions to replicate** (wiki "Rune" page):

- Aftershock becomes Grasp, and Glacial Augment becomes First Strike, for champions without an immobilize (including Yorick).
- Manaflow Band becomes Axiom Arcanist for manaless champions.
- Presence of Mind becomes Triumph for champions with neither mana nor energy.
- Axiom Arcanist becomes Nimbus Cloak for Elise, Jayce, Nidalee and Zoe.
- Ultimate Hunter becomes Relentless Hunter for Bel'Veth, and Treasure Hunter for Samira.
- Waterwalking becomes Scorch in modes without a river.

---

## 3. Keystones

### 3.1 Press the Attack (8005): Precision. Confidence H (stacking M)

- **Proc damage:** `Dmg = lerp(MinDamage=40, MaxDamage=160) + BonusADRatio(0)*bAD + APRatio(0)*AP + LethalityRatio(0)*lethality`. In practice this is `lerp(40,160)`, adaptive (G2.1).
- **Amp:** `+BonusPercentDamage (0.08)` damage dealt **to champions**. It is an additive dealt-modifier (G4) and **includes true damage** except Smite (since V25.S1.3).
- **Trigger:**
  - Basic attacks **on-hit** against an enemy champion apply a stack. Each stack lasts `TimeBetweenHits = 4 s` and the timer refreshes on each new stack.
  - The 3rd stack (`HitsRequired = 3`) consumes them all and deals the proc.
  - Stacks are **lost when you attack a different champion**. They are tracked per user.
- **What counts as a hit:**
  - Multi-on-hit attacks add extra stacks per attack: Lucian passive, Renekton W, **Guinsoo's Phantom Hit**.
  - **AoE-tagged on-hit attacks do not apply stacks.** Examples: Runaan's bolts, Statikk, Kayle E secondary, Yi Q, Senna Q secondary, Smolder Q secondary. Azir W is the exception.
  - Multi-target attacks not tagged AoE (Bel'Veth E, Graves passive, MF Q, Nocturne passive, Yunara Q) try to stack every target, so the stacks reset on each.
  - Misses and dodges don't apply stacks, because the attack must land on-hit (M).
- **Amp timing:**
  - The amp is a self-buff: "8% increased damage against champions until 5 s after exiting combat with them" (`AmpDuration = OutOfCombatTimer = 5`). Before V14.10 it was an "Exposed" debuff on the target.
  - **The triggering 3rd attack is not amplified, and neither is the triggering PtA proc or anything dealt on the same frame the buff is gained.**
  - Later PtA procs, DoTs and follow-ups from attacks (Darius bleed, Teemo E, Illaoi tentacles) are amplified.
- **Cooldown:** `Cooldown = 6 s`, starting after a target's stacks are consumed. The wiki doesn't say whether stacks can build during those 6 s; assume they can't (L).
- **Melee/ranged:** no difference.
- **Other interactions:**
  - The proc is **not affected by on-hit damage modifiers** (undocumented, V26.09 to V26.14).
  - It doesn't trigger spell effects.
  - Crit, lifesteal and omnivamp are wiki silent. Omnivamp should apply per G5 (M).
- **Caps:** 3 stacks. Only one amp buff; it refreshes, it doesn't stack.
- **perks.txt notes:** `AmpPotencyStartSelf/MaxSelf = 0.08` is the live 8%. `AmpPotency…Others` looks like a leftover of the old Exposed debuff (L).

### 3.2 Lethal Tempo (8008): Precision. Confidence H

- **Attack speed:** `ASPerStack = 0.06 × (ranged ? 0.8 : 1)`, from the CALC. That is 6% melee and **4.8% ranged**. Max `MaxStacks = 6`, giving 36% / 28.8%.
- **Bolt at max stacks:** `NoteDamage = lerp(9, 30) × (ranged ? 0.667 : 1) × (1 + bAS)`, adaptive (G2.1).
  - `bAS` **includes LT's own 36% / 28.8%**.
  - It scales with the bonus AS **stat**, so AS above the 2.5/3.0 cap still increases damage.
  - The "+1% per 1% bonus AS" scaling itself is not reduced for ranged.
- **Trigger:**
  - Basic attacks **on-attack** (windup completes; landing is not required) against enemy champions grant a stack lasting `Duration = 6 s`, refreshing on each attack.
  - At 6 stacks, every basic attack also fires a bolt on-attack, which deals its damage **on arrival**.
  - Clone attacks grant stacks; attacks into shields grant stacks.
  - Whether the bolt fires when attacking non-champions at max stacks: wiki silent (L).
- **Decay:** when the 6 s expire, 1 stack drops immediately and the rest drop one every **0.3 s**.
- **Cooldown:** none.
- **Melee/ranged:** as above. It follows current form (Jayce changes apply instantly, including to held stacks).
- **Interactions:** proc damage, no spell effects. `PerfectlyTimedForgivance 0.25` is the HUD-tracker grace window and has no combat effect.
- **FLAG (perks.txt internal):**
  - `TTASPerStackRanged = 0.04` and `TTMinNoteDamageRanged/Max = 6/24` are **tooltip-only and wrong**.
  - The game CALCs give 4.8% AS per stack and bolt 6.0–20.0 (at L18).
  - The wiki confirms the tooltip applies 0.8 instead of 0.667. **Use the CALC values.**

### 3.3 Fleet Footwork (8021): Precision. Confidence H. No damage

- **Heal:** `Heal = (sgrow(HealBase=15, HealMax=160) + HealBonusADRatio(0.10)*bAD + HealAPRatio(0.05)*AP) × (ranged ? RangedHealMod 0.6 : 1)`. It is ×`MinionHealMod 0.15` when the Energized attack hits a minion.
- **Movement speed:** `MSBuff 0.20 × (ranged ? 0.75 : 1)` for `MSDuration = 1 s`.
- **Energize:** 6 charges per basic attack on-attack, 6 per ability hit that applies on-hit, and 1 per 24 units moved (dashes and displacements included). At 100 charges the next basic attack is Energized and consumes them on-hit. It is not consumed on wards or plants and works on structures.
- **Fleet deals no damage in 16.20.** Last changed in V26.16 (heal 10–130 → 15–160).

### 3.4 Conqueror (8010): Precision. Confidence H (decay M)

- **Per stack:** `AF = lerp(MinAdaptivePerStack=1.8, MaxAdaptivePerStack=4.0)`.
- **Total:** `AF_total = stacks × AF`, up to `MaxStacks = 12` (21.6–48 AF, which is 12.96–28.8 AD or 21.6–48 AP). It resolves as adaptive force (G3).
- **Bug (wiki, "unexpected"):** the per-stack value **locks to your level when the first stack is generated** and does not update while you keep stacks. A strict simulator should snapshot `L` at stack 0 → 1.
- **Healing at 12 stacks:** heal `HealingPercent 0.08` (ranged `0.05`) of **post-mitigation** damage dealt to enemy champions.
- **Stack gain:**
  - Basic damage on-hit against a champion: **2 stacks melee, 1 ranged.** Every on-hit instance counts, so multi-hit attacks stack multiple times; Yi Q is the exception.
  - Any other damage that is **neither basic damage nor non-pet proc damage**: 2 stacks, limited to **once per 4 s per cast instance** (`TimeUntilNextStackFromSameSpell = 4`).
    - So abilities, DoTs (once per 4 s), item actives and non-basic pet damage count.
    - Garen E and Wukong E are special-cased to stack every tick.
  - Ranged quirks: Azir W, Ezreal Q and MF Q give 2 stacks; Smolder Q, Vayne Q and Viktor Q give 1.
  - **Does not stack from:**
    - pet basic attacks (Tibbers, Voidling, Maiden; bug); Daisy gives 1 via Ivern on-hit;
    - basic damage that doesn't apply on-hit;
    - clone attacks;
    - Runaan's bolts;
    - dodged attacks, or attacks missed while blinded;
    - attacks on invulnerable targets.
  - **Does stack from:** blocked attacks, Malphite W cone, and default/raw damage.
- **Duration:** `BuffDuration = 5 s`, refreshed by any further champion damage. Whether stacks drop all at once or one by one: wiki silent (M; assume all at once).
- **Cooldown:** none.
- **Melee/ranged:** stacks from attacks (2/1) and heal (8%/5%).
- **Caps:** 12 stacks.

### 3.5 Electrocute (8112): Domination. Confidence H

- **Damage:** `Dmg = lerp(DamageBase=70, DamageMax=240) + BonusADRatio(0.10)*bAD + APRatio(0.05)*AP`. That is `60 + 10*L` + ratios.
- **Type:** variable, G2.2 (compare `0.10*bAD` against `0.05*AP`; ties go to magic).
- **Stacks:** basic attacks, abilities, item effects, summoner spells, **CC application** and **DoT application** against an enemy champion each apply a stack. The limit is **one stack per cast instance per champion**.
  - Proc damage does not stack it, unless it is pet damage or applies a debuff (Black Cleaver's Carve does).
  - Blind, Cripple, Drowsy, Kinematics, Nearsight and Stasis don't count as CC for stacks.
  - Special cases: Ambessa R gives 2 stacks (suppression plus damage). Zed Q and E with shadows stack per tick. Nami E stacks only on its first instance.
- **Window:** **3 stacks within `WindowDuration = 3 s` of the FIRST stack.** The window does not refresh.
- **Strike:** fires after a **0.25 s** delay. Untargetability during the delay doesn't stop it, and it can trigger while you are dead.
- **Cooldown:** `Cooldown = CooldownMin = 20 s`, flat.
- **Melee/ranged:** no difference.
- **Interactions:** proc damage, no spell effects. Damage modifiers (PtA, Coup, Cut Down, Last Stand) should amplify it (G4; M).
- **Caps:** none.

### 3.6 Dark Harvest (8128): Domination. Confidence H (threshold timing L)

- **Damage:** `Dmg = BaseDamage(30) + DamagePerSoulEssence(11)*souls + ADRatio(0.10)*bAD + APRatio(0.05)*AP`, adaptive (G2.1). There is no level scaling (flat 30 since V14.13 / V25.S1.3).
- **Trigger:** dealing **pet damage or non-proc damage** to an enemy champion **below `HarvestThreshold` = 50% of max HP**.
  - Damage under 2 does not trigger it (Brand passive excepted). Proc damage doesn't trigger it (Teemo E excepted). Clones can trigger it; zombies can't.
  - **Whether the 50% check uses health before or after the triggering hit:** wiki silent (L). The parallel documented rule for Coup de Grace is "before the hit"; assume the same.
- **Souls:**
  - Each proc reaps 1 soul **1.75 s later**. No further souls are reaped during that delay, and the new soul doesn't affect the current proc.
  - While Dark Harvest is off cooldown, you also reap 1 soul when you get kill credit for a champion killed by a minion, monster or turret.
  - There are no minion or monster souls.
  - No cap on souls.
- **Cooldown:** `Cooldown = 35 s`, **reset to `CooldownResetValue` = 1 s on a champion takedown.**
- **Melee/ranged:** no difference.
- **Interactions:** proc damage, no spell effects; doesn't stack Electrocute.

### 3.7 Hail of Blades (9923): Domination. Confidence H (non-champion attacks M)

- **Attack speed:** `+ASBoost 0.90` melee / `ASBoostRanged 0.60` ranged while active. It also **lifts the AS cap** (internal cap 90). It can't lift Jhin, Graves or Zeri caps; it can lift Sion R's cap.
- **Bonus true damage per empowered attack:** `True = lerp(BonusDamageMin=2, BonusDamageMax=20) + BonusADRatio(0.12)*bAD + APRatio(0.10)*AP`. The wiki template is linear (2 + 18/17·(L-1)).
- **Trigger and stacks:**
  - Starting an **attack windup against an enemy champion** triggers it. If the windup completes, you gain **2 stacks** for `Duration = 3 s`.
  - **The triggering attack itself is empowered** with the true damage. It doesn't benefit from the AS, which applies from the next windup (M).
  - Each later basic attack on-attack consumes a stack. **So by default 3 empowered attacks** (`NumHits = 3`): the trigger plus 2 stacks.
  - The 3 s timer refreshes on each on-attack against an enemy champion. If more than 3 s pass between attacks, the effect ends.
- **Attack resets:**
  - Each reset adds **1 stack, up to `MaxBonusHits = 2` times**, for at most 5 empowered attacks.
  - Only effects with the `Trait_AttackReset` tag count. Exceptions: TF W, Warwick W recast and Rocketbelt don't count; Sett E and Sylas W do (bug); K'Sante Q and Rell W don't (bug).
  - A reset stack doesn't refresh the duration. It counts even if your attack wasn't on cooldown.
  - Yasuo Q and Yone Q are special-cased: they can trigger it and consume a stack once per cast.
- **Cancel rules:**
  - If the triggering windup is cancelled, no stacks are granted. It goes briefly on cooldown, then resets.
  - A champion-targeted windup cancelled while active refreshes the duration immediately, but the next attack won't refresh it. This can happen once per stack.
- **Cooldown:** `Cooldown = 10 s`, starting **after the effect ends**.
- **Melee/ranged:** AS 90% vs 60%. True damage is the same.
- **Interactions:**
  - Proc damage, no spell effects.
  - Not affected by on-attack damage penalties (Azir fix V26.14).
  - True damage is amplified by PtA, Coup and Cut Down (G4).
- **Stacks against non-champions:** "stacks are consumed per basic attack on-attack", with no champion restriction stated. Attacking a minion while active likely wastes a stack (M).

### 3.8 Summon Aery (8214): Sorcery. Confidence H (timing M)

- **Damage:** `Dmg = lerp(DamageBase=10, DamageMax=50) + DamageADRatio(0.10)*bAD + DamageAPRatio(0.05)*AP`, adaptive (G2.1).
- **Shield (ally trigger):** `lerp(ShieldBase=20, ShieldMax=100) + ShieldRatioAD(0.10)*bAD + ShieldRatio(0.05)*AP` for `ShieldDuration = 2.5 s`. A self-applied shield is not a trigger; Aery shields allies, not you.
- **Trigger:** **damaging** basic attacks, abilities and item effects against an enemy champion.
  - Not persistent proc damage.
  - Ignite is special-cased to trigger on its first tick.
- **Travel and availability (this is her effective cooldown):**
  1. She pounces to the target in a **fixed 0.45 s**, and damage applies on arrival.
  2. She lingers about 2 s ("slightly less").
  3. She flies back. Return speed starts at 200 (L1–5), 300 (L6–10) or 600 (L11+) and accelerates by +10 per 51 units travelled. Inside 200 units of you she gets +2000 per 51 units, so moving toward her picks her up.
  4. She cannot be sent again until she returns.

  To model her, use cycle time ≈ 0.45 + ~2.0 + return_time(distance). For a melee or short-range trade, ~2.5–3 s per proc is a reasonable approximation (M).
- **Interactions:** proc damage. She is not blocked by projectile blocks or windwalls. Her shield triggers Ardent Censer and Staff of Flowing Water.
- **Cooldown:** none beyond the return.
- **Melee/ranged:** no difference.

### 3.9 Arcane Comet (8229): Sorcery. Confidence H (distance details M)

- **Damage:** `Dmg = (lerp(DamageBase=15, DamageMax=100) + ADRatio(0.10)*bAD + APRatio(0.05)*AP) × (1 + MaxDamageAmp(1.0) × min(dist / MaxRange(750), 1))`.
  - At maximum range this is ×2, which the wiki writes as `30–200 (+20% bAD) (+10% AP)`.
  - `dist` is "the distance the comet travelled". The comet flies from the caster to the target's location at trigger time, so use caster–target distance at trigger.
  - The amp is linear from 0 at 0 units to 100% at 750 units. The wiki formula is `0 to 100 | 0 to 750 units`, linear (M).
  - New in V26.09, together with base damage 30–130 → 15–100.
- **Type:** variable, G2.2 (ties go to magic).
- **Trigger:** **ability damage or pet damage** to an enemy champion. Basic attacks, items and summoner spells don't trigger it; 0-damage instances don't either.
- **Flight and impact:**
  - It lands **0.8 s** after trigger (the wiki shows this as 0.825 s, rounded up to the next game tick).
  - It hits enemies in a **140 radius** (the indicator is 175). It is **dodgeable**.
  - It is a projectile: blocked by spell shields and intercepted by Braum E, Samira W and Yasuo W.
  - It is proc damage tagged **AoE**, with no spell effects.
- **Cooldown:** `CooldownCalc = clamp(lerp(RechargeTime=20, RechargeTimeMin=8), 0.3, 20)`, which is 6.59 s at L20.
  - **Since V26.09 nothing reduces the remaining cooldown.**
  - **FLAG:** `PercentRefund 0.20 / AoEPercentRefund 0.10 / DotPercentRefund 0.05` in perks.txt are **leftovers**. The refunds were removed in V26.09; do not simulate them.
- **Melee/ranged:** no difference.

### 3.10 Stormraider's Surge (8230, replaces Phase Rush): Sorcery. Confidence H numbers / M trigger. Utility, no damage

- **Trigger:** your **post-mitigation** damage to one enemy champion totals at least `DamageThreshold 0.25 × target maxHP` within `Window = 3 s`. The tooltip hover on the wiki says "post-mitigation damage".
  - Any damage source counts; no tag restriction is stated.
  - Whether the window is rolling: wiki silent (L; assume a rolling 3 s sum per target).
- **Effect:** `MoveSpeedCalc = HasteMax 0.48 × (ranged ? RangedEffectiveness 0.75 : 1)` (48% / 36%) bonus MS, plus `SlowResist 0.5`, for `Duration = 4 s`. The wiki shows no decay (M).
- **Cooldown:** `lerp(MaxCooldown=20, MinCooldown=10)` (8.82 at L20).
- History: V26.09 added it (40/30%, 3 s); V26.10 changed it to 48/36% and 4 s.

### 3.11 Deathfire Touch (8992, new): Sorcery. Confidence H (linger-timer refresh M)

- **Burn:** `DPS = lerp(Level1DamageTOOLTIP=3, {2156e250}=12) + ADRatio(0.07)*bAD + APRatio(0.025)*AP`. It is **magic damage** (adaptive until V26.11). It ticks every `1/TicksPerSecond = 0.5 s` for `DPS/2` per tick.
- **Linger amp:** after the burn has lasted `TimeToAmp = 3 s` on the target, each tick does `×(1 + DamageMultiplier 0.75)` while it lasts.
- **Trigger:** **ability damage or pet damage** to an enemy champion.
- **Duration depends on the triggering damage tag:**

| Damage tag | Burn duration |
|---|---|
| Spell damage | **4 s** |
| Area damage | **2 s** |
| Persistent (DoT) damage | **1 s** |
| Persistent area damage | **1 s** |
| Pet damage | **1 s** (2 s if the pet damage is also area-tagged; bug) |

- **Refresh rules:**
  - A new application overwrites or refreshes only if the current total duration is ≤ the new source's duration.
  - Spell overrides everything. Area overrides everything except spell. Persistent and pet refresh each other.
  - If the current total is longer but the remaining time is shorter than the new source's duration, it is set to the new duration.
  - Whether a refresh resets the 3 s linger timer is not stated. "Lingered for 3 seconds" suggests continuous burn time (M).
- **Single-application totals at L18:** spell 57 (= 6 normal + 2 amped ticks); area 24; persistent/pet 12. Ratios scale the same way.
- **Snapshot:** stats are captured at application and stay fixed until the debuff expires and is reapplied.
- **Multiple users:** burns from different users stack.
- **Interactions:** proc and periodic damage, no spell effects.
- **Cooldown:** none.
- **Melee/ranged:** no difference.

### 3.12 Grasp of the Undying (8437): Resolve. Confidence H (timing M)

- **Damage:** `Dmg = PercentHealthDamage(0.035) × maxHP × (ranged ? RangedPenaltyMod 0.4 : 1)`, bonus **magic**. Total max HP. No level scaling.
- **Heal:** `PercentHealthHeal(0.013) × maxHP × (ranged ? 0.4 : 1)`.
- **Permanent HP:** `+MaxHealthPerProc 5` (ranged `RangedHealthPerProc 2`), which raises maxHP for later procs.
- **Charging:**
  - Being in combat with any enemy unit (champions, minions, monsters, turrets) generates **1 stack per second**. Generation continues for 3 s after the last combat instance and refreshes with each new one.
  - At **4 stacks** (`TriggerTime = 4 s` of sustained combat) the next basic attack **on-hit against an enemy champion** within **`Window = 5 s`** consumes the stacks.
  - Attacks on minions don't consume it. Blocked attacks don't apply it.
- **Interactions:**
  - Proc damage, no spell effects.
  - **Not affected by on-hit damage modifiers** (V26.09 or V26.10).
  - It is amplified by dealt-modifiers (G4).
- **Cooldown:** none beyond recharging.
- **Melee/ranged:** ranged gets 40% damage and heal, and +2 HP per proc. Last changed V25.12.

### 3.13 Aftershock (8439): Resolve. Confidence H (minions M)

- **Trigger:** **immobilizing** an enemy champion.
  - Counts: airborne (knock-up/back), stun (incl. suspension), root, suppression, charm, flee/fear, taunt, berserk, sleep, stasis.
  - Doesn't count: slows, grounding, drowsy, polymorph, silence, blind, disarm, nearsight.
  - It does not activate if the target is displacement-immune.
- **Defensive phase:** for `DelayBeforeBurst = 2.5 s`, gain `FlatResists 45 + PercentBonusResist 0.75 × bonusArmor` armor (likewise MR). Each is capped at `lerp(BonusResistMin=80, BonusResistMax=150)`.
  - The bonus-resist part is snapshotted at trigger.
  - The cap binds at bonus armor/MR ≈ (cap−45)/0.75, which is 46.7–140. The wiki note still uses the old 35/80% numbers.
- **Shockwave after 2.5 s:** `Dmg = lerp(StartingBaseDamage=25, MaxBaseDamage=120) + HealthRatio(0.08) × bonusHP` **magic**.
  - It hits enemy **champions and monsters** within `DamageRadius 350` of you. Minions are not listed (M).
  - It is AoE + Proc + ActiveSpell, so it **does apply spell effects**: Liandry's, Luden's, Rylai's and so on can trigger from it.
- **Cooldown:** `Cooldown = 20 s` from trigger.
- **Melee/ranged:** no difference.

### 3.14 Guardian (8465): Resolve. Confidence H. Defensive

- **Shield:** `lerp(ShieldBase=40, ShieldMax=150) + APRatio(0.20)*AP + HPRatio(0.06)*bonusHP`. It goes on you and the Guarded ally when either would take ≥ `lerp(ThresholdMin=50, ThresholdMax=165)` damage within 2.5 s, or lethal damage, from an enemy champion, monster or turret.
- **Guard:** range 350. Allies hit by your unit-targeted abilities are Guarded for 3 s at any distance.
- **Cooldown:** `lerp(Cooldown=75, CooldownMaxLevel=40)`, starting only when the shield triggers.
- **FLAGS:**
  - perks `ShieldDuration 1.5` vs wiki **2 s**.
  - perks `GuardDuration 2.5` is the 2.5 s damage-accumulation window per the wiki; the Guarded-ally duration is 3 s.
  - perks `ThresholdCalc` lerps 40→150, which duplicates the shield numbers. The value fields and the wiki say **50→165**; use 50→165 (M).
- **Damage relevance:** none, except that it creates a shield, which can arm Shield Bash.

### 3.15 Glacial Augment (8351): Inspiration. Confidence H. No damage dealt

- **Trigger:** immobilizing an enemy champion (not displacement-immune) fires 3 rays that create icy zones lasting `SlowZoneDuration 3 s + immobilize duration` (after tenacity).
- **Slow:** `SlowZoneSlowBase 20% + 7% per 100 bAD + 6% per 100 AP + 9% per 10% HSP`.
- **Damage relevance:** enemies in the zones deal **15% (`DmgReduction`) less damage to your allies, not to you**. This is a damage-received modifier on allies, so it is multiplicative (G4).
- **Cooldown:** 25 s.

### 3.16 Unsealed Spellbook (8360): Inspiration. Confidence H. Damage only via swapped spells

- **Swap rules:** swap one summoner spell while out of combat for 5 s.
  - The first swap is at 6:00 (`ShardFirstMinutes`).
  - Swap cooldown is 270 s (`ShardRechargeMinutes 4.5`), reduced by 25 s per unique spell, to a minimum of 120 s.
  - You must use 3 other spells before repeating one.
  - A selected spell starts with a 5 s cooldown; using it puts that slot on a 10 s cooldown.
- **Damage relevance:**
  - A swapped-in **Smite** deals **600 / 600 / 1000** by swap count (V26.01). Per the wiki, the tooltip's "after two swaps" behaves as "3rd+ swap" (bug).
  - A swapped **Ignite** is a normal Ignite, which is not amplified by damage modifiers (G4).
- **Wiki inconsistency:** the infobox says 245 s while the text says 270 s. perks.txt `ShardRechargeMinutes 4.5` = 270 s.

### 3.17 First Strike (8369): Inspiration. Confidence H numbers / M interactions / L entry timer

- **Effect:**
  - Your attack or ability against an enemy champion within `GraceWindow 0.25 s` of entering champion combat gives `GoldProcBonus 10` gold and the First Strike buff for `Duration 3 s`.
  - During the buff, **every instance of post-mitigation damage you deal to champions also deals `DamageAmp 0.07 ×` that amount as bonus TRUE damage**.
  - Afterwards you gain gold equal to `GoldPercentBonus 0.5` (ranged `0.35`) of the bonus damage dealt.
- **What the bonus is:**
  - A **separate proc and indirect true-damage instance**, not a damage modifier. It does not inherit the source's tags.
  - It triggers from all damage types, true damage included.
  - **The triggering hit also gets the bonus.**
  - It works against multiple champions.
  - It is delivered by a missile with a **fixed 0.4 s** travel time, so the bonus lands 0.4 s after each hit. The missile only carries the effect; it doesn't decide whether the bonus applies.
- **Failure:** if an enemy champion damages you before you damage them, First Strike goes on **full cooldown without activating**.
- **Cooldown:** `lerp(TooltipOnlyCooldownStartAmount=25, …EndAmount=15) × ModesCooldownReduction(1.0)`, **clamped at L18** (`mScalePastDefaultMaxLevel false`). It starts on activation.
- **Interaction with amps:** it is 7% of post-mitigation damage, so it multiplies on top of the already-amplified hit. Whether PtA, Coup or Cut Down then amplify First Strike's own true damage: wiki silent (L).
- **Melee/ranged:** only the gold conversion differs.
- **Unexplained field:** `OOCTimer 10`. Most likely you must be out of champion combat for 10 s before a re-entry counts as "entering champion combat" (L; not on the wiki).

---

## 4. Minor runes

### Precision

**Coup de Grace (8014): H**

- Effect: `+BonusPercentDamage 0.08` damage to champions with HP **below `EnemyHealthPercentageThreshold` = 40%** of max HP.
- The check uses **health before the hit**: "only triggers on damage dealt after the champion is brought below 40%". The hit that crosses 40% is not amplified.
- It is an additive dealt-modifier (G4) and amplifies true damage except Smite.
- No cooldown.

**Cut Down (8017): H (threshold timing M)**

- Effect: `+BonusPercentDamage 0.08` to champions **above 60%** (`EnemyHealthPercentageThreshold 0.6`) of max HP.
- Additive dealt-modifier; includes true damage except Smite.
- Pre-hit check, by analogy with Coup de Grace (M).
- A V26.09 hotfix fixed it applying twice.
- **FLAG:** `MinBonusDamagePercent 0.05 / MaxBonusDamagePercent 0.15 / Min/MaxHealthDifference` are leftovers of the pre-V14.10 max-HP-difference version. Ignore them.

**Last Stand (8299): H endpoints / M curve**

- Effect: `amp = 0` if your HP% ≥ 60%; otherwise `MinBonusDamagePercent 0.05 + (0.11−0.05) × clamp((0.6 − HP%)/(0.6 − 0.3), 0, 1)`.
- That is 5% just below 60% HP, rising linearly to `MaxBonusDamagePercent 0.11` at ≤ 30% (`HealthThresholdStart 0.6`, `HealthThresholdEnd 0.3`). The wiki's missing-health table is linear 5 → 11 between 40% and 70% missing HP.
- It uses **your own** current HP.
- Damage to champions only. Additive dealt-modifier; includes true damage except Smite.

**Legend: Alacrity (9104): H**

- Effect: `bAS = AttackSpeedBase 0.03 + AttackSpeedPerStack 0.015 × stacks`, with stacks ≤ `MaxLegendStacks 10`. Maximum +18%.
- **Legend points** (shared by all three Legend runes; 100 points = 1 stack): champion takedown 100, epic monster takedown 100, large monster kill 25 (`LargeMonsterKillValue`), minion kill 4 (`MinionKillValue`).

**Legend: Haste (9105): H**

- Effect: `HastePerStack 1.5` **basic-ability haste** per stack (Q/W/E only, not R), ≤ 10 stacks. Maximum 15.

**Legend: Bloodline (9103): H**

- Effect: `LifeStealPerStack 0.0045` life steal per stack, ≤ 15 stacks (6.75%). At 15 stacks, also `+BonusHealth 85` bonus HP (relevant for bonus-HP scalings).

**Absorb Life, Triumph, Presence of Mind**

- No damage. Skipped, except that Triumph is the substitute for manaless champions.

### Domination

**Cheap Shot (8126): H**

- **Damage:** `True = lerp(DamageIncMin=10, DamageIncMax=45)` bonus true damage. `Cooldown 4 s`.
- **Trigger:** **non-proc** damage to an enemy champion that is **already** affected by one of these CC types:
  - immobilize
  - blind
  - disarm
  - ground
  - nearsight
  - polymorph
  - silence
  - slow

  **Cripple doesn't count.**
- **Timing:**
  - The check happens in the damage event's on-deal-pre-drain phase.
  - CC applied on-hit (Alistar passive) is present in time. CC applied on-pre-apply (Rylai's) is not.
  - **Damage on the same game tick as CC from the same cast instance does not trigger it**, unless the target was already CC'd.
  - All basic damage counts as one cast instance. So Ashe Q or Ezreal Q + Iceborn alone trigger it only every other hit (bug).
  - DoT ticks after CC is applied can trigger it. Lux E detonation triggers it.
- **Interactions:** proc damage. Not affected by on-attack modifiers since V26.09.

**Taste of Blood (8139): H. Heal only**

- Effect: heal `lerp(HealAmount=16, HealAmountMax=40) + ADRatio 0.10*bAD + APRatio 0.05*AP` on damaging an enemy champion.
- Cooldown 20 s. Doesn't trigger at full HP.

**Sudden Impact (8143): H**

- **Damage:** `True = lerp(MinDamageTooltip=20, MaxDamageTooltip=80)` (the CALC `BaseDamage` part).
- **Trigger:** any damage to an enemy champion within `ArmedDuration 4 s` of a **dash or blink, or of leaving stealth**. 0-damage instances count.
  - Ready-ers: champion dashes and blinks, **Flash, Hexflash**, the Dash spell, Teleport and Unleashed TP, Recall, Blast Cone, Hex-gates, Rocketbelt, Bard E, Ivern Q dash, Senna W wraith, Tahm W spit, Thresh W.
  - Not ready-ers: **lunges** (e.g. Udyr) and leaving brush or fog.
- **Cooldown:** `Cooldown 10 s`, starting **after the bonus is applied** (or after the 4 s armed window expires unused).
- **Interactions:** proc damage. Not affected by on-attack modifiers.
- **FLAG (wording):** perks LONGDESC says "damaging basic attacks and abilities"; the wiki says any damage. Behaviour per the wiki (M).

**Ultimate Hunter (8106): H**

- Effect: ultimate haste = `StartingUltAH 6 + AdditionalUltAH 5 × BountyHunterStacks` (≤5). Maximum 31.
- Ultimate haste adds to normal ability haste for R only.
- **Bounty Hunter stacks:** 1 per **unique** enemy champion you get a takedown on, so at most 5.

**Treasure Hunter (8135): H. Gold only**

- Effect: per unique takedown, gold = `BaseGoldAmount 50 + GoldGrowth 20 × stacks` (50/70/90/110/130).

**Relentless Hunter (8105): H. Utility**

- Effect: `OOCMS 8` out-of-combat bonus MS per Bounty Hunter stack (max 40).

**Grisly Mementos (8140): H. Utility**

- Effect: `TrinketAH 6` per memento, ≤ `MaxStacks 18` (108). One memento per champion takedown. In modes without wards, `SummonerAH 3` per stack instead.

**Deep Ward (8141) / Sixth Sense (8137): H**

- Ward utility only. No combat stats.

### Sorcery

**Axiom Arcanist (8224): H (scope M)**

- **Amp:** ultimate damage `+DamageAmp 0.12`, or `+AOEAmp 0.08` if the ultimate's damage is AoE-tagged (Twitch R bolts special-cased to AoE). Healing and shielding from the ult (but **not self-healing**) also get +12%.
  - It is a damage-dealt modifier, additive with the others (G4).
- **Applies to:** the ult's damaging passive effects, pets summoned by the ult (not Illaoi R; bug), Heimerdinger R and Karma R empowered spells, Udyr awakened spells, and damage to non-champions.
  - It applies to life steal from ults that apply life steal. Mundo R regen is special-cased.
- **Does not apply to:** Ryze R's effect on EQ, or Mordekaiser R's max-HP steal.
- **Cooldown refund:** a champion takedown reduces the ult's **current** cooldown by `UltimateRefundBase 7%`.
- Where in doubt about tag classification, use the ability's AoE tag.

**Scorch (8237): H**

- **Damage:** `Magic = lerp(Damage=20, DamageMax=40)`, dealt `DotDuration 1 s` after trigger. No ratios.
- **Trigger:** **ability damage** to an enemy champion. AoE abilities apply it to the first champion that receives spell effects. Single target.
- **Cooldown:** `BurnlockoutDuration 10 s`.
- **Interactions:** proc, indirect and periodic damage, no spell effects. If it triggers on-attack (Azir W, Bel'Veth E) it was hit by on-attack modifiers (bug; fixed for Azir in V26.14).

**Gathering Storm (8236): H (AD field M)**

- **Formula:** `m = 1 + floor(gameTime / (UpdateAfterMinutes=10 min))`, `AF = 4·m·(m−1)` (the equivalent `8·n(n+1)/2` with n = floor(t/10 min)). That gives AF = AP 0 / 8 / 24 / 48 / 80 / 120 / 168 …, and **AD = 0.6 × AF** (0 / 4.8 / 14.4 / 28.8 / 48 / 72 / 100.8 …).
- Discrete steps at 10:00, 20:00 and so on. Uncapped. Adaptive (G3).
- **FLAG:** perks.txt `AdaptiveAD 6` does not match the effective 4.8 AD per step. The tooltip numbers (5, 14, 29, 48, 72, 101) are the rounded 0.6 × AP values, so treat `AdaptiveAD 6` as unused. (The wiki's own strategy table has wrong AD values for the 9th and 10th steps; the formula is correct.)

**Absolute Focus (8233): H (> vs ≥ M)**

- Effect: `AF = lerp(MinAdaptive=3, MaxAdaptive=30)` while **current HP > `HealthPercent` 70% of max HP**. That is 1.8–18 AD or 3–30 AP.
- Lost immediately when HP drops below the threshold (there was a V8.15 fix about attacks cancelling).

**Waterwalking (8232): H**

- Effect: while in the river, `+MovementSpeed 10` flat MS and `AF = lerp(MinAdaptive=13, MaxAdaptive=30)`.
- Stats are lost immediately on leaving; the MS decays over 1 s.
- Ocean-drake jungle puddles count. In modes without a river it becomes Scorch.

**Transcendence (8210): H**

- Effect: `+5 AH` at level 5 (`LevelToTurnOn`), `+5 AH` at level 8.
- From level 11: an enemy champion takedown reduces the **current** cooldowns of basic abilities by `KillCooldownRefund 20%`.
- The old excess-CDR → AD/AP conversion is gone (removed V10.23).

**Celerity (8234): H. Utility**

- Effect: `+PercentMS 1%` bonus MS, and all MS bonuses are `PercentHasteMod 7%` more effective. There are documented quirks with additive and multiplicative MS on the wiki.

**Manaflow Band (8226), Nimbus Cloak (8275)**

- Not damage-relevant. Skipped.

### Resolve

**Shield Bash (8401): H (BonusShieldMult L)**

- **Damage:** `Dmg = lerp(ProcBaseMin=5, ProcBaseMax=30) + (BonusHealthRatio 2.5/100) × bonusHP + (ShieldRatio 15/100) × ShieldAmount`, bonus **adaptive** (G2.1), applied on-hit.
- **Trigger:**
  - Gaining **any** shield arms your next basic attack against an enemy champion. It stays armed while the shield lasts plus `ProcDuration 2 s` after it expires.
  - One proc per gained shield. After the empowered attack, all earlier shields become invalid as triggers.
- **ShieldAmount:**
  - It is the **initial or maximum value** of the shield, not the remaining value. If a shield grows, the highest value reached is used.
  - When several shields are active (or expired within 2 s), the largest is used. A new shield replaces the armed value only if it is larger.
- Sources that raise ShieldAmount: Revitalize (+5% HSP, +10% under 40% HP), Overgrowth via bonus HP.
- **Unexplained field:** `BonusShieldMult 0.10` (L; possibly vestigial).
- **Interactions:** proc damage, no spell effects.
- **Melee/ranged:** no difference stated.

**Demolish (8446): H (field `8` L)**

- **Damage:** the 3rd basic attack **on-hit against a turret** consumes 3 stacks and deals `BaseDamageMelee 85 + HPRatioMelee 0.28 × maxHP` (ranged `BaseDamageRanged 50 + HPRatioRanged 0.20 × maxHP`) bonus **physical** damage.
- **Stacks:** they never expire, are tracked per user per turret, and can sit on several turrets. Triggering on one clears the others.
- **Lockouts:** a 3 s same-turret lockout for all users (`{97664ba4} 3`) and a global `CooldownSeconds 30` that starts after triggering.
- Proc damage tagged basic. It displays as a crit (visual bug only).
- The hidden `{8d810998} 8` is unexplained. Reworked in V26.01.

**Conditioning (8429): H (base/bonus classification M)**

- Effect: after `MinutesRequired 12` min, `+ArmorBase 8` armor and `+MRBase 8` MR, and **total** armor and MR ×(1 + `ExtraResist 0.03`).
- How the 3% is classified (base or bonus) is ambiguous on the wiki. It reportedly does feed bonus-resist scalings such as Aftershock (V10.7).
- `Range 800`: unexplained.

**Overgrowth (8451): H**

- Effect: `+FlatHealthPerTier 3` bonus HP per `UnitsPerTier 8` minion or monster deaths within `Range 1400`. Only units you have direct line of sight to count; you don't need the kill, and it works while dead.
- At `ThresholdUnits 120` (15 stacks), **base HP and bonus HP are each ×1.035** (`ThresholdMaxHealthRatio`). This raises bonusHP for Aftershock, Shield Bash and Guardian ratios, and maxHP for Grasp and Demolish.

**Unflinching (8242): H. Defensive**

- Effect: 10 armor and 10 MR while CC'd by an enemy champion, plus 2 s after. It is applied after the CC-ing damage instance.

**Font of Life, Second Wind, Bone Plating, Revitalize**

- No outgoing damage.
- Bone Plating reduces the next 3 hits from the triggering champion by `lerp(30,60)` **after mitigation, including true damage** (55 s cooldown). Relevant only if you simulate incoming damage.
- Revitalize: see Shield Bash.

### Inspiration

**Triple Tonic (8313): H**

- **Level 3:** Elixir of Avarice. 5 bonus true damage on-hit against minions for 60 s, then 60 gold.
- **Level 6:** **Elixir of Force: 25 adaptive force (15 AD / 25 AP) for 60 s.** Last changed V26.03.
- **Level 9:** Elixir of Skill: **+1 skill point**. It never exceeds 18 points total, so in practice you rank an ability one level early. Damage-relevant if you simulate skill order.
- Avarice and Force wait for a free inventory slot; Skill auto-consumes if the inventory is full.

**Jack of All Trades (8316): H (which items count M)**

- **Stacks:** 1 per **unique stat type currently granted by items**. Each stack gives `HastePerStack 1` ability haste.
- **Adaptive force:** at 5 stacks **+8 AF** (`{1b48f5ea} 8`). At 10 stacks a total of **20 AF** (`{55d14eea} 20`, i.e. +12 more). Last changed V26.15 from 10/25.
- **Eligible stat types:**
  - AD, attack range, AS, AH, AP
  - armor, %armor pen
  - crit chance, crit damage
  - gold generation, HSP
  - HP, base HP regen
  - life steal, lethality
  - flat and % magic pen, MR
  - mana, base mana regen
  - flat and % MS
  - omnivamp, tenacity
- **Not eligible:** adaptive force, physical vamp, slow resist, spell vamp.
- Some item-effect stats count (Sterak's AD, Yun Tal crit) and others don't (Endless Hunger). Shards and runes don't count; it is "from items" only.

**Cosmic Insight (8347): H**

- Effect: `SummonerHaste 18` summoner-spell haste, `ItemHaste 10` item haste (item active cooldowns).

**Biscuit Delivery (8345)**

- Each Biscuit (at 2:00, 4:00 and 6:00) gives a permanent `+PermanentHP 30` max HP when eaten or sold, so up to **+90 bonus HP**. This matters for bonus-HP ratios.

**Hextech Flashtraption, Magical Footwear, Cash Back, Time Warp Tonic, Approach Velocity**

- No damage effect. Skipped.
- Cash Back refunds `PercentRefund 7.5%` of a Legendary's cost.
- Magical Footwear gives free boots at 12:00 (−45 s per takedown) with +10 MS.

---

## 5. Stat shards (16.20 SR). Confidence H

| Row | Shard (id) | Value (perks.txt) | Notes |
|---|---|---|---|
| Offense | Adaptive Force (5008) | `StatGain2 9` AF = `StatGain1 5.4` bonus AD **or** 9 AP | G3 resolution |
| Offense | Attack Speed (5005) | `StatGain 10` → +10% bonus AS | |
| Offense | Ability Haste (5007) | `HasteGain 8` AH | |
| Flex | Adaptive Force (5008) | as above | |
| Flex | Move Speed (5010) | `StatGain1 2.5` → +2.5% bonus MS | V25.22: 2% → 2.5% |
| Flex | Health Scaling (5001) | `StatGainMin 10` → `StatGainMax 180`, i.e. **10 × L** bonus HP | Wiki formula `10*x` for L1–20 (200 at L20; M) |
| Defense | Health (5011) | `StatGain 65` bonus HP | flat |
| Defense | Tenacity and Slow Resist (5013) | `StatGain 15` → 15% tenacity and 15% slow resist | V25.22: 10% → 15% |
| Defense | Health Scaling (5001) | as above | |

**Not on SR (do not offer):** Armor 5002 (6), Magic Resist 5003 (8), Attack Damage 5004 (5.6), Ability Power 5006 (9), Scaling Adaptive Force 5009, Resist Scaling 5012 (1–8).

- Armor and MR were removed from SR shards in V14.2. The other four don't appear anywhere on the wiki; they are presumably legacy or other-mode data (L).

---

## 6. In perks.txt but NOT live on SR: do not simulate (H)

| Perk (id) | Status |
|---|---|
| Predator (8124) | Removed V14.10 |
| Ingenious Hunter (8134) | Removed V14.10 |
| Zombie Ward (8136) | Removed V25.S1.1 (→ Sixth Sense) |
| Ghost Poro (8120) | Removed V25.S1.1 (→ Grisly Mementos) |
| Eyeball Collection (8138) | Removed V25.S1.1 (→ Deep Ward) |
| Kleptomancy (8359) | Removed V9.23 |
| Celestial Body (8339) | Removed V8.4 |
| Chrysalis (8472) | Removed V8.23. perks.txt shows 40 HP → 10 AF; the wiki's last live values were 50 HP → 9 AD / 15 AP |
| Iron Skin (8430), Mirror Shell (8435) | Removed V8.6 |
| Phase Rush | Removed V26.09. Id 8230 is now Stormraider's Surge |
| Nullifying Orb | Removed V25.S1.1. Id 8224 is now Axiom Arcanist |
| "Set bonus" perks: The Aether Blade 8115, Wicked Maestro 8109, Immortal Butcher 8114, Twisted Surgeon 8127, Timeless 8320, Stargazer 8319, Ruthless Visionary 8318, Elegant Duelist 8344, Arcane Colossus 8415, Leviathan 8454, Behemoth 8414, Enlightened Titan 8416, Calamity 8220, Cryptic 8207, Incontestable Spellslinger 8205, Ancient One 8208, Brazen Perfect 8004, Merciless Elite 8016, Eternal Champion 8006, Savant 8007 | Pre-V8.23 path bonuses. All values are 0. Ignore |
| Template (7000) | Ignore |

---

## 7. perks.txt vs wiki: disagreements and oddities (numbers per perks.txt; flag only)

1. **The wiki shows level-20 values.** Everywhere the wiki's upper bound is higher (Electrocute 260, PtA 174.12, Cheap Shot 49.12, HoB 22.12, Taste of Blood 42.82, Aery 54.71, Comet 110 and CD 6.59, and so on), it is the same perks.txt lerp extrapolated to L20 (G1). There is **no real conflict at L1–18.**
   - Simulator decision: don't clamp `L` at 18 for level-lerped values, except First Strike's cooldown.
2. **Lethal Tempo ranged.** perks `TTASPerStackRanged 0.04` and `TTMin/MaxNoteDamageRanged 6/24` (tooltip fields) disagree with perks CALCs (4.8% AS, 6–20 bolt). The wiki confirms the CALCs.
3. **Arcane Comet refunds.** `PercentRefund 0.2`, `AoEPercentRefund 0.1` and `DotPercentRefund 0.05` were removed from the live effect in V26.09.
4. **Guardian.**
   - `ShieldDuration 1.5` vs wiki 2 s.
   - `GuardDuration 2.5` vs wiki: 2.5 s is the damage window and the targeted-guard duration is 3 s.
   - `ThresholdCalc` lerps 40–150 vs `ThresholdMin/Max` 50–165; the wiki says 50–165.
5. **Gathering Storm.** `AdaptiveAD 6` vs the effective 4.8 AD per step (0.6 × 8 AP).
6. **Cut Down.** Min/Max% and HealthDifference fields are leftovers; the live effect is a flat 8% above 60%.
7. **Press the Attack.** `AmpPotency…Others 0.08` is a likely leftover of the removed Exposed debuff. The LONGDESC "amplifies your damage dealt" is broader than the wiki's "against champions".
8. **Sudden Impact.** The LONGDESC "damaging basic attacks and abilities" is narrower than the wiki's "dealing damage" (any, including 0-damage).
9. **Unexplained hidden fields:** Shield Bash `BonusShieldMult 0.10`, Demolish `{8d810998} 8`, First Strike `OOCTimer 10`, Conditioning `Range 800`, Stormraider's `HasteMax` naming (the wiki shows no decay).
10. **Wiki-internal errors (not perks.txt):**
    - Unsealed Spellbook infobox 245 s vs text 270 s.
    - Gathering Storm strategy-table AD rows 9 and 10.
    - Aftershock cap note uses the old 35/80%.
    - Grasp proc-count notes use pre-V25.12 ranged values.
    - Dark Harvest vs Electrocute pages disagree on what "adaptive" ties default to; resolved in G2 (adaptive goes to the champion's type, variable goes to magic).

---

## 8. Open questions to verify in-game (all L)

- Dark Harvest, Cut Down: is the HP threshold checked before or after the triggering hit? (Coup de Grace is documented as pre-hit.)
- Stormraider's Surge: is the 3 s damage window rolling, and is it per target?
- Deathfire Touch: does a refresh reset the 3 s linger timer?
- Arcane Comet: is the distance measured at trigger time (assumed) or at impact? Is the amp exactly linear?
- First Strike: what does the 10 s `OOCTimer` gate? Does PtA, Coup or Cut Down amplify First Strike's true damage?
- Hail of Blades: do attacks on non-champions while active consume stacks and get the true damage?
- Aftershock: does the shockwave hit minions? (The tooltip says champions and monsters.)
- Conqueror: do stacks expire all at once or one at a time?
- V26.09 additive amplifiers: are there exceptions? (The wiki itself has this pending test.)
- Do level-lerped values really extrapolate to L19–20 in-game for every rune? The wiki's arithmetic implies yes; Aftershock is unconfirmed.

---

## 9. Reference values (lerp per G1; L19–20 extrapolated)

| Value | L1 | L6 | L9 | L11 | L13 | L16 | L18 | L20 |
|---|---|---|---|---|---|---|---|---|
| Electrocute base | 70 | 120 | 150 | 170 | 190 | 220 | 240 | 260 |
| Press the Attack proc | 40 | 75.29 | 96.47 | 110.59 | 124.71 | 145.88 | 160 | 174.12 |
| Lethal Tempo bolt, melee (×(1+bAS); ranged ×0.667) | 9 | 15.18 | 18.88 | 21.35 | 23.82 | 27.53 | 30 | 32.47 |
| Hail of Blades true per hit | 2 | 7.29 | 10.47 | 12.59 | 14.71 | 17.88 | 20 | 22.12 |
| Summon Aery dmg | 10 | 21.76 | 28.82 | 33.53 | 38.24 | 45.29 | 50 | 54.71 |
| Arcane Comet base (×1 to ×2 by distance) | 15 | 40 | 55 | 65 | 75 | 90 | 100 | 110 |
| Arcane Comet CD (s) | 20 | 16.47 | 14.35 | 12.94 | 11.53 | 9.41 | 8 | 6.59 |
| Stormraider's Surge CD (s) | 20 | 17.06 | 15.29 | 14.12 | 12.94 | 11.18 | 10 | 8.82 |
| Deathfire burn per second (before ×1.75) | 3 | 5.65 | 7.24 | 8.29 | 9.35 | 10.94 | 12 | 13.06 |
| Cheap Shot true | 10 | 20.29 | 26.47 | 30.59 | 34.71 | 40.88 | 45 | 49.12 |
| Sudden Impact true | 20 | 37.65 | 48.24 | 55.29 | 62.35 | 72.94 | 80 | 87.06 |
| Scorch magic | 20 | 25.88 | 29.41 | 31.76 | 34.12 | 37.65 | 40 | 42.35 |
| Aftershock base | 25 | 52.94 | 69.71 | 80.88 | 92.06 | 108.82 | 120 | 131.18 |
| Aftershock resist cap | 80 | 100.59 | 112.94 | 121.18 | 129.41 | 141.76 | 150 | 158.24 |
| Shield Bash base | 5 | 12.35 | 16.76 | 19.71 | 22.65 | 27.06 | 30 | 32.94 |
| Conqueror AF per stack | 1.8 | 2.45 | 2.84 | 3.09 | 3.35 | 3.74 | 4 | 4.26 |
| Absolute Focus AF | 3 | 10.94 | 15.71 | 18.88 | 22.06 | 26.82 | 30 | 33.18 |
| Waterwalking AF | 13 | 18 | 21 | 23 | 25 | 28 | 30 | 32 |
| Guardian shield base | 40 | 72.35 | 91.76 | 104.71 | 117.65 | 137.06 | 150 | 162.94 |
| First Strike CD (s; clamped at L18) | 25 | 22.06 | 20.29 | 19.12 | 17.94 | 16.18 | 15 | 15 |
| Taste of Blood heal | 16 | 23.06 | 27.29 | 30.12 | 32.94 | 37.18 | 40 | 42.82 |
| Fleet heal, melee (stat-growth curve; ranged ×0.6) | 15 | 48.69 | 72.49 | 89.85 | 108.4 | 138.46 | 160 | 182.73 |
| Health Scaling shard | 10 | 60 | 90 | 110 | 130 | 160 | 180 | 200 |

Dark Harvest = 30 + 11·souls + ratios (no level scaling). Grasp = 3.5% maxHP (ranged 1.4%).
