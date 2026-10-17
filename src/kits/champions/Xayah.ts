import type { ChampionKit } from "../../engine/kit-types.ts";
import type { Sim } from "../../engine/sim.ts";

// Xayah — patch 16.20.
// Feathers are tracked in hooks, from when and where (units from Xayah) they land: Double Daggers
// leaves 2, Featherstorm 5, and each attack empowered by Clean Cuts (3 per ability cast, max 5 —
// data) leaves 1. Bladecaller recalls all of them through the target, those still flying once they
// land (wiki): each feather deals 5% less than the previous one, down to 10% (wiki).
const add = (sim: Sim, key: string, v: number) => sim.setCounter(key, sim.counter(key) + v);

type Feather = { lands: number; at: number };
const feathers = new WeakMap<Sim, Feather[]>();
const plant = (sim: Sim, f: Feather) => feathers.set(sim, [...(feathers.get(sim) ?? []), f]);
/** One feather's damage: less for each that hit before it. */
const FEATHER = "E.calc.FeatherDamage * max(0.1, 1 - E.dv.FeatherFalloff * stacks.xayahEHits)";

const kit: ChampionKit = {
  id: "Xayah",
  status: "curated",
  notes: [
    "Feathers are assumed to lie in line with the target when recalled and are not expired (6s) in the simulation; ones still flying when Bladecaller is cast come back once they land.",
    'Option "feathers" = feathers already on the ground at combo start.',
  ],
  options: [{ key: "feathers", label: "Feathers on the ground at start", default: 0, min: 0, max: 20, step: 1 }],
  abilities: {
    Q: {
      notes: ["Both daggers hit a single target for full damage."],
      // Each dagger forms for its delay, then flies through the target at its speed (data), on to its 1100 range.
      components: [
        {
          id: "dagger1",
          label: "Double Daggers",
          type: "physical",
          amount: "calc.TotalDamage",
          delay: "dv.Missile1DelayTime",
          travel: "reach / dv.Missile1DelaySpeed",
        },
        {
          id: "dagger2",
          label: "Double Daggers",
          type: "physical",
          amount: "calc.TotalDamage",
          delay: "dv.Missile2DelayTime",
          travel: "reach / dv.Missile2DelaySpeed",
        },
      ],
    },
    W: {
      noTarget: true,
      notes: ["Attacks fire a second blade dealing 25% of the attack's damage (scaled by the attack's crit, cannot crit itself; proc damage)."],
      buff: {
        id: "xayahW",
        label: "Deadly Plumage",
        duration: "dv.WAttackSpeedDuration",
        stats: { attackSpeed: "dv.WAttackSpeedAmount / 100" },
        onHit: [{ id: "blade", label: "Deadly Plumage", type: "physical", amount: "ad * W.dv.BonusDamagePercent / 100", canCrit: true, proc: true }],
      },
    },
    E: {
      notes: [
        "Hits once per feather (from Q, R and Clean Cuts attacks): those on the ground, and those still flying once they land; 3+ feathers root. Damage already includes the game's crit-chance scaling.",
        "Override the count of feathers on the ground with E{feather:N}.",
      ],
      components: [
        {
          id: "feather",
          label: "Bladecaller",
          type: "physical",
          amount: FEATHER,
          hits: "stacks.xayahEFeathers",
          maxHits: 20,
          interval: 0.03,
          // The feathers on the ground set off after dv.FeatherReturnDelay from where they lie, ~1000
          // units out behind the target (wiki), and pass it at their speed. Flying ones: hook.
          delay: "dv.FeatherReturnDelay",
          travel: "max(0, 1000 - distance) / missileSpeed",
        },
      ],
    },
    R: {
      notes: ["Untargetable for 1.5s; daggers land after 1s and leave 5 feathers (wiki)."],
      // Wiki: unable to attack or cast during the 1.5s Featherstorm.
      lockout: 1.5,
      // Shot after 1s (dv.RAttackDelay); no missile speed in the data or the wiki for their flight.
      components: [{ id: "storm", label: "Featherstorm", type: "physical", amount: "calc.Damage", aoe: true, delay: "dv.RAttackDelay" }],
    },
  },
  hooks: {
    onStart(sim) {
      feathers.set(
        sim,
        Array.from({ length: sim.opt.feathers ?? 0 }, () => ({ lands: 0, at: 1000 })),
      );
    },
    onCast(sim, cast) {
      const end = sim.time + (cast.castTime ?? 0);
      if (cast.slot === "E") {
        // Those on the ground are its hits; the rest come back as they land.
        const all = feathers.get(sim) ?? [];
        const flying = all.filter((f) => f.lands > sim.time);
        feathers.set(sim, []);
        sim.setCounter("xayahEFeathers", all.length - flying.length);
        sim.setCounter("xayahECast", cast.castId);
        sim.setCounter("xayahEHits", 0);
        const back = sim.time + sim.evalExpr("E.dv.FeatherReturnDelay", { slot: "E" });
        const speed = sim.evalExpr("E.missileSpeed", { slot: "E" });
        for (const f of flying)
          sim.schedule(Math.max(back, f.lands) - sim.time + Math.max(0, f.at - sim.distance) / speed, () =>
            sim.deal({
              source: "E",
              sourceLabel: "Bladecaller",
              label: "Bladecaller",
              type: "physical",
              amount: sim.evalExpr(FEATHER, { slot: "E" }),
              castId: cast.castId,
              flags: { kind: "ability", slot: "E", ability: true },
            }),
          );
      }
      // Each dagger forms for its delay, then flies its 1100 range.
      if (cast.slot === "Q")
        for (const n of [1, 2])
          plant(sim, { lands: end + sim.evalExpr(`Q.dv.Missile${n}DelayTime + Q.castRange / Q.dv.Missile${n}DelaySpeed`, { slot: "Q" }), at: 1100 });
      // No speed on the wiki: planted as the daggers strike, ~1000 out (their 1100 range starts behind her).
      if (cast.slot === "R") for (let i = 0; i < 5; i++) plant(sim, { lands: end + sim.evalExpr("R.dv.RAttackDelay", { slot: "R" }), at: 1000 });
      if (cast.slot !== "P") {
        const max = sim.evalExpr("P.dv.PStackMax", { slot: "P" });
        sim.setCounter("xayahCuts", Math.min(max, sim.counter("xayahCuts") + sim.evalExpr("P.dv.PStacksPerCast", { slot: "P" })));
      }
    },
    // Clean Cuts is used as the attack goes off (on-attack): it flies on past the target, to 1000
    // units from Xayah, at 4000 (wiki), or drops where it hits a target farther away.
    onLaunch(sim, launch) {
      if (launch.fromAbility || sim.counter("xayahCuts") <= 0) return;
      add(sim, "xayahCuts", -1);
      const on = Math.max(0, 1000 - sim.distance) / sim.evalExpr("P.missileSpeed", { slot: "P" });
      plant(sim, { lands: sim.time + sim.attackTravel() + on, at: Math.max(1000, sim.distance) });
    },
    afterDamage(sim, inst) {
      if (inst.flags.slot !== "E" || inst.castId !== sim.counter("xayahECast")) return;
      add(sim, "xayahEHits", 1);
      if (sim.counter("xayahEHits") === sim.evalExpr("E.dv.FeatherThreshold", { slot: "E" }))
        sim.applyCC("immobilize", sim.evalExpr("E.dv.RootDuration", { slot: "E" }), inst.castId, "E");
    },
  },
};
export default kit;
