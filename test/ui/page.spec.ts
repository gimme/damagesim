// Around the cards: the state in the URL hash and in storage across reloads, the header's buttons, dark mode.

import { test, expect, encodeState, type UI } from "./ui.ts";

/** Loads the page again, as a link or a reload would: a navigation that only changes the hash doesn't. */
const reload = async (ui: UI, hash?: string) => {
  if (hash !== undefined) await ui.page.goto("/" + hash);
  await ui.page.reload();
  await ui.settle();
};

test("the state survives a reload", async ({ ui }) => {
  const { page, step } = ui;
  const champion = ui.card("Champion").getByRole("searchbox", { name: "Champion" });
  const level = ui.card("Champion").getByRole("slider", { name: "Champion level" });
  const tank = ui.card("Target").getByRole("button", { name: "Tank" });
  const saved = () => page.evaluate(() => localStorage.getItem("damagesim:state") === location.hash.slice(1));
  let changed = {} as Awaited<ReturnType<UI["state"]>>;
  let hash = "";

  await step(
    "level 20, Rabadon's, a tank, Q E W R AA",
    async () => {
      await ui.open();
      await level.focus();
      await level.press("End");
      const items = ui.card("Items");
      await items.locator(".slots > .slot").nth(2).click();
      await items.getByRole("searchbox", { name: "Search items" }).fill("rabadon");
      await items.getByRole("searchbox", { name: "Search items" }).press("Enter");
      await tank.click();
      const combo = ui.card("Combo");
      await combo.getByRole("button", { name: "Edit as text" }).click();
      await combo.getByRole("textbox", { name: "Combo shorthand" }).fill("Q E W R AA");
      await combo.getByRole("textbox", { name: "Combo shorthand" }).press("Enter");
    },
    async () => {
      changed = await ui.state();
      expect(changed).toMatchObject({ level: 20, combo: "Q E W R AA", target: { mode: "tank" } });
      expect(changed.items[2]).not.toBeNull();
      expect(await saved()).toBe(true);
      hash = new URL(page.url()).hash;
    },
  );
  const shows = async () => {
    expect(await ui.state()).toEqual(changed);
    await expect(level).toHaveValue("20");
    await expect(tank).toHaveAttribute("aria-pressed", "true");
    await expect(ui.card("Items").locator(".slots > .slot").nth(2)).toHaveAttribute("aria-label", /^Item slot 3: Rabadon's Deathcap\./);
  };
  await step("reload: the same, from the hash", () => reload(ui), shows);
  await step(
    "no hash: the state saved",
    async () => {
      await page.goto("/");
      await ui.settle();
    },
    async () => {
      await shows();
      expect(new URL(page.url()).hash).toBe(hash);
    },
  );
  await step(
    "a link's state wins over the one saved",
    () => reload(ui, encodeState({ champion: "Lux", target: { mode: "bruiser" } })),
    async () => {
      await expect(champion).toHaveValue("Lux");
      await expect(ui.card("Target").getByRole("button", { name: "Bruiser" })).toHaveAttribute("aria-pressed", "true");
      expect(await saved()).toBe(true);
    },
  );
  await step(
    "a hash that isn't a state: the state saved",
    () => reload(ui, "#notastate!!"),
    async () => {
      await expect(champion).toHaveValue("Lux");
      expect(await saved()).toBe(true);
    },
  );
  await step(
    "an unknown target and a broken rune page: those defaults, the rest kept",
    () => reload(ui, encodeState({ champion: "Zed", target: { mode: "boss" }, runes: { primary: 1 } })),
    async () => {
      await expect(champion).toHaveValue("Zed");
      await expect(ui.card("Target").getByRole("button", { name: "Squishy" })).toHaveAttribute("aria-pressed", "true");
      await expect(ui.card("Runes").locator(".rune-tree").first().locator(".tree-name")).toHaveText("Domination");
    },
  );
  await step("the first link again", () => reload(ui, hash), shows);
});

test("header: copy and Reset", async ({ ui, context }) => {
  const { page, step } = ui;
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  const clipboard = () => page.evaluate(() => navigator.clipboard.readText());
  const header = page.locator("header");
  let fresh = {} as Awaited<ReturnType<UI["state"]>>;

  await step(
    "load",
    () => ui.open(),
    async () => {
      fresh = await ui.state();
    },
  );
  await step(
    "Zed with Youmuu's: Copy link copies the link, says so a moment",
    async () => {
      await reload(ui, encodeState({ champion: "Zed", combo: "W E Q AA R", items: [3142, null, null, null, null, null] }));
      await header.getByRole("button", { name: "Copy link" }).click();
    },
    async () => {
      await expect(header.getByRole("button", { name: "Link copied" })).toBeVisible();
      expect(await clipboard()).toBe(page.url());
      await expect(header.getByRole("button", { name: "Copy link" })).toBeVisible();
    },
  );
  await step(
    "Copy scenario: the CLI's and MCP's JSON for it",
    () => header.getByRole("button", { name: "Copy scenario" }).click(),
    async () => {
      await expect(header.getByRole("button", { name: "Scenario copied" })).toBeVisible();
      expect(JSON.parse(await clipboard())).toMatchObject({ champion: "Zed", items: [3142], combo: "W E Q AA R", target: { preset: "squishy" } });
      await expect(header.getByRole("button", { name: "Copy scenario" })).toBeVisible();
    },
  );
  await step(
    "Reset: the default state",
    () => header.getByRole("button", { name: "Reset" }).click(),
    async () => expect(await ui.state()).toEqual(fresh),
  );
  await step(
    "Undo in Items: the items before Reset",
    () => ui.card("Items").getByRole("button", { name: "Undo" }).click(),
    async () => expect((await ui.state()).items).toEqual([3142, null, null, null, null, null]),
  );
});

/** The theme: the attribute and storage that choose it, and how light the page's background is (0 to 255). */
const theme = (ui: UI) =>
  ui.page.evaluate(() => {
    const [r, g, b] = getComputedStyle(document.body).backgroundColor.match(/\d+/g)!.map(Number);
    return {
      attribute: document.documentElement.getAttribute("data-theme"),
      stored: localStorage.getItem("theme"),
      scheme: getComputedStyle(document.documentElement).colorScheme,
      lightness: (r + g + b) / 3,
    };
  });

test("dark mode", async ({ ui }) => {
  const { page, step } = ui;
  const toggle = page.getByRole("button", { name: "Toggle dark mode" });
  await step(
    "load: light, nothing chosen",
    () => ui.open(),
    async () => {
      expect(await theme(ui)).toMatchObject({ attribute: null, stored: null, scheme: "light" });
      expect((await theme(ui)).lightness).toBeGreaterThan(200);
      await expect(toggle).toHaveText("☾");
    },
  );
  await step(
    "toggle: dark, chosen",
    () => toggle.click(),
    async () => {
      expect(await theme(ui)).toMatchObject({ attribute: "dark", stored: "dark", scheme: "dark" });
      expect((await theme(ui)).lightness).toBeLessThan(50);
      await expect(toggle).toHaveText("☀");
    },
  );
  await step(
    "reload: still dark",
    () => reload(ui),
    async () => expect(await theme(ui)).toMatchObject({ attribute: "dark", scheme: "dark" }),
  );
  await step(
    "toggle: light, chosen",
    () => toggle.click(),
    async () => expect(await theme(ui)).toMatchObject({ attribute: "light", stored: "light", scheme: "light" }),
  );
});

test.describe("with the system in dark mode", () => {
  test.use({ colorScheme: "dark" });
  test("dark mode", async ({ ui }) => {
    const { page, step } = ui;
    const toggle = page.getByRole("button", { name: "Toggle dark mode" });
    await step(
      "load: dark, nothing chosen",
      () => ui.open(),
      async () => {
        expect(await theme(ui)).toMatchObject({ attribute: null, stored: null, scheme: "dark" });
        expect((await theme(ui)).lightness).toBeLessThan(50);
      },
    );
    await step(
      "toggle: light, chosen",
      () => toggle.click(),
      async () => expect(await theme(ui)).toMatchObject({ attribute: "light", stored: "light", scheme: "light" }),
    );
  });
});
