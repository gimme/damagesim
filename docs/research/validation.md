# Wiki cross-check of lolsim, patch 16.20 (wiki "V26.20")

Read-only audit. Nothing under /home/user/dev was modified. The wiki data came from `Template:Data_<Champ>/<Ability>?action=raw`, `Module:ChampionData/data` (base stats) and the patch-history pages. Our numbers came from `scripts/inspect-champion.ts`, `src/cli/main.ts champion … --json` and `simulate … --events`. Scratch scripts are in `scratchpad/research/scripts/`.

Coverage:
- About 150 ability values in 60 sample rows across 44 champions plus Ignite.
- Base stats for all 173 champions, compared automatically.
- Level scalings checked at every level from 1 to 18 wherever the wiki gives per-level values.

## Sample table (✓ match, ✗ mismatch)

| # | Champion / ability | Wiki | Ours | |
|---|---|---|---|---|
| 1 | Ahri Q | 35–135 (+50% AP), magic out + true back | BaseDamage 35/60/85/110/135 + 0.5 AP, both passes | ✓ |
| 2 | Ahri W | 40–120 (+40% AP); later fires 40% | same | ✓ |
| 3 | Ahri E / R | 80–240 (+85% AP) / 75–175 (+35% AP) | same | ✓ |
| 4 | Ahri P heals | pplevel 75→165 (+30% AP), 35→95 (+20% AP), linear | lerp; L11 = 127.94 / 70.29 | ✓ |
| 5 | Yasuo Q (crit) | 20–120 (+105% AD); crit 105% × 200% × crit_mod 0.95 | sim L11 rank 5: 283.5 = 120 + 1.995 × 81.9 | ✓ |
| 6 | Yasuo E | 70–130 (+20% bAD)(+60% AP), +25% per stack | same | ✓ |
| 7 | Yasuo R | 200/350/500 (+150% bAD) | same | ✓ |
| 8 | Yasuo P shield | 125→600 on the stat-growth curve | equal at all 18 levels | ✓ |
| 9 | Yone Q | 25–125 (+110% AD), crit × 0.95 | same (kit uses CritDamageMod) | ✓ |
| 10 | Yone W | 10–50 + 8–12% max HP, split phys/magic; shield 40→90 linear (+65% bAD) | same | ✓ |
| 11 | Yone W monster cap | 140 + 10/level (L1 = 150, L18 = 320) | L1 = 140, L18 = 310 | ✗ bug A |
| 12 | Yone W minion floor | 30 + 10/lvl to L8, +20 to L13, +40 after (L1 = 40) | flat 30 to L8, then +20; L11 = 90 against wiki 150 | ✗ bug C (minor) |
| 13 | Yone E / R | 25–35% stored / 200–600 (+80% bAD) split | same | ✓ |
| 14 | Senna P | 1–10% current HP (1% × level, capped at 10) | equal at all 18 levels | ✓ |
| 15 | Senna Q/W/R | 30–130 (+60% bAD); 70–230 (+90% bAD); 250–550 (+115% bAD)(+70% AP); crit_mod 0.8 | same | ✓ |
| 16 | Jhin P bonus AD% | 4,5,…,12,14,16,20,…,44 | equal at all 18 levels | ✓ |
| 17 | Jhin P 4th shot | 15/20/25% missing HP at L1/6/11; crit 150% | same | ✓ |
| 18 | Jhin Q/W/E/R | 44–144 (+44–74% AD)(+60% AP); 70–210 (+50% AD); 20–260 (+120% AD)(+100% AP); 64–192 (+25% AD) ×4 by missing HP | same | ✓ |
| 19 | Jhin AS growth | 3% per level; "attack speed can only increase by leveling" | attackSpeedPerLevel 0, so AS stays 0.625 at every level | ✗ bug D |
| 20 | Pyke R | 250 at L6 … 550 at L18 (13-value list) | equal at all levels; sim (430 + 0.8 × 55 + 1.5 × 18) × 0.5 = 250.5 | ✓ |
| 21 | Pyke Q/E/P | 100–300 (+75% / +100% bAD); 1 AD per 14 bHP; grey health 9% / 40% (+0.2/0.4% per lethality) | same | ✓ |
| 22 | Irelia P | AS 10→25% per stack linear; on-hit 10→61 (+20% bAD) | same | ✓ |
| 23 | Irelia Q/W/E/R | 5–85 (+80% AD); W 10–50 / 30–150 (+40/120% AD)(+50/150% AP); 70–230 (+100% AP); 125–275 | same | ✓ |
| 24 | Darius P bleed | 13→30 linear (+30% bAD) per stack | equal at all 18 levels | ✓ |
| 25 | Darius Noxian Might | 30, +5/lvl to L10, +10 to L13, +25 after | equal at all 18 levels | ✓ |
| 26 | Darius Q/W/E/R | 50–170 (+100–140% AD); 40–60% AD bonus; 20–40% armor pen; 125–375 (+75% bAD), +20% per stack | same | ✓ |
| 27 | Garen E | 4–16 (+40–52% AD); 7 spins + 1 per 25% bonus AS (items + growth); crit +30% of bonus crit; nearest +25% | sim L11: 8 / 9 / 12 spins at 32% / 62% / 127% bonus AS | ✓ |
| 28 | Garen Q/W/R/P | 30–150 (+50% AD) bonus; shield 65–145 (+18% bHP); R 125–275 + 25–35% missing HP; regen breakpoints | same | ✓ |
| 29 | Kai'Sa P | 4→30 + 1→8 per stack (+12% / +3% AP); 15% (+6% per 100 AP) missing HP | same | ✓ |
| 30 | Kai'Sa Q/W/E/R | 40–100 (+55% bAD)(+20% AP), 25% for later missiles; 30–130 (+130% AD)(+45% AP); AS 40–80%; shield 100–200 (+90–180% AD)(+120% AP) | same | ✓ |
| 31 | Akshan P | proc 15/40/80/150 at L1/6/11/16 (+60% AP); shield 40→280 curve (+35% bAD); 2nd shot 50% AD, crits | equal at all levels; sim 39.2 normal / 78.3 crit | ✓ |
| 32 | Akshan Q/E/R | 45–165 (+70% bAD); 8–40 (+25% AD) × (1 + 0.3 × bAS); 25–45 (+15% AD) + crit, up to ×3 by missing HP | same | ✓ |
| 33 | Jayce hammer Q/W/E (6 ranks) | 60–310 (+135% bAD); 35–110 per tick; 8–22% max HP (+100% bAD) | equal at ranks 1, 3 and 6 | ✓ |
| 34 | Jayce cannon Q (Shock Blast) | 80–285 (+130% bAD) | `simulate Q:cannon`: 80 / 285 ✓. `champion` / get_champion variant: 60 / 160 / 310 (hammer values) | ✗ bug B |
| 35 | Nidalee human | Javelin 70–150 (+50% AP), ×3.25 max; trap 10–50 per tick; heal 50–150 (+35% AP), up to ×2 | same | ✓ |
| 36 | Nidalee cougar (R rank, 4 ranks) | Takedown 5–80 (+75% AD)(+40% AP), +1–1.75% per 1% missing; Pounce 55–190; Swipe 70–250 | sim L16 R4: 161.5 at full HP / 302.8 at 50%; 190; 250 | ✓ |
| 37 | Elise human Q / spider Q | 40–160 + 4% (+3% per 100 AP) current HP / 50–170 + 8% missing HP | same | ✓ |
| 38 | Elise spider passive | 14–44 (+15% AP), heal 6–12, spiderlings 2–5 by R rank (4 ranks) | rank 4: 44 / 12 / 5 | ✓ |
| 39 | Cho'Gath R | 300/475/650 (+50% AP)(+10% bonus HP) | sim with Warmog's: 475 + 0.1 × 1120 = 587 | ✓ |
| 40 | Cho'Gath Q/W/E | 80–300 (+100% AP); 80–280 (+70% AP); 30–110 (+30% AP) + 2.5–3.9% max HP (+0.5% per Feast) | same | ✓ |
| 41 | Malphite E/W/Q/R | E 60–200 (+40% armor)(+60% AP); W 30–70 (+20% AP)(+15% armor), passive armor ×3 while shielded | sim E: 93.4 / 103.4 / 123.4 at W0 / 1 / 5 | ✓ |
| 42 | Galio P / R / W | 15→115 (+100% AD)(+40% AP)(+60% bMR); 150–350 (+70% AP)(+100% bMR); DR 25–45% (+8% per 100 bMR)(+1% per 100 bHP) | sim R with Kaenic: 250 + 80 = 330 | ✓ |
| 43 | Rammus P / W / Q | AD = 15% armor + 15% MR; 27–47 (+30–60% armor); 80–240 (+100% AP) | L11 AD 89.1 + 18.7 | ✓ |
| 44 | Sett R / W / Q / E | 200–400 (+120% bAD)(+40–60% target bHP); 80–160 + 25% (+25% per 100 bAD) of Grit; Q 1% (+1–3% per 100 AD) max HP; E 50–130 (+60% AD) | same | ✓ |
| 45 | Sett P right punch | 5 → 90 (5 + 5 per level) (+55% bAD) | L1 = 0, L11 = 50 (wiki 55), L18 = 85 | ✗ bug A |
| 46 | Brand P / Q / W / E / R | 2% max HP burn; blast 6→12% linear (+2% per 100 AP); 70–190; 75–255 (+25%); 55–155; 100–250 | same | ✓ |
| 47 | Caitlyn P / Q / W / E / R | headshot 60/80/100% at L1/7/13 + crit scaling; 50–210 (+125–205% AD); +35–215 (+30% bAD); 80–280; 300–650 (+100% bAD) + crit | same | ✓ |
| 48 | Fiora P / Q / W / E / R | vital 3% (+4% per 100 bAD); 70–110 (+90–110% bAD); 110–270; crit 160–200%; heal 80–130 (+70% bAD) | same | ✓ |
| 49 | Vayne W (changed V26.17) / Q / E / R | 4–10% max HP, floor 40–100; 75–115% AD; 50–190 (+50% bAD), ×2.5 on stun; 35–65 AD | sim: 100 floor, 300 vs 3000 HP | ✓ |
| 50 | Warwick Q / P / R | 6–10% max HP (+120% AD)(+100% AP); on-hit 6→55 linear (+15% bAD)(+10% AP); 175–525 (+167% bAD) | same | ✓ |
| 51 | Zed P / Q / E / R | 5/7.5/10% at L1/7/17; 80–240 (+100% bAD); 70–160 (+70% bAD); 100% AD + 25/40/55% stored | same | ✓ |
| 52 | Diana P / Q / W / E / R | cleave 20,+5…+25 breakpoints (+50% AP), AS 15→35%; 70–210; shield 45–105 (+14% bHP); 50–130; 200–400 + 35–85 per champion | same | ✓ |
| 53 | Kayle E / Q / R / P wave | 8–10% (+1.5% per 100 AP) missing HP; 60–180 (+60% bAD)(+50% AP); 200–400; wave 20 + 3/level from L11 | same | ✓ |
| 54 | Kog'Maw W / Q / E / R | 3–6% (+1.5% per 100 AP) max HP; 80–260; 70–230; 100–180 (+75% bAD)(+35–45% AP), ×2 | same | ✓ |
| 55 | Tristana E / W / R | 60–160 (+80% bAD)(+50% AP), +25% per stack, +up to 40% from crit; 70–210; 225–325 | same | ✓ |
| 56 | Twisted Fate W / Q / E | blue 40–120 (+100% AD)(+100% AP), red 30–90, gold 15–45; 60–240; 65–165 | same | ✓ |
| 57 | Lux Q / W / E / R | 80–240; shield 40–100; 65–265; 300–500 (+120% AP) | same | ✓ |
| 58 | Lux P (Illumination) | 30 → 200 (+35% AP) | sim L1 = 20, L18 = 190 | ✗ bug A |
| 59 | Zaahen P / W / E / R | 1.5→2.8% AD per stack (×2 at 12); 40–120 + 30–110; 40–120 (+50% bAD), edge ×1.5 + 4–6% max HP magic; 250–550 (+200% bAD), armor pen 10–30% | same | ✓ |
| 60 | Zaahen Q | 15–75 + 100% AD + 20–40% bAD split over 2 strikes; crit adds only AD-based damage | non-crit sim 173 ✓; crit sim 346 (doubles the Q bonus too); wiki-implied 271 | ✗ bug E (medium confidence) |
| 61 | Yunara Q / W / R-W / E / P | 3–23 (+20% AP) ×2; 55–215 (+85% bAD)(+50% AP), linger 60%/4 per tick; 160–480 (+120% bAD)(+75% AP); 30–50% MS; crit +10% (+10% per 100 AP) | same | ✓ |
| 62 | Mel Q / W / E / R / Overwhelm | 60–160 + 5–13 per bolt; shield 80–200; 60–240 + 2–8 per tick; 125–275 + 4–10 per stack; Overwhelm 50/60/70/80 + 2/3/4/5 per stack by R rank 0–3 | same, including R rank 0 (50 + 2) | ✓ |
| 63 | Locke P / Q / W / E / R | 5→40 to 10→80 on-hit; 40–72 per nail + 18–50 (+25–35% AP) per stack; AS 40→70%; 40–80 + 40–120; 150–300, execute 10–12% | same | ✓ |
| 64 | Hwei QE (Molten Fissure) | 20–80 (+30% AP) | sim 80 ✓; `champion` variant shows 160 | ✗ bug B |
| 65 | Ignite | 70, +20/lvl to L5, then +25 (L18 = 475) | sim L1/2/5/6/11/18 = 70/90/150/175/300/475 | ✓ |
| 66 | Graves P pellet % | 70% → 100% AD (formula gives 0.70 at L1) | L1 table value 0, so **AA deals 0 damage at level 1** | ✗ bug A |
| 67 | Katarina P dagger | 68 at L1 … 240 at L18 | L1 = 0 ("dealing 0 magic damage"); L18 = 223.75 | ✗ bug A |
| 68 | Rengar empowered W | 50 → 220 | L1 = 0, L18 = 210 | ✗ bug A |
| 69 | Braum / Kha'Zix / Leona / Nautilus passives | 26→196 / 22→141 / 32→151 / 14→116 | 16→186 / 15→134 / 25→144 / 8→110 | ✗ bug A |

