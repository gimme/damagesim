// Scenario format documentation (shown by `damagesim scenario` and the MCP server).

export const SCENARIO_HELP = `Scenario JSON (all fields except champion and combo are optional):
{
  "champion": "Ahri",                 // name or id (case/punctuation-insensitive; "wukong", "kaisa" ok)
  "level": 11,                        // 1-20 (20 needs the Top lane role quest)
  "ranks": { "Q": 5, "W": 2, "E": 1, "R": 2 },   // default: R at 6/11/16, maxed in skillOrder
  "skillOrder": "QWE",
  "items": ["Luden's Echo", "Sorcerer's Shoes", 3089],   // names, aliases (dcap, botrk, ie…) or ids
  "runes": ["Electrocute", "Cheap Shot", 5008, 5008, 5001],  // keystone, minors and shards (ids or names)
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
    "waitForCooldowns": true          // repeated abilities wait for their cooldown
  }
}

Combo steps (array form):
  { "type": "ability", "slot": "Q", "variant": "empowered", "hits": { "componentId": 2 }, "enable": ["optionalComponentId"], "miss": false, "crit": true }
  { "type": "attack", "count": 3, "crit": true }
  { "type": "summoner", "spell": "ignite" }
  { "type": "item", "item": "Hextech Rocketbelt" }
  { "type": "wait", "seconds": 1.5 }

Combo shorthand: "Q W E R P AA AA*3 3AA AA! AA? Q! Q? Q:variant Q{out:1,back:0} Q+bonus ignite item:rocketbelt wait:1.5"
  (crits deal their expected value; ! crits every hit of the step that can crit, ? none, follow-up attacks included)

Common options: self.hpPercent (your HP in %, for Last Stand etc.), gameTime (minutes; Gathering Storm,
Conditioning), distance (to the target; Arcane Comet, Hexoptics C44, Horizon Focus), legend.stacks,
darkHarvest.souls, aery.cycle, grasp.charged, firstStrike.active, suddenImpact.armed, energized.start
(0-100), heartsteel.ready, heartsteel.stacks, glory.stacks, rodofages.stacks, yuntal.crit,
deadmans.stacks, luden.targets, combat.seconds (seconds already in combat when the combo starts, 0-4;
Liandry's, Riftmaker and Haunting Guise ramp, Grasp's charge),
plus champion-specific options listed by "damagesim champion <name>" (e.g. stack counts).`;
