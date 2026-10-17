import type { ChampionKit, ComponentSpec, DebuffSpec } from "../../engine/kit-types.ts";
import type { Sim } from "../../engine/sim.ts";

// Aphelios — patch 16.20.
// Weapons: 1 Calibrum, 2 Severum, 3 Gravitum, 4 Infernum, 5 Crescendum. The main-hand / off-hand
// weapons start from the options and are kept in counters 'aphMain' / 'aphOff' (W swaps them), so
// Q, R and attack effects follow the weapon currently in the main hand.
const WEAPONS = ["calibrum", "severum", "gravitum", "infernum", "crescendum"] as const;
const CAL = "spell['ApheliosCalibrumQ']";
const SEV = "spell['ApheliosSeverumQ']";
const GRA = "spell['ApheliosGravitumQ']";
const INF = "spell['ApheliosInfernumQ']";
const CRE = "spell['ApheliosCrescendumQ']";

/** Sum of the per-chakram AD ratios: decreasing from MiniDamageRatioMax by MiniDamageRatioDecPer down to MiniDamageRatioMin. */
const chakramRatio = (() => {
  const n = "opt.chakrams";
  const m = `min(${n}, floor((${CRE}.dv.MiniDamageRatioMax - ${CRE}.dv.MiniDamageRatioMin) / ${CRE}.dv.MiniDamageRatioDecPer) + 1)`;
  return `(${m} * ${CRE}.dv.MiniDamageRatioMax - ${CRE}.dv.MiniDamageRatioDecPer * ${m} * (${m} - 1) / 2 + max(0, ${n} - ${m}) * ${CRE}.dv.MiniDamageRatioMin)`;
})();

const severumHits = `floor(${SEV}.calc.NumAttacks)`;

// Weapon Q cooldowns: the *QCD calcs already include ability haste (cooldownMultiplier), so divide it
// back out — the engine applies haste to the base cooldown.
const WEAPON_CD = [`${CAL}.calc.CalibrumQCD`, `${SEV}.calc.SeverumQCD`, `${GRA}.calc.GravitumQCD`, `${INF}.calc.InfernumQCD`, `${CRE}.calc.CrescendumQCD`].map(
  (cd) => `${cd} * (1 + ah / 100)`,
);

// Each weapon's Q has its own cast time (its spell's).
const WEAPON_CT = [CAL, SEV, GRA, INF, CRE].map((sp) => `${sp}.castTime`);
// Moonshot flies to the target at 1850 (wiki; no speed in the data).
const MOONSHOT = `${CAL}.castTime + ${CAL}.reach / 1850`;
// Moonlight Vigil is fired as its cast time starts (wiki: {{Effect at cast time start}}).
const R_TRAVEL = "reach / missileSpeed - castTime";
// Wiki: Onslaught keeps Phase and Moonlight Vigil from being cast (he can move); Duskwave keeps him
// from attacking until its volley (0.25s after the wave) has resolved.
const SEV_LOCK = `${SEV}.dv.Duration`;
const INF_LOCK = `${INF}.castTime + 0.25`;

/** Q components per weapon; `gate` limits them to the weapon currently in the main hand. */
const weaponQ = (w: number, gate: boolean): ComponentSpec[] => {
  const hits = (h: string | number) => (gate ? `stacks.aphMain == ${w} ? ${h} : 0` : h);
  switch (w) {
    case 1:
      return [{ id: "moonshot", label: "Moonshot", type: "physical", amount: `${CAL}.calc.SpellDamage`, hits: hits(1), travel: `${CAL}.reach / 1850` }];
    case 2:
      return [
        {
          id: "onslaught",
          label: "Onslaught",
          type: "physical",
          amount: `${SEV}.calc['{9480e64f}']`,
          hits: hits(severumHits),
          interval: `${SEV}.dv.Duration / ${severumHits}`,
          canCrit: true,
          sameCast: false,
          onHit: true,
          onHitEffectiveness: 0.25,
        },
      ];
    case 3:
      return [{ id: "eclipse", label: "Binding Eclipse", type: "magic", amount: `${GRA}.calc.Damage`, hits: hits(1) }];
    case 4:
      return [
        // Wiki: the wave sweeps the cone over the cast time; the volley follows 0.25s later.
        { id: "duskwave", label: "Duskwave", type: "physical", amount: `${INF}.calc.QWaveDamage`, hits: hits(1), aoe: true },
        { id: "volley", label: "Duskwave (off-hand attack)", type: "physical", amount: "ad", hits: hits(1), delay: 0.25, canCrit: true, onHit: true },
      ];
    default:
      return [
        {
          id: "sentry",
          label: "Sentry",
          type: "physical",
          amount: `${CRE}.calc.TurretDamage`,
          hits: hits(`floor(${CRE}.dv.TurretDurationActive * as)`),
          interval: "1 / as",
          // Wiki: the sentry arms 0.35s after it is deployed.
          delay: 0.35,
          canCrit: true,
          pet: true,
        },
      ];
  }
};

