# damagesim

A League of Legends damage simulator and build optimizer. Pick a champion, items, runes, a combo and a
target, and damagesim plays the combo out on a timeline and reports every hit, using the numbers and
tooltip formulas from Riot's own game files.

**Live:** <https://gimme.github.io/damagesim/>

It comes in two forms:

- a **web UI** for players,
- a **CLI** with `--json` output, for scripts and AI agents.

Both run on the same engine.

Current data: **patch 16.20**. All 173 champions have hand-written kits. Every Summoner's Rift item is
included (85 with modeled passives or actives, the rest stats only), as are all live runes and Ignite.
See [docs/COVERAGE.md](docs/COVERAGE.md) for details.

## Contents

- [Features](#features)
- [Requirements](#requirements)
- [Installation](#installation)
- [Usage](#usage)
  - [Web UI](#web-ui)
  - [CLI](#cli)
  - [Scenario format](#scenario-format)
- [How it works](#how-it-works)
- [Limitations](#limitations)
- [Development](#development)
- [Updating to a new patch](#updating-to-a-new-patch)
- [Project structure](#project-structure)
- [Legal](#legal)

## Features

- **Full combo simulation.** Abilities, basic attacks, item actives and Ignite play out in order, with
  cast times, attack windups, missile travel, cooldowns, DoTs and stacking effects.
- **Flexible targets.** Fight a squishy, bruiser or tank preset scaled to its level, a real champion
  with items, or raw health, armor and magic resist.
- **Item value ranking.** See which item adds the most damage to your build, either per gold or in
  total, for your next slot or in place of an item you already own. It can also rank sets of several
  items bought together.
- **Build comparison.** Keep several builds side by side as tabs and compare their damage, time to kill
  and gold.
- **Shareable links.** The page's address encodes the whole setup, so you can bookmark or share a
  build.
- **Exact numbers.** Ability and item values come from the patch's game files, and the tooltip formulas
  are executed rather than retyped. No values are entered by hand.

## Requirements

- [Node.js](https://nodejs.org/) 22.18 or later. Node runs the TypeScript sources directly, so the CLI
  needs no build step.
- npm

## Installation

```bash
git clone https://github.com/gimme/damagesim.git
cd damagesim
npm install
```

The processed game data for the current patch is committed under `data/generated/`. You don't need
to download anything else to run the simulator.

## Usage

### Web UI

```bash
npm run dev      # http://localhost:5173
make dev         # the same, but reachable from other machines on your network (PORT=5173 by default)
```

The page is made of cards:

| Card           | What it holds                                                                              |
| -------------- | ------------------------------------------------------------------------------------------ |
| **Champion**   | Champion, level, ability ranks, and champion, item and rune options                        |
| **Items**      | Your build, with a shop, undo/redo and tooltips computed for your stats                    |
| **Runes**      | A rune page laid out as in the client, keeping to the game's rules                         |
| **Combo**      | The steps to play, edited by clicking or typed as [shorthand](#combo-shorthand)            |
| **Target**     | A preset, an enemy champion with items, or raw stats                                       |
| **Result**     | Health bar, timeline, breakdown by source and a resist sweep, for one build or all of them |
| **Item value** | Live ranking of the items, or sets of items, that add the most damage, as a list or a gold-vs-damage map |
| **Settings**   | Whether DoTs finish and executes kill, tier 3 boots, and components in Item value          |

Builds open as tabs in the top bar. Each tab has its own items and runes and shares the level, target
and settings with the others. The combo is shared too, unless you give each build its own.

The address holds the whole page: the champion in the path and the builds in the hash, for example
`/zed/#…`. Copy it to share the setup.

To build for production:

```bash
npm run build    # writes dist/
npm run preview  # serves dist/ locally
```

Set `BASE_PATH` when the site is served below the domain root, for example
`BASE_PATH=/damagesim/ npm run build`.

### CLI

```bash
npm run sim -- <command> [options]
# or, after `npm link`:
damagesim <command> [options]
```

| Command       | Description                                                   |
| ------------- | ------------------------------------------------------------- |
| `simulate`    | Run a combo and print the damage by source                    |
| `compare`     | Compare several item builds on the same scenario              |
| `rank-items`  | Damage each item adds to a build (`--size <n>` for item sets) |
| `optimize`    | Best *n* items from a pool                                    |
| `combo-order` | Best ordering of the combo's steps                            |
| `sweep`       | Damage as the target's armor or magic resist varies           |
| `champion`    | A champion's abilities, formulas and kit notes                |
| `champions`   | List champions and their kit status                           |
| `items`       | List items (`--search` to filter)                             |
| `runes`       | List runes                                                    |
| `scenario`    | Print the scenario JSON format                                |

Example:

```bash
npm run sim -- simulate -c Ahri -l 11 -i "Luden's Echo,Sorcerer's Shoes" -r Electrocute \
  --combo "E Q W R AA" --target squishy
```

```
source                        hits  damage    share
Orb of Deception              2     326       31.3%
Fox-Fire                      3     164       15.8%
Electrocute                   1     133       12.8%
Charm                         1     126       12.1%
Luden's Echo                  6     122       11.7%
Spirit Rush                   1     122       11.7%
Basic attack                  1     48        4.6%

TOTAL 1040 damage (48 physical, 807 magic, 185 true) = 63.6% of target HP over 1.85s  → 595 HP left
```

Add `--json` to any command for machine-readable output, `--events` to list every damage instance, and
`--scenario <file.json>` to load a full scenario. Run `damagesim --help` for every option.

### Scenario format

The CLI's `--scenario` option takes a scenario as JSON. Only `champion` and `combo` are required.

```json
{
  "champion": "Zed",
  "level": 11,
  "skillOrder": "QEW",
  "items": ["Youmuu's Ghostblade", "Serrated Dirk", "Ionian Boots of Lucidity"],
  "runes": ["Electrocute", "Sudden Impact", "Absolute Focus", 5008, 5008, 5001],
  "options": { "suddenImpact.armed": 1 },
  "combo": "W E Q AA R AA ignite",
  "target": { "preset": "squishy", "levelDiff": 0 }
}
```

Items and runes accept names, common aliases (`ie`, `botrk`) or ids. Run `damagesim scenario` for
the complete reference, including every option.

#### Targets

| Form       | Example                                                    | Notes                                                                                  |
| ---------- | ---------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| Preset     | `{ "preset": "tank", "levelDiff": 0 }`                     | Class-average base stats plus a typical build for the target's level; `items` replaces it |
| Champion   | `{ "champion": "Jinx", "levelDiff": -1, "items": ["Infinity Edge"] }` | A real champion with the given items                                        |
| Raw stats  | `{ "maxHp": 2000, "armor": 80, "mr": 50 }`                 | All base stats unless you give `bonusHp`, `bonusArmor` or `bonusMr`                    |

`levelDiff` is the target's level minus yours; `level` sets it directly. Only the stats of the
target's items count, because the target never acts.

#### Combo shorthand

| Step                    | Meaning                                                              |
| ----------------------- | -------------------------------------------------------------------- |
| `Q` `W` `E` `R` `P`     | Cast an ability (`P` for a passive step, where the kit has one)      |
| `AA`, `AA*3`            | One basic attack, or three                                           |
| `AA!`, `Q!`             | Every hit of the step that can crit does                             |
| `AA?`, `Q?`             | No hit of the step crits                                             |
| `Q:variant`             | Cast a named variant of the ability                                  |
| `Q{out:1,back:0}`       | Set how many times each part of the ability hits                     |
| `E{0.5s}`               | How long a channel, toggle or charge lasts                           |
| `R{3}`                  | How many shots an ability fires (Xerath R, Jhin R)                   |
| `Q+bonus`               | Enable an optional part of the ability                               |
| `ignite`                | Cast Ignite                                                          |
| `item:rocketbelt`       | Use an item's active                                                 |
| `energize`              | Become Energized, so the next attack fires your Energized items      |
| `wait`, `wait{1.5s}`    | Wait one second, or the given time                                   |

Unmarked crits deal their expected value.

## How it works

1. **Game data.** `scripts/fetch-data.ts` downloads the patch's champion, item, rune and summoner
   spell files from [CommunityDragon](https://www.communitydragon.org/) and Data Dragon.
   `scripts/build-data.ts` extracts base stats, per-rank ability values, item and rune values,
   tooltip strings and the tooltip formulas, and writes them to `data/generated/<patch>/`.
2. **Formulas.** `src/engine/calc.ts` evaluates Riot's formula trees (stat ratios, level scaling,
   breakpoints, buff counters) instead of transcribing them. Each number therefore matches the
   client's tooltip at the same rank, level and stats. `damagesim champion <name>` prints both side by
   side.
3. **Champion kits.** A kit in `src/kits/champions/` says which formula is dealt how: hit counts,
   empowered attacks, marks, DoTs, recasts and passives. Each kit lists its assumptions in `notes`,
   and these appear in every result. A champion without a kit, such as one added in a later patch,
   falls back to a kit generated from its tooltips until one is written. See
   [docs/KIT_AUTHORING.md](docs/KIT_AUTHORING.md).
4. **Mechanics.** Damage, penetration, crits, item and rune triggers and stacking follow patch 16.20,
   checked against the League of Legends Wiki and patch notes. The research notes, with sources, are
   in [docs/research/](docs/research/). A few examples:
   - crits deal 200%, and the attack speed cap is 3.0;
   - lethality is flat armor penetration;
   - penetration applies as flat reduction, then % reduction, then % penetration, then flat
     penetration;
   - damage-dealt amplifiers add together, while damage-taken modifiers multiply;
   - levels go up to 20 and a seventh slot holds boots, as granted by the role quests.
5. **Wiki audits.** The game files hold the numbers, not behaviour such as whether an ability applies
   on-hit effects or can crit. `npm run audit` and `npm run audit:items` compare the kits, items and
   runes with the wiki's data.

## Limitations

- **One attacker, one target.** There are no minions, monsters or allies, and healing and shields are
  not modeled. The target never moves, fights back or uses its items' passives or actives (such as
  Guardian Angel or Banshee's Veil).
- **Positioning is simplified.** The target stands at your attack range (option `distance`), which
  sets how long missiles and dashes take to reach it. Movement is otherwise ignored.
- **Crits are averaged** unless a step is marked with `!` or `?`.
- **Situational stacks are options.** Dark Harvest souls, Gathering Storm's game time, Heartsteel
  stacks, champion stacks and stacks from hits before the combo have defaults that you can override
  per scenario.
- **Item slot order doesn't matter.** Items take effect in the same order wherever they sit.
- **Undocumented behaviour** follows a best guess from the research notes and is listed in each
  result's `notes`.

## Development

### Tests

```bash
npm test                           # typecheck, engine tests and a formatting check
npx playwright install chromium    # once per machine, for the UI tests
npm run test:ui                    # the web UI's tests in headless Chromium
npm run fmt                        # format the code with Prettier
```

`npm test` covers the core math, item and rune trigger rules, a snapshot of standard combos for every
champion, and a golden test that pins every result of a fixed set of scenarios exactly. After a change
that is meant to move the numbers, record them again:

```bash
node scripts/update-snapshots.ts   # test/snapshots/champions.json
node scripts/update-golden.ts      # test/snapshots/golden.json (--dump <dir> writes each result to diff)
```

`npm run test:ui` starts a dev server on port 5173 (or `PORT`) unless one is already running. The UI
tests check behaviour, not the engine's numbers.

CI (`.github/workflows/ci.yml`) runs both test suites and a production build on every push to `main`,
and deploys the build to GitHub Pages.

### Useful scripts

| Command                                     | Description                                              |
| ------------------------------------------- | -------------------------------------------------------- |
| `node scripts/check-kits.ts [Champion...]`  | Check that every kit's formulas resolve at several levels |
| `node scripts/inspect-champion.ts <Champion>` | Print a champion's data, tooltips and formulas for kit writing |
| `node scripts/gen-coverage.ts`              | Regenerate `docs/COVERAGE.md`                            |
| `node scripts/bench.ts`                     | Time the simulator, item ranking and item search         |
| `node scripts/ui-bench.ts`                  | Time the web UI's state changes in a production build    |
| `npm run wiki`                              | Download or refresh the wiki pages used by the audits    |

## Updating to a new patch

```bash
npm run data -- 16.21            # fetch and build data/generated/16.21 and make it current
node scripts/check-kits.ts       # kits still resolve their formulas?
npm run wiki && npm run audit    # kits still match the wiki?
npm run audit:items              # items and runes still match the wiki?
npm test
```

Numbers update automatically from the new game files. Kits need edits only when a champion's
mechanics or formula names change, and `check-kits` reports any references that went missing.

## Project structure

```
src/engine/       simulation engine: formulas, stats, damage, timeline, items, runes, analysis
src/kits/         champion kits
src/cli/          command-line interface
src/web/          web UI (React, Vite)
scripts/          data pipeline, kit checks, wiki audits, benchmarks
data/generated/   processed game data per patch (data/raw/ is the download cache, not committed)
test/             engine, snapshot and golden tests; test/ui/ holds the Playwright UI tests
docs/             coverage, kit authoring guide and mechanics research
```

## Legal

damagesim isn't endorsed by Riot Games and doesn't reflect the views or opinions of Riot Games or
anyone officially involved in producing or managing Riot Games properties. Riot Games, and all
associated properties are trademarks or registered trademarks of Riot Games, Inc.
