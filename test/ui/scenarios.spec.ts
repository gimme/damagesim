// Saved scenarios in the top bar: saving one under a name, over one or as a new one, switching between
// them with their changes kept and the unsaved work kept beside them, rename, revert and delete, the
// shelf across a reload and a link; and the Compare card: what's on screen beside the scenarios picked.

import { test, expect, addressOf, num, texts, type UI } from "./ui.ts";

const bar = (ui: UI) => ui.page.getByRole("group", { name: "Saved scenarios" });
/** A scenario's chip by its name, "(changed)" after it while it has changes. */
const chip = (ui: UI, name: string) => bar(ui).getByRole("button", { name, exact: true });
/** The chips' names, as read. */
const chips = (ui: UI) =>
  bar(ui)
    .locator(".scenario-chip")
    .evaluateAll((els) => els.map((e) => `${e.getAttribute("aria-label")}${e.getAttribute("aria-pressed") === "true" ? " *" : ""}`));
const saveButton = (ui: UI) => bar(ui).getByRole("button", { name: "Save", exact: true }).first();
const nameField = (ui: UI) => ui.page.getByRole("textbox", { name: "Scenario name" });

/** Moves the champion level `n` steps right (left where negative). */
const level = async (ui: UI, n: number) => {
  const slider = ui.card("Champion").getByRole("slider", { name: "Champion level" });
  await slider.focus();
  for (let i = 0; i < Math.abs(n); i++) await slider.press(n > 0 ? "ArrowRight" : "ArrowLeft");
};
const mode = (ui: UI, m: string) => ui.card("Target").getByRole("group", { name: "Target" }).getByRole("button", { name: m });

