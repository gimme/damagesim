// A champion's builds as tabs in the top bar: + opens a copy of the one on screen at the end, a click
// switches, its items and runes its own and the rest shared, the combo too unless each build has its
// own; a tab renamed, dragged to another place, closed by its × or Delete, all in the address (the
// first build's first, as if alone) through a reload, and Back undoing a close and Reset. The Result
// card compares them: a bar each, the table under them until it's all shown, against the first build,
// a click in a column opening its build, a fade where the columns scroll; folded, the one on screen
// alone. Each champion its builds.

import { test, expect, num, pageAddressOf, texts, type UI } from "./ui.ts";

const bar = (ui: UI) => ui.page.getByRole("group", { name: "Builds" });
const tab = (ui: UI, name: string) => bar(ui).getByRole("button", { name, exact: true });
/** The tabs' names, the one on screen's with " *". */
const tabs = (ui: UI) =>
  bar(ui)
    .locator("button[aria-pressed]")
    .evaluateAll((els) => els.map((e) => `${e.textContent}${e.getAttribute("aria-pressed") === "true" ? " *" : ""}`));
const first = (ui: UI) => ui.page.getByRole("button", { name: "Build", exact: true });
const bars = (ui: UI) => ui.card("Result").getByRole("img", { name: /^Target health bar/ });
const hash = (ui: UI) => decodeURIComponent(new URL(ui.page.url()).hash);

/** Moves the champion level `n` steps right (left where negative). */
const level = async (ui: UI, n: number) => {
  const slider = ui.card("Champion").getByRole("slider", { name: "Champion level" });
  await slider.focus();
  for (let i = 0; i < Math.abs(n); i++) await slider.press(n > 0 ? "ArrowRight" : "ArrowLeft");
};

