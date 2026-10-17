// Summoner spells that deal damage (Ignite).

import type { Effect, SetupCtx } from "./effects.ts";
import type { Sim } from "./sim.ts";
import { evalCalcNode, type CalcEnv } from "./calc.ts";

export function createSummonerEffect(name: "ignite", setup: SetupCtx): Effect {
  return {
    id: "summoner:ignite",
    label: "Ignite",
    source: "summoner",
    description: "True damage over 5 seconds, dealt in 5 one-second ticks.",
    active: {
      label: "Ignite",
      cooldown: 0,
      cast(sim: Sim, castId: number) {
        const spell = sim.data.summoners.SummonerDot;
        if (!spell) {
          sim.warn("Ignite data missing");
          return;
        }
        const env = {
          rank: 1,
          level: setup.level,
          dataValue: (n: string) => spell.dataValues[n]?.[1] ?? 0,
        } as unknown as CalcEnv;
        const total = evalCalcNode(spell.calcs.TooltipTrueDamageCalculation, env, (n) => spell.calcs[n]);
        const duration = spell.dataValues.DotDuration?.[1] ?? 5;
        const ticks = Math.round(duration);
        for (let i = 1; i <= ticks; i++) {
          sim.schedule(i, () =>
            sim.deal({
              source: "summoner:ignite",
              sourceLabel: "Ignite",
              label: `Burn tick ${i}`,
              type: "true",
              amount: total / ticks,
              castId,
              // Ignite isn't affected by damage-dealt modifiers; it still counts for Electrocute etc.
              flags: { kind: "summoner", dot: true, unamplified: true },
            }),
          );
        }
      },
    },
  };
}
