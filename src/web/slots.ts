// The build's item slots: the bot lane role quest's seventh, for boots, and what goes where.

import { DATA } from "./data.ts";

/** The bot lane role quest's slot, which holds the boots: the build has it when its items have a seventh entry. */
export const BOOTS_SLOT = 6;

const isBoots = (id: number) => !!DATA.items[id]?.tags.includes("Boots");

/** Whether slot i of a build can hold an item, or be empty (null): with the boots slot, the boots go there and only there. */
export function slotFits(items: (number | null)[], i: number, id: number | null): boolean {
  return id == null || items.length <= BOOTS_SLOT || isBoots(id) === (i === BOOTS_SLOT);
}

/** The build with the boots slot: boots in the other slots move to it, as in game when the quest is done. */
export function addBootsSlot(items: (number | null)[]): (number | null)[] {
  const k = items.findIndex((id) => id != null && isBoots(id));
  return [...items.map((id, j) => (j === k ? null : id)), k >= 0 ? items[k] : null];
}
