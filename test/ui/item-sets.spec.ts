// Item value's sets: how many items to rank together, the best sets of them, a set's item clicked to
// leave it out of the ranking (in the setup, so in the page's address), the items left out at the top
// of the card, put back one by one or all at once, and a set bought into the empty slots.

import { test, expect, attrs, num, texts, type UI } from "./ui.ts";
import type { Locator } from "@playwright/test";

// Every step checks the ranking as the build then is.
test.use({ itemValue: true });

const parts = (ui: UI) => {
  const card = ui.card("Item value");
  // The rows: not the heading's, nor Show more's.
  const rows = card
    .getByRole("table")
    .getByRole("row")
    .filter({ has: ui.page.getByRole("cell") })
    .filter({ hasNot: ui.page.getByRole("button", { name: /^Show (more|less)$/ }) });
  /** A set's items, each a button that leaves it out of the ranking. */
  const items = (row: Locator) => row.getByRole("button", { name: /^Exclude / });
  return {
    card,
    rows,
    items,
    /** The names of a set's items. */
    names: async (row: Locator) => (await attrs(items(row), "aria-label")).map((l) => /^Exclude (.*) from the ranking$/.exec(l!)![1]),
    picker: card.getByRole("group", { name: "Items" }),
    caption: card.locator(".iv-caption"),
    excluded: card.getByRole("group", { name: "Items left out of the ranking" }),
    perGold: async () => (await texts(rows.locator(".iv-pg"))).map(num),
    /** The names of the build's items, by slot, as Items shows them. */
    build: async () =>
      (await attrs(ui.card("Items").locator(".slots > .slot:not(.vacated)"), "aria-label")).map(
        (l) => /^Item slot \d: (.*)\. Arrow keys/.exec(l!)?.[1] ?? null,
      ),
  };
};

const descending = (xs: number[]) => xs.every((x, i) => i === 0 || xs[i - 1] >= x);

