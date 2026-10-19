// Item value's sets of items: how many items to rank together, a set's items in its row, each a
// button that leaves it out of the ranking, and the items left out, at the top of the card, each a
// button that puts it back. The list itself is Item value's (item-value.tsx), a set a row.

import { useId, type MouseEvent } from "react";
import { DATA } from "../data.ts";
import { ItemIcon } from "./icons.tsx";
import type { ItemSet } from "../../engine/analysis.ts";

export const setName = (s: ItemSet) => s.items.map((x) => x.item).join(" + ");
/** The same items bought in any order are one set. */
export const setKey = (s: ItemSet) =>
  s.items
    .map((x) => x.id)
    .sort((a, b) => a - b)
    .join();
/** "A, B and C". */
export const setList = (s: ItemSet) => {
  const names = s.items.map((x) => x.item);
  return names.length > 1 ? `${names.slice(0, -1).join(", ")} and ${names.at(-1)}` : names.join("");
};

/** How many items to rank: 1, the next one or one in place of a slot's, or the best sets of more, as
 *  many as there's room for (room in state.ts): the empty slots, and the items to upgrade (Serrated Dirk). */
export function CountPicker({ count, slots, room, onChange }: { count: number; slots: number; room: number; onChange: (n: number) => void }) {
  const label = useId();
  // One in place of an item when there's no room.
  const most = Math.max(1, room);
  return (
    <div className="iv-count">
      <span id={label} className="small secondary">
        Items
      </span>
      <div className="segmented small" role="group" aria-labelledby={label}>
        {Array.from({ length: slots }, (_, k) => k + 1).map((n) => (
          <button
            key={n}
            aria-pressed={n === count}
            disabled={n > most}
            title={n > most ? `Only ${most} item${most === 1 ? " fits" : "s fit"}` : undefined}
            onClick={() => onChange(n)}
          >
            {n}
          </button>
        ))}
      </div>
    </div>
  );
}

/** A set's items in its row, in the order to buy them: each a button that leaves it out of the ranking,
 *  what its click does being the list's, and that `drag` lets be dragged onto a slot to buy it alone. */
export function SetItems({ set, onClick, drag }: { set: ItemSet; onClick: (e: MouseEvent, id: number) => void; drag?: (id: number) => object }) {
  return (
    <span className="iv-set">
      {set.items.map((x) => (
        <button
          key={x.id}
          type="button"
          className="iv-set-item"
          data-item={x.id}
          aria-label={`Exclude ${x.item} from the ranking`}
          {...drag?.(x.id)}
          onClick={(e) => onClick(e, x.id)}
        >
          <ItemIcon id={x.id} size="sm" />
        </button>
      ))}
    </span>
  );
}

/** The items left out of the ranking: a click on one puts it back, Clear puts them all back. `bind` gives each its hover card. */
export function Excluded({
  ids,
  onInclude,
  onClear,
  bind,
}: {
  ids: number[];
  onInclude: (id: number) => void;
  onClear: () => void;
  bind: (id: number) => object;
}) {
  return (
    <div className="iv-excluded small" role="group" aria-label="Items left out of the ranking">
      <span className="secondary">Excluded</span>
      {ids.map((id) => (
        <button
          key={id}
          type="button"
          className="iv-excluded-item"
          aria-label={`Put ${DATA.items[id]?.name} back in the ranking`}
          {...bind(id)}
          onClick={() => onInclude(id)}
        >
          <ItemIcon id={id} size="sm" />
        </button>
      ))}
      <button type="button" className="iv-clear" onClick={onClear}>
        Clear
      </button>
    </div>
  );
}
