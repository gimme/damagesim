// The Champion card: the champion search, level and ranks, ability cards, and the parameters section.

import { test, expect, attrs, num, texts, type UI } from "./ui.ts";

const parts = (ui: UI) => {
  const card = ui.card("Champion");
  return {
    card,
    search: card.getByRole("searchbox", { name: "Champion" }),
    list: card.getByRole("listbox"),
    options: card.getByRole("listbox").getByRole("option"),
    level: card.getByRole("slider", { name: "Champion level" }),
    rank: (k: string) => card.getByRole("spinbutton", { name: `${k} rank` }),
    ranks: async () => Promise.all(["Q", "W", "E", "R"].map(async (k) => Number(await card.getByRole("spinbutton", { name: `${k} rank` }).inputValue()))),
  };
};

test("search and picking", async ({ ui }) => {
  const { page, step } = ui;
  const { search, list, options } = parts(ui);
  let all = 0;
  let total = 0;

  await step(
    "load: Ahri",
    () => ui.open(),
    async () => {
      await expect(search).toHaveValue("Ahri");
      total = await ui.total();
      expect(total).toBeGreaterThan(0);
    },
  );
  await step(
    "focus the search: every champion, the first selected",
    () => search.click(),
    async () => {
      all = await options.count();
      expect(all).toBeGreaterThan(100);
      await expect(options.first()).toHaveAttribute("aria-selected", "true");
    },
  );
  await step(
    "type lu: fewer, the first selected",
    () => search.fill("lu"),
    async () => {
      expect(await options.count()).toBeLessThan(all);
      await expect(options.first()).toHaveAttribute("aria-selected", "true");
    },
  );
  await step(
    "the pointer over the second selects it",
    () => options.nth(1).hover(),
    () => expect(options.nth(1)).toHaveAttribute("aria-selected", "true"),
  );
  await step(
    "click Lux: picked, the result changes, the focus stays in the search",
    () => options.filter({ hasText: /^Lux/ }).click(),
    async () => {
      await expect(search).toHaveValue("Lux");
      await expect(list).toHaveCount(0);
      await expect(search).toBeFocused();
      expect((await ui.state()).champion).toBe("Lux");
      expect(await ui.total()).not.toBe(total);
    },
  );
  await step(
    "a click opens the list again, a new search",
    () => search.click(),
    async () => {
      await expect(search).toHaveValue("");
      await expect(options).toHaveCount(all);
    },
  );
  let second = "";
  await step(
    "ze, ArrowDown twice, ArrowUp, Enter: the second match",
    async () => {
      await search.pressSequentially("ze");
      second = (await texts(options.nth(1).locator("span:not(.icon):not(.badge)")))[0];
      for (const key of ["ArrowDown", "ArrowDown", "ArrowUp", "Enter"]) await search.press(key);
    },
    async () => {
      await expect(search).toHaveValue(second);
      await expect(list).toHaveCount(0);
      await expect(search).toBeFocused();
    },
  );
  await step(
    "Enter again picks nothing",
    () => search.press("Enter"),
    () => expect(search).toHaveValue(second),
  );
  await step(
    "typing opens the list, a new search",
    () => search.pressSequentially("lux"),
    async () => {
      await expect(search).toHaveValue("lux");
      await expect(options.first()).toHaveText(/^Lux/);
    },
  );
  await step(
    "Escape closes it, the field shows the champion",
    () => search.press("Escape"),
    async () => {
      await expect(list).toHaveCount(0);
      await expect(search).toHaveValue(second);
    },
  );
  await step(
    "Escape again changes nothing",
    () => search.press("Escape"),
    () => expect(list).toHaveCount(0),
  );
  await step(
    "ArrowDown opens it",
    () => search.press("ArrowDown"),
    () => expect(options).toHaveCount(all),
  );
  await step(
    "no match",
    () => search.fill("qqqq"),
    async () => {
      await expect(list).toHaveText("No champion matches “qqqq”.");
      await expect(options).toHaveCount(0);
    },
  );
  await step(
    "Escape, Backspace: a new search",
    async () => {
      await search.press("Escape");
      await search.press("Backspace");
    },
    async () => {
      await expect(search).toHaveValue("");
      await expect(options).toHaveCount(all);
    },
  );
  await step(
    "Tab away and back: the list opens",
    async () => {
      await search.press("Escape");
      await page.keyboard.press("Tab");
      await page.keyboard.press("Shift+Tab");
    },
    () => expect(options).toHaveCount(all),
  );
});

