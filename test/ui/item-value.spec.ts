// The Item value card: the slot to rank for (the build's, in its address, following its items and brought back by undo), the ranking sorted two ways,
// Show more, buying from a row or by dragging its item onto a slot, the gold map, and what a card calls a hit.

import { test, expect, attrs, num, texts, type UI } from "./ui.ts";

// Every step checks the ranking as the build then is.
test.use({ itemValue: true });

const parts = (ui: UI) => {
  const card = ui.card("Item value");
  // The items' rows: not the heading's, nor Show more's.
  const rows = card
    .getByRole("table")
    .getByRole("row")
    .filter({ has: ui.page.getByRole("cell") })
    .filter({ hasNot: ui.page.getByRole("button", { name: /^Show (more|less)$/ }) });
  return {
    card,
    slots: card.locator(".slots > .slot:not(.vacated)"),
    rows,
    names: () => texts(rows.locator(".iv-name")),
    perGold: async () => (await texts(rows.locator(".iv-pg"))).map(num),
    damage: async () => (await texts(rows.locator(".iv-dmg"))).map(num),
    caption: card.locator(".iv-caption"),
    /** The index of the slot ranked for. */
    ranked: async () => (await attrs(card.locator(".slots > .slot:not(.vacated)"), "aria-pressed")).indexOf("true"),
    /** The names of the build's items, by slot, as Items shows them. */
    build: async () =>
      (await attrs(ui.card("Items").locator(".slots > .slot:not(.vacated)"), "aria-label")).map(
        (l) => /^Item slot \d: (.*)\. Arrow keys/.exec(l!)?.[1] ?? null,
      ),
  };
};

const descending = (xs: number[]) => xs.every((x, i) => i === 0 || xs[i - 1] >= x);

test("ranking, sorting and buying", async ({ ui }) => {
  const { page, step } = ui;
  const { card, slots, rows, names, perGold, damage, caption, ranked, build } = parts(ui);
  let shown = 0;

  await step(
    "load: the next slot ranked, by damage per gold",
    () => ui.open(),
    async () => {
      await expect(caption).toHaveText("Next item");
      expect(await ranked()).toBe(2);
      shown = await rows.count();
      expect(shown).toBeGreaterThan(0);
      expect(shown).toBeLessThanOrEqual(8);
      expect(descending(await perGold())).toBe(true);
      await expect(card.getByRole("columnheader", { name: "per 1000g", exact: true })).toHaveAttribute("aria-sort", "descending");
    },
  );
  await step(
    "Show more: more rows",
    () => card.getByRole("button", { name: "Show more" }).click(),
    async () => expect(await rows.count()).toBeGreaterThan(shown),
  );
  await step(
    "Show less: as before",
    () => card.getByRole("button", { name: "Show less" }).click(),
    () => expect(rows).toHaveCount(shown),
  );
  await step(
    "sort by damage",
    () => card.getByRole("button", { name: "damage", exact: true }).click(),
    async () => {
      expect(descending(await damage())).toBe(true);
      await expect(card.getByRole("columnheader", { name: "damage", exact: true })).toHaveAttribute("aria-sort", "descending");
    },
  );
  await step(
    "sort per 1000g",
    () => card.getByRole("button", { name: "per 1000g", exact: true }).click(),
    async () => expect(descending(await perGold())).toBe(true),
  );
  const second = (await names())[1];
  await step(
    "hover a row's item: its card names it, a click buys",
    () => rows.nth(1).locator(".iv-name").hover(),
    async () => {
      await expect(ui.tooltip).toContainText(second);
      await expect(ui.tooltip).toContainText("Click to buy");
    },
  );
  await step(
    "hover its bar: where its damage comes from",
    () => rows.nth(1).locator(".iv-track").hover(),
    () => expect(ui.tooltip).toContainText(`${second} · `),
  );
  await step("the pointer away", () => ui.unhover());
  const first = (await build())[0]!;
  await step(
    "hover slot 1: its card names its item",
    () => slots.nth(0).hover(),
    () => expect(ui.hovercard).toContainText(first),
  );
  await step("the pointer away", () => ui.unhover());
  await step(
    "click slot 1: ranked in place of its item, listed as the current one",
    () => slots.nth(0).click(),
    async () => {
      expect(await ranked()).toBe(0);
      await expect(caption).toHaveText(`In place of ${first}`);
      await expect(card.locator("[role=row][aria-current=true]")).toContainText(first);
    },
  );
  await step(
    "Enter on slot 2 ranks it",
    async () => {
      await slots.nth(1).focus();
      await page.keyboard.press("Enter");
    },
    async () => expect(await ranked()).toBe(1),
  );
  let top = "";
  await step(
    "click the top row: bought in its place, the next slot ranked",
    async () => {
      top = (await names())[0];
      await rows.first().click();
    },
    async () => {
      expect((await build())[1]).toBe(top);
      expect(await ranked()).toBe(2);
    },
  );
  await step(
    "Enter on a row's item buys it",
    async () => {
      top = (await names())[1];
      await rows.nth(1).getByRole("button").focus();
      await page.keyboard.press("Enter");
    },
    async () => expect((await build())[2]).toBe(top),
  );
  await step(
    "Delete on slot 3 sells it, and ranks it",
    async () => {
      await slots.nth(2).focus();
      await page.keyboard.press("Delete");
    },
    async () => {
      expect((await build())[2]).toBeNull();
      expect(await ranked()).toBe(2);
    },
  );
});