### Base stats (`Module:ChampionData/data`, all 173 champions, every growth stat)

All values match within 0.15% except the ones listed below.

| Champion | Wiki | Ours (= game bin) | Verdict |
|---|---|---|---|
| Ahri, Garen, Zaahen | HP, AD, armor, MR, AS, AS ratio and all growths | identical | ✓ |
| Vi | AD growth 3.5 | 3.9 | ✓ ours. Patch history: V26.19 raised it to 3.9; the wiki module is stale |
| Vayne | AS ratio 0.658 | 0.67 | ✓ ours. V26.17 changed it to 0.67; the wiki module is stale |
| Jhin | AS growth 3% | 0 | ✗ bug D |
| Kled | HP 810 / 142.8 (Kled + Skaarl) | 410 / 84 | known limitation, documented in the kit notes ("Skaarl's health not modelled"). Affects Kled as a target |
| Singed | AS ratio 0.69 | 0.625 (bin) | most likely a wiki error; no patch note |
| Kayle, Maokai, Milio, Mordekaiser, Nunu, Rakan, Yuumi, Zac | 5 hp5 | 0 | low: bin omits `baseStaticHPRegen` and build-data defaults it to 0. Not used for damage |
| ~14 champions | `attack_delay_offset` | 0 | not a bug: they use castTime/totalTime, which `sim.ts:1583` handles. Only Karthus has neither field |

