// The results: the summary and its health bar, the charts in each tab, the events' modifier cards,
// the abilities, stats and resist sweep, and pinning setups to compare.

import { test, expect, num, texts, type UI } from "./ui.ts";

/** Moves the pointer over a chart, at fractions of its width and height. */
const over = async (ui: UI, name: string | RegExp, fx: number, fy: number) => {
  const chart = ui.page.getByRole("img", { name });
  await chart.scrollIntoViewIfNeeded();
  const b = (await chart.boundingBox())!;
  await ui.page.mouse.move(b.x + b.width * fx, b.y + b.height * fy);
};

test("summary and the health bar", async ({ ui }) => {
  const { step } = ui;
  const result = ui.card("Result");
  const bar = result.getByRole("img", { name: /^Target health bar/ });
  const order = result.getByRole("group", { name: "Order the bar's sources" });
  const notes = result.locator(".notice.small:not(.warn)");

  await step(
    "load: the total, its share of the target's health, the time and DPS",
    () => ui.open(),
    async () => {
      const total = await ui.total();
      expect(total).toBeGreaterThan(0);
      const [, dealt, health] = /: ([\d,]+) damage of ([\d,]+) health/.exec((await bar.getAttribute("aria-label"))!)!.map((x) => num(x ?? "0"));
      expect(dealt).toBe(total);
      const share = num(await result.locator(".stat-tile .value").first().innerText());
      expect(share).toBeCloseTo(Math.min(100, (total / health) * 100), 0);
      const [seconds, dps] = (await result.locator(".stat-tile .value").nth(1).innerText()).split("·").map(num);
      expect(seconds).toBeGreaterThan(0);
      expect(Math.abs(dps - total / seconds)).toBeLessThan(2);
    },
  );
  await step(
    "hover the bar's start: a block of hits, its damage and share",
    () => over(ui, /^Target health bar/, 0.05, 0.3),
    () => expect(ui.tooltip).toContainText("max HP"),
  );
  await step(
    "hover its end: the health left",
    () => over(ui, /^Target health bar/, 0.97, 0.3),
    () => expect(ui.tooltip).toContainText("Health left"),
  );
  await step("the pointer away", () => ui.unhover());
  for (const o of ["By source", "Chronological"])
    await step(
      o,
      () => order.getByRole("button", { name: o }).click(),
      () => expect(order.getByRole("button", { name: o })).toHaveAttribute("aria-pressed", "true"),
    );
  await step(
    "the model notes",
    () => result.getByRole("button", { name: /model note/ }).click(),
    async () => {
      const count = num(await result.getByRole("button", { name: /model note/ }).innerText());
      await expect(notes).toHaveCount(count);
    },
  );
  await step(
    "closed again",
    () => result.getByRole("button", { name: /model note/ }).click(),
    () => expect(notes).toHaveCount(0),
  );
  await step(
    "a kill: level 18 against half health",
    async () => {
      const level = ui.card("Champion").getByRole("slider", { name: "Champion level" });
      await level.focus();
      for (let i = 0; i < 7; i++) await level.press("ArrowRight");
      await ui
        .card("Target")
        .getByRole("slider", { name: /^Current HP/ })
        .focus();
      for (let i = 0; i < 50; i++) await ui.page.keyboard.press("ArrowLeft");
    },
    () => expect(result.locator(".stat-tile.end")).toContainText(/Kill at.*✓ \d+\.\d\ds/),
  );
});

