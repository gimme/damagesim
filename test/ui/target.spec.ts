// The Target card: its five modes, a preset's build, a champion with items, and the editable table of custom numbers.

import { test, expect, attrs, num, type UI } from "./ui.ts";

const parts = (ui: UI) => {
  const card = ui.card("Target");
  const row = (label: string) => card.locator("table.target-stats tbody tr").filter({ has: ui.page.getByRole("rowheader", { name: label }) });
  return {
    card,
    mode: (m: string) => card.getByRole("group", { name: "Target" }).getByRole("button", { name: m }),
    level: card.getByRole("slider", { name: "Target level relative to yours" }),
    levelText: card.locator(".target-field strong.num"),
    items: card.locator(".target-item:not(.later)"),
    later: card.locator(".target-item.later"),
    shop: card.locator(".item-picker"),
    /** A stat's base, bonus and total, shown or typed. */
    stat: async (label: string) => {
      const inputs = row(label).locator("input");
      if (await inputs.count()) return Promise.all([0, 1, 2].map(async (i) => Number(await inputs.nth(i).inputValue())));
      return (await row(label).locator("td").allInnerTexts()).map(num);
    },
    field: (label: string) => card.getByRole("spinbutton", { name: label, exact: true }),
  };
};

test("presets and their builds", async ({ ui }) => {
  const { step } = ui;
  const { card, mode, level, levelText, items, later, shop, stat } = parts(ui);
  let squishy = { health: 0, total: 0 };

  await step(
    "load: a squishy, its health as base + bonus",
    () => ui.open(),
    async () => {
      await expect(mode("Squishy")).toHaveAttribute("aria-pressed", "true");
      const [base, bonus, total] = await stat("Health");
      expect(base + bonus).toBe(total);
      squishy = { health: total, total: await ui.total() };
    },
  );
  await step(
    "Bruiser",
    () => mode("Bruiser").click(),
    async () => {
      await expect(mode("Bruiser")).toHaveAttribute("aria-pressed", "true");
      await expect(mode("Squishy")).toHaveAttribute("aria-pressed", "false");
      expect((await ui.state()).target.mode).toBe("bruiser");
    },
  );
  await step(
    "Tank: more health, less damage taken",
    () => mode("Tank").click(),
    async () => {
      expect((await stat("Health"))[2]).toBeGreaterThan(squishy.health);
      expect(await ui.total()).toBeLessThan(squishy.total);
    },
  );
  await step(
    "Squishy again",
    () => mode("Squishy").click(),
    async () => expect(await ui.total()).toBe(squishy.total),
  );
  await step(
    "level +2: yours and 2",
    async () => {
      await level.focus();
      await level.press("ArrowRight");
      await level.press("ArrowRight");
    },
    () => expect(levelText).toHaveText("+2 (lvl 13)"),
  );
  await step(
    "Home: −5",
    () => level.press("Home"),
    () => expect(levelText).toHaveText("−5 (lvl 6)"),
  );
  await step(
    "End: +5",
    () => level.press("End"),
    () => expect(levelText).toHaveText("+5 (lvl 16)"),
  );
  await step(
    "the same level: its typical build now, the items it buys later faded",
    async () => {
      for (let i = 0; i < 5; i++) await level.press("ArrowLeft");
    },
    async () => {
      await expect(levelText).toHaveText("same (lvl 11)");
      expect(await later.count()).toBeGreaterThan(0);
      for (const label of await attrs(later, "aria-label")) expect(label).toMatch(/^Add .*, bought around level \d+$/);
    },
  );
  const fadedName = async () => /^Add (.*), bought/.exec((await later.last().getAttribute("aria-label"))!)![1];
  await step(
    "hover a faded item: its card names it",
    () => later.last().hover(),
    async () => expect(ui.hovercard).toContainText(await fadedName()),
  );
  let count = 0;
  await step(
    "click it: bought now, the build yours",
    async () => {
      count = await items.count();
      await later.last().click();
    },
    async () => {
      await expect(items).toHaveCount(count + 1);
      await expect(later).toHaveCount(0);
      await expect(card.getByRole("button", { name: "Use the typical build" })).toBeVisible();
      expect((await ui.state()).target.builds.squishy).toHaveLength(count + 1);
    },
  );
  await step(
    "click an item: removed",
    () => items.first().click(),
    () => expect(items).toHaveCount(count),
  );
  await step(
    "Use the typical build",
    () => card.getByRole("button", { name: "Use the typical build" }).click(),
    async () => {
      expect((await ui.state()).target.builds).toEqual({});
      expect(await later.count()).toBeGreaterThan(0);
    },
  );
  await step(
    "+ item, thornmail, Enter: in its build",
    async () => {
      await card.getByRole("button", { name: "+ item" }).click();
      await shop.getByRole("searchbox", { name: "Search items" }).fill("thornmail");
      await shop.getByRole("searchbox", { name: "Search items" }).press("Enter");
    },
    () => expect(card.getByRole("button", { name: "Remove Thornmail" })).toBeVisible(),
  );
  await step(
    "the tank's build is its own",
    () => mode("Tank").click(),
    () => expect(card.getByRole("button", { name: "Remove Thornmail" })).toHaveCount(0),
  );
  await step(
    "the squishy's still has it",
    () => mode("Squishy").click(),
    () => expect(card.getByRole("button", { name: "Remove Thornmail" })).toBeVisible(),
  );
  let total = 0;
  await step(
    "Current HP 50%",
    async () => {
      total = await ui.total();
      const hp = card.getByRole("slider", { name: /^Current HP/ });
      await hp.focus();
      for (let i = 0; i < 50; i++) await hp.press("ArrowLeft");
    },
    async () => {
      await expect(card.getByRole("slider", { name: "Current HP (50%)" })).toBeVisible();
      expect((await ui.state()).target.hpPercent).toBe(50);
    },
  );
  await step(
    "damage reduction 20%: less damage",
    async () => {
      total = await ui.total();
      await card.getByRole("spinbutton", { name: "Damage reduction %" }).fill("20");
    },
    async () => {
      expect((await ui.state()).target.damageReduction).toBe(0.2);
      expect(await ui.total()).toBeLessThan(total);
    },
  );
});