test("builds", async ({ ui }) => {
  const { page, step } = ui;
  const combo = ui.card("Combo");
  const same = combo.getByRole("checkbox", { name: "Same for all builds" });
  let at11 = 0;

  await step(
    "load: one build, + Build alone",
    () => ui.open(),
    async () => {
      await expect(bar(ui)).toHaveCount(0);
      await expect(first(ui)).toBeVisible();
      await expect(ui.card("Items").locator(".build-of")).toHaveCount(0);
      await expect(same).toHaveCount(0);
      at11 = await ui.total();
    },
  );
  await step(
    "+ Build: a copy in a second tab, on screen, its name on the cards of its own",
    () => first(ui).click(),
    async () => {
      expect(await tabs(ui)).toEqual(["Build 1", "Build 2 *"]);
      expect(await ui.total()).toBe(at11);
      expect(hash(ui)).toBe("#~*.Build_2");
      await expect(ui.card("Items").locator(".build-of")).toHaveText("Build 2");
      await expect(ui.card("Runes").locator(".build-of")).toHaveText("Build 2");
      await expect(same).toBeChecked();
      await expect(bars(ui)).toHaveCount(2);
    },
  );
  await step(
    "Luden's Echo sold in it: Build 1 as it was",
    async () => {
      const slot = ui.card("Items").locator(".slots > .slot:not(.vacated)").nth(0);
      await slot.hover();
      await slot.getByRole("button", { name: "Sell Luden's Echo" }).click();
      await ui.settle();
      expect(await ui.total()).toBeLessThan(at11);
      await tab(ui, "Build 1").click();
    },
    async () => {
      expect(await tabs(ui)).toEqual(["Build 1 *", "Build 2"]);
      expect((await ui.state()).items[0]).toBe(6655);
      expect(await ui.total()).toBe(at11);
    },
  );
  await step(
    "level 16 and a combo of Q in Build 1: Build 2's too, and still without Luden's Echo",
    async () => {
      await level(ui, 5);
      await combo.getByRole("button", { name: "Clear" }).click();
      await combo.locator(".combo-palette").getByRole("button", { name: "Q", exact: true }).click();
      await ui.settle();
      await tab(ui, "Build 2").click();
    },
    async () => {
      const s = await ui.state();
      expect([s.level, s.combo, s.items[0]]).toEqual([16, "Q", null]);
    },
  );
  await step(
    "each its own combo: Build 2's W, Build 1's still Q",
    async () => {
      await same.uncheck();
      await combo.locator(".combo-palette").getByRole("button", { name: "W", exact: true }).click();
      await ui.settle();
      await tab(ui, "Build 1").click();
    },
    async () => {
      expect((await ui.state()).combo).toBe("Q");
      await expect(combo.locator(".build-of")).toHaveText("Build 1");
      expect(hash(ui)).toMatch(/!combos$/);
      await tab(ui, "Build 2").click();
      await ui.settle();
      expect((await ui.state()).combo).toBe("Q W");
    },
  );
  await step(
    "Build 2 renamed Burst by a double-click",
    async () => {
      await tab(ui, "Build 2").dblclick();
      await bar(ui).getByRole("textbox", { name: "Build name" }).fill("Burst");
      await bar(ui).getByRole("textbox", { name: "Build name" }).press("Enter");
    },
    async () => {
      expect(await tabs(ui)).toEqual(["Build 1", "Burst *"]);
      expect(hash(ui)).toContain(".Burst");
    },
  );
  await step(
    "Burst dragged first: still on screen, first in the address too, as if alone but for its name",
    () => ui.drag(bar(ui).locator(".build-tab").nth(1), bar(ui).locator(".build-tab").nth(0)),
    async () => {
      expect(await tabs(ui)).toEqual(["Burst *", "Build 1"]);
      expect(hash(ui)).toMatch(/^#\w+\.Burst~\w*\.Build_1!combos$/);
    },
  );
  await step(
    "a reload: as they were",
    () => page.reload(),
    async () => {
      expect(await tabs(ui)).toEqual(["Burst *", "Build 1"]);
      expect((await ui.state()).combo).toBe("Q W");
    },
  );
  await step(
    "Burst closed: Build 1 alone, + Build; Back brings Burst back",
    async () => {
      await bar(ui).getByRole("button", { name: "Close Burst" }).click();
      await ui.settle();
      await expect(bar(ui)).toHaveCount(0);
      expect((await ui.state()).combo).toBe("Q");
      await page.goBack();
    },
    async () => expect(await tabs(ui)).toEqual(["Burst *", "Build 1"]),
  );
  await step(
    "Reset: one build, nothing in it; Back brings them back",
    async () => {
      await page.getByRole("button", { name: "Reset" }).click();
      await ui.settle();
      await expect(bar(ui)).toHaveCount(0);
      expect((await ui.state()).items.every((x) => x == null)).toBe(true);
      await page.goBack();
    },
    async () => {
      expect(await tabs(ui)).toEqual(["Burst *", "Build 1"]);
      expect((await ui.state()).level).toBe(16);
    },
  );
});

test("compared", async ({ ui }) => {
  const { page, step } = ui;
  const card = ui.card("Result");
  const table = card.getByRole("table", { name: "Compared builds" });
  const row = (label: string) => table.locator("tr").filter({ has: page.getByRole("rowheader", { name: label, exact: true }) });
  const cells = async (label: string) => (await texts(row(label).getByRole("cell"))).map(num);
  const fold = card.getByRole("button", { name: "3 builds" });
  const more = card.getByRole("button", { name: /^Show (more|less)$/ });
  const search = ui.card("Champion").getByRole("searchbox", { name: "Champion" });
  const pick = async (name: string) => {
    await search.click();
    await search.fill(name);
    await search.press("Enter");
  };
  // The default page with Dark Harvest picked in Electrocute's place: last, as a page keeps its picks in the order they came.
  const harvest = { primary: "Domination", secondary: "Sorcery", picks: [8126, 8140, 8106, 8233, 8237, 8128], held: [], shards: [5008, 5008, 5001] };

  await step(
    "a link to three builds, Build 2 with Rabadon's on screen",
    () =>
      ui.open(
        pageAddressOf(
          {},
          [{}, { items: [6655, 3020, 3089, null, null, null] }, { items: [3020, null, null, null, null, null], runes: harvest, name: "Boots" }],
          1,
        ),
      ),
    async () => {
      expect(await tabs(ui)).toEqual(["Build 1", "Build 2 *", "Boots"]);
      await expect(bars(ui)).toHaveCount(3);
      await expect(card.getByRole("group", { name: "Build 2" }).getByRole("button", { name: "Build 2" })).toHaveAttribute("aria-pressed", "true");
      expect(await texts(table.getByRole("columnheader"))).toEqual(["", "Build 1", "Build 2", "Boots"]);
    },
  );
  await step(
    "each build's items and of its runes the keystone alone, Boots' Dark Harvest though it was picked last",
    async () => {},
    async () => {
      const runes = (k: number) => row("Build").getByRole("cell").nth(k).locator("img[src*='perk-images']");
      for (const [k, keystone] of [
        [0, /Electrocute/],
        [1, /Electrocute/],
        [2, /DarkHarvest/],
      ] as const) {
        await expect(runes(k)).toHaveCount(1);
        await expect(runes(k)).toHaveAttribute("src", keystone);
      }
    },
  );
  await step(
    "the totals: in the tabs' order, each a health bar's, against Build 1",
    async () => {},
    async () => {
      const totals = await cells("Total damage");
      expect(totals[1]).toBe(await ui.total());
      expect(totals[1]).toBeGreaterThan(totals[0]);
      expect(totals[2]).toBeLessThan(totals[0]);
      const shown = await bars(ui).evaluateAll((els) => els.map((e) => e.getAttribute("aria-label")!));
      expect(shown.map((b) => num(/: ([\d,]+) damage/.exec(b)![1]))).toEqual(totals);
      await expect(row("Total damage").getByRole("cell").nth(1)).toContainText(`+${(totals[1] - totals[0]).toLocaleString("en-US")}`);
      await expect(row("Total damage").getByRole("cell").nth(2)).toContainText(`−${(totals[0] - totals[2]).toLocaleString("en-US")}`);
    },
  );
  await step(
    "the table: its top rows until Show more, then the rest and the sources",
    async () => {
      expect(await texts(table.getByRole("rowheader"))).toEqual(["Build", "Total damage", "Of its health"]);
      await more.click();
    },
    async () => {
      await expect(more).toHaveText("Show less");
      await expect(row("Gold").getByRole("cell").nth(1)).toContainText("+");
      await expect(table.getByRole("rowheader", { name: "Orb of Deception" })).toHaveCount(1);
      await expect(table.getByRole("rowheader", { name: "Luden's Echo" })).toHaveCount(1);
    },
  );
  await step(
    "a build's name: it on screen",
    () => card.getByRole("group", { name: "Boots" }).getByRole("button", { name: "Boots" }).click(),
    async () => {
      expect(await tabs(ui)).toEqual(["Build 1", "Build 2", "Boots *"]);
      expect((await ui.state()).items[0]).toBe(3020);
    },
  );
  await step(
    "the mouse over Build 2's column: shaded, and not over the rows' names",
    () => row("Gold").getByRole("cell").nth(1).hover(),
    async () => {
      await expect(table.locator("td.hot")).not.toHaveCount(0);
      await row("Gold").getByRole("rowheader").hover();
      await expect(table.locator(".hot")).toHaveCount(0);
    },
  );
  await step(
    "a click in Build 1's column, by Damage by source too: it on screen",
    () => row("Damage by source").getByRole("cell").nth(0).click(),
    async () => expect(await tabs(ui)).toEqual(["Build 1 *", "Build 2", "Boots"]),
  );
  const scroll = card.locator(".compare-scroll");
  const size = page.viewportSize()!;
  await step(
    "on a phone, the columns scroll: a fade at the side with more",
    () => page.setViewportSize({ width: 390, height: 844 }),
    async () => {
      await expect(scroll).toHaveClass(/more-right/);
      await expect(scroll).not.toHaveClass(/more-left/);
      await scroll.locator(".compare-table").evaluate((el) => (el.scrollLeft = el.scrollWidth));
      await expect(scroll).toHaveClass(/more-left/);
      await expect(scroll).not.toHaveClass(/more-right/);
      await page.setViewportSize(size);
      await expect(scroll).not.toHaveClass(/more-/);
    },
  );
  await step(
    "folded: the one on screen alone, in the address through a reload",
    async () => {
      await fold.click();
      await ui.settle();
      await page.reload();
    },
    async () => {
      await expect(fold).toHaveAttribute("aria-expanded", "false");
      expect(hash(ui)).toMatch(/!folded$/);
      await expect(bars(ui)).toHaveCount(1);
      await expect(table).toHaveCount(0);
      await fold.click();
      await expect(bars(ui)).toHaveCount(3);
    },
  );
  await step(
    "Zed picked: a build of his own; Ahri again, her three",
    async () => {
      await pick("zed");
      await ui.settle();
      await expect(bar(ui)).toHaveCount(0);
      await pick("ahri");
    },
    async () => expect(await tabs(ui)).toEqual(["Build 1 *", "Build 2", "Boots"]),
  );
});

test("+ at the end, and Delete from tab to tab", async ({ ui }) => {
  const { page, step } = ui;
  await step(
    "three builds, Build 2 on screen; +: a copy of it at the end",
    async () => {
      await ui.open(pageAddressOf({}, [{}, { items: [3020, null, null, null, null, null] }, {}], 1));
      await bar(ui).getByRole("button", { name: "New build" }).click();
    },
    async () => {
      expect(await tabs(ui)).toEqual(["Build 1", "Build 2", "Build 3", "Build 4 *"]);
      expect((await ui.state()).items[0]).toBe(3020);
    },
  );
  await step(
    "Build 2 clicked, then Delete: closed, Build 3 on screen and focused",
    async () => {
      await tab(ui, "Build 2").click();
      await page.keyboard.press("Delete");
    },
    async () => {
      expect(await tabs(ui)).toEqual(["Build 1", "Build 3 *", "Build 4"]);
      await expect(tab(ui, "Build 3")).toBeFocused();
    },
  );
  await step(
    "Delete twice more: Build 1 alone, + Build focused",
    async () => {
      await page.keyboard.press("Delete");
      await ui.settle();
      expect(await tabs(ui)).toEqual(["Build 1", "Build 4 *"]);
      await page.keyboard.press("Delete");
    },
    async () => {
      await expect(bar(ui)).toHaveCount(0);
      await expect(first(ui)).toBeFocused();
      expect((await ui.state()).items[0]).toBe(6655);
    },
  );
});