test("slots and the gold map", async ({ ui }) => {
  const { page, step } = ui;
  const { card, slots, rows, caption, ranked, build } = parts(ui);
  const items = async () => (await ui.state()).items;
  let was: (number | null)[] = [];

  await step(
    "load",
    () => ui.open(),
    async () => {
      was = await items();
    },
  );
  await step(
    "drag slot 2 onto slot 1: they swap, the next slot still ranked",
    () => ui.drag(slots.nth(1), slots.nth(0)),
    async () => {
      expect(await items()).toEqual([was[1], was[0], ...was.slice(2)]);
      expect(await ranked()).toBe(2);
    },
  );
  let item = "";
  await step(
    "rank slot 2, drag it onto slot 5: the ranked slot follows its item",
    async () => {
      item = (await build())[1]!;
      await slots.nth(1).click();
      await ui.drag(slots.nth(1), slots.nth(4));
    },
    async () => {
      expect(await ranked()).toBe(4);
      await expect(caption).toHaveText(`In place of ${item}`);
      expect((await build())[4]).toBe(item);
    },
  );
  await step(
    "ArrowLeft on the focused slot 5 moves its item, ranked still",
    async () => {
      await slots.nth(4).focus();
      await page.keyboard.press("ArrowLeft");
    },
    async () => {
      expect((await build())[3]).toBe(item);
      expect(await ranked()).toBe(3);
      expect((await ui.state()).slot).toBe(3);
      await page.evaluate(() => (document.activeElement as HTMLElement).blur());
    },
  );
  await step(
    "Undo in Items: the move back, and slot 5 ranked again",
    () => ui.card("Items").getByRole("button", { name: "Undo" }).click(),
    async () => {
      expect((await build())[4]).toBe(item);
      expect(await ranked()).toBe(4);
    },
  );
  await step(
    "Redo: slot 4 again",
    () => ui.card("Items").getByRole("button", { name: "Redo" }).click(),
    async () => {
      expect((await build())[3]).toBe(item);
      expect(await ranked()).toBe(3);
    },
  );

  const view = card.getByRole("group", { name: "View" });
  const map = card.getByRole("img", { name: "Damage gained versus item cost" });
  // The dots, at their middles on screen: drawn with a 2px outline (a hovered one's ring is larger, r 9).
  const dots = map.locator('circle[stroke-width="2"]:not([r="9"])');
  const at = async (i: number) => {
    const b = (await dots.nth(i).boundingBox())!;
    return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
  };
  let listed = 0;
  await step(
    "Gold map: a dot per item the list has",
    async () => {
      await card.getByRole("button", { name: "Show more" }).click();
      listed = await rows.count();
      await view.getByRole("button", { name: "Gold map" }).click();
    },
    async () => {
      await expect(map).toBeVisible();
      await expect(dots).toHaveCount(listed);
    },
  );
  await step(
    "hover a dot: its numbers, a ring round it",
    async () => {
      const d = await at(0);
      await page.mouse.move(d.x, d.y);
    },
    async () => {
      await expect(ui.tooltip).toContainText("Damage gained");
      await expect(ui.tooltip).toContainText("Per 1000 gold");
      await expect(map.locator('circle[r="9"]')).toHaveCount(1);
    },
  );
  // The current item's dot is the hollow one.
  const current = async () => (await attrs(dots, "fill")).indexOf("var(--surface)");
  await step(
    "click the current item's dot: nothing bought",
    async () => {
      was = await items();
      const d = await at(await current());
      await page.mouse.click(d.x, d.y);
    },
    async () => expect(await items()).toEqual(was),
  );
  let bought = "";
  await step(
    "click another dot: bought in its place",
    async () => {
      const i = (await current()) === 0 ? 1 : 0;
      const d = await at(i);
      await page.mouse.move(d.x, d.y);
      bought = (await ui.tooltip.locator(".tt-title").innerText()).split(" · ")[0];
      await page.mouse.click(d.x, d.y);
    },
    async () => expect((await build())[3]).toBe(bought),
  );
  await step(
    "the pointer away",
    () => ui.unhover(),
    () => expect(map.locator('circle[r="9"]')).toHaveCount(0),
  );
  await step(
    "List",
    () => view.getByRole("button", { name: "List" }).click(),
    async () => {
      await expect(map).toHaveCount(0);
      expect(await rows.count()).toBeGreaterThan(0);
    },
  );
});

