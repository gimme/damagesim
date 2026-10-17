// The Items card: the shop and its filters, buying, the slots' drags, selling, undo and redo, Clear.

import { test, expect, attrs, num, texts, type UI } from "./ui.ts";

const parts = (ui: UI) => {
  const card = ui.card("Items");
  const shop = card.locator(".item-picker");
  return {
    card,
    shop,
    slots: card.locator(".slots > .slot:not(.vacated)"),
    search: shop.getByRole("searchbox", { name: "Search items" }),
    names: () => texts(shop.locator(".item-option .name")),
    filter: (f: string) => shop.locator(":scope > .row").nth(1).getByRole("button", { name: f, exact: true }),
    /** The build's cost, in the card's heading. */
    gold: async () => num(await card.locator("h2 .num").innerText()),
    undo: card.getByRole("button", { name: "Undo" }),
    redo: card.getByRole("button", { name: "Redo" }),
  };
};

test("shop and filters", async ({ ui }) => {
  const { page, step } = ui;
  const { card, shop, slots, search, names, filter, gold } = parts(ui);
  let all: string[] = [];
  let before = { gold: 0, total: 0 };

  await step(
    "load",
    () => ui.open(),
    async () => {
      before = { gold: await gold(), total: await ui.total() };
    },
  );
  await step(
    "click slot 3: the shop, its search focused, the slot marked",
    () => slots.nth(2).click(),
    async () => {
      await expect(shop).toBeVisible();
      await expect(search).toBeFocused();
      expect(await attrs(slots, "aria-expanded")).toEqual(["false", "false", "true", "false", "false", "false"]);
      await expect(filter("All")).toHaveAttribute("aria-pressed", "true");
      all = await names();
      expect(all.length).toBeGreaterThan(50);
    },
  );
  for (const f of ["AP", "Boots"])
    await step(
      `filter ${f}: some of them`,
      () => filter(f).click(),
      async () => {
        await expect(filter(f)).toHaveAttribute("aria-pressed", "true");
        await expect(filter("All")).toHaveAttribute("aria-pressed", "false");
        const some = await names();
        expect(some.length).toBeGreaterThan(0);
        expect(some.length).toBeLessThan(all.length);
        expect(all).toEqual(expect.arrayContaining(some));
      },
    );
  await step(
    "every tier: more",
    async () => {
      await filter("All").click();
      await shop.locator(".segmented").getByRole("button", { name: "All" }).click();
    },
    async () => expect((await names()).length).toBeGreaterThan(all.length),
  );
  await step(
    "completed items again",
    () => shop.getByRole("button", { name: "Completed" }).click(),
    async () => expect(await names()).toEqual(all),
  );
  let top = { name: "", price: 0 };
  await step(
    "search rab: the top match marked",
    () => search.fill("rab"),
    async () => {
      const first = shop.locator(".item-option").first();
      await expect(first).toHaveClass(/\btop\b/);
      await expect(shop.locator(".item-option.top")).toHaveCount(1);
      top = { name: await first.locator(".name").innerText(), price: num(await first.locator(".muted").innerText()) };
    },
  );
  await step(
    "hover it: its card names it",
    () => shop.locator(".item-option").first().hover(),
    async () => {
      await expect(ui.hovercard).toContainText(top.name);
      await expect(ui.hovercard).toContainText(`${top.price.toLocaleString("en-US")}g`);
    },
  );
  await step(
    "Enter buys it: in slot 3, its price added, the result changes",
    () => search.press("Enter"),
    async () => {
      await expect(shop).toHaveCount(0);
      await expect(slots.nth(2)).toHaveAttribute("aria-label", new RegExp(`^Item slot 3: ${top.name}\\.`));
      expect(await gold()).toBe(before.gold + top.price);
      expect(await ui.total()).not.toBe(before.total);
    },
  );
  let clicked = "";
  await step(
    "slot 4, search ac, click the first: bought",
    async () => {
      await slots.nth(3).click();
      await search.fill("ac");
      clicked = await shop.locator(".item-option .name").first().innerText();
      await shop.locator(".item-option").first().click();
    },
    () => expect(slots.nth(3)).toHaveAttribute("aria-label", new RegExp(`^Item slot 4: ${clicked}\\.`)),
  );
  const items = (await ui.state()).items;
  await step(
    "slot 5, search zzz: nothing listed, Enter buys nothing",
    async () => {
      await slots.nth(4).click();
      await search.fill("zzz");
      await search.press("Enter");
    },
    async () => {
      await expect(shop.locator(".item-option")).toHaveCount(0);
      await expect(shop).toBeVisible();
      expect((await ui.state()).items).toEqual(items);
    },
  );
  await step(
    "Escape closes the shop",
    () => search.press("Escape"),
    () => expect(shop).toHaveCount(0),
  );
  for (const [how, close] of [
    ["a click outside", () => page.locator("header h1").click()],
    ["a click on its slot", () => slots.nth(4).click()],
    ["its ✕", () => shop.getByRole("button", { name: "Close item picker" }).click()],
  ] as const)
    await step(
      `${how} closes it`,
      async () => {
        await slots.nth(4).click();
        await expect(shop).toBeVisible();
        await close();
      },
      () => expect(shop).toHaveCount(0),
    );
  await step(
    "a second pair of boots and a second of an item: a warning each",
    async () => {
      for (const [slot, q] of [
        [4, "berserker"],
        [5, top.name],
      ] as const) {
        await slots.nth(slot).click();
        await search.fill(q);
        await search.press("Enter");
      }
    },
    async () => {
      await expect(card.locator(".notice.warn")).toHaveCount(2);
      await expect(card.locator(".notice.warn").first()).toContainText("only one pair of boots works");
      await expect(card.locator(".notice.warn").last()).toContainText(`${top.name}: only one copy works`);
    },
  );
  const full = (await ui.state()).items;
  await step(
    "Clear: every slot empty",
    () => card.getByRole("button", { name: "Clear" }).click(),
    async () => {
      expect((await ui.state()).items).toEqual([null, null, null, null, null, null]);
      expect(await gold()).toBe(0);
      await expect(card.getByRole("button", { name: "Clear" })).toBeDisabled();
      await expect(card.locator(".notice.warn")).toHaveCount(0);
    },
  );
  await step(
    "Undo brings the build back",
    () => card.getByRole("button", { name: "Undo" }).click(),
    async () => expect((await ui.state()).items).toEqual(full),
  );
});