const calibrumMark = (bonus: string): DebuffSpec => ({
  id: "calibrumMark",
  label: "Calibrum mark",
  duration: `${CAL}.dv.MarkDuration`,
  consume: { by: "attack", components: [{ id: "mark", label: "Calibrum mark", type: "physical", amount: `${CAL}.calc.BonusDamagePerMark${bonus}` }] },
});

/** Effects of a Q / R with the given weapon that depend on the weapon (marks, crowd control). */
const weaponEffects = (sim: Sim, slot: "Q" | "R", weapon: number, castId: number, delay: number) => {
  sim.schedule(delay, () => {
    if (weapon === 1) sim.applyDebuff(calibrumMark(slot === "R" ? " + R.dv.CalibrumRMarkBonusDamage" : ""), slot, sim.spellFor(slot), sim.rankOf(slot), castId);
    if (weapon === 3 && slot === "Q") sim.applyCC("immobilize", sim.evalExpr(`${GRA}.dv.RootDuration`, { slot: "Q" }), castId, "Q");
    if (weapon === 3 && slot === "R") sim.applyCC("slow", sim.evalExpr(`${GRA}.dv.SlowDuration`, { slot: "R" }), castId, "R");
  });
};

/** Rank-up stat points: every level except the ultimate levels; rank k needs level 1/2/3/5/7/9. */
const RANK_LEVEL = [1, 2, 3, 5, 7, 9];
const statRanks = (level: number, opt: Record<string, number>) => {
  let points = level - [6, 11, 16].filter((l) => level >= l).length;
  const cap = RANK_LEVEL.filter((l) => level >= l).length;
  const out: number[] = [];
  for (const key of ["adRanks", "asRanks", "lethalityRanks"]) {
    const given = opt[key] ?? -1;
    const r = given >= 0 ? Math.min(given, 6) : Math.max(0, Math.min(cap, points));
    out.push(r);
    points -= r;
  }
  return out;
};