test("the slot to rank for is the build's, in its address, and undo brings it back", async ({ ui }) => {
  const { page, step } = ui;
  const { slots, caption, ranked, build } = parts(ui);
  const undo = ui.card("Items").getByRole("button", { name: "Undo" });
  let boots = "";
  await step(
    "open at slot 2: in place of its item",
    () => ui.open({ slot: 1 }),
    async () => {
      boots = (await build())[1]!;
      expect(await ranked()).toBe(1);
      await expect(caption).toHaveText(`In place of ${boots}`);
      await expect(undo).toBeDisabled();
    },
  );
  await step(
    "Delete on slot 1 sells it: ranked, and in the address",
    async () => {
      await slots.nth(0).focus();
      await page.keyboard.press("Delete");
    },
    async () => {
      expect(await ranked()).toBe(0);
      expect((await ui.state()).slot).toBe(0);
      await expect(caption).toHaveText("Next item");
    },
  );
  await step(
    "Undo: the item back, and slot 2 ranked again",
    () => undo.click(),
    async () => {
      expect(await ranked()).toBe(1);
      expect((await ui.state()).slot).toBe(1);
      await expect(caption).toHaveText(`In place of ${boots}`);
    },
  );
  await step(
    "slot 3 clicked: ranked, and not a change to undo",
    () => slots.nth(2).click(),
    async () => {
      expect(await ranked()).toBe(2);
      expect((await ui.state()).slot).toBe(2);
      await expect(undo).toBeDisabled();
    },
  );
});

test("the boots slot", async ({ ui }) => {
  const { step } = ui;
  const { card, slots, rows, names, caption, ranked } = parts(ui);
  let boots: string[] = [];

  // Luden's Echo, Sorcerer's Shoes, Rabadon's Deathcap, Void Staff, Shadowflame and Zhonya's Hourglass.
  await step(
    "load a full build: its last item reconsidered",
    () => ui.open({ items: [6655, 3020, 3089, 3135, 4645, 3157] }),
    async () => {
      expect(await ranked()).toBe(5);
      await expect(caption).toHaveText("In place of Zhonya's Hourglass");
    },
  );
  await step(
    "add the boots slot in Items: seven slots, the one the boots left ranked",
    () => ui.card("Items").getByRole("button", { name: "Add an extra boots slot" }).click(),
    async () => {
      await expect(slots).toHaveCount(7);
      expect(await ranked()).toBe(1);
      await expect(caption).toHaveText("Next item");
    },
  );
  await step(
    "click the boots slot: boots ranked, the shoes in it among them",
    () => slots.nth(6).click(),
    async () => {
      expect(await ranked()).toBe(6);
      await expect(caption).toHaveText("In place of Sorcerer's Shoes");
      boots = await names();
      expect(boots).toContain("Sorcerer's Shoes");
      expect(boots.length).toBeLessThan(15);
    },
  );
  await step(
    "slot 2 again, every item shown: none of those boots, as the boots slot has a pair",
    async () => {
      await slots.nth(1).click();
      await card.getByRole("button", { name: "Show more" }).click();
    },
    async () => {
      const all = await names();
      expect(all.length).toBeGreaterThan(boots.length);
      expect(all.filter((n) => boots.includes(n))).toEqual([]);
    },
  );
  await step(
    "buy the top one there: the build full, its last item reconsidered, not the boots",
    () => rows.first().click(),
    async () => {
      expect((await ui.state()).items.every((x) => x != null)).toBe(true);
      expect(await ranked()).toBe(5);
    },
  );
});