test("sets of items, and items left out of the ranking", async ({ ui }) => {
  const { page, step } = ui;
  const { card, rows, items, names, picker, caption, excluded, perGold, build } = parts(ui);
  const count = (n: number) => picker.getByRole("button", { name: String(n), exact: true });
  const excludedIds = async () => (await ui.state()).excluded;

  await step(
    "load: one item ranked; as many together as there are empty slots, four",
    () => ui.open(),
    async () => {
      await expect(count(1)).toHaveAttribute("aria-pressed", "true");
      for (const n of [2, 3, 4]) await expect(count(n)).toBeEnabled();
      for (const n of [5, 6]) await expect(count(n)).toBeDisabled();
      await expect(excluded).toHaveCount(0);
    },
  );
  await step(
    "3 items: the best sets of 3, per gold",
    () => count(3).click(),
    async () => {
      await expect(caption).toHaveText("Next 3 items");
      await expect(card.getByRole("table", { name: "Sets of items ranked by the damage they add" })).toBeVisible();
      const shown = await rows.count();
      expect(shown).toBeGreaterThan(0);
      expect(shown).toBeLessThanOrEqual(8);
      for (let i = 0; i < shown; i++) await expect(items(rows.nth(i))).toHaveCount(3);
      expect(descending(await perGold())).toBe(true);
      // No slot is ranked: a set fills the empty ones.
      await expect(card.locator(".slots > .slot[aria-pressed=true]")).toHaveCount(0);
      // Its progress, shown only for a search that takes a while, is gone once it's done.
      await expect(card.getByRole("progressbar")).toHaveCount(0);
    },
  );
  let set: string[] = [];
  await step(
    "hover a set's bar: its items and where its damage comes from, a click buys all 3",
    async () => {
      set = await names(rows.first());
      await rows.first().locator(".iv-track").hover();
    },
    async () => {
      await expect(ui.tooltip).toContainText(`${set.join(" + ")} · `);
      await expect(ui.tooltip).toContainText("Click to buy all 3");
    },
  );
  await step(
    "hover its first item: its card, a click leaves it out",
    () => items(rows.first()).first().hover(),
    async () => {
      await expect(ui.tooltip).toContainText(set[0]);
      await expect(ui.tooltip).toContainText("Click to leave it out of the ranking");
    },
  );
  let first = 0;
  await step(
    "click it: left out of the ranking, in the page's address, listed at the top, and in no set",
    async () => {
      first = Number(await items(rows.first()).first().getAttribute("data-item"));
      await items(rows.first()).first().click();
    },
    async () => {
      expect(await excludedIds()).toEqual([first]);
      await expect(excluded.getByRole("button", { name: `Put ${set[0]} back in the ranking` })).toBeVisible();
      await expect(card.getByRole("button", { name: `Exclude ${set[0]} from the ranking` })).toHaveCount(0);
      expect(await rows.count()).toBeGreaterThan(0);
    },
  );
  await ui.unhover();
  let second = 0;
  let other = "";
  await step(
    "Enter on another set's item leaves it out too",
    async () => {
      const button = items(rows.first()).first();
      second = Number(await button.getAttribute("data-item"));
      other = (await names(rows.first()))[0];
      await button.focus();
      await page.keyboard.press("Enter");
    },
    async () => {
      expect(await excludedIds()).toEqual([first, second]);
      await expect(excluded.getByRole("button", { name: /back in the ranking$/ })).toHaveCount(2);
      await expect(card.getByRole("button", { name: `Exclude ${other} from the ranking` })).toHaveCount(0);
    },
  );
  await step(
    "reload: still left out, of the next item's ranking too",
    async () => {
      await page.reload();
      await expect(card).toBeVisible();
    },
    async () => {
      expect(await excludedIds()).toEqual([first, second]);
      await expect(count(1)).toHaveAttribute("aria-pressed", "true");
      await card.getByRole("button", { name: "Show more" }).click();
      const listed = await texts(rows.locator(".iv-name"));
      expect(listed.length).toBeGreaterThan(8);
      expect(listed).not.toContain(set[0]);
      expect(listed).not.toContain(other);
    },
  );
  await step(
    "click the first at the top: back in the ranking",
    () => excluded.getByRole("button", { name: `Put ${set[0]} back in the ranking` }).click(),
    async () => {
      expect(await excludedIds()).toEqual([second]);
      expect(await texts(rows.locator(".iv-name"))).toContain(set[0]);
    },
  );
  await step(
    "Clear: all back",
    () => excluded.getByRole("button", { name: "Clear" }).click(),
    async () => {
      expect(await excludedIds()).toEqual([]);
      await expect(excluded).toHaveCount(0);
    },
  );
  const slot1 = (await build())[0]!;
  await step(
    "2 items, then a slot clicked: one item ranked for it",
    async () => {
      await count(2).click();
      await ui.settle();
      await card.locator(".slots > .slot:not(.vacated)").first().click();
    },
    async () => {
      await expect(count(1)).toHaveAttribute("aria-pressed", "true");
      await expect(caption).toHaveText(`In place of ${slot1}`);
    },
  );
  let was: (string | null)[] = [];
  await step(
    "3 items, then a click on the top set: all 3 bought, in the empty slots; one left, one item ranked",
    async () => {
      await count(3).click();
      await ui.settle();
      was = await build();
      set = await names(rows.first());
      await rows.first().locator(".iv-track").click();
    },
    async () => {
      const now = await build();
      expect(now.slice(0, 2)).toEqual(was.slice(0, 2));
      expect(now.filter((x) => x != null).sort()).toEqual([...was.slice(0, 2), ...set].sort() as string[]);
      await expect(caption).toHaveText("Next item");
      await expect(count(1)).toHaveAttribute("aria-pressed", "true");
      for (const n of [2, 3, 4, 5, 6]) await expect(count(n)).toBeDisabled();
    },
  );
});

test("a set's item dragged onto a slot is bought there alone", async ({ ui }) => {
  const { step } = ui;
  const { card, rows, items, names, picker, build } = parts(ui);
  const slots = card.locator(".slots > .slot:not(.vacated)");
  let was: (string | null)[] = [];
  let item = "";
  await step("load, 2 items", async () => {
    await ui.open();
    await picker.getByRole("button", { name: "2", exact: true }).click();
  });
  await step(
    "drag a set's second item onto slot 6: outlined while over it, bought there alone, nothing left out",
    async () => {
      was = await build();
      item = (await names(rows.first()))[1];
      await ui.drag(items(rows.first()).nth(1), slots.nth(5), () => expect(slots.nth(5)).toHaveClass(/landing/));
    },
    async () => {
      expect(await build()).toEqual([...was.slice(0, 5), item]);
      expect((await ui.state()).excluded).toEqual([]);
    },
  );
});