### Wiki/data differences that are not simulator bugs

These are non-damage values where the game data is authoritative:
- Brand mana-restore breakpoints.
- Galio W out-of-combat timer (wiki 12/10/8, data 12/11/8).
- Yasuo Flow per unit.
- Darius bleed tick (1.26 s in data, 1.25 s on the wiki).

## Suspected simulator bugs

### A. `lvltable` (ByCharLevelFormulaCalculationPart) is one level behind (high confidence, high impact)

`src/engine/calc.ts:100-101`:
```ts
case 'lvltable':
  return p.values[Math.min(Math.max(env.level, 1), p.values.length) - 1] ?? 0;
```

The raw arrays have 31 entries, and index 0 is level 0. Several arrays start with a placeholder value:
- Graves `[0, 0.7, 0.7113, …]`
- Katarina `[0, 68.18, 72.14, …]`
- Rengar `[0, 50, 60, …]`
- Sett `[0, 5, 10, …]`
- Presence of Mind `[6, 6, 6.8, …]`

Every wiki value matches `values[level]`, and none match `values[level-1]`:

| Calc | Wiki L1 / L18 | `values[1]` / `values[18]` |
|---|---|---|
| Braum | 26 / 196 | 26 / 196 |
| Kha'Zix | 22 / 141 | 22 / 141 |
| Leona | 32 / 151 | 32 / 151 |
| Lux | 30 / 200 | 30 / 200 |
| Nautilus | 14 / 116 | 14 / 116 |
| Rengar | 50 / 220 | 50 / 220 |
| Katarina | 68 / 240 | 68.18 / 240.02 |
| Graves | 0.70 / 1.00 (formula) | 0.70 / 1.0001 |
| Sett | 5 / 90 | 5 / 90 |
| Yone | 150 / 320 | 150 / 320 |

