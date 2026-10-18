// The Runes card: a rune page that keeps to the game's rules, its tooltips, and shards whose numbers follow the level.

import { test, expect, attrs, num, type UI } from "./ui.ts";

const parts = (ui: UI) => {
  const card = ui.card("Runes");
  const group = (name: string) => card.getByRole("group", { name, exact: true });
  return {
    card,
    group,
    /** The names of a group's runes picked. */
    picked: async (name: string) => (await attrs(group(name).locator("[aria-pressed=true]"), "aria-label")) as string[],
    tree: (i: number) => card.locator(".rune-tree").nth(i),
    treeName: (i: number) => card.locator(".rune-tree").nth(i).locator(".tree-name"),
  };
};

test("rune page rules", async ({ ui }) => {
  const { step } = ui;
  const { card, group, picked, tree, treeName } = parts(ui);
  const rows = (t: string) => [1, 2, 3].map((r) => `${t} row ${r}`);

  await step(
    "load: a keystone, a rune per row, two secondary, a shard per row",
    () => ui.open(),
    async () => {
      await expect(treeName(0)).toHaveText("Domination");
      await expect(treeName(1)).toHaveText("Sorcery");
      expect(await picked("Keystone")).toHaveLength(1);
      for (const r of rows("Domination")) expect(await picked(r)).toHaveLength(1);
      await expect(tree(1).locator("[aria-pressed=true].rune-pick")).toHaveCount(2);
      for (const s of ["Offense shard", "Flex shard", "Defense shard"]) expect(await picked(s)).toHaveLength(1);
    },
  );
  await step(
    "the shards: no row titles, each stat abbreviated, Ahri's adaptive force as AP in magic's color",
    async () => {},
    async () => {
      for (const row of ["Offense", "Flex", "Defense"]) await expect(card.getByText(row, { exact: true })).toHaveCount(0);
      await expect(card).not.toContainText("Two, from different rows");
      await expect(group("Offense shard").locator(".shard-text")).toHaveText("+9 AP");
      await expect(group("Offense shard").locator(".shard-text .it-value")).toHaveClass(/\bmagic\b/);
      await expect(group("Defense shard").locator(".shard-text")).toHaveText(/^\+\d+ HP \(based on level\)$/);
      await expect(group("Defense shard").locator(".shard-text .it-value")).not.toHaveClass(/\b(magic|physical)\b/);
    },
  );
  await step(
    "primary Precision: nothing picked in it yet, the secondary kept",
    () => group("Primary tree").getByRole("button", { name: "Precision" }).click(),
    async () => {
      await expect(treeName(0)).toHaveText("Precision");
      expect(await picked("Keystone")).toEqual([]);
      for (const r of rows("Precision")) expect(await picked(r)).toEqual([]);
      await expect(treeName(1)).toHaveText("Sorcery");
      await expect(tree(1).locator("[aria-pressed=true].rune-pick")).toHaveCount(2);
      expect(await attrs(group("Secondary tree").getByRole("button"), "aria-label")).not.toContain("Precision");
    },
  );
  await step(
    "a keystone and a rune per row",
    async () => {
      await group("Keystone").getByRole("button", { name: "Conqueror" }).click();
      for (const r of rows("Precision")) await group(r).getByRole("button").first().click();
    },
    async () => {
      expect(await picked("Keystone")).toEqual(["Conqueror"]);
      for (const r of rows("Precision")) expect(await picked(r)).toHaveLength(1);
    },
  );
  await step(
    "another rune in a row replaces it",
    () => group("Precision row 1").getByRole("button").last().click(),
    async () => expect(await picked("Precision row 1")).toEqual([(await attrs(group("Precision row 1").getByRole("button"), "aria-label")).at(-1)]),
  );
  await step(
    "secondary Resolve: two from different rows",
    async () => {
      await group("Secondary tree").getByRole("button", { name: "Resolve" }).click();
      await expect(tree(1).locator("[aria-pressed=true].rune-pick")).toHaveCount(0);
      await group("Resolve row 1").getByRole("button").first().click();
      await group("Resolve row 3").getByRole("button").first().click();
    },
    () => expect(tree(1).locator("[aria-pressed=true].rune-pick")).toHaveCount(2),
  );
  await step(
    "one from a third row replaces one",
    () => group("Resolve row 2").getByRole("button").first().click(),
    async () => {
      await expect(tree(1).locator("[aria-pressed=true].rune-pick")).toHaveCount(2);
      expect(await picked("Resolve row 2")).toHaveLength(1);
    },
  );
  await step(
    "another in the same row replaces it",
    () => group("Resolve row 2").getByRole("button").last().click(),
    async () => {
      await expect(tree(1).locator("[aria-pressed=true].rune-pick")).toHaveCount(2);
      expect(await picked("Resolve row 2")).toEqual([(await attrs(group("Resolve row 2").getByRole("button"), "aria-label")).at(-1)]);
    },
  );
  await step(
    "primary Resolve: the trees swap",
    () => group("Primary tree").getByRole("button", { name: "Resolve" }).click(),
    async () => {
      await expect(treeName(0)).toHaveText("Resolve");
      await expect(treeName(1)).toHaveText("Precision");
      await expect(tree(1).locator("[aria-pressed=true].rune-pick")).toHaveCount(2);
    },
  );
  await step(
    "Space on a focused keystone picks it",
    async () => {
      await group("Keystone").getByRole("button").last().focus();
      await ui.page.keyboard.press("Space");
    },
    () => expect(group("Keystone").getByRole("button").last()).toHaveAttribute("aria-pressed", "true"),
  );
  for (const row of ["Offense", "Flex", "Defense"]) {
    let text = "";
    await step(
      `${row} shard: another replaces it, its text with it`,
      async () => {
        text = await group(`${row} shard`).locator(".shard-text").innerText();
        await group(`${row} shard`).getByRole("button").nth(1).click();
      },
      async () => {
        expect(await picked(`${row} shard`)).toEqual([(await attrs(group(`${row} shard`).getByRole("button"), "aria-label"))[1]]);
        await expect(group(`${row} shard`).locator(".shard-text")).not.toHaveText(text);
      },
    );
  }
  await step(
    "hover the keystone: its card names it",
    () => group("Keystone").getByRole("button").first().hover(),
    async () => expect(ui.hovercard).toContainText((await group("Keystone").getByRole("button").first().getAttribute("aria-label"))!),
  );
  await step(
    "hover a shard: its card at once, a Shard",
    () => group("Defense shard").getByRole("button", { name: "Health Scaling" }).hover(),
    async () => {
      await expect(ui.hovercard).toContainText("Health Scaling");
      await expect(ui.hovercard.locator(".it-head .secondary")).toHaveText("Shard");
    },
  );
  await step("the pointer away", () => ui.unhover());
  let health = 0;
  await step(
    "Health Scaling",
    () => group("Defense shard").getByRole("button", { name: "Health Scaling" }).click(),
    async () => {
      health = num(await group("Defense shard").locator(".shard-text").innerText());
      expect(health).toBeGreaterThan(0);
    },
  );
  await step(
    "Jinx without AP items, with Adaptive Force: AD in physical's color",
    async () => {
      const search = ui.card("Champion").getByRole("searchbox", { name: "Champion" });
      await search.fill("jinx");
      await search.press("Enter");
      await ui.card("Items").getByRole("button", { name: "Clear" }).click();
      await group("Offense shard").getByRole("button", { name: "Adaptive Force" }).click();
    },
    async () => {
      await expect(group("Offense shard").locator(".shard-text")).toHaveText(/^\+[\d.]+ AD$/);
      await expect(group("Offense shard").locator(".shard-text .it-value")).toHaveClass(/\bphysical\b/);
    },
  );
  await step(
    "level 18: more health from it",
    async () => {
      const level = ui.card("Champion").getByRole("slider", { name: "Champion level" });
      await level.focus();
      for (let i = 0; i < 7; i++) await level.press("ArrowRight");
    },
    async () => expect(num(await group("Defense shard").locator(".shard-text").innerText())).toBeGreaterThan(health),
  );
});

test("an empty page", async ({ ui }) => {
  const { step } = ui;
  const { card, group, picked } = parts(ui);
  const shards = ["Offense shard", "Flex shard", "Defense shard"];

  await step(
    "load with nothing picked: the trees, no rune or shard pressed",
    () => ui.open({ runes: { primary: "Domination", secondary: "Sorcery", picks: [], held: [], shards: [] } }),
    async () => {
      await expect(card.locator("[aria-pressed=true].rune-pick, [aria-pressed=true].shard-pick")).toHaveCount(0);
      await expect(card.locator(".shard-text").first()).toHaveText("");
    },
  );
  await step(
    "a flex shard: the other rows take their first",
    () => group("Flex shard").getByRole("button").last().click(),
    async () => {
      const firsts = await Promise.all(shards.map(async (s) => (await attrs(group(s).getByRole("button"), "aria-label"))[0]));
      const last = (await attrs(group("Flex shard").getByRole("button"), "aria-label")).at(-1);
      expect(await Promise.all(shards.map(picked))).toEqual([[firsts[0]], [last], [firsts[2]]]);
    },
  );
});
