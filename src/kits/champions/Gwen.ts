import type { ChampionKit, ComponentSpec } from "../../engine/kit-types.ts";
import type { Sim } from "../../engine/sim.ts";

// Gwen — patch 16.20.
// Hook: Snip Snip! stacks (gained per attack, consumed by Q) feed the snip count through a counter
// (stacks.gwenQSnips).

const MAX_SNIP_STACKS = 4; // tooltip: "max 4"
const CUTS = "P.calc.PercentHealth1000Cuts * target.maxHp";

// Wiki: the snips happen over the 0.5s cast time, the final one as it ends; all land at its end here.
function snips(id: string, label: string, amount: string, hits: string, center: boolean): ComponentSpec[] {
  if (!center) return [{ id, label, type: "magic", amount, hits, aoe: true }];
  return [
    { id, label, type: "magic", amount: `${amount} * (1 - dv.TrueDamageConversion)`, hits, aoe: true },
    { id: `${id}True`, label: `${label} (true)`, type: "true", amount: `${amount} * dv.TrueDamageConversion`, hits, aoe: true },
    { id: `${id}Cuts`, label: "A Thousand Cuts", type: "magic", amount: CUTS, hits, proc: true },
  ];
}
const qSnips = (center: boolean): ComponentSpec[] => [
  ...snips("snip", "Snip", "calc.MiniSwipeDamage", "1 + stacks.gwenQSnips", center),
  ...snips("final", "Final snip", "calc.FinalSwipeDamage", "1", center),
];

const kit: ChampionKit = {
  id: "Gwen",
  status: "curated",
  options: [{ key: "snipStacks", label: "Snip Snip! stacks at start", default: 4, min: 0, max: MAX_SNIP_STACKS, step: 1 }],
  notes: [
    'Snip Snip!: 1 snip + 1 per stack + a final snip. Stacks come from attacks (max 4, Q.dv.BuffDuration s) plus the "snipStacks" option at combo start (default 4).',
    "Center snips (default) convert dv.TrueDamageConversion of their damage to true damage and each applies A Thousand Cuts; Q:edge for edge hits (all magic, no Cuts).",
    'Needlework: write "R R R" — 1, 3 and 5 needles; each needle applies A Thousand Cuts.',
  ],
  attack: {
    onHit: [{ id: "cuts", label: "A Thousand Cuts", type: "magic", amount: CUTS, proc: true }],
  },
  abilities: {
    Q: {
      components: qSnips(true),
      variants: { edge: { label: "edge", note: "Target outside the center: all magic damage, no A Thousand Cuts.", components: qSnips(false) } },
    },
    W: {
      noTarget: true,
      buff: { id: "gwenW", label: "Hallowed Mist", duration: "dv.ZoneDuration", stats: { armor: "calc.TotalResists", mr: "calc.TotalResists" } },
    },
    E: {
      dash: true,
      // The dash's range at its dash speed (data; no missile speed).
      lockout: "dv.DashRange / dv.DashSpeed",
      resetsAttack: true,
      noTarget: true,
      notes: ["Attack reset; empowered attacks for dv.BuffDuration s (attack speed, range, magic on-hit)."],
      buff: {
        id: "gwenE",
        label: "Skip 'n Slash",
        duration: "dv.BuffDuration",
        stats: { attackSpeed: "calc.BonusAttackSpeed", range: "dv.BonusAttackRange" },
        onHit: [{ id: "skip", label: "Skip 'n Slash", type: "magic", amount: "E.calc.OnHitDamage", proc: true }],
      },
    },
    R: {
      recasts: 3,
      recastDelay: "dv.LockoutTime",
      // Wiki: the recasts' cast times are 0.5s; each cast's needles fire from 0.25s in, 0.1s apart
      // on the second cast and 0.0625s on the third.
      lockout: "recast > 1 ? 0.5 : castTime",
      cc: [{ kind: "slow", duration: "dv.DebuffDuration" }],
      components: [
        {
          id: "needle",
          label: "Needle",
          type: "magic",
          amount: "calc.TotalDamage",
          hits: "2 * recast - 1",
          interval: "recast == 2 ? 0.1 : 0.0625",
          travel: true,
          aoe: true,
        },
        {
          id: "needleCuts",
          label: "A Thousand Cuts",
          type: "magic",
          amount: CUTS,
          hits: "2 * recast - 1",
          interval: "recast == 2 ? 0.1 : 0.0625",
          travel: true,
          proc: true,
        },
      ],
    },
  },
  hooks: {
    onStart(sim: Sim) {
      sim.setCounter("gwenQ", Math.min(MAX_SNIP_STACKS, sim.opt.snipStacks ?? MAX_SNIP_STACKS));
      sim.setCounter("gwenQ.until", sim.evalExpr("Q.dv.BuffDuration", { slot: "Q" }));
    },
    onAttack(sim: Sim, atk) {
      if (atk.fromAbility || atk.phantom) return;
      const cur = sim.time <= sim.counter("gwenQ.until") ? sim.counter("gwenQ") : 0;
      sim.setCounter("gwenQ", Math.min(MAX_SNIP_STACKS, cur + 1));
      sim.setCounter("gwenQ.until", sim.time + sim.evalExpr("Q.dv.BuffDuration", { slot: "Q" }));
    },
    onCast(sim: Sim, cast) {
      if (cast.slot !== "Q") return;
      sim.setCounter("gwenQSnips", sim.time <= sim.counter("gwenQ.until") ? sim.counter("gwenQ") : 0);
      sim.setCounter("gwenQ", 0);
    },
  },
};
export default kit;