**Affected calcs.** 12 calcs: Braum P, Graves P, Katarina P, Kha'Zix P, Leona P, Lux P, Nautilus P (2), Rengar W, Sett P (2), Yone W, plus the Presence of Mind rune. At level 1, Graves basic attacks, Katarina daggers, Rengar's empowered W and Sett's right punch all deal 0.

**Fix.** Use `values[clamp(level, 0, len-1)]`. The `[by level: …]` display in inspect is shifted the same way.

**Reproduce:**
```
node src/cli/main.ts simulate -c Graves -l 1 --combo "AA" --crit never --target hp=5000,armor=0,mr=0   # TOTAL 0
node src/cli/main.ts simulate -c Lux -l 18 --ranks Q=1,W=0,E=0,R=0 --combo "Q wait:0.5 AA" --target hp=5000,armor=0,mr=0 --events   # Illumination 190 (wiki 200)
node src/cli/main.ts champion Katarina -l 1      # "dealing 0 magic damage"
node scripts/inspect-champion.ts Sett 11 --all-spells | grep RightPunchBonus   # 50 (wiki 55)
```

### B. `champion` / MCP `get_champion` evaluates variant components against the wrong spell (high confidence; display only, `simulate` is correct)

`src/engine/describe.ts:88` calls `componentInfo(sim, slot, c)` for variants and ignores `variant.spell`. As a result, unqualified `calc.` / `dv.` references resolve against the slot's default spell. Examples:
- Jayce Q:cannon shows hammer Q values: rank 1 / 3 / 6 = 60 / 160 / 310, wiki 80 / 162 / 285.
- Hwei Q:QE shows 160, wiki 20–80, `simulate` gives 80.