test("saving and switching", async ({ ui }) => {
  const { page, step } = ui;
  const saveForm = page.getByRole("dialog", { name: "Save scenario" });

  await step(
    "load: nothing saved, Save alone",
    () => ui.open(),
    async () => {
      expect(await chips(ui)).toEqual([]);
      await expect(saveButton(ui)).toBeVisible();
      await expect(bar(ui).getByRole("button", { name: "Compare" })).toHaveCount(0);
    },
  );
  await step(
    "Save: a name for it, the champion, level and first item",
    () => saveButton(ui).click(),
    async () => {
      await expect(nameField(ui)).toHaveValue("Ahri 11 · Luden's Echo");
      await expect(nameField(ui)).toBeFocused();
      await expect(saveForm.getByRole("button")).toHaveText("Save");
    },
  );
  await step(
    "Escape: closed, nothing saved",
    () => nameField(ui).press("Escape"),
    async () => {
      await expect(saveForm).toHaveCount(0);
      expect(await chips(ui)).toEqual([]);
    },
  );
  await step(
    "saved as Burst: its chip, open",
    async () => {
      await saveButton(ui).click();
      await nameField(ui).fill("Burst");
      await nameField(ui).press("Enter");
    },
    async () => {
      await expect(saveForm).toHaveCount(0);
      expect(await chips(ui)).toEqual(["Burst *"]);
    },
  );
  const burst = await ui.state();
  await step(
    "level 16: Burst changed",
    () => level(ui, 5),
    async () => expect(await chips(ui)).toEqual(["Burst (changed) *"]),
  );
  await step(
    "Save: Burst's name, to save over it; another name saves a new one",
    async () => {
      await saveButton(ui).click();
      await expect(nameField(ui)).toHaveValue("Burst");
      await expect(saveForm.getByRole("button")).toHaveText("Save over");
      await nameField(ui).fill("Burst 16");
      await expect(saveForm.getByRole("button")).toHaveText("Save");
      await nameField(ui).press("Enter");
    },
    async () => expect(await chips(ui)).toEqual(["Burst", "Burst 16 *"]),
  );
  const burst16 = await ui.state();
  expect(burst16.level).toBe(16);
  await step(
    "Burst: it as saved, at its address",
    () => chip(ui, "Burst").click(),
    async () => {
      expect(await ui.state()).toEqual(burst);
      expect(await chips(ui)).toEqual(["Burst *", "Burst 16"]);
    },
  );
  await step(
    "a tank: Burst changed; Burst 16, then Burst again: its change kept",
    async () => {
      await mode(ui, "Tank").click();
      await expect(chip(ui, "Burst (changed)")).toBeVisible();
      await chip(ui, "Burst 16").click();
      expect(await ui.state()).toEqual(burst16);
      await chip(ui, "Burst (changed)").click();
    },
    async () => {
      expect(await ui.state()).toEqual({ ...burst, target: { ...burst.target, mode: "tank" } });
      await expect(mode(ui, "Tank")).toHaveAttribute("aria-pressed", "true");
      expect(await chips(ui)).toEqual(["Burst (changed) *", "Burst 16"]);
    },
  );
  const menu = page.getByRole("dialog", { name: "Burst" });
  await step(
    "the open chip: its menu; Revert changes: Burst as saved",
    async () => {
      await chip(ui, "Burst (changed)").click();
      await menu.getByRole("button", { name: "Revert changes" }).click();
    },
    async () => {
      await expect(menu).toHaveCount(0);
      expect(await ui.state()).toEqual(burst);
      expect(await chips(ui)).toEqual(["Burst *", "Burst 16"]);
    },
  );
  await step(
    "a tank again, then Ctrl+S: saved over Burst",
    async () => {
      await mode(ui, "Tank").click();
      await page.keyboard.press("Control+s");
    },
    async () => {
      await expect(saveForm).toHaveCount(0);
      expect(await chips(ui)).toEqual(["Burst *", "Burst 16"]);
    },
  );
  await step(
    "a link to Lux: unsaved work, beside the scenarios",
    () => ui.open({ champion: "Lux" }),
    async () => {
      await expect(ui.card("Champion").getByRole("searchbox", { name: "Champion" })).toHaveValue("Lux");
      expect(await chips(ui)).toEqual(["Unsaved *", "Burst", "Burst 16"]);
    },
  );
  await step(
    "Burst 16: the unsaved work kept",
    () => chip(ui, "Burst 16").click(),
    async () => {
      expect(await ui.state()).toEqual(burst16);
      expect(await chips(ui)).toEqual(["Unsaved", "Burst", "Burst 16 *"]);
    },
  );
  await step(
    "a reload: the same",
    () => page.reload().then(() => ui.settle()),
    async () => {
      expect(await ui.state()).toEqual(burst16);
      expect(await chips(ui)).toEqual(["Unsaved", "Burst", "Burst 16 *"]);
    },
  );
  await step(
    "Unsaved: Lux back, and Burst 16 as it was",
    () => chip(ui, "Unsaved").click(),
    async () => {
      expect(page.url()).toMatch(new RegExp(`${addressOf({ champion: "Lux" })}$`));
      expect(await chips(ui)).toEqual(["Unsaved *", "Burst", "Burst 16"]);
    },
  );
  await step(
    "Burst, then the unsaved work's ×: dropped",
    async () => {
      await chip(ui, "Burst").click();
      await chip(ui, "Unsaved").hover();
      await bar(ui).getByRole("button", { name: "Discard unsaved work" }).click();
    },
    async () => expect(await chips(ui)).toEqual(["Burst *", "Burst 16"]),
  );
  await step(
    "rename Burst to a name taken: not taken; to Tank burst",
    async () => {
      await chip(ui, "Burst").click();
      await menu.getByRole("textbox", { name: "Scenario name" }).fill("Burst 16");
      await expect(menu.getByRole("button", { name: "Name taken" })).toBeVisible();
      await menu.getByRole("textbox", { name: "Scenario name" }).fill("Tank burst");
      await menu.getByRole("textbox", { name: "Scenario name" }).press("Enter");
    },
    async () => expect(await chips(ui)).toEqual(["Tank burst *", "Burst 16"]),
  );
  const tankMenu = page.getByRole("dialog", { name: "Tank burst" });
  await step(
    "Delete, at a second press: gone, what was on screen left as unsaved work",
    async () => {
      await chip(ui, "Tank burst").click();
      await tankMenu.getByRole("button", { name: "Delete" }).click();
      await expect(chips(ui)).resolves.toEqual(["Tank burst *", "Burst 16"]);
      await tankMenu.getByRole("button", { name: "Delete Tank burst?" }).click();
    },
    async () => {
      expect(await chips(ui)).toEqual(["Unsaved *", "Burst 16"]);
      await expect(mode(ui, "Tank")).toHaveAttribute("aria-pressed", "true");
    },
  );
});