const kit: ChampionKit = {
  id: "Aphelios",
  status: "curated",
  options: [
    {
      key: "weapon",
      label: "Main-hand weapon",
      default: 1,
      min: 1,
      max: 5,
      step: 1,
      description: "1 Calibrum, 2 Severum, 3 Gravitum, 4 Infernum, 5 Crescendum.",
    },
    { key: "offhand", label: "Off-hand weapon", default: 2, min: 1, max: 5, step: 1, description: "Swapped in by W." },
    {
      key: "chakrams",
      label: "Crescendum chakrams",
      default: 0,
      min: 0,
      max: 20,
      step: 1,
      description: "Bonus attack damage while Crescendum is in the main hand.",
    },
    { key: "adRanks", label: "AD rank-ups (-1 = auto)", default: -1, min: -1, max: 6, step: 1 },
    { key: "asRanks", label: "Attack speed rank-ups (-1 = auto)", default: -1, min: -1, max: 6, step: 1 },
    { key: "lethalityRanks", label: "Lethality rank-ups (-1 = auto)", default: -1, min: -1, max: 6, step: 1 },
  ],
  notes: [
    'Weapons via options "weapon"/"offhand" (1 Calibrum, 2 Severum, 3 Gravitum, 4 Infernum, 5 Crescendum); W swaps them; Q/R/attacks use the current main hand. Ammo and weapon rotation are not modeled.',
    "Rank-ups: auto = AD first, then attack speed, then lethality (one point per non-ultimate level).",
    "Calibrum: Moonshot (and R with Calibrum) marks the target; the next attack consumes it (the mark hit does not apply on-hit here).",
    "Severum Onslaught hits apply on-hit at 25%; Infernum Q and R follow-up attacks at full effectiveness. Severum healing is not modeled.",
  ],
  stats: ({ level, opt, evalExpr }) => {
    const [ad, as, leth] = statRanks(level, opt);
    return { ad: ad * evalExpr("P.dv.ADPerRank"), attackSpeed: as * evalExpr("P.dv.ASPerRank"), lethality: leth * evalExpr("P.dv.APPerRank") };
  },
  attack: {
    damageMult: `stacks.aphMain == 4 ? ${INF}.dv.InfernumDamageMultiplier : 1`,
    onHit: [
      {
        id: "chakrams",
        label: "Crescendum chakrams",
        type: "physical",
        amount: `${chakramRatio} * ad`,
        hits: "stacks.aphMain == 5 && opt.chakrams > 0 ? 1 : 0",
        canCrit: true,
      },
    ],
  },
  abilities: {
    P: { notes: ["Weapon effects and rank-up stats (see notes/options)."] },
    Q: {
      spell: "ApheliosCalibrumQ",
      name: "Weapon ability",
      notes: [
        "Uses the main-hand weapon; Q:calibrum / Q:severum / Q:gravitum / Q:infernum / Q:crescendum force one.",
        "Severum: floor(NumAttacks) hits over 1.75s, can crit, on-hit at 25%. Gravitum: root (needs the Gravitum slow). Infernum: wave + one off-hand attack (on-hit). Crescendum: turret attacks for 4s at your attack speed.",
        "Each weapon has its own cooldown (its *QCD calc); swapping with W keeps the other weapon's cooldown.",
      ],
      cooldown: `${["", ...WEAPON_CD.slice(0, 4).map((cd, i) => `stacks.aphMain == ${i + 1} ? ${cd} : `)].join("")}${WEAPON_CD[4]}`,
      castTime: `${["", ...WEAPON_CT.slice(0, 4).map((ct, i) => `stacks.aphMain == ${i + 1} ? ${ct} : `)].join("")}${WEAPON_CT[4]}`,
      castLockout: { W: `stacks.aphMain == 2 ? ${SEV_LOCK} : 0`, R: `stacks.aphMain == 2 ? ${SEV_LOCK} : 0` },
      attackLockout: `stacks.aphMain == 4 ? ${INF_LOCK} : 0`,
      components: [1, 2, 3, 4, 5].flatMap((w) => weaponQ(w, true)),
      variants: Object.fromEntries(
        WEAPONS.map((name, i) => [
          name,
          {
            label: name,
            cooldown: WEAPON_CD[i],
            castTime: WEAPON_CT[i],
            castLockout: i === 1 ? { W: SEV_LOCK, R: SEV_LOCK } : {},
            attackLockout: i === 3 ? INF_LOCK : 0,
            components: weaponQ(i + 1, false),
          },
        ]),
      ),
    },
    W: { noTarget: true, notes: ["Swaps main-hand and off-hand weapons."] },
    E: { spell: "ApheliosE", noTarget: true, notes: ["Aphelios has no E ability (rank-ups grant stats)."] },
    R: {
      notes: [
        "Blast, then a main-hand attack (on-hit; crit chance raises its damage via calc.CritDamageModCalc).",
        "Calibrum: empowered mark; Infernum: bonus blast damage and 110% AD attack; Gravitum: 99% slow. Severum heal / Crescendum chakrams not modeled.",
      ],
      components: [
        {
          id: "blast",
          label: "Moonlight Vigil",
          type: "physical",
          amount: "calc.MaxDamage + (stacks.aphMain == 4 ? calc.InfernumRBonusDamage : 0)",
          aoe: true,
          travel: R_TRAVEL,
        },
        {
          id: "attack",
          label: "Moonlight Vigil (attack)",
          type: "physical",
          amount: `ad * (stacks.aphMain == 4 ? ${INF}.dv.InfernumDamageMultiplier : 1) * calc.CritDamageModCalc`,
          // Wiki: the attacks launch from the sky 0.3s after the blast.
          delay: 0.3,
          travel: R_TRAVEL,
          onHit: true,
        },
      ],
    },
  },
  hooks: {
    onStart(sim) {
      sim.setCounter("aphMain", sim.opt.weapon ?? 1);
      sim.setCounter("aphOff", sim.opt.offhand ?? 2);
    },
    onCast(sim, cast) {
      if (cast.slot === "W") {
        // Each weapon keeps its own Q cooldown across swaps.
        const main = sim.counter("aphMain");
        const off = sim.counter("aphOff");
        sim.setCounter(`aphQReady${main}`, sim.cooldownReadyAt("ability:Q"));
        sim.startCooldown("ability:Q", Math.max(0, sim.counter(`aphQReady${off}`) - sim.time));
        sim.setCounter("aphMain", off);
        sim.setCounter("aphOff", main);
        return;
      }
      if (!cast.hitsTarget || (cast.slot !== "Q" && cast.slot !== "R")) return;
      const forced = cast.variant ? WEAPONS.indexOf(cast.variant.toLowerCase() as (typeof WEAPONS)[number]) + 1 : 0;
      const weapon = forced || sim.counter("aphMain");
      // Just after the hit that applies them: Moonshot, Binding Eclipse, Moonlight Vigil's attacks.
      const at = cast.slot === "R" ? `castTime + ${R_TRAVEL} + 0.3` : weapon === 1 ? MOONSHOT : `${GRA}.castTime`;
      weaponEffects(sim, cast.slot, weapon, cast.castId, sim.evalExpr(at, { slot: cast.slot }) + 0.05);
    },
    // Gravitum attacks slow.
    onAttack(sim, atk) {
      if (!atk.phantom && !atk.fromAbility && sim.counter("aphMain") === 3)
        sim.applyCC("slow", sim.evalExpr(`${GRA}.dv.SlowDuration`, { slot: "P" }), atk.castId, "P");
    },
  },
};
export default kit;