The 11 kits that use a variant `spell:` override are Aphelios, Evelynn, Gnar, Hwei, Jayce, Kled, Rell, Elise, Nidalee, RekSai and Qiyana. Elise and Nidalee use explicit `Q.dv` / `R.calc` references, so they show correct values.

**Reproduce:**
```
node src/cli/main.ts champion Jayce -l 18 --ranks Q=1,W=1,E=1,R=1 --json     # variant cannon blast 60
node src/cli/main.ts simulate -c Jayce -l 18 --ranks Q=1,W=1,E=1,R=1 --combo "Q:cannon" --target hp=5000,armor=0,mr=0 --events   # 80
```

### C. Breakpoints with no `mLevel` are dropped (low impact)

`scripts/build-data.ts:85` maps a missing `mLevel` to `undefined`. In addition, `evalBreakpoints` (`calc.ts:62`) starts its loop at L = 2, so even a level-1 breakpoint would never apply.

The wiki matches a default of `mLevel` = 1 counted at level 1. For Yone's W minion floor that gives 30 + 10 × L up to L8; at L11 the wiki has 150 and we have 90.

The only champion occurrence is Yone `MinimumDamageMinions`, which is minion-only. The item bins have two empty `ChampLevelReached` breakpoints. inspect prints this breakpoint as "Lundefined".

**Reproduce:**
```
node scripts/inspect-champion.ts Yone 11 --all-spells | grep MinimumDamageMinions
```

### D. Jhin has no level attack-speed growth (medium-high confidence)

The bin and Data Dragon both have no `attackSpeedPerLevel` for Jhin, so the simulator keeps his AS at 0.625 at every level.

The wiki says:
- His AS growth is 3%.
- "Jhin's attack speed does not benefit from any bonuses other than its growth" (Attack speed page).
- "cannot increase except by leveling up" (Whisper).

`JhinPassive` has an unused data value, `PercentAttackSpeedPerLevel = 0.03`. It appears nowhere in `src/` or `scripts/`, which suggests the passive script applies the growth. That puts Jhin's AS at about 0.79 at L11 and 0.94 at L18 in game.