test("champion and custom numbers", async ({ ui }) => {
  const { page, step } = ui;
  const { card, mode, levelText, items, shop, stat, field } = parts(ui);
  const search = card.getByRole("searchbox", { name: "Target champion" });
  const options = card.getByRole("option");

  await step("load", () => ui.open());
  await step(
    "Champion: Jinx with an item",
    () => mode("Champion").click(),
    async () => {
      await expect(search).toHaveValue("Jinx");
      await expect(items).toHaveCount(1);
    },
  );
  await step(
    "malph, click the first",
    async () => {
      await search.click();
      await search.fill("malph");
      await options.first().click();
    },
    async () => {
      await expect(search).toHaveValue("Malphite");
      expect((await ui.state()).target.champion).toBe("Malphite");
    },
  );
  let first = "";
  await step(
    "gar, ArrowDown, ArrowUp, Enter: the first match",
    async () => {
      await search.click();
      await search.fill("gar");
      first = await options.first().locator("span:not(.icon):not(.badge)").first().innerText();
      for (const key of ["ArrowDown", "ArrowUp", "Enter"]) await search.press(key);
    },
    () => expect(search).toHaveValue(first),
  );
  await step(
    "+ item, randuin, click it",
    async () => {
      await card.getByRole("button", { name: "+ item" }).click();
      await shop.getByRole("searchbox", { name: "Search items" }).fill("randuin");
      await shop.locator(".item-option").first().click();
    },
    async () => {
      await expect(items).toHaveCount(2);
      await expect(card.getByRole("button", { name: "Remove Randuin's Omen" })).toBeVisible();
    },
  );
  await step(
    "hover it: its card names it, only its stats count",
    () => items.last().hover(),
    async () => {
      await expect(ui.hovercard).toContainText("Randuin's Omen");
      await expect(ui.hovercard).toContainText("Only its stats count");
    },
  );
  await step(
    "click the first item: removed",
    () => items.first().click(),
    async () => {
      await expect(items).toHaveCount(1);
      await expect(ui.hovercard).toHaveCount(0);
    },
  );
  await step(
    "level −1",
    async () => {
      await card.getByRole("slider", { name: "Target level relative to yours" }).focus();
      await page.keyboard.press("ArrowLeft");
    },
    () => expect(levelText).toHaveText("−1 (lvl 10)"),
  );

  const stats = async () => Object.fromEntries(await Promise.all(["Health", "Armor", "Magic resist"].map(async (s) => [s, await stat(s)] as const)));
  let shown: Record<string, number[]> = {};
  await step(
    "Custom: the champion's numbers, to type in",
    async () => {
      shown = await stats();
      await mode("Custom").click();
    },
    async () => {
      await expect(field("Base health")).toBeVisible();
      expect(await stats()).toEqual(shown);
    },
  );
  await step(
    "base health 2000: the total follows",
    () => field("Base health").fill("2000"),
    async () => {
      const [base, bonus, total] = await stat("Health");
      expect(base).toBe(2000);
      expect(total).toBe(base + bonus);
    },
  );
  const mr = await stat("Magic resist");
  await step(
    "total magic resist 120 typed: nothing yet",
    () => field("Total magic resist").fill("120"),
    async () => expect((await ui.state()).target.bonus.mr).toBe(mr[1]),
  );
  await step(
    "Enter: the base kept, the bonus the rest",
    () => field("Total magic resist").press("Enter"),
    async () => expect(await stat("Magic resist")).toEqual([mr[0], 120 - mr[0], 120]),
  );
  await step(
    "total health 1500, then another field: below the base, the base goes down",
    async () => {
      await field("Total health").fill("1500");
      await field("Base armor").focus();
    },
    async () => expect(await stat("Health")).toEqual([1500, 0, 1500]),
  );
  const armor = await stat("Armor");
  await step(
    "total armor 999, Escape: as it was",
    async () => {
      await field("Total armor").fill("999");
      await field("Total armor").press("Escape");
      await field("Base armor").focus();
    },
    async () => expect(await stat("Armor")).toEqual(armor),
  );
  await step(
    "base armor −5 is 0",
    () => field("Base armor").fill("-5"),
    async () => expect((await stat("Armor"))[0]).toBe(0),
  );
  await step(
    "Champion, then Custom again: from the champion's numbers again",
    async () => {
      await mode("Champion").click();
      await expect(field("Base health")).toHaveCount(0);
      shown = await stats();
      await mode("Custom").click();
    },
    async () => {
      await expect(field("Base health")).toBeVisible();
      expect(await stats()).toEqual(shown);
    },
  );
});