test("details tabs", async ({ ui }) => {
  const { page, step } = ui;
  const details = ui.details();
  const tab = (t: string) => details.getByRole("tab", { name: t, exact: true });
  const rows = details.locator("table tbody tr");
  const column = async (i: number) => (await texts(rows.locator(`td:nth-child(${i})`))).map((t) => (t === "–" ? 0 : num(t)));

  await step(
    "load: the timeline",
    () => ui.open(),
    async () => {
      await expect(tab("Timeline")).toHaveAttribute("aria-selected", "true");
      await expect(details.getByRole("img", { name: "Target health over time" })).toBeVisible();
    },
  );
  await step(
    "hover it: the time and the target's health",
    () => over(ui, "Target health over time", 0.3, 0.5),
    async () => {
      await expect(ui.tooltip).toContainText("t = ");
      await expect(ui.tooltip).toContainText("target HP");
    },
  );
  await step("the pointer away", () => ui.unhover());
  await step(
    "Breakdown: a bar chart, a row per source dealing the total between them",
    () => tab("Breakdown").click(),
    async () => {
      await expect(details.getByRole("img", { name: "Damage by source" })).toBeVisible();
      const dealt = await column(4);
      expect(dealt.length).toBeGreaterThan(0);
      expect(Math.abs(dealt.reduce((a, b) => a + b, 0) - (await ui.total()))).toBeLessThanOrEqual(dealt.length);
      expect(Math.abs((await column(5)).reduce((a, b) => a + b, 0) - 100)).toBeLessThanOrEqual(0.1 * dealt.length);
    },
  );
  await step(
    "hover the first bar: the first source",
    () => details.getByRole("img", { name: "Damage by source" }).locator("g").first().hover(),
    async () => expect(ui.tooltip).toContainText((await texts(rows.first().locator("td").first()))[0]),
  );
  await step("the pointer away", () => ui.unhover());
  await step(
    "Liandry's Torment bought, Events: hits in time order, the target's health going down, modifiers",
    async () => {
      const items = ui.card("Items");
      await items.locator(".slots > .slot").nth(2).click();
      await items.getByRole("searchbox", { name: "Search items" }).fill("liandry");
      await items.getByRole("searchbox", { name: "Search items" }).press("Enter");
      await page.mouse.move(1, 1);
      await tab("Events").click();
    },
    async () => {
      const times = await column(1);
      expect(times.length).toBeGreaterThan(0);
      expect(times.every((t, i) => i === 0 || times[i - 1] <= t)).toBe(true);
      const hp = await column(8);
      expect(hp.every((h, i) => i === 0 || hp[i - 1] >= h)).toBe(true);
      expect(await details.locator(".amps").count()).toBeGreaterThan(0);
    },
  );
  await step(
    "hover a hit's modifiers: their card names them",
    () => details.locator(".amps").first().hover(),
    () => expect(ui.hovercard).toContainText("Liandry's Torment"),
  );
  await step("the pointer away", () => ui.unhover());
  await step(
    "Tab to a hit's modifiers: their card",
    async () => {
      await details.locator(".amps").nth(1).focus();
      await page.keyboard.press("Shift+Tab");
      await page.keyboard.press("Tab");
    },
    () => expect(ui.hovercard).toBeVisible(),
  );
  await step(
    "the focus elsewhere: closed",
    () => page.evaluate(() => (document.activeElement as HTMLElement).blur()),
    () => expect(ui.hovercard).toHaveCount(0),
  );
  await step(
    "Abilities: the passive and the four",
    () => tab("Abilities").click(),
    async () => expect(await texts(details.locator(".ability .kbd"))).toEqual(["P", "Q", "W", "E", "R"]),
  );
  await step(
    "Resist sweep: by magic resist, as the damage is mostly magic",
    () => tab("Resist sweep").click(),
    async () => {
      await expect(details.getByRole("button", { name: "Magic resist" })).toHaveAttribute("aria-pressed", "true");
      await expect(details.getByRole("img", { name: "Damage versus target MR" })).toBeVisible();
    },
  );
  await step(
    "Armor",
    () => details.getByRole("button", { name: "Armor" }).click(),
    () => expect(details.getByRole("img", { name: "Damage versus target armor" })).toBeVisible(),
  );
  await step(
    "hover the sweep: an armor and its total",
    () => over(ui, "Damage versus target armor", 0.4, 0.5),
    async () => {
      await expect(ui.tooltip).toContainText("armor");
      await expect(ui.tooltip).toContainText("Total damage");
    },
  );
  await step("the pointer away", () => ui.unhover());
  await step(
    "Stats: yours and the target's, the items",
    () => tab("Stats").click(),
    async () => {
      await expect(details.locator(".stats-grid > div")).not.toHaveCount(0);
      await expect(details).toContainText("Target: Squishy");
      await expect(details.locator("[data-hovercard]")).toHaveCount(3);
    },
  );
  await step(
    "hover an item: its card names it",
    () => details.locator("[data-hovercard]").first().hover(),
    async () => expect(ui.hovercard).toContainText(await details.locator("[data-hovercard]").first().innerText()),
  );
  await step("the pointer away", () => ui.unhover());
});

test("compare and pinning", async ({ ui }) => {
  const { step } = ui;
  const details = ui.details();
  const pin = details.getByRole("button", { name: "Pin current" });
  const pins = details.getByRole("button", { name: /✕$/ });
  const charts = details.getByRole("img", { name: "Bar chart" });

  await step("load", () => ui.open());
  await step(
    "Compare: nothing pinned",
    () => details.getByRole("tab", { name: "Compare" }).click(),
    async () => {
      await expect(details).toContainText("Nothing pinned yet.");
      await expect(charts).toHaveCount(0);
    },
  );
  await step(
    "Pin current: named for the setup, a chart",
    () => pin.click(),
    async () => {
      await expect(pins).toHaveCount(1);
      await expect(pins.first()).toHaveText(/^Ahri 11: Luden's Echo, Sorcerer's Shoes · E Q W R AA R ✕$/);
      await expect(charts).toHaveCount(1);
    },
  );
  await step(
    "level 16, pin again",
    async () => {
      const level = ui.card("Champion").getByRole("slider", { name: "Champion level" });
      await level.focus();
      for (let i = 0; i < 5; i++) await level.press("ArrowRight");
      await pin.click();
    },
    async () => {
      await expect(pins).toHaveCount(2);
      await expect(pins.last()).toHaveText(/^Ahri 16:/);
    },
  );
  await step(
    "hover the bars: a setup's total",
    () => over(ui, "Bar chart", 0.5, 0.1),
    () => expect(ui.tooltip).toContainText("Total damage"),
  );
  await step("the pointer away", () => ui.unhover());
  await step(
    "unpin the first",
    () => pins.first().click(),
    async () => {
      await expect(pins).toHaveCount(1);
      await expect(pins.first()).toHaveText(/^Ahri 16:/);
    },
  );
  await step(
    "Find best order: a chart of the orders",
    () => details.getByRole("button", { name: "Find best order" }).click(),
    () => expect(charts).toHaveCount(2),
  );
  await step(
    "six pins: no more",
    async () => {
      for (let i = 0; i < 5; i++) await pin.click();
    },
    async () => {
      await expect(pins).toHaveCount(6);
      await expect(pin).toBeDisabled();
    },
  );
});