Possible second effect: if the level-derived bonus AS also feeds Whisper's "0.3% AD per 1% bonus AS", his passive AD is also undercounted (16% instead of about 24% at L11). The wiki is ambiguous on this point, so verify it in game.

**Reproduce:**
```
node src/cli/main.ts simulate -c Jhin -l 18 --combo "AA" --target hp=5000,armor=0,mr=0   # AS 0.625
```

### E. Zaahen Q crit doubles the Q bonus damage (medium confidence)

The kit (`src/kits/champions/Zaahen.ts`) uses `canCrit` with the default multiplier on `(ad + Q.calc.InitialDamage)/2` per strike. The wiki says each strike crits for `{{critical damage|crit_base/2|50|base=50}}` AD, meaning only the AD portion crits (one roll for both strikes).

At L11, Q rank 5:

| | Damage |
|---|---|
| Non-crit | 173 |
| Our crit | 346 |
| Wiki-implied crit | 2 × 98.1 + 75 ≈ 271 |

**Reproduce:**
```
node src/cli/main.ts simulate -c Zaahen -l 11 --ranks Q=5,W=1,E=1,R=1 --combo "Q AA" --crit always --target hp=5000,armor=0,mr=0 --events
```

## What looked solid

- **Formulas and stat mapping.** Per-rank arrays, rank indexing (including 4-rank R for Elise and Nidalee, 6-rank Jayce abilities and R rank 0 for Mel) and every stat mapping tested were correct:
  - AP, total AD and bonus AD
  - bonus HP, armor, bonus MR and lethality
  - crit chance and crit damage
  - target current, missing, max and bonus HP
- **Unit conversions.** `×0.01`, `/100` and per-100-AP coefficients all came out right.
- **Level scaling.** Linear and stat-curve level interpolation matched the wiki exactly (Yasuo shield to 3 decimals at all 18 levels). So did breakpoint semantics for both per-level bonus and flat add at a level: Pyke R, Darius Noxian Might, Jhin, Caitlyn, Zed, Akshan, Diana, Garen P and Ignite.
- **Crit modifiers.** Champion-specific crit modifiers (Yasuo, Yone, Jhin, Senna, Akshan, Garen E, Caitlyn, Tristana) were right.
- **Attack-speed scaling.** Garen E spin counts, Akshan E and Kai'Sa all matched.
- **Recent and new champions.** V26.17 to V26.20 changes (Vayne, Vi) and the new champions (Zaahen, Yunara, Mel, Locke) matched current values.

## Addendum: Lux Q / Morgana Q cooldowns (requested later)

| Spell | Wiki (V26.20 data template) | Wiki patch history | Ours (`champion <X> -l 11`) | |
|---|---|---|---|---|
| Lux Q, Light Binding | `cooldown = 10` (flat) | V26.04: "changed to 10 seconds at all ranks from 11 to 9" | 10/10/10/10/10 | ✓ |
| Morgana Q, Dark Binding | `cooldown = 10` (flat) | V10.16: "reduced to 10 seconds from 11"; no later change | 10/10/10/10/10 | ✓ |

Both raw bins (`LuxLightBinding`, `MorganaQ`) do omit `cooldownTime`. The wiki agrees with the assumed default of 10 s at every rank.

## Resolution (applied after this audit)

| Finding | Fix |
|---|---|
| A. Per-level lookup tables one level behind | `calc.ts` now reads `values[level]` (index 0 = level 0). Affected Braum, Graves, Katarina, Kha'Zix, Leona, Lux, Nautilus, Rengar, Sett, Yone and Presence of Mind; re-verified (e.g. Sett right punch 55 at L11, Graves L1 attack no longer 0). |
| B. `champion` / `get_champion` showed variants with the wrong spell | `describe.ts` evaluates variant components with the variant's spell (Jayce cannon Q now 80 at rank 1). Simulation was already correct. |
| C. Breakpoints without `mLevel` | Default to level 1 (minion-only formula; no champion damage affected). |
| D. Jhin attack speed growth | Jhin's kit sets attack speed from Whisper: base × (1 + 3% × level growth), ≈0.94 at L18. Whether growth feeds Whisper's bonus AD remains unverified (item bonus AS only). |
| E. Zaahen Q crit | Only the AD half of each strike crits (271 on a crit at L11 Q5, matching the wiki). |
| Missing `cooldownTime` | The bin omits it when it equals the default of 10s; the data builder now applies that default (wiki agrees for Lux Q and Morgana Q). |

