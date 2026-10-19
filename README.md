# damagesim

A League of Legends damage simulator and item build optimizer: pick a **champion**, **level/ranks**, **items**, **runes**, a
**combo** of abilities, attacks, item actives and Ignite, and a **target**: a squishy, bruiser or
tank preset at a level relative to yours, an enemy champion with items, or raw HP/armor/MR. It plays
the combo out on a timeline and reports every damage instance.

* **Humans:** a web UI with HP bar, timeline, breakdown and a resist sweep, plus a
  live **item value** ranking: which item adds the most damage (per gold or in total) to your next
  slot or in place of an item you own, as a list (each bar split into what the item adds to your
  other damage, the damage it deals itself and the hits it adds, like Electrocute it procs, then
  struck out, what the item takes away from your other damage, like a proc it makes land later, past
  0 where that's more than it adds)
  or a gold-vs-damage map; one click buys it, an upgrade (Boots into a pair) for the difference.
  With the components setting, every component is ranked too (Serrated Dirk, to see if it's worth
  sitting on, and a Long Sword alike); one in the build ranks what's built from it in its place, for
  the rest of its price (Youmuu's Ghostblade in place of the Dirk). It
  ranks sets too: the best sets of 2 or more legendaries and boots to buy together for your empty slots
  and in place of the components you hold (3 items with 2 slots empty and a Serrated Dirk, one of them
  built from the Dirk; with 3 slots empty, sets that keep it too), found by a
  search that simulates a few hundred to a few thousand builds in a Web Worker, not every
  combination; a click on a set's item leaves it out of the ranking (listed at the top of the card,
  and in the link); how many to rank, and the item to rank in place of, are in the link too, the count
  going down by the items you buy and the pick following its item, and undo in Items brings both back. Hovering an item shows its cost, stats, passives and actives, with the numbers
  for your champion's level and stats, melee or ranged. Runes go on a rune page laid out as in the client, which keeps to the game's rules (a rune per
  row, two from the secondary tree, a shard per row); hovering a rune shows its tooltip like an item's, and whether its
  adaptive damage is physical or magic for you. The page's address is a link to its scenario: the champion in the path and
  the rest as a short code in the hash (`/zed/#…`, about 70 characters for a full build), none at the defaults.
  A champion's builds open as tabs in the top bar, each a copy of the one on screen to change: its items and runes are
  its own, the rest (level, target, settings) all of theirs, and the combo too unless each build has its own. Tabs are
  dragged into order, renamed by a double-click and closed by × or Delete. The Result card compares them: a health bar
  each, then a table of their items, totals, time to kill, gold and damage by source against the first build; folded,
  the one on screen alone. The builds are in the address too, the first build's as if it were alone and the others
  after it, a name only where it isn't its place's (`/ahri/#…~*…~….Burst`), so a link opens them as they are, and Back
  undoes Reset or a tab closed.
* **AI agents:** an MCP server (simulate, compare, rank items, optimize builds and combo order) and a
  CLI with `--json` output.
* **Accuracy:** every number comes from Riot's own game files for the patch (via CommunityDragon),
  including the exact tooltip formulas. Nothing is typed in by hand.

Current data: **patch 16.20**: all 173 champions with hand-written ("curated") kits, all Summoner's
Rift items (85 with modeled passives or actives, the rest are stats only), all live runes and Ignite. See
[docs/COVERAGE.md](docs/COVERAGE.md).

## Quick start

```bash
npm install
npm run dev                 # web UI on http://localhost:5173
npm run sim -- simulate -c Ahri -l 11 -i "Luden's Echo,Sorcerer's Shoes" -r Electrocute \
  --combo "E Q W R AA" --target squishy --events
npm test                    # typecheck, engine tests, then a formatting check
npm run fmt                 # format the code (Prettier)
npx playwright install chromium  # once per machine: the browser the UI test drives
npm run test:ui             # the web UI's smoke test, in headless Chromium, against the dev server on PORT (5173 by default), started if none is running
```

Requires Node ≥ 22.18 (runs the TypeScript sources directly; no build step for CLI/MCP).

## Using it from an AI agent (MCP)

```bash
claude mcp add damagesim -- node /absolute/path/to/damagesim/src/mcp/server.ts
```

Or in any MCP client config:

```json
{ "mcpServers": { "damagesim": { "command": "node", "args": ["/absolute/path/to/damagesim/src/mcp/server.ts"] } } }
```

Tools:

| Tool | What it does |
|---|---|
| `get_champion` | Abilities at a level: rendered tooltips, cooldowns, each damage component with its value and formula, variants, kit notes, options |
| `simulate` | Run a scenario; totals, by source/type, kill time, effective resists, warnings, model notes (`includeEvents` for every hit) |
| `compare_builds` | Same scenario, several variants (items/runes/combo/level/options), ranked |
| `rank_items` | Marginal damage of adding each legendary/boots (and each component, with `components: true`) to the current build, per 1000 gold of the item (`metric: damagePerGold` ranks by it), the part the item deals itself and the part from hits that land only with it |
| `optimize_build` | Best *n* items from a pool; respects item groups (one Spellblade, Hydra, Fatality…) |
| `optimize_combo` | Best ordering of the combo steps |
| `resist_sweep` | Damage as target armor or MR varies |
| `list_champions`, `list_items`, `get_item`, `list_runes`, `scenario_help` | Lookup and docs |

The CLI exposes the same features (`damagesim --help`); add `--json` for machine-readable output.

## Scenario format

```json
{
  "champion": "Zed", "level": 11, "skillOrder": "QEW",
  "items": ["Youmuu's Ghostblade", "Serrated Dirk", "Ionian Boots of Lucidity"],
  "runes": ["Electrocute", "Sudden Impact", "Absolute Focus", 5008, 5008, 5001],
  "options": { "suddenImpact.armed": 1 },
  "combo": "W E Q AA R AA ignite",
  "target": { "preset": "squishy", "levelDiff": 0 }
}
```

Combo shorthand: `Q W E R P`, `AA`, `AA*3`, `AA!`/`Q!` (crits), `AA?`/`Q?` (doesn't), `Q:variant`, `Q{out:1,back:0}` (hit
counts), `E{0.5s}` (how long a channel, toggle or charge lasts: Smolder E ended early, Karthus E left on, Sion Q held),
`R{3}` (Xerath or Jhin R's shots), `Q+bonus` (enable an optional hit), `ignite`, `item:rocketbelt`, `wait` (1 second),
`wait{1.5s}`. Run `damagesim scenario` for everything.

Targets:
* `{ "preset": "squishy" | "bruiser" | "tank", "levelDiff": 0 }`: the average base stats of the
  class (marksman/mage/assassin, fighter, tank) at the target's level, plus the stats of a typical
  build for that level and health shards. The item count follows the level: boots around 7, first
  item around 9, six items at 18. Builds are listed in `src/engine/presets.ts`; `items` replaces
  the typical build.
* `{ "champion": "Jinx", "levelDiff": -1, "items": ["Infinity Edge"] }`: a real champion.
* `{ "maxHp": 2000, "armor": 80, "mr": 50 }`: raw numbers, all base stats unless you give
  `bonusHp`/`bonusArmor`/`bonusMr` (the bonus part of each total). On a preset or champion, a total
  keeps its base and puts the rest in bonus, and a bonus is added to its base.

Only the stats of a target's items count: it never fights back, so their passives and actives
(Guardian Angel's revive, Banshee's Veil's spell shield) don't apply.

`levelDiff` is the target's level minus yours; `level` sets an absolute level instead.

## How accuracy is achieved

1. **Game data, not wiki numbers.** `scripts/fetch-data.ts` downloads the champion, item, rune and
   summoner-spell bin files for the patch from CommunityDragon. `scripts/build-data.ts` extracts:
   * champion base stats and growth (including fields Data Dragon gets wrong),
   * every ability's per-rank data values **and the tooltip formulas** (`mSpellCalculations` trees),
   * item stats, data values and formulas; rune values and formulas; tooltip strings.
   Hashed names in the data are resolved with Riot's FNV-1a hash.
2. **Formulas are executed, not transcribed.** `src/engine/calc.ts` evaluates Riot's formula trees
   (stat ratios, level interpolation, breakpoints, buff counters, ranged multipliers…). A component's
   number equals the client tooltip's number at the same rank, level and stats. `damagesim champion X`
   prints both, side by side.
3. **Game mechanics follow patch 16.20.** Checked against the official wiki and patch notes
   (`docs/research/`):
   * crit damage is 200% (IE +30%); the attack speed cap is 3.0; lethality is 1:1 flat penetration;
   * penetration order is flat reduction → % reduction → % penetration → flat penetration;
   * damage-dealt amplifiers add together since 26.9, while damage-taken modifiers multiply;
   * levels go up to 20 (Top role quest), boots get a seventh slot of their own (Bot role quest), and
     tier 3 boots (Mid role quest) are offered with a setting, in place of the pairs they're upgraded
     from, which it swaps in every build as it's turned on or off; Ignite is 70–475;
   * an item built from one you have takes its place, for the difference in gold (Boots into a pair);
   * item and rune trigger rules, damage types and stacking are modeled, including item groups.
4. **Champion kits** (`src/kits/champions/`) say *which* formula is dealt *how*: hit counts,
   empowered attacks, marks, DoTs, CC, recasts, charges and passives. All 173 are `curated`, written
   against the data, rendered tooltips and wiki, with each kit's assumptions listed in its `notes`. These
   notes appear in every result. A champion added in a future patch falls back to an `auto` kit derived from
   tooltips (per-hit values exact, hit counts and conditions best-effort) until it is curated.
5. **Tests** (`npm test`):
   * core math pinned to known values;
   * item and rune trigger rules;
   * a snapshot of three standard combos for every champion, so engine changes can't move numbers
     unnoticed (`node scripts/update-snapshots.ts` after an intended change);
   * a golden test: every champion in five scenarios (`test/corpus.ts`) and five item rankings give
     the results recorded in `test/snapshots/golden.json`, each whole, every event in order to the
     last bit. It guards changes meant to change nothing, such as optimizations; after an intended
     change, `node scripts/update-golden.ts` records them again (its `--dump <dir>` writes each
     result's JSON, to diff what changed).

   Speed: `node scripts/bench.ts` times the simulator over the same scenarios (setup and run, by
   champion), the item ranking and the item search; `node scripts/ui-bench.ts` times the web UI's
   state changes in a production build in headless Chromium, the main thread's time by what it did
   (the page's simulation, Item value's ranking, React, the browser's own work) and the latency.

   The web UI has a smoke test of its own, `npm run test:ui` (Playwright, not part of `npm test`):
   scenarios in `test/ui/` drive every card in headless Chromium, against the dev server on `PORT`
   (5173 by default, as for `make dev`; started if none is running), and check after each step that it
   did what it should: a pick shows the champion and changes the result, a buy fills its slot, a drag
   reorders, undo restores, a hover card names its item. They check behaviour, not the engine's
   numbers (the champion snapshots own those), and in every test that the console stays empty.

   `node scripts/check-kits.ts` validates every kit's formulas at several levels. `npm test` also checks
   that the code is formatted; `npm run fmt` formats it (Prettier, configured in `.prettierrc`).
6. **Behaviour the game files don't encode** is checked against the wiki. The files hold the
   numbers, but not whether an ability applies on-hit effects or triggers on-attack effects, or
   whether it can crit. `npm run wiki` downloads the wiki pages damagesim is checked against: every
   ability's data, the items, runes and their articles, champion stats and "Attack effects".
   It fetches 50 pages per request (about 60 requests, a minute) and on later runs only pages that
   changed (about 15 requests). `npm run audit` then compares every kit with the ability
   descriptions and the "Attack effects" lists. `npm run audit:items` does the same for items and
   runes: it plays every item and rune through a set of probe combos and compares what it does
   (damage type, on-hit, ability or proc damage, cooldowns) and the item stats with the wiki's item
   data, rune data and article notes.

## Model, assumptions and limits

* **One attacker against one target champion.** No minions, monsters, allies, healing or shields,
  and the target never fights back.
* **Timing.** Casts take the wiki's cast times (instant ones, like Garen Q, none) and attacks use
  your attack speed and windup. The target stands at your attack range (option `distance`), so
  missiles and dashes at it fly that far at their speed (attacks too), and a grenade can land
  after the attack that follows it or before (Jhin Q then AA). Dashes without a speed on the wiki
  take a rough duration. Attack-move and positioning are otherwise ignored. Energize charges,
  mostly from moving, aren't simulated: you're Energized as the combo starts (option
  `energized.ready`, which unset starts you without), and again after each `energize` step.
* **Empowered attacks** (Garen Q, Darius W) show the attack's normal damage as the attack's and
  only the extra as the ability's, like bonus on-hit damage (Vayne Q). The health bar names such an
  attack after the ability, listed first.
* **On-hit vs on-attack.** Abilities the wiki lists as applying on-hit effects get item and rune
  on-hit effects. Only basic attacks and abilities that also trigger on-attack effects stack
  Guinsoo's, Lethal Tempo and similar. A champion's own passive on-hit applies
  to its abilities only where the kit lists it (Warwick Q/R, Fizz Q).
* **Crits** deal their expected value. Mark steps to fix them: `AA!`/`Q!` crit, `AA?`/`Q?` don't.
  A mark holds for everything the step causes, follow-up attacks included (Akshan's second shot,
  Lucian's Lightslinger).
* **Situational stacks** are options with defaults: Dark Harvest souls, Legend stacks, Gathering
  Storm game time, Heartsteel stacks, champion stacks (Nasus, Veigar…), and stacks from hits just
  before the combo (Kraken Slayer, Guinsoo's, Black Cleaver, Conqueror, Lethal Tempo, Press the Attack…; none
  by default). See `get_champion`
  and `scenario_help`.
* **Item slots don't matter.** Items take effect in one order, by id, wherever they sit, so an
  attack's on-hits land in the same order in any build order (the wiki gives them none).
* **Behaviour the wiki doesn't document** follows the research notes' best guess and is listed in
  each result's `notes`. Examples: First Strike's bonus is not re-amplified; Kraken's missing-HP
  scaling is linear.

## Updating to a new patch

```bash
npm run data -- 16.21        # fetch + build data/generated/16.21 and make it current
node scripts/check-kits.ts   # kits still resolve their formulas?
npm run wiki && npm run audit  # refresh changed wiki pages; kits still match on-hit/on-attack/crit?
npm run audit:items          # items and runes still match the wiki?
npm test
```

Numbers update automatically from the new game files. Kits only need edits when a champion's
mechanics or formula names changed; `check-kits` flags any references that went missing.

## Project layout

```
scripts/        fetch-data, build-data, update-data, inspect-champion, check-kits, gen-kit-index,
                gen-coverage, update-snapshots, update-golden, bench + ui-bench (speed),
                fetch-wiki + audit-wiki, audit-items (kit, item and rune behaviour vs the wiki)
data/generated/ processed game data per patch (committed); data/raw is the download cache (game files, wiki)
src/engine/     calc (formula interpreter), expr, stats, damage, sim (timeline), items, runes,
                rune-page (what a page holds), summoners, autokit, analysis (compare/rank/optimize),
                describe, tooltip
src/kits/       champion kits (curated) + registry
src/cli/        damagesim CLI
src/mcp/        MCP server
src/web/        React UI (Vite)
docs/           KIT_AUTHORING.md, COVERAGE.md, research/ (mechanics notes with sources)
test/           engine, mechanics, per-champion snapshot and golden tests; ui/ the web UI's smoke test (Playwright)
```
