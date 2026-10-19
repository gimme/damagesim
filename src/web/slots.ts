// The build's item slots: the bot lane role quest's seventh, for boots, what goes where, and buying.

import { builtFrom } from "../engine/analysis.ts";
import { DATA } from "./data.ts";
import { settled, type UIState } from "./state.ts";

/** The bot lane role quest's slot, which holds the boots: the build has it when its items have a seventh entry. */
export const BOOTS_SLOT = 6;

export const isBoots = (id: number) => !!DATA.items[id]?.tags.includes("Boots");
/** The tier 3 boots, which the mid lane role quest upgrades a pair to. */
export const isQuestBoots = (id: number) => isBoots(id) && DATA.items[id].depth >= 3;

/** Whether slot i of a build can hold an item, or be empty (null): with the boots slot, the boots go there and only there. */
export function slotFits(items: (number | null)[], i: number, id: number | null): boolean {
  return id == null || items.length <= BOOTS_SLOT || isBoots(id) === (i === BOOTS_SLOT);
}

/**
 * The build after buying an item for slot i: an item built from items of the build takes the place of
 * the first (Boots, for a pair of boots), as the shop combines them; boots replace the build's boots,
 * in the boots slot when it has one; anything else goes in slot i.
 */
export function buyItem(items: (number | null)[], i: number, id: number): (number | null)[] {
  const used = builtFrom(DATA, items, id);
  const to = buyAt(items, i, id);
  return items.map((x, k) => (k === to ? id : used.includes(k) ? null : x));
}

/** The slot buying an item for slot i puts it in (see buyItem). */
export function buyAt(items: (number | null)[], i: number, id: number): number {
  const used = builtFrom(DATA, items, id);
  const boots = isBoots(id) ? (items.length > BOOTS_SLOT ? BOOTS_SLOT : items.findIndex((x) => x != null && isBoots(x))) : -1;
  return boots >= 0 ? boots : used.length ? used[0] : i;
}

/** The build after buying items one after another (a set from Item value), each as buyItem places it, in the first empty slot that takes it. */
export function buyItems(items: (number | null)[], ids: number[]): (number | null)[] {
  return ids.reduce(
    (xs, id) =>
      buyItem(
        xs,
        xs.findIndex((x, k) => x == null && slotFits(xs, k, id)),
        id,
      ),
    items,
  );
}

/** The build with the boots slot: boots in the other slots move to it, as in game when the quest is done. */
export function addBootsSlot(items: (number | null)[]): (number | null)[] {
  const k = items.findIndex((id) => id != null && isBoots(id));
  return [...items.map((id, j) => (j === k ? null : id)), k >= 0 ? items[k] : null];
}

/** How many items `now` has that `was` hadn't, as a multiset: those bought, an upgrade in place of what it's built from too; none for items moved or sold. */
function newItems(was: (number | null)[], now: (number | null)[]): number {
  const left = was.filter((x) => x != null);
  let n = 0;
  for (const x of now) {
    if (x == null) continue;
    const k = left.indexOf(x);
    if (k >= 0) left.splice(k, 1);
    else n++;
  }
  return n;
}

/**
 * The state with its items changed to `items`: every change to the build's items but undo and redo,
 * which bring back what the change did. Items bought (newItems) take Item value's count of items to
 * rank (next) down by as many, to one at least: a set bought leaves it at one, the next item. A move
 * or a sale leaves it as it is, but that it's never more than the empty slots; and the item it ranks
 * in place of, sold or bought over, is none, the next item (settled).
 */
export function withItems(s: UIState, items: (number | null)[]): UIState {
  return settled({ ...s, items, next: s.next - newItems(s.items, items) });
}
