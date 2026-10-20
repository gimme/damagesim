// The Champion card: the champion search, level and ranks, ability cards, the parameters section, and
// another champion's page, Back returning.

import { RESET_STATE } from "../../src/web/state.ts";
import { test, expect, attrs, num, texts, type UI } from "./ui.ts";

const parts = (ui: UI) => {
  const card = ui.card("Champion");
  return {
    card,
    /** The champion picker: the champion's icon and name, nothing under it. */
    picker: card.locator(".picker").first(),
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
  const { picker, search, list, options } = parts(ui);
  let all = 0;
  let total = 0;

  await step(
    "load: Ahri, by name alone: no title, no kit status",
    () => ui.open(),
    async () => {
      await expect(search).toHaveValue("Ahri");
      await expect(picker).not.toContainText("Nine-Tailed Fox");
      await expect(picker.locator(".badge")).toHaveCount(0);
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
      await expect(list.locator(".badge")).toHaveCount(0);
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
      second = (await texts(options.nth(1).locator("span:not(.icon)")))[0];
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
  // The passive's key, before Q's, with no rank field.
  const passive = card.locator("span[tabindex]").filter({ has: page.locator(".kbd", { hasText: /^P$/ }) });
  await step(
    "hover P: its card names the passive, without a rank",
    () => passive.hover(),
    async () => {
      await expect(passive).toHaveAttribute("aria-label", "Essence Theft");
      await expect(ui.hovercard).toContainText("Essence Theft");
      await expect(ui.hovercard).toContainText("Essence Fragment");
      await expect(ui.hovercard).not.toContainText("Rank");
      await expect(card.getByRole("spinbutton", { name: "P rank" })).toHaveCount(0);
    },
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
    "Zed: his parameters, Vex's gone, the distance kept",
    async () => {
      await search.click();
      await search.fill("zed");
      await search.press("Enter");
    },
    async () => {
      expect((await ui.state()).options).toEqual({ distance: 500 });
      await expect(params.getByRole("checkbox", { name: "Doom ready at start" })).toHaveCount(0);
    },
  );
  await step(
    "Vex again: a fresh page of hers, the distance kept, Doom ready as to begin with; Back: hers as she had them",
    async () => {
      await search.click();
      await search.fill("vex");
      await search.press("Enter");
      await ui.settle();
      expect((await ui.state()).options).toEqual({ distance: 500 });
      await expect(params.getByRole("checkbox", { name: "Doom ready at start" })).toBeChecked();
      await ui.page.goBack();
      await ui.settle();
      await ui.page.goBack();
    },
    async () => {
      expect((await ui.state()).options).toEqual({ doom: 0, distance: 500 });
      await expect(params.getByRole("checkbox", { name: "Doom ready at start" })).not.toBeChecked();
    },
  );
});

test("the champion on screen picked: their fresh page, one build with no items or runes, the rest as it is; Back returning", async ({ ui }) => {
  const { step } = ui;
  const { search } = parts(ui);
  const tabs = ui.page.getByRole("group", { name: "Builds" }).locator("button[aria-pressed]");
  let before = {} as Awaited<ReturnType<UI["state"]>>;

  await step(
    "Ahri at 16 against a tank, on two tabs",
    async () => {
      await ui.open({ level: 16, target: { mode: "tank" } });
      await ui.page.getByRole("button", { name: "New build" }).click();
      await ui.settle();
    },
    async () => {
      await expect(tabs).toHaveCount(2);
      before = await ui.state();
    },
  );
  await step(
    "Ahri picked: one build, with no items or runes, at 16 against a tank",
    async () => {
      await search.click();
      await search.fill("ahri");
      await search.press("Enter");
      await ui.settle();
    },
    async () => {
      await expect(tabs).toHaveCount(1);
      expect(await ui.state()).toEqual({ ...before, items: [null, null, null, null, null, null], runes: RESET_STATE.runes });
    },
  );
  await step(
    "Back: the two builds",
    () => ui.page.goBack(),
    async () => {
      await expect(tabs).toHaveCount(2);
      expect(await ui.state()).toEqual(before);
    },
  );
});

test("another champion: a page of their own with a fresh build and the rest as it is, Back and Forward between them", async ({ ui }) => {
  const { step } = ui;
  const { search, level } = parts(ui);
  const pick = async (name: string) => {
    await search.click();
    await search.fill(name);
    await search.press("Enter");
  };
  const items = ui.card("Items");
  const slots = items.locator(".slots > .slot:not(.vacated)");
  const undo = items.getByRole("button", { name: "Undo" });
  const primary = (tree: string) => ui.card("Runes").getByRole("group", { name: "Primary tree", exact: true }).getByRole("button", { name: tree });
  const target = (mode: string) => ui.card("Target").getByRole("group", { name: "Target" }).getByRole("button", { name: mode });
  const empty = [null, null, null, null, null, null];
  let ahri = {} as Awaited<ReturnType<UI["state"]>>;
  let zed = ahri;

  await step("load", () => ui.open());
  await step(
    "Ahri: Luden's sold, primary Precision, level 20, a tank",
    async () => {
      await slots.nth(0).hover();
      await slots
        .nth(0)
        .getByRole("button", { name: /^Sell / })
        .click();
      await primary("Precision").click();
      await level.press("End");
      await target("Tank").click();
    },
    async () => {
      ahri = await ui.state();
      expect(ahri).toMatchObject({ items: [null, 3020, null, null, null, null], runes: { primary: "Precision" }, level: 20, target: { mode: "tank" } });
    },
  );
  await step(
    "Zed: a fresh build, the level and target as they are, nothing to undo",
    () => pick("zed"),
    async () => {
      expect(await ui.state()).toEqual({ ...ahri, champion: "Zed", items: empty, runes: RESET_STATE.runes });
      await expect(undo).toBeDisabled();
    },
  );
  await step(
    "Youmuu's bought, primary Domination, level 1, a bruiser",
    async () => {
      await slots.nth(0).click();
      await items.getByRole("searchbox", { name: "Search items" }).fill("youmuu");
      await items.getByRole("searchbox", { name: "Search items" }).press("Enter");
      await primary("Domination").click();
      await level.press("Home");
      await target("Bruiser").click();
    },
    async () => {
      zed = await ui.state();
      expect(zed).toMatchObject({ items: [3142, null, null, null, null, null], runes: { primary: "Domination" }, level: 1, target: { mode: "bruiser" } });
    },
  );
  await step(
    "Back: Ahri's page as she had it, nothing to undo",
    () => ui.page.goBack(),
    async () => {
      expect(await ui.state()).toEqual(ahri);
      await expect(undo).toBeDisabled();
    },
  );
  await step(
    "Forward: Zed's as he had it",
    () => ui.page.goForward(),
    async () => expect(await ui.state()).toEqual(zed),
  );
  await step(
    "Ahri picked from it: a fresh build of hers with his level and target, not her page as it was",
    () => pick("ahri"),
    async () => expect(await ui.state()).toEqual({ ...zed, champion: "Ahri", items: empty, runes: RESET_STATE.runes }),
  );
});
