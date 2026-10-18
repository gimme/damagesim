// Scenarios as tabs in the top bar: + opens a copy of the one on screen, a click switches with each
// tab's changes its own, × closes one, and all of them are in the address, through a reload; and the
// Compare card: the one on screen beside the others, from a link, its sources until all are shown.

import { test, expect, num, pageAddressOf, texts, type UI } from "./ui.ts";

const bar = (ui: UI) => ui.page.getByRole("group", { name: "Scenarios" });
const tab = (ui: UI, label: string) => bar(ui).getByRole("button", { name: label, exact: true });
/** The tabs' labels, the one on screen's with " *". */
const tabs = (ui: UI) =>
  bar(ui)
    .locator("button[aria-pressed]")
    .evaluateAll((els) => els.map((e) => `${e.textContent}${e.getAttribute("aria-pressed") === "true" ? " *" : ""}`));
const plus = (ui: UI) => ui.page.getByRole("button", { name: "+ Scenario" });

/** Moves the champion level `n` steps right (left where negative). */
const level = async (ui: UI, n: number) => {
  const slider = ui.card("Champion").getByRole("slider", { name: "Champion level" });
  await slider.focus();
  for (let i = 0; i < Math.abs(n); i++) await slider.press(n > 0 ? "ArrowRight" : "ArrowLeft");
};
const mode = (ui: UI, m: string) => ui.card("Target").getByRole("group", { name: "Target" }).getByRole("button", { name: m });

test("tabs", async ({ ui }) => {
  const { page, step } = ui;
  let at11 = 0;

  await step(
    "load: one scenario, + Scenario alone",
    () => ui.open(),
    async () => {
      await expect(bar(ui)).toHaveCount(0);
      await expect(plus(ui)).toBeVisible();
      at11 = await ui.total();
    },
  );
  await step(
    "+ Scenario: a copy in a second tab, on screen",
    () => plus(ui).click(),
    async () => {
      expect(await tabs(ui)).toEqual(["Ahri", "Ahri 2 *"]);
      expect(await ui.total()).toBe(at11);
      expect(new URL(page.url()).hash).toBe("#ahri-~");
    },
  );
  await step(
    "level 16 in it: the first as it was",
    async () => {
      await level(ui, 5);
      await ui.settle();
      await tab(ui, "Ahri").click();
    },
    async () => {
      expect(await tabs(ui)).toEqual(["Ahri *", "Ahri 2"]);
      expect((await ui.state()).level).toBe(11);
      expect(await ui.total()).toBe(at11);
    },
  );
  await step(
    "back to the second: at 16",
    () => tab(ui, "Ahri 2").click(),
    async () => expect((await ui.state()).level).toBe(16),
  );
  await step(
    "+ again, the tank on screen, and a reload: all as they were",
    async () => {
      await bar(ui).getByRole("button", { name: "New scenario" }).click();
      await mode(ui, "Tank").click();
      await ui.settle();
      await page.reload();
    },
    async () => {
      expect(await tabs(ui)).toEqual(["Ahri", "Ahri 2", "Ahri 3 *"]);
      expect((await ui.state()).level).toBe(16);
      expect((await ui.state()).target.mode).toBe("tank");
      await tab(ui, "Ahri 2").click();
      await ui.settle();
      expect((await ui.state()).target.mode).toBe("squishy");
      await tab(ui, "Ahri 3").click();
    },
  );
  await step(
    "× on the one on screen, the last: the one before it on screen",
    () => bar(ui).getByRole("button", { name: "Close Ahri 3" }).click(),
    async () => {
      expect(await tabs(ui)).toEqual(["Ahri", "Ahri 2 *"]);
      expect((await ui.state()).target.mode).toBe("squishy");
    },
  );
  await step(
    "× on the other: one left, + Scenario alone, the address a scenario's",
    () => bar(ui).getByRole("button", { name: "Close Ahri", exact: true }).click(),
    async () => {
      await expect(bar(ui)).toHaveCount(0);
      expect((await ui.state()).level).toBe(16);
      expect(new URL(page.url()).hash).not.toContain("~");
    },
  );
});