test("an upgrade of the build's Boots", async ({ ui }) => {
  const { step } = ui;
  const { card, rows, names, ranked } = parts(ui);
  const row = (name: string) => rows.filter({ has: ui.page.locator(".iv-name", { hasText: name }) });

  // Luden's Echo and Boots.
  await step(
    "load Luden's Echo and Boots: slot 3 ranked, boots among the items, as upgrades of the Boots",
    async () => {
      await ui.open({ items: [6655, 1001, null, null, null, null] });
      await card.getByRole("button", { name: "Show more" }).click();
    },
    async () => {
      expect(await ranked()).toBe(2);
      expect(await names()).toContain("Sorcerer's Shoes");
      await expect(row("Sorcerer's Shoes").getByRole("button")).toHaveAttribute("aria-label", /^Buy Sorcerer's Shoes in place of Boots/);
    },
  );
  await step(
    "hover its bar: 800g, from the Boots",
    () => row("Sorcerer's Shoes").locator(".iv-track").hover(),
    () => expect(ui.tooltip).toContainText("Sorcerer's Shoes · 800g, from Boots"),
  );
  await step(
    "buy them: in place of the Boots; slot 3 still ranked, without boots now, as the build has a pair",
    async () => {
      await ui.unhover();
      await row("Sorcerer's Shoes").click();
    },
    async () => {
      expect((await ui.state()).items).toEqual([6655, 3020, null, null, null, null]);
      expect(await ranked()).toBe(2);
      await expect(card.getByRole("button", { name: "Show less" })).toBeVisible();
      expect(await names()).not.toContain("Berserker's Greaves");
    },
  );
});

test("the mid lane quest's tier 3 boots, ranked with their setting", async ({ ui }) => {
  const { step } = ui;
  const { card, names } = parts(ui);

  await step(
    "load Luden's Echo alone, every item shown: boots, but no tier 3 ones",
    async () => {
      await ui.open({ items: [6655, null, null, null, null, null] });
      await card.getByRole("button", { name: "Show more" }).click();
    },
    async () => {
      expect(await names()).toContain("Sorcerer's Shoes");
      expect(await names()).not.toContain("Spellslinger's Shoes");
    },
  );
  await step(
    "check their setting: ranked too",
    () => ui.card("Settings").getByRole("checkbox", { name: "Tier 3 boots (mid lane quest)" }).check(),
    async () => expect(await names()).toContain("Spellslinger's Shoes"),
  );
});

test("a card names a hit as the run it comes from calls it", async ({ ui }) => {
  const { step } = ui;
  const { card, rows } = parts(ui);

  await step(
    "Yunara without items, every item shown: Sundered Sky's card has her passive's crit hit as a proc, (crit) and all",
    async () => {
      await ui.open({ champion: "Yunara", items: [null, null, null, null, null, null], combo: "Q W E R AA AA" });
      await card.getByRole("button", { name: "Show more" }).click();
      await rows.filter({ hasText: "Sundered Sky" }).locator(".iv-track").hover();
    },
    () => expect(ui.tooltip).toContainText("Vow of the First Lands (crit)"),
  );
});

test("a row's item dragged onto a slot is bought there alone", async ({ ui }) => {
  const { step } = ui;
  const { slots, rows, names, build } = parts(ui);
  let was: (string | null)[] = [];
  let name = "";
  await step(
    "load",
    () => ui.open(),
    async () => {
      was = await build();
    },
  );
  await step(
    "drag the second row's item onto slot 5: outlined while over it, bought there alone",
    async () => {
      name = (await names())[1];
      await ui.drag(rows.nth(1).locator(".iv-icon"), slots.nth(4), () => expect(slots.nth(4)).toHaveClass(/landing/));
    },
    async () => expect(await build()).toEqual([...was.slice(0, 4), name, null]),
  );
  await step(
    "drag the top row's item onto slot 1: bought in place of Luden's Echo",
    async () => {
      was = await build();
      name = (await names())[0];
      await ui.drag(rows.first().locator(".iv-icon"), slots.nth(0));
    },
    async () => expect(await build()).toEqual([name, ...was.slice(1)]),
  );
  await step(
    "drag one and let it go away from the slots: nothing bought",
    async () => {
      was = await build();
      await ui.drag(rows.first().locator(".iv-icon"), { x: 5, y: 5 });
    },
    async () => expect(await build()).toEqual(was),
  );
});