test("slots: drags, selling, undo and redo", async ({ ui }) => {
  const { page, step } = ui;
  const { card, shop, slots, gold, undo, redo } = parts(ui);
  const items = async () => (await ui.state()).items;
  const name = async (i: number) => /^Item slot \d: (.*)\. Arrow keys/.exec((await slots.nth(i).getAttribute("aria-label"))!)![1];
  const focusedSlot = () =>
    page.evaluate(() =>
      [...document.querySelectorAll("section.card .slots")][0].contains(document.activeElement)
        ? [...document.activeElement!.parentElement!.children].indexOf(document.activeElement!)
        : -1,
    );
  let was: (number | null)[] = [];

  // Luden's Echo, Sorcerer's Shoes, Rabadon's Deathcap and Void Staff.
  await step(
    "load four items",
    () => ui.open({ items: [6655, 3020, 3089, 3135, null, null] }),
    async () => {
      was = await items();
    },
  );
  await step(
    "hover slot 1: its card names its item",
    () => slots.nth(0).hover(),
    async () => expect(ui.hovercard).toContainText(await name(0)),
  );
  await step(
    "hover slot 2: its card at once",
    () => slots.nth(1).hover(),
    async () => expect(ui.hovercard).toContainText(await name(1)),
  );
  await step(
    "hover the empty slot 5: none",
    () => slots.nth(4).hover(),
    () => expect(ui.hovercard).toHaveCount(0),
  );
  await step(
    "drag slot 1 onto slot 2: they swap",
    () => ui.drag(slots.nth(0), slots.nth(1)),
    async () => {
      expect(await items()).toEqual([was[1], was[0], ...was.slice(2)]);
      await expect(undo).toBeEnabled();
    },
  );
  await step(
    "drag slot 2 onto the empty slot 6: it moves",
    async () => {
      was = await items();
      await ui.drag(slots.nth(1), slots.nth(5));
    },
    async () => expect(await items()).toEqual([was[0], null, was[2], was[3], null, was[1]]),
  );
  await step(
    "drag slot 1 away from the slots: it goes back",
    async () => {
      was = await items();
      await ui.drag(slots.nth(0), { x: 200, y: 900 }, async () => {
        await expect(card.locator(".slot.dragging")).toHaveCount(1);
        await expect(card.locator(".slot.landing")).toHaveCount(0);
      });
    },
    async () => expect(await items()).toEqual(was),
  );
  await step(
    "open slot 1's shop and drag slot 1 onto slot 5: the shop follows",
    async () => {
      was = await items();
      await slots.nth(0).click();
      await ui.drag(slots.nth(0), slots.nth(4));
    },
    async () => {
      expect(await items()).toEqual([null, was[1], was[2], was[3], was[0], was[5]]);
      await expect(shop).toBeVisible();
      expect(await attrs(slots, "aria-expanded")).toEqual(["false", "false", "false", "false", "true", "false"]);
      await shop.getByRole("button", { name: "Close item picker" }).click();
    },
  );
  let cost = 0;
  await step(
    "✕ on slot 6 sells it",
    async () => {
      cost = await gold();
      await slots.nth(5).hover();
      await slots
        .nth(5)
        .getByRole("button", { name: /^Sell / })
        .click();
    },
    async () => {
      expect((await items())[5]).toBeNull();
      expect(await gold()).toBeLessThan(cost);
    },
  );
  await step(
    "Delete sells the focused slot 3, the focus stays",
    async () => {
      await slots.nth(2).focus();
      await page.keyboard.press("Delete");
    },
    async () => {
      expect((await items())[2]).toBeNull();
      expect(await focusedSlot()).toBe(2);
    },
  );
  await step(
    "ArrowRight moves the focused slot 4's item, the focus with it",
    async () => {
      was = await items();
      await slots.nth(3).focus();
      await page.keyboard.press("ArrowRight");
    },
    async () => {
      expect(await items()).toEqual([...was.slice(0, 3), was[4], was[3], was[5]]);
      expect(await focusedSlot()).toBe(4);
    },
  );
  const moved = await items();
  await step(
    "Undo puts it back",
    () => undo.click(),
    async () => expect(await items()).toEqual(was),
  );
  await step(
    "Redo moves it again",
    () => redo.click(),
    async () => expect(await items()).toEqual(moved),
  );
  await step(
    "Ctrl+Z on a slot undoes",
    async () => {
      await slots.nth(0).focus();
      await page.keyboard.press("Control+z");
    },
    async () => expect(await items()).toEqual(was),
  );
  await step(
    "Ctrl+Shift+Z redoes",
    () => page.keyboard.press("Control+Shift+Z"),
    async () => expect(await items()).toEqual(moved),
  );
  await step(
    "Ctrl+Z with nothing focused undoes",
    async () => {
      await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
      await page.keyboard.press("Control+z");
    },
    async () => expect(await items()).toEqual(was),
  );
  await step(
    "Ctrl+Y redoes",
    () => page.keyboard.press("Control+y"),
    async () => expect(await items()).toEqual(moved),
  );
  await step(
    "Ctrl+Z in the champion search isn't an undo",
    async () => {
      const search = ui.card("Champion").getByRole("searchbox", { name: "Champion" });
      await search.focus();
      await page.keyboard.press("Control+z");
      await search.press("Escape");
    },
    async () => expect(await items()).toEqual(moved),
  );
  await step(
    "a buy in Item value fills a slot",
    () => ui.card("Item value").getByRole("row").nth(1).click(),
    async () => expect((await items()).filter((x) => x != null).length).toBe(moved.filter((x) => x != null).length + 1),
  );
  await step(
    "Undo takes it back",
    () => undo.click(),
    async () => expect(await items()).toEqual(moved),
  );
  // An item dropped on a slot, the pointer resting there, and before its card's delay is up the
  // keyboard moves it on: the slot left empty under the pointer gets no card, then or once the delay is up.
  let [from, at] = [0, 0];
  await step(
    "an item dropped, then moved on by the keyboard: no card for the slot the pointer rests on",
    async () => {
      was = await items();
      from = was.findIndex((x) => x != null);
      at = was.findIndex((x, k) => x === null && was[k + 1] === null);
      await ui.drag(slots.nth(from), slots.nth(at));
      await slots.nth(at).focus();
      await page.keyboard.press("ArrowRight");
      // Past the delay: a timer set after the card's, for longer, fires after it.
      await page.evaluate(() => new Promise((done) => setTimeout(done, 250)));
      await page.evaluate(() => (document.activeElement as HTMLElement).blur());
    },
    async () => {
      expect(await items()).toEqual(was.map((x, k) => (k === from ? null : k === at + 1 ? was[from] : x)));
      await expect(ui.hovercard).toHaveCount(0);
    },
  );
  await step(
    "the pointer off it: none still",
    () => page.mouse.move(1, 1),
    () => expect(ui.hovercard).toHaveCount(0),
  );
});
