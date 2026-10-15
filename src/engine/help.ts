// Scenario format documentation (shown by `lolsim scenario` and the MCP server).

export const SCENARIO_HELP = `Scenario JSON (all fields except champion and combo are optional):
{
  "champion": "Ahri",                 // name or id (case/punctuation-insensitive; "wukong", "kaisa" ok)
  "level": 11,                        // 1-20 (20 needs the Top lane role quest)
  "ranks": { "Q": 5, "W": 2, "E": 1, "R": 2 },   // default: R at 6/11/16, maxed in skillOrder
  "skillOrder": "QWE",
  "items": ["Luden's Echo", "Sorcerer's Shoes", 3089],   // names, aliases (dcap, botrk, ie…) or ids
  "runes": ["Electrocute", "Cheap Shot", 5008, 5008, 5001],  // keystone, minors and shards (ids or names)
  "options": { "darkHarvest.souls": 10, "self.hpPercent": 0.5 },  // champion/item/rune parameters
  "combo": "E Q W R AA ignite",       // or an array of steps (below)
  "target": {                         // either a preset…
    "preset": "tank", "levelDiff": 0, "hpPercent": 1
    // squishy | bruiser | tank: class-average base stats + a typical build for the target's level
    // (boots ~lvl 7, first item ~9, 6 items at 18) + health shards. levelDiff: target level minus yours.
    // …or a champion: "champion": "Jinx", "levelDiff": -1, "items": ["Infinity Edge"]  ("level" = absolute)
    // …or raw stats: "maxHp": 2000, "armor": 80, "bonusArmor": 30, "mr": 50, "bonusMr": 10, "bonusHp": 600,
    //   "damageReduction": 0. Raw fields also override a preset's or champion's numbers.
  },
  "settings": {
    "finishDots": true,               // keep simulating burns/bleeds after the last step (else they stop 3s after it)
    "waitForCooldowns": true,         // repeated abilities wait for their cooldown
    "priorCombatTime": 0,             // seconds already in combat (Liandry's/Riftmaker ramp)
    "ampStacking": "additive"         // additive (live since 26.9) | multiplicative
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

Common options: self.hpPercent (your HP, for Last Stand etc.), gameTime (minutes; Gathering Storm),
legend.stacks, darkHarvest.souls, comet.distance, aery.cycle, grasp.charged, firstStrike.active,
suddenImpact.armed, energized.start (0-100), heartsteel.ready, heartsteel.stacks, glory.stacks,
rodofages.stacks, yuntal.crit, deadmans.stacks, luden.targets, abilityDistance, attackDistance,
plus champion-specific options listed by "lolsim champion <name>" (e.g. stack counts).`;
