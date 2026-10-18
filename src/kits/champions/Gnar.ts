import type { BuffSpec, ChampionKit } from "../../engine/kit-types.ts";

// Gnar — patch 16.20.
// Forms: Mini Gnar is the default. Mega Gnar is a buff that swaps Mini's passive stats for Mega's and
// disables Hyper; Q and E cast Mega's spells while it lasts. Rage is not tracked: the combo decides
// when Gnar is Mega, by a P step (Rage full) or a Mega-only cast (W, R).

const MEGA_DURATION = 15; // tooltip: "transforms him into Mega Gnar for 15 seconds"

const mega: BuffSpec = {
  id: "megaGnar",
  label: "Mega Gnar",
  duration: MEGA_DURATION,
  stats: {
    hp: "P.calc.TotalMegaGnarHealth",
    armor: "P.calc.TotalMegaGnarArmor",
    mr: "P.calc.TotalMegaGnarMR",
    ad: "P.calc.TotalMegaGnarAD",
    // Remove Mini Gnar's passive bonuses (granted in `stats`).
    attackSpeed: "-P.calc.TotalAS",
    range: "-P.calc.TotalAttackRange",
    msFlat: "-P.calc.TotalMS",
  },
};

const kit: ChampionKit = {
  id: "Gnar",
  status: "curated",
  notes: [
    "Mini Gnar by default. Rage generation is not modeled: cast P when Rage is full to turn Mega for 15s; W (Wallop) and R, Mega only, also do (each Mega cast refreshes it). In Mega form Q and E cast Boulder Toss and Crunch.",
    "Hyper (Mini only): every third attack or ability hit (one per cast) deals W.calc.MiniTotalDamage + W.dv.MiniPercentHPDamage max health magic damage.",
    "Boomerang Throw: a single target is hit once (each enemy only once per throw).",
  ],
  stats: ({ evalExpr }) => ({
    attackSpeed: evalExpr("P.calc.TotalAS"),
    range: evalExpr("P.calc.TotalAttackRange"),
    msFlat: evalExpr("P.calc.TotalMS"),
  }),
  marks: [
    {
      id: "hyper",
      label: "Hyper",
      // W's spec spell is Mega Gnar's Wallop, so Mini Gnar's Hyper values are read from spell GnarW.
      slot: "W",
      maxStacks: "spell['GnarW'].dv.MiniMaxStacks + 1",
      duration: "spell['GnarW'].dv.MiniMarkDuration",
      appliedBy: ["attack", "ability"],
      stacksPerHit: "buff.megaGnar || W.rank == 0 ? 0 : 1",
      atMax: {
        consume: true,
        components: [
          {
            id: "hyper",
            label: "Hyper",
            type: "magic",
            amount: "spell['GnarW'].calc.MiniTotalDamage + spell['GnarW'].dv.MiniPercentHPDamage * target.maxHp",
            proc: true,
          },
        ],
      },
    },
  ],
  abilities: {
    P: { name: "Rage", noTarget: true, buff: mega, components: [], notes: ["Rage full: Gnar turns Mega for 15s."] },
    Q: {
      name: "Boomerang Throw",
      cc: [{ kind: "slow", duration: "dv.SlowDuration" }],
      // Launched as the cast time starts ({{Effect at cast time start}}); no speed in the data: the
      // wiki's boomerang slows from 2500 to 1400 (-3000/s², reached after 715 units) on its way to the
      // target.
      components: [
        {
          id: "boomerang",
          label: "Boomerang Throw",
          type: "physical",
          amount: "calc.MiniTotalDamage",
          travel: "(2500 - sqrt(2500 * 2500 - 6000 * min(reach, 715))) / 3000 + max(0, reach - 715) / 1400 - castTime",
        },
      ],
      variants: {
        mega: {
          label: "mega",
          name: "Boulder Toss",
          when: `buff.${mega.id}`,
          note: "Boulder Toss (Mega Gnar).",
          buff: mega,
          // Boulder Toss's own spell: 0.5s cast time; thrown as it starts ({{Effect at cast time start}}),
          // it flies to the target at its speed.
          castTime: "spell['GnarBigQ'].castTime",
          cc: [{ kind: "slow", duration: "dv.MegaSlowDuration" }],
          components: [
            {
              id: "boulder",
              label: "Boulder Toss",
              type: "physical",
              amount: "calc.MegaTotalDamage",
              aoe: true,
              travel: "spell['GnarBigQ'].reach / spell['GnarBigQ'].missileSpeed - spell['GnarBigQ'].castTime",
            },
          ],
        },
      },
    },
    W: {
      // Mini Gnar's W is passive (Hyper, a mark above); the castable W is Mega Gnar's Wallop.
      spell: "GnarBigW",
      name: "Wallop",
      buff: mega,
      notes: ["Wallop (Mega Gnar only)."],
      cc: [{ kind: "immobilize", duration: "spell['GnarW'].dv.MegaStunDuration" }],
      components: [{ id: "wallop", label: "Wallop", type: "physical", amount: "spell['GnarW'].calc.MegaTotalDamage", aoe: true }],
    },
    E: {
      name: "Hop",
      dash: true,
      notes: ["Mini: bounces off the target (damage + brief slow) and gains attack speed."],
      buff: { id: "gnarE", label: "Hop", duration: "dv.MiniASDuration", stats: { attackSpeed: "dv.MinibAS" } },
      // No dash speed in the data: the leap takes dv.TravelTime, then he bounces off the target as
      // far again (assumed as long). Boomerang Throw can be cast during the dash (wiki).
      attackLockout: "2 * dv.TravelTime",
      cc: [{ kind: "slow", duration: "dv.SlowDuration" }],
      components: [{ id: "hop", label: "Hop", type: "physical", amount: "calc.MiniTotalDamage", delay: "dv.TravelTime" }],
      variants: {
        mega: {
          label: "mega",
          name: "Crunch",
          when: `buff.${mega.id}`,
          note: "Crunch (Mega Gnar).",
          dash: true,
          // No dash speed in the data: the leap takes Hop's dv.TravelTime.
          lockout: "dv.TravelTime",
          buff: mega,
          cc: [{ kind: "slow", duration: "dv.SlowDuration" }],
          components: [{ id: "crunch", label: "Crunch", type: "physical", amount: "calc.MegaTotalDamage", aoe: true, delay: "dv.TravelTime" }],
        },
      },
    },
    R: {
      buff: mega,
      notes: ["Mega Gnar only. Default: knocked back without hitting a wall (~0.4s displacement, then slowed); R:wall for the wall stun."],
      cc: [
        { kind: "immobilize", duration: 0.4 },
        { kind: "slow", duration: "dv.RCCDuration" },
      ],
      components: [{ id: "gnar", label: "GNAR!", type: "physical", amount: "calc.Damage", aoe: true }],
      variants: {
        wall: {
          label: "wall",
          note: "Knocked into a wall: more damage and a stun.",
          buff: mega,
          cc: [{ kind: "immobilize", duration: "dv.RCCDuration" }],
          components: [{ id: "gnar", label: "GNAR! (wall)", type: "physical", amount: "calc.WallDamage", aoe: true }],
        },
      },
    },
  },
};
export default kit;
