// Scenario format documentation (shown by `damagesim scenario` and the MCP server).

export const SCENARIO_HELP = `Scenario JSON (all fields except champion and combo are optional):
{
  "champion": "Ahri",                 // name or id (case/punctuation-insensitive; "wukong", "kaisa" ok)
  "level": 11,                        // 1-20 (20 needs the Top lane role quest)
  "ranks": { "Q": 5, "W": 2, "E": 1, "R": 2 },   // default: R at 6/11/16, maxed in skillOrder
  "skillOrder": "QWE",
  "items": ["Luden's Echo", "Sorcerer's Shoes", 3089],   // names, aliases (dcap, botrk, ie…) or ids
  "runes": ["Electrocute", "Cheap Shot", 5008, 5008, 5001],  // ids or names; a rune page (warnings name what isn't):
                                      // a keystone and a rune per row of its tree, two runes from different rows
                                      // of another tree, and a shard per shard row (list_runes / damagesim runes)
  "options": { "darkHarvest.souls": 10, "self.hpPercent": 50 },  // champion/item/rune parameters
  "combo": "E Q W R AA ignite",       // or an array of steps (below)
  "target": {                         // either a preset…
    "preset": "tank", "levelDiff": 0, "hpPercent": 100
    // squishy | bruiser | tank: class-average base stats + a typical build for the target's level
    // (boots ~lvl 7, first item ~9, 6 items at 18; "items" replaces it) + health shards.
    // levelDiff: target level minus yours. Only the items' stats count, not their passives.
    // …or a champion: "champion": "Jinx", "levelDiff": -1, "items": ["Infinity Edge"]  ("level" = absolute)
    // …or raw stats: "maxHp": 2000, "armor": 80, "bonusArmor": 30, "mr": 50, "bonusMr": 10, "bonusHp": 600,
    //   "damageReduction": 0. Totals (maxHp, armor, mr) include the bonus parts; raw numbers are all base
    //   unless a bonus is given. On a preset or champion, a total keeps its base and puts the rest in
    //   bonus, and a bonus is added to its base.
  },
  "settings": {
    "finishDots": true,               // keep simulating burns/bleeds after the last step (else they stop 3s after it)
    "executes": true,                 // executes kill below their health line (else they deal nothing)
    "waitForCooldowns": true          // repeated abilities wait for their cooldown
  }
}

Combo steps (array form):
  { "type": "ability", "slot": "Q", "variant": "empowered", "hits": { "componentId": 2 }, "enable": ["optionalComponentId"], "miss": false, "crit": true }
  { "type": "ability", "slot": "E", "duration": 0.5 }   // seconds, or "count": 3: see E{0.5s} below
  { "type": "attack", "count": 3, "crit": true }
  { "type": "summoner", "spell": "ignite" }
  { "type": "energize" }                                // Energize charges full: the next attack is Energized
  { "type": "item", "item": "Hextech Rocketbelt" }
  { "type": "wait", "seconds": 1.5 }

Combo shorthand: "Q W E R P AA AA*3 3AA AA! AA? Q! Q? Q:variant Q{out:1,back:0} E{0.5s} R{3} Q+bonus ignite energize item:rocketbelt wait wait{1.5s}"
  (crits deal their expected value; ! crits every hit of the step that can crit, ? none, follow-up attacks included)
  E{0.5s}: how long a cast lasts where the player chooses it: a channel ended early (Smolder E,
  Katarina R), a toggle left on (Karthus E), or a charge held (Sion Q{1s}, Varus Q{0s}). R{3}: how
  many shots Xerath R or Jhin R fires. Q{id:N} sets one component's hits. wait = 1 second.
  energize: Energize charges aren't counted (most come from moving); this makes you Energized, so
  the next attack (or Voltaic's Galvanize) fires your Energized items.
  A number past what the cast allows runs as the nearest it does, with a warning.

Common options: self.hpPercent (your HP in %, for Last Stand etc.), gameTime (minutes; Gathering Storm,
Conditioning), distance (to the target; Arcane Comet, Hexoptics C44, Horizon Focus), legend.stacks,
darkHarvest.souls, aery.cycle, grasp.charged, firstStrike.active, suddenImpact.armed, energized.ready
(0/1, default 1: Energized as the combo starts), heartsteel.ready, heartsteel.stacks, glory.stacks, rodofages.stacks, yuntal.crit,
deadmans.stacks, luden.targets, combat.seconds (seconds already in combat when the combo starts, 0-4;
Liandry's, Riftmaker and Haunting Guise ramp, Grasp's charge), stacks from hits just before the
combo (default 0; 2 Kraken stacks proc on the first attack): kraken.stacks (0-2), guinsoo.stacks
(0-6: 4 is full, 6 makes the first attack a Phantom Hit), hullbreaker.stacks (0-4), terminus.stacks
(0-3), shojin.stacks (0-4), blackCleaver.stacks (0-5), bloodletter.stacks (0-4), conqueror.stacks
(0-12), lethalTempo.stacks (0-6), pressTheAttack.stacks (0-3: 2 procs on the first attack, 3 procced
just before), plus champion-specific options listed by "damagesim champion <name>" (e.g. stack counts).`;
