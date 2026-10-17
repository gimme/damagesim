import type { ChampionKit } from "../../engine/kit-types.ts";

// Rakan — patch 16.20. Fey Feathers (self shield), the Q heal and E's ally shield are not modeled.
const kit: ChampionKit = {
  id: "Rakan",
  status: "curated",
  abilities: {
    Q: {
      components: [{ id: "quill", label: "Gleaming Quill", type: "magic", amount: "calc.TotalDamage", travel: true }],
    },
    W: {
      dash: true,
      notes: ["Dash, then a short delay before the knock-up lands."],
      cc: [{ kind: "immobilize", duration: "dv.KnockupDuration" }],
      // Dashes to the target at the dash speed; the knock-up lands 0.35s after he arrives (wiki).
      lockout: "castTime + reach / missileSpeed",
      components: [{ id: "entrance", label: "Grand Entrance", type: "magic", amount: "calc.TotalDamage", aoe: true, delay: 0.35, travel: true }],
    },
    E: {
      dash: true,
      noTarget: true,
      recasts: 2,
      notes: ["Dash to an ally (shield not modeled); can be recast once."],
      // Dashes its max range at 1250 + 80% of his movement speed (wiki; no speed in the data).
      lockout: "castTime + castRange / (1250 + 0.8 * ms)",
      components: [],
    },
    R: {
      notes: ["Each enemy is damaged and charmed once, the first time Rakan touches it."],
      cc: [{ kind: "immobilize", duration: "dv.CharmDuration" }],
      // Wiki: during the 0.5s cast time he can move, attack and cast Gleaming Quill and Battle Dance;
      // only Grand Entrance waits. He touches the target as it ends.
      castTime: 0,
      castLockout: { W: 0.5 },
      components: [{ id: "touch", label: "The Quickness", type: "magic", amount: "calc.TotalDamageTooltip", aoe: true, delay: 0.5 }],
    },
  },
};
export default kit;