test("compare", async ({ ui }) => {
  const { page, step } = ui;
  const card = ui.card("Compare");
  const table = card.getByRole("table", { name: "Compared scenarios" });
  const row = (label: string) => table.locator("tr").filter({ has: page.getByRole("rowheader", { name: label, exact: true }) });
  const cells = async (label: string) => (await texts(row(label).getByRole("cell"))).map(num);
  const sources = table.locator("tbody").nth(1).getByRole("rowheader");
  const more = card.getByRole("button", { name: /^Show (all \d+ sources|less)$/ });
  const compare = () => page.getByRole("button", { name: "Compare", exact: true });
  let all = 0;

  await step(
    "a link to three tabs compared: Ahri at 11 on screen, at 16, and Zed",
    () => ui.open(pageAddressOf([{}, { level: 16 }, { champion: "Zed", items: [3142, null, null, null, null, null], combo: "W E Q AA R" }], 0, "own")),
    async () => {
      expect(await tabs(ui)).toEqual(["Ahri *", "Ahri 2", "Zed"]);
      await expect(compare()).toHaveAttribute("aria-pressed", "true");
      expect(await texts(table.getByRole("columnheader"))).toEqual(["", "Ahri", "Ahri 2", "Zed"]);
      await expect(card.getByRole("img", { name: /^Target health bar/ })).toHaveCount(3);
    },
  );
  await step(
    "the totals: the one on screen first, each a health bar's, Ahri 2's more",
    async () => {},
    async () => {
      const totals = await cells("Total damage");
      expect(totals[0]).toBe(await ui.total());
      expect(totals[1]).toBeGreaterThan(totals[0]);
      const bars = await card.getByRole("img", { name: /^Target health bar/ }).evaluateAll((els) => els.map((e) => e.getAttribute("aria-label")!));
      expect(bars.map((b) => num(/: ([\d,]+) damage/.exec(b)![1]))).toEqual(totals);
      await expect(row("Total damage").getByRole("cell").nth(1)).toContainText(`+${(totals[1] - totals[0]).toLocaleString("en-US")}`);
      await expect(row("Build").getByRole("cell").nth(2)).toContainText("Zed 11");
      await expect(row("Combo").getByRole("cell").nth(2)).toHaveText("W E Q AA R");
    },
  );
  await step(
    "the sources: the top three until all are shown, either champion's",
    async () => {
      await expect(sources).toHaveCount(3);
      await expect(more).toHaveAttribute("aria-expanded", "false");
      all = num((await texts(more))[0]);
      await more.click();
    },
    async () => {
      await expect(more).toHaveText(/Show less/);
      await expect(sources).toHaveCount(all);
      await expect(table.getByRole("rowheader", { name: "Orb of Deception" })).toHaveCount(1);
      await expect(table.getByRole("rowheader", { name: "Razor Shuriken" })).toHaveCount(1);
    },
  );
  await step(
    "a tank on screen: the others against their own target",
    () => mode(ui, "Tank").click(),
    async () => {
      const [here, other] = await texts(row("Target").getByRole("cell"));
      expect(here).toMatch(/^Tank /);
      expect(other).toMatch(/^Squishy /);
    },
  );
  await step(
    "All against the target on screen: the tank, at its level 11, in the address through a reload",
    async () => {
      await card.getByRole("checkbox", { name: "All against Tank lvl 11" }).check();
      await ui.settle();
      await page.reload();
    },
    async () => {
      expect(new URL(page.url()).hash).toMatch(/!compare-same-target$/);
      await expect(card.getByRole("checkbox", { name: "All against Tank lvl 11" })).toBeChecked();
      const [here, other] = await texts(row("Target").getByRole("cell"));
      expect(other).toBe(here);
      const [now, at16] = await cells("Total damage");
      expect(now).toBe(await ui.total());
      expect(at16).toBeGreaterThan(now);
    },
  );
  await step(
    "Zed closed: two columns",
    () => bar(ui).getByRole("button", { name: "Close Zed" }).click(),
    async () => expect(await texts(table.getByRole("columnheader"))).toEqual(["", "Ahri", "Ahri 2"]),
  );
  await step(
    "✕: closed, and out of the address",
    () => card.getByRole("button", { name: "Close Compare" }).click(),
    async () => {
      await expect(card).toHaveCount(0);
      await expect(compare()).toHaveAttribute("aria-pressed", "false");
      expect(new URL(page.url()).hash).not.toContain("!");
    },
  );
});
