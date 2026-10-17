import type { ChampionKit } from "../../engine/kit-types.ts";

// Soraka — patch 16.20.
const kit: ChampionKit = {
  id: "Soraka",
  status: "curated",
  notes: ["Astral Infusion and Wish only heal allies; they are not modeled beyond casting."],
  abilities: {
    Q: {
      notes: ["The star lands 0.25s (at 50 units) to 1s (at its 800 max range) after the cast (wiki), here at the target's distance."],
      cc: [{ kind: "slow", duration: "dv.SlowDuration" }],
      components: [{ id: "star", label: "Starcall", type: "magic", amount: "calc.TotalDamage", aoe: true, delay: "0.25 + max(0, reach - 50) / 1000" }],
    },
    W: { noTarget: true, components: [] },
    E: {
      notes: ["Default: the initial hit and silence. E:root = the champion is still inside when the zone erupts after RootDelay — second hit and root."],
      cc: [{ kind: "impair", duration: "dv.RootDelay" }],
      components: [{ id: "field", label: "Equinox", type: "magic", amount: "calc.TotalDamage", aoe: true }],
      variants: {
        root: {
          label: "root",
          cc: [
            { kind: "impair", duration: "dv.RootDelay" },
            { kind: "immobilize", duration: "dv.RootDuration", delay: "dv.RootDelay" },
          ],
          components: [
            { id: "field", label: "Equinox", type: "magic", amount: "calc.TotalDamage", aoe: true },
            { id: "erupt", label: "Equinox (eruption)", type: "magic", amount: "calc.TotalDamage", aoe: true, delay: "dv.RootDelay" },
          ],
        },
      },
    },
    R: { noTarget: true, components: [] },
  },
};
export default kit;