## On-hit and on-attack audit (all champions)

Triggered by Smolder: Super Scorcher Breath applies on-hit effects and triggers on-attack effects,
but the kit dealt it as plain ability damage, so Essence Reaver's Spellblade never fired from it.

**Source.** The wiki's [Attack effects](https://wiki.leagueoflegends.com/en-us/Attack_effects) page
lists the abilities that apply on-hit effects and those that trigger on-attack effects. Each
ability's data template says the same in its description, e.g. "applies on-hit effects; applies life
steal at 50% effectiveness; and triggers on-attack effects". The game files don't encode either
property: Smolder's client tooltip doesn't mention on-hit.

**Engine.** On-hit and on-attack effects are now separate:
* abilities that apply on-hit (`onHit`) get on-hit effects: Spellblade, Energized procs, Kraken,
  BotRK, Heartsteel, Dead Man's Plate, Hullbreaker, Terminus, Grasp, Press the Attack;
* only basic attacks and abilities flagged `onAttack` stack on-attack effects: Guinsoo's (and its
  Phantom Hit count), Energize charges, Navori, Yun Tal, Lethal Tempo, Hail of Blades;
* Press the Attack ignores area on-hits (`areaOnHit`: Katarina's daggers and R, Evelynn's empowered
  E, Master Yi's Q), per its wiki notes.

**Audit.** `node scripts/audit-wiki.ts` compares every kit with both wiki sources and also flags
abilities the wiki says can crit. `scripts/fetch-wiki.ts` downloads them into
`data/raw/wiki/pages.json`, 50 pages per API request, and on later runs only pages whose revision
changed. Fixed:

| Kit | Was | Now |
|---|---|---|
| Smolder Q | plain ability damage | applies on-hit, triggers on-attack |
| Senna Q | plain ability damage (kit note said "on-attack, not on-hit") | applies on-hit, triggers on-attack (one champion) |
| Briar Q | plain ability damage | applies on-hit, triggers on-attack, resets the attack timer |
| Ivern R (Daisy) | "does not apply Ivern's on-hit" | Daisy's attacks apply Ivern's on-hit effects and Brushmaker bolts (wiki Ivern#Pets) |
| Ezreal Q, Gangplank Q, Miss Fortune Q (first unit), Bel'Veth E, Katarina R, Urgot W, Volibear W, Warwick Q/R, Yasuo Q, Yone Q, Zeri Q | on-hit only | also trigger on-attack |
| Katarina P/R, Evelynn empowered E, Master Yi Q | counted for Press the Attack | area on-hits (ignored by PTA) |

21 other differences were checked by hand and are modeled another way, listed with reasons in
`REVIEWED` in the script. Examples: second shots fired by hooks (Akshan, Lucian, Master Yi, Viego),
crit already in the game formula (Aphelios R, Kennen W), passive on-hit effects of basic attacks
(Braum, Blitzcrank, Jax). The audit now reports 0 unexplained differences across 173 champions.

Item and rune rules changed with it: Heartsteel, Dead Man's Plate, Umbral Glaive, Hullbreaker,
Terminus, Grasp and Press the Attack now also come from abilities that apply on-hit. Energized
procs follow the same rule ("Rapid Firecannon (damage)" is on-hit), but Energize charges come only
from on-attack. Open questions: Sundered Sky and Opening Barrage stay basic-attack-only (their crit
can't apply to ability damage). Muramana's Shock is applied as ability damage to on-hit abilities
that also deal spell damage, as its wiki notes describe, but abilities without spell effects (Yasuo
Q) should apply it as an attack instead.

Smolder R: the report that the center deals less than the edge did not reproduce. The center deals
`TooltipOnly_TotalSweetspotDamage` = TotalDamage × `SweetspotPercentageIncrease` (1.5), i.e. 150%,
matching the wiki, at every rank in the CLI, the UI (typed and dropdown) and the published page,
and in 1,500 random builds. Every ability variant was also compared with its default cast: the
only variants that deal less are the intended ones (edge, tap, uncharged, short range, other form).
