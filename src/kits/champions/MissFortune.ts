import type { ChampionKit } from "../../engine/kit-types.ts";

// Miss Fortune — patch 16.20.
const kit: ChampionKit = {
  id: "MissFortune",
  status: "curated",
  notes: [
    'Love Tap triggers on the first attack (or Double Up hit) on the target only, unless the "Love Tap every attack" option is on (she alternates targets). It is proc damage: no crit.',
    "Strut's cooldown refund from Love Tap and its passive move speed are not modeled.",
  ],
  options: [
    {
      key: "loveTapEvery",
      label: "Love Tap every attack",
      default: 0,
      toggle: true,
      description: "Miss Fortune attacks another unit in between, so every attack on the target is a new target.",
    },
  ],
  hooks: {
    onAttack(sim, atk) {
      if (atk.phantom) return;
      // Love Tap: attacks and Double Up hits on an unmarked target (single target: the first one).
      if (sim.counter("mf:tapped") && !sim.opt.loveTapEvery) return;
      sim.setCounter("mf:tapped", 1);
      atk.extra.push({
        source: "P",
        sourceLabel: "Love Tap",
        label: "Love Tap",
        type: "physical",
        amount: sim.evalExpr("P.calc.TotalDamage", { slot: "P" }),
        castId: atk.castId,
        flags: { kind: "ability", slot: "P", onHit: true, ability: false, proc: true },
      });
    },
  },
  abilities: {
    Q: {
      notes: [
        "Default: the target is hit by the first shot (applies on-hit). Q:bounce — the target is the bounce target (shot through a minion): can crit for dv.BounceCriticalMod of crit damage. Q:bounceKill — the first shot kills the minion, so the bounce always crits.",
      ],
      components: [{ id: "shot", label: "Double Up", type: "physical", amount: "calc.TotalDamageTooltip", onHit: true, onAttack: true, travel: true }],
      // The bounce: the shot flies to a unit in front of the target, then on to it, up to 500 units (wiki).
      variants: {
        bounce: {
          label: "bounce",
          components: [
            {
              id: "bounce",
              label: "Double Up (bounce)",
              type: "physical",
              amount: "calc.TotalDamageTooltip",
              canCrit: true,
              critMultiplier: "1 + dv.BounceCriticalMod * (critDamage - 1)",
              onHit: true,
              travel: "min(distance, castRange + 500) / missileSpeed",
            },
          ],
        },
        bounceKill: {
          label: "bounce (guaranteed crit)",
          components: [
            {
              id: "bounce",
              label: "Double Up (bounce crit)",
              type: "physical",
              amount: "calc.TotalDamageCrit",
              onHit: true,
              travel: "min(distance, castRange + 500) / missileSpeed",
            },
          ],
        },
      },
    },
    W: {
      noTarget: true,
      buff: { id: "strut", label: "Strut", duration: "dv.ActiveDuration", stats: { attackSpeed: "dv.ActiveAS" } },
      components: [],
    },
    E: {
      cc: [{ kind: "slow", duration: "dv.BaseDuration" }],
      components: [
        {
          id: "rain",
          label: "Make It Rain",
          type: "magic",
          amount: "calc.TotalDamagePerSecond / dv.TicksPerSecond",
          hits: "dv.BaseDuration * dv.TicksPerSecond",
          interval: "1 / dv.TicksPerSecond",
          delay: "1 / dv.TicksPerSecond",
          aoe: true,
          dot: true,
        },
      ],
    },
    R: {
      // Channel: Miss Fortune can't act while firing; waves are spread over the channel.
      lockout: "dv.BaseChannelDuration",
      variableDuration: true,
      notes: [
        "Channelled for dv.BaseChannelDuration (blocks the next combo step); all dv.BaseWaves waves hit the target once. Each wave can crit for dv.CritDamageMultiplier of crit damage.",
        "Set the seconds (R{1.5s}) to cancel it early.",
      ],
      components: [
        {
          id: "wave",
          label: "Bullet Time",
          type: "physical",
          amount: "calc.PhysicalDamagePerWave",
          hits: "dv.BaseWaves",
          maxHits: "dv.BaseWaves",
          interval: "dv.BaseChannelDuration / dv.BaseWaves",
          delay: "dv.BaseChannelDuration / dv.BaseWaves / 2",
          // No range in the data: each bullet stream's 1450 (wiki), to the target.
          travel: "min(distance, 1450) / missileSpeed",
          canCrit: true,
          critMultiplier: "1 + dv.CritDamageMultiplier * (critDamage - 1)",
          aoe: true,
        },
      ],
    },
  },
};
export default kit;
