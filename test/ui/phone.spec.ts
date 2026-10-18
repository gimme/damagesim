// A phone: one column that fits the screen, the shards inside their column, Item value's phone layout
// and its tapped cards, a finger held on an item for its card, and a step dragged by a finger.

import type { Locator } from "@playwright/test";
import { test, expect, type UI } from "./ui.ts";

test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, itemValue: true });

/** A finger on the screen, through the browser's touch input. */
async function finger(ui: UI) {
  const cdp = await ui.page.context().newCDPSession(ui.page);
  const touch = (type: "touchStart" | "touchMove" | "touchEnd" | "touchCancel", x = 0, y = 0) =>
    cdp.send("Input.dispatchTouchEvent", { type, touchPoints: type === "touchEnd" || type === "touchCancel" ? [] : [{ x, y }] });
  return {
    down: (x: number, y: number) => touch("touchStart", x, y),
    move: async (x0: number, y0: number, x1: number, y1: number, steps = 16) => {
      for (let i = 1; i <= steps; i++) await touch("touchMove", x0 + ((x1 - x0) * i) / steps, y0 + ((y1 - y0) * i) / steps);
    },
    up: () => touch("touchEnd"),
    cancel: () => touch("touchCancel"),
  };
}

/** A locator's middle on screen, scrolled into view. */
const middle = async (loc: Locator) => {
  await loc.scrollIntoViewIfNeeded();
  const b = (await loc.boundingBox())!;
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
};

test("phone width", async ({ ui }) => {
  const { page, step } = ui;
  /** One column, and nothing past the screen's right edge but what scrolls in a box of its own (the tabs, the events). */
  const fits = async () => {
    const layout = await page.evaluate(() => {
      const width = document.documentElement.clientWidth;
      return {
        scroll: document.documentElement.scrollWidth - width,
        columns: new Set([...document.querySelectorAll("section.card")].map((c) => Math.round(c.getBoundingClientRect().left))).size,
        outside: [...document.querySelectorAll("body *")]
          .filter((e) => e.getBoundingClientRect().right > width + 0.5)
          .filter((e) => {
            for (let p = e.parentElement; p && p !== document.body; p = p.parentElement) if (getComputedStyle(p).overflowX !== "visible") return false;
            return true;
          })
          .map((e) => `${e.tagName.toLowerCase()}.${e.getAttribute("class") ?? ""}`),
      };
    });
    expect(layout).toEqual({ scroll: 0, columns: 1, outside: [] });
  };
  await step("load: one column, nothing past the screen's edge", () => ui.open(), fits);
  await step(
    "Runes: the shards and their stats inside the secondary tree's column",
    async () => {},
    async () => {
      const column = (await ui.card("Runes").locator(".rune-tree").nth(1).boundingBox())!;
      for (const row of ["Offense", "Flex", "Defense"]) {
        const b = (await ui
          .card("Runes")
          .getByRole("group", { name: `${row} shard`, exact: true })
          .boundingBox())!;
        expect(b.x).toBeGreaterThanOrEqual(column.x);
        expect(b.x + b.width).toBeLessThanOrEqual(column.x + column.width);
        expect(b.y + b.height).toBeLessThanOrEqual(column.y + column.height);
      }
    },
  );

  const iv = ui.card("Item value");
  const rows = iv
    .getByRole("table")
    .getByRole("row")
    .filter({ has: page.getByRole("cell") });
  const swap = iv.getByRole("button", { name: /^Ranked / });
  await step(
    "Item value: one number a row, its heading switches it",
    () => swap.tap(),
    async () => {
      await expect(swap).toHaveAccessibleName("Ranked by damage; rank per 1000 gold");
      await expect(rows.first().locator(".iv-name")).toBeHidden();
    },
  );
  let name = "";
  await step(
    "tap a row's item: its card, with Buy",
    async () => {
      name = (await rows.first().getByRole("button").getAttribute("aria-label"))!.replace(/^Buy (.*) in slot \d.*$/, "$1");
      await rows.first().locator(".iv-icon").tap();
    },
    async () => {
      await expect(ui.tooltip).toContainText(name);
      await expect(ui.tooltip.getByRole("button", { name: `Buy ${name} in slot 3` })).toBeVisible();
    },
  );
  await step(
    "tap it again: closed",
    () => rows.first().locator(".iv-icon").tap(),
    () => expect(ui.tooltip).toHaveCount(0),
  );
  await step(
    "tap the row's bar: where its damage comes from",
    () => rows.first().locator(".iv-track").tap(),
    () => expect(ui.tooltip).toContainText(`${name} · `),
  );
  await step(
    "Buy: in slot 3",
    () => ui.tooltip.getByRole("button", { name: /^Buy / }).tap(),
    async () => {
      await expect(ui.tooltip).toHaveCount(0);
      await expect(ui.card("Items").locator(".slots > .slot").nth(2)).toHaveAttribute("aria-label", new RegExp(`^Item slot 3: ${name}\\.`));
    },
  );

  const f = await finger(ui);
  const slot = ui.card("Items").locator(".slots > .slot").first();
  await step(
    "a finger held on slot 1: its card",
    async () => {
      const m = await middle(slot);
      await f.down(m.x, m.y);
    },
    () => expect(ui.hovercard).toContainText("Luden's Echo"),
  );
  await step(
    "the touch cancelled: closed, no shop",
    () => f.cancel(),
    async () => {
      await expect(ui.hovercard).toHaveCount(0);
      await expect(ui.card("Items").locator(".item-picker")).toHaveCount(0);
    },
  );

  const chips = ui.card("Combo").getByRole("listitem");
  await step(
    "a finger drags step 1 after step 3",
    async () => {
      const a = await middle(chips.nth(0));
      const b = (await chips.nth(2).boundingBox())!;
      await f.down(a.x, a.y);
      await f.move(a.x, a.y, b.x + b.width * 0.9, b.y + b.height / 2);
      await ui.settle();
      await f.up();
    },
    async () => expect((await ui.state()).combo).toBe("Q W E R AA R"),
  );
  await step(
    "tap the key for the boots slot: seven slots, and the page still fits",
    () => ui.card("Items").getByRole("button", { name: "Add an extra boots slot" }).tap(),
    async () => {
      await expect(ui.card("Items").locator(".slots > .slot:not(.vacated)")).toHaveCount(7);
      await expect(ui.card("Item value").locator(".slots > .slot:not(.vacated)")).toHaveCount(7);
      await fits();
    },
  );
});