test("level and ranks", async ({ ui }) => {
  const { step } = ui;
  const { card, level, rank, ranks } = parts(ui);
  const sum = async () => (await ranks()).reduce((a, b) => a + b, 0);
  const reset = card.getByRole("button", { name: "Reset to default leveling" });
  let total = 0;

  await step(
    "load: level 11, a point per level",
    () => ui.open(),
    async () => {
      await expect(level).toHaveValue("11");
      expect(await sum()).toBe(11);
      total = await ui.total();
    },
  );
  await step(
    "End: level 20, the most points, the result changes",
    () => level.press("End"),
    async () => {
      await expect(level).toHaveValue("20");
      await expect(card.locator("strong.num").first()).toHaveText("20");
      expect(await sum()).toBe(18);
      expect(await ui.total()).not.toBe(total);
    },
  );
  await step(
    "Home: level 1, one point",
    () => level.press("Home"),
    async () => {
      await expect(level).toHaveValue("1");
      expect(await sum()).toBe(1);
    },
  );
  await step(
    "Q and W rank 5 at level 1: too many points, a reset",
    async () => {
      await rank("Q").fill("5");
      await rank("W").fill("5");
    },
    async () => {
      await expect(card.locator(".notice.warn")).toContainText("skill points used at level 1");
      await expect(reset).toBeVisible();
      expect((await ui.state()).ranks).toMatchObject({ Q: 5, W: 5 });
    },
  );
  await step(
    "R rank 9 is its most",
    () => rank("R").fill("9"),
    async () => expect(rank("R")).toHaveValue((await rank("R").getAttribute("max"))!),
  );
  await step(
    "Reset to default leveling",
    () => reset.click(),
    async () => {
      await expect(card.locator(".notice.warn")).toHaveCount(0);
      await expect(reset).toHaveCount(0);
      expect((await ui.state()).ranks).toBeNull();
      expect(await sum()).toBe(1);
    },
  );
  let qwe: number[] = [];
  await step(
    "level 11",
    async () => {
      for (let i = 0; i < 10; i++) await level.press("ArrowRight");
    },
    async () => {
      qwe = await ranks();
    },
  );
  await step(
    "max order EWQ: E and Q trade their points",
    () => card.getByRole("combobox", { name: "Max order" }).selectOption("EWQ"),
    async () => {
      expect(await ranks()).toEqual([qwe[2], qwe[1], qwe[0], qwe[3]]);
      expect((await ui.state()).skillOrder).toBe("EWQ");
    },
  );
});

test("ability cards and parameters", async ({ ui }) => {
  const { page, step } = ui;
  const { card, search } = parts(ui);
  const key = (k: string) =>
    card
      .locator("label.field")
      .filter({ has: page.getByRole("spinbutton", { name: `${k} rank` }) })
      .locator("span[tabindex]");
  const named = async (k: string) => (await key(k).getAttribute("aria-label"))!;

  await step("load", () => ui.open());
  // The keys' labels name the abilities; the card shows after a moment, then moves from key to key at once.
  await step(
    "hover Q: its card names it, with its rank",
    () => key("Q").hover(),
    async () => {
      await expect(ui.hovercard).toContainText(await named("Q"));
      await expect(ui.hovercard).toContainText(/Rank \d\/\d/);
    },
  );
  await step(
    "hover W: its card at once",
    () => key("W").hover(),
    async () => expect(ui.hovercard).toContainText(await named("W")),
  );
  await step("the pointer away closes it", () => ui.unhover());
  await step(
    "Tab to the Q key: its card",
    async () => {
      await card.getByLabel("Q rank").focus();
      await page.keyboard.press("Shift+Tab");
    },
    async () => expect(ui.hovercard).toContainText(await named("Q")),
  );
  await step(
    "Tab on closes it",
    () => page.keyboard.press("Tab"),
    () => expect(ui.hovercard).toHaveCount(0),
  );

  // Vex: her kit's toggle, the distance every kit has, and the items' and runes' parameters.
  const params = card.locator("details");
  await step(
    "Vex, the parameters opened: as many as the summary says",
    async () => {
      await search.click();
      await search.fill("vex");
      await search.press("Enter");
      await params.locator("summary").click();
    },
    async () => expect(params.locator("input")).toHaveCount(num((await params.locator("summary").innerText()).replace(/^[^(]*/, ""))),
  );
  await step(
    "uncheck Doom ready at start",
    () => params.getByRole("checkbox", { name: "Doom ready at start" }).click(),
    async () => expect((await ui.state()).options).toMatchObject({ doom: 0 }),
  );
  await step(
    "distance 500",
    () => params.getByRole("spinbutton", { name: "Distance to target (units)" }).fill("500"),
    async () => expect((await ui.state()).options).toMatchObject({ distance: 500 }),
  );
  const sources = params.locator(".opt-sources [role=img]");
  await step(
    "hover the last source: its card names it",
    () => sources.last().hover(),
    async () => expect(ui.hovercard).toContainText((await attrs(sources, "aria-label")).at(-1)!),
  );
  await step("the pointer away", () => ui.unhover());
  await step(
    "Zed: his parameters, the ones set gone",
    async () => {
      await search.click();
      await search.fill("zed");
      await search.press("Enter");
    },
    async () => {
      expect((await ui.state()).options).toEqual({});
      await expect(params.getByRole("checkbox", { name: "Doom ready at start" })).toHaveCount(0);
    },
  );
});