test("settings", async ({ ui }) => {
  const { step } = ui;
  const box = ui.card("Settings").getByRole("checkbox", { name: "Let burns and bleeds finish after the combo" });
  let total = 0;
  await step(
    "load Ignite in the combo: burns and bleeds finish",
    () => ui.open({ combo: "E Q W R AA R ignite" }),
    async () => {
      await expect(box).toBeChecked();
      total = await ui.total();
    },
  );
  await step(
    "uncheck it: only what lands in the combo",
    () => box.click(),
    async () => {
      await expect(box).not.toBeChecked();
      expect(await ui.total()).toBeLessThan(total);
    },
  );
  await step(
    "check it by its label: as before",
    () => ui.card("Settings").getByText("Let burns and bleeds finish after the combo").click(),
    async () => {
      await expect(box).toBeChecked();
      expect(await ui.total()).toBe(total);
    },
  );
});

test("executes: the line on the health bar, and the setting that turns them off", async ({ ui }) => {
  const { step } = ui;
  const box = ui.card("Settings").getByRole("checkbox", { name: "Executes kill below their health line" });
  const bar = ui.card("Result").getByRole("img", { name: /^Target health bar/ });
  let total = 0;
  await step(
    "load Zeri's Burst Fire and an uncharged attack on 220 health, 300 units away: the attack takes it below her execute line, marked on the bar",
    () =>
      ui.open({
        champion: "Zeri",
        items: [],
        options: { charged: 0, distance: 300 },
        combo: "Q AA",
        target: { mode: "custom", base: { hp: 220, armor: 30, mr: 30 }, bonus: { hp: 0, armor: 0, mr: 0 } },
      }),
    async () => {
      await expect(box).toBeChecked();
      await expect(bar).toHaveAttribute("aria-label", /; Living Battery \(execute\) below \d+$/);
      await expect(ui.card("Result").locator(".stat-tile.end")).toContainText("Kill at");
      total = await ui.total();
    },
  );
  await step(
    "hover the line: the execute and the health it kills below",
    async () => {
      const line = num(/below ([\d,]+)$/.exec((await bar.getAttribute("aria-label"))!)![1]);
      const b = (await bar.boundingBox())!;
      await ui.page.mouse.move(b.x + b.width * (1 - line / 220), b.y + 10);
    },
    async () => {
      await expect(ui.tooltip).toContainText("Living Battery (execute)");
      await expect(ui.tooltip).toContainText("Kills below");
    },
  );
  await step("the pointer away", () => ui.unhover());
  await step(
    "uncheck it: no execute, no line",
    () => box.click(),
    async () => {
      await expect(bar).not.toHaveAttribute("aria-label", /execute/);
      await expect(ui.card("Result").locator(".stat-tile.end")).toHaveCount(0);
      expect(await ui.total()).toBeLessThan(total);
    },
  );
  await step(
    "check it again: as before",
    () => box.click(),
    async () => {
      await expect(bar).toHaveAttribute("aria-label", /execute/);
      expect(await ui.total()).toBe(total);
    },
  );
});