test("compare", async ({ ui }) => {
  const { page, step } = ui;
  const card = ui.card("Compare");
  const picks = card.getByRole("group", { name: "Scenarios to compare" }).getByRole("button");
  const table = card.getByRole("table", { name: "Compared scenarios" });
  const row = (label: string) => table.locator("tr").filter({ has: page.getByRole("rowheader", { name: label, exact: true }) });
  const cells = async (label: string) => (await texts(row(label).getByRole("cell"))).map(num);
  const save = async (name: string) => {
    await saveButton(ui).click();
    await nameField(ui).fill(name);
    await nameField(ui).press("Enter");
  };

  await step(
    "three saved: Ahri at 11, at 16, and Zed",
    async () => {
      await ui.open();
      await save("Ahri 11");
      await level(ui, 5);
      await save("Ahri 16");
      await ui.open({ champion: "Zed", items: [3142, null, null, null, null, null], combo: "W E Q AA R" });
      await save("Zed");
      await chip(ui, "Ahri 11").click();
    },
    async () => expect(await chips(ui)).toEqual(["Ahri 11 *", "Ahri 16", "Zed"]),
  );
  const ahri11 = await ui.total();
  await step(
    "Compare: the card, with each of the others",
    () => bar(ui).getByRole("button", { name: "Compare" }).click(),
    async () => {
      await expect(bar(ui).getByRole("button", { name: "Compare" })).toHaveAttribute("aria-pressed", "true");
      expect(await texts(picks)).toEqual(["Ahri 16", "Zed"]);
      for (const p of await picks.all()) await expect(p).toHaveAttribute("aria-pressed", "true");
      expect(await texts(table.getByRole("columnheader"))).toEqual(["", "Ahri 11", "Ahri 16", "Zed"]);
      await expect(card.getByRole("img", { name: /^Target health bar/ })).toHaveCount(3);
    },
  );
  await step(
    "the totals: what's on screen first, each a health bar's, Ahri 16's more",
    async () => {},
    async () => {
      const totals = await cells("Total damage");
      expect(totals[0]).toBe(ahri11);
      expect(totals[1]).toBeGreaterThan(totals[0]);
      const bars = await card.getByRole("img", { name: /^Target health bar/ }).evaluateAll((els) => els.map((e) => e.getAttribute("aria-label")!));
      expect(bars.map((b) => num(/: ([\d,]+) damage/.exec(b)![1]))).toEqual(totals);
      await expect(row("Total damage").getByRole("cell").nth(1)).toContainText(`+${(totals[1] - totals[0]).toLocaleString("en-US")}`);
      await expect(row("Build").getByRole("cell").nth(2)).toContainText("Zed 11");
      await expect(row("Combo").getByRole("cell").nth(2)).toHaveText("W E Q AA R");
      // The sources of either champion, each in its row.
      await expect(table.getByRole("rowheader", { name: "Orb of Deception" })).toHaveCount(1);
      await expect(table.getByRole("rowheader", { name: "Razor Shuriken" })).toHaveCount(1);
    },
  );
  await step(
    "Zed left out: two columns",
    () => picks.filter({ hasText: "Zed" }).click(),
    async () => {
      expect(await texts(table.getByRole("columnheader"))).toEqual(["", "Ahri 11", "Ahri 16"]);
      await expect(card.getByRole("img", { name: /^Target health bar/ })).toHaveCount(2);
    },
  );
  await step(
    "a tank on screen: the others against their own target",
    () => mode(ui, "Tank").click(),
    async () => {
      expect(await texts(table.getByRole("columnheader"))).toEqual(["", "Ahri 11 •", "Ahri 16"]);
      const [here, other] = await texts(row("Target").getByRole("cell"));
      expect(here).toMatch(/^Tank /);
      expect(other).toMatch(/^Squishy /);
    },
  );
  await step(
    "All against the target on screen: the tank, at its level 11",
    () => card.getByRole("checkbox", { name: "All against Tank lvl 11" }).check(),
    async () => {
      const [here, other] = await texts(row("Target").getByRole("cell"));
      expect(other).toBe(here);
      const [now, at16] = await cells("Total damage");
      expect(now).toBe(await ui.total());
      expect(at16).toBeGreaterThan(now);
    },
  );
  await step(
    "✕: closed",
    () => card.getByRole("button", { name: "Close Compare" }).click(),
    async () => {
      await expect(card).toHaveCount(0);
      await expect(bar(ui).getByRole("button", { name: "Compare" })).toHaveAttribute("aria-pressed", "false");
    },
  );
});
