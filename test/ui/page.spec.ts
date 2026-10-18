// Around the cards: the scenario's address (the champion in the path, the rest as a code in the hash,
// none at the defaults) and the address kept in storage across reloads, a link entered on the page,
// Back and Forward, Reset, dark mode.

import { test, expect, addressOf, type UI } from "./ui.ts";

/** Loads the page again, as a link or a reload would: a navigation that only changes the hash doesn't. */
const reload = async (ui: UI, address?: string) => {
  if (address !== undefined) await ui.page.goto(address);
  await ui.page.reload();
  await ui.settle();
};

/** The page's address after its origin: "/zed/#5h2Kq…". */
const address = (ui: UI) => {
  const url = new URL(ui.page.url());
  return url.pathname + url.hash;
};

/** Whether the page keeps its address in storage. */
const saved = (ui: UI) => ui.page.evaluate(() => "/" + localStorage.getItem("damagesim:state") === location.pathname + location.hash);

/** A scenario's code, its address's hash. */
const codeOf = (state: Record<string, any>) => addressOf(state).split("#")[1];

const lux = { champion: "Lux", target: { mode: "bruiser" } };

test("the state survives a reload", async ({ ui }) => {
  const { page, step } = ui;
  const champion = ui.card("Champion").getByRole("searchbox", { name: "Champion" });
  const level = ui.card("Champion").getByRole("slider", { name: "Champion level" });
  const tank = ui.card("Target").getByRole("button", { name: "Tank" });
  let changed = {} as Awaited<ReturnType<UI["state"]>>;

  await step(
    "level 20, Rabadon's, a tank, Q E W R AA: Ahri's address, a code in its hash",
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
      expect(changed).toMatchObject({ level: 20, items: [6655, 3020, 3089, null, null, null], combo: "Q E W R AA", target: { mode: "tank" } });
      expect(address(ui)).toMatch(/^\/ahri\/#[0-9A-Za-z]{10,40}$/);
      expect(await saved(ui)).toBe(true);
    },
  );
  const shows = async () => {
    expect(await ui.state()).toEqual(changed);
    await expect(level).toHaveValue("20");
    await expect(tank).toHaveAttribute("aria-pressed", "true");
    await expect(ui.card("Items").locator(".slots > .slot").nth(2)).toHaveAttribute("aria-label", /^Item slot 3: Rabadon's Deathcap\./);
  };
  await step("reload: the same, from the address", () => reload(ui), shows);
  await step(
    "the site's root: the state saved, at its address",
    async () => {
      await page.goto("/");
      await ui.settle();
    },
    async () => {
      await shows();
      expect(address(ui)).toBe(addressOf(changed));
    },
  );
  await step(
    "a link's state wins over the one saved",
    () => reload(ui, addressOf(lux)),
    async () => {
      expect(address(ui)).toBe(addressOf(lux));
      await expect(champion).toHaveValue("Lux");
      await expect(ui.card("Target").getByRole("button", { name: "Bruiser" })).toHaveAttribute("aria-pressed", "true");
      expect(await saved(ui)).toBe(true);
    },
  );
  await step(
    "a hash that isn't a scenario's: the state saved, at its address",
    () => reload(ui, "/zed/#notastate!!"),
    async () => {
      await expect(champion).toHaveValue("Lux");
      expect(address(ui)).toBe(addressOf(lux));
    },
  );
  await step(
    "a path that isn't a champion's: the state saved",
    () => reload(ui, "/nobody/"),
    async () => {
      await expect(champion).toHaveValue("Lux");
      expect(address(ui)).toBe(addressOf(lux));
    },
  );
  await step(
    "a champion's name as written, with no slash after: that champion",
    () => reload(ui, "/MissFortune#" + codeOf({ target: { mode: "tank" } })),
    async () => {
      await expect(champion).toHaveValue("Miss Fortune");
      expect(address(ui)).toBe("/miss-fortune/#" + codeOf({ target: { mode: "tank" } }));
    },
  );
  await step(
    "an item the patch hasn't (one since removed): its slot empty, the rest kept",
    () => reload(ui, addressOf({ champion: "Zed", items: [3142, 9999, null, null, null, null], target: { mode: "tank" } })),
    async () => {
      await expect(champion).toHaveValue("Zed");
      await expect(tank).toHaveAttribute("aria-pressed", "true");
      expect((await ui.state()).items).toEqual([3142, null, null, null, null, null]);
      expect(address(ui)).toBe(addressOf({ champion: "Zed", items: [3142, null, null, null, null, null], target: { mode: "tank" } }));
    },
  );
  await step("the first link again", () => reload(ui, addressOf(changed)), shows);
});

test("a link holds what the page keeps but doesn't show: the target champion while a tank is the target", async ({ ui }) => {
  const { page, step } = ui;
  const card = ui.card("Target");
  const mode = (m: string) => card.getByRole("group", { name: "Target" }).getByRole("button", { name: m });
  const search = card.getByRole("searchbox", { name: "Target champion" });

  await step(
    "Malphite as the target, then a tank",
    async () => {
      await ui.open();
      await mode("Champion").click();
      await search.click();
      await search.fill("malph");
      await card.getByRole("option").first().click();
      await mode("Tank").click();
    },
    async () => expect(address(ui)).toBe(addressOf({ target: { mode: "tank", champion: "Malphite" } })),
  );
  await step(
    "the link where nothing was saved, Champion: Malphite",
    async () => {
      const link = page.url();
      await page.evaluate(() => localStorage.clear());
      await reload(ui, link);
      await mode("Champion").click();
    },
    () => expect(search).toHaveValue("Malphite"),
  );
});

test("a link entered in the address bar on the page loads, as Back and Forward do", async ({ ui }) => {
  const { page, step } = ui;
  const champion = ui.card("Champion").getByRole("searchbox", { name: "Champion" });
  const level = ui.card("Champion").getByRole("slider", { name: "Champion level" });
  const bruiser = ui.card("Target").getByRole("button", { name: "Bruiser" });
  // Set before a link: still there after it, so the page didn't reload.
  const stayed = () => page.evaluate(() => (window as any).stayed === true);
  const bruiserZed = { champion: "Zed", target: { mode: "bruiser" } };
  const entries = () => page.evaluate(() => history.length);
  let before = 0;

  await step(
    "Zed",
    async () => {
      await ui.open({ champion: "Zed" });
      await page.evaluate(() => ((window as any).stayed = true));
      before = await entries();
    },
    async () => {
      await expect(champion).toHaveValue("Zed");
      expect(address(ui)).toBe("/zed/");
    },
  );
  await step(
    "level 20: the address written over (no new history entry)",
    async () => {
      await level.focus();
      await level.press("End");
    },
    async () => {
      expect(address(ui)).toBe(addressOf({ champion: "Zed", level: 20 }));
      expect(await entries()).toBe(before);
    },
  );
  await step(
    "a link to Zed against a bruiser: that scenario, without a reload",
    () => page.goto(addressOf(bruiserZed)),
    async () => {
      await expect(bruiser).toHaveAttribute("aria-pressed", "true");
      await expect(level).toHaveValue("11");
      expect(await stayed()).toBe(true);
      expect(address(ui)).toBe(addressOf(bruiserZed));
    },
  );
  await step(
    "Back: Zed at 20",
    () => page.goBack(),
    async () => {
      await expect(level).toHaveValue("20");
      await expect(bruiser).toHaveAttribute("aria-pressed", "false");
    },
  );
  await step(
    "Forward: against a bruiser",
    () => page.goForward(),
    async () => {
      await expect(bruiser).toHaveAttribute("aria-pressed", "true");
      await expect(level).toHaveValue("11");
    },
  );
  await step(
    "a hash that isn't a scenario's: nothing changes, and the address is the scenario's again",
    () => page.goto("/zed/#notacode!!"),
    async () => {
      await expect(bruiser).toHaveAttribute("aria-pressed", "true");
      expect(address(ui)).toBe(addressOf(bruiserZed));
      expect(await stayed()).toBe(true);
    },
  );
  await step(
    "Lux picked: the path Lux's, written over",
    async () => {
      before = await entries();
      await champion.click();
      await champion.fill("lux");
      await ui.card("Champion").getByRole("option").filter({ hasText: /^Lux/ }).click();
    },
    async () => {
      expect(new URL(page.url()).pathname).toBe("/lux/");
      expect((await ui.state()).target.mode).toBe("bruiser");
      expect(await entries()).toBe(before);
    },
  );
  await step(
    "a link to another champion's scenario: it loads (a page of its own)",
    () => page.goto(addressOf({ champion: "Jinx", target: { mode: "tank" } })),
    async () => {
      await expect(champion).toHaveValue("Jinx");
      await expect(ui.card("Target").getByRole("button", { name: "Tank" })).toHaveAttribute("aria-pressed", "true");
    },
  );
});

test("Reset", async ({ ui }) => {
  const { page, step } = ui;
  let fresh = {} as Awaited<ReturnType<UI["state"]>>;

  await step(
    "load",
    () => ui.open(),
    async () => {
      fresh = await ui.state();
    },
  );
  await step(
    "Zed at 16 with Youmuu's, against a tank",
    () => reload(ui, addressOf({ champion: "Zed", level: 16, combo: "W E Q AA R", items: [3142, null, null, null, null, null], target: { mode: "tank" } })),
    () => expect(ui.card("Champion").getByRole("searchbox", { name: "Champion" })).toHaveValue("Zed"),
  );
  const empty = { primary: "Domination", secondary: "Sorcery", picks: [], held: [], shards: [] };
  await step(
    "Reset, its title naming Zed: still Zed, at his address, with no items, runes or combo, the rest as on a fresh page",
    async () => {
      const reset = page.locator("header").getByRole("button", { name: "Reset" });
      await expect(reset).toHaveAttribute("title", "Reset Zed: one build, no items, runes or combo, and the rest as on a fresh page (Back undoes it)");
      await reset.click();
    },
    async () => {
      expect(await ui.state()).toEqual({ ...fresh, champion: "Zed", items: [null, null, null, null, null, null], runes: empty, combo: "" });
      expect(address(ui)).toMatch(/^\/zed\/#/);
      await expect(ui.card("Runes").locator("[aria-pressed=true].rune-pick, [aria-pressed=true].shard-pick")).toHaveCount(0);
      await expect(ui.card("Combo").getByRole("listitem")).toHaveCount(0);
    },
  );
  await step(
    "Undo in Items: the items before Reset",
    () => ui.card("Items").getByRole("button", { name: "Undo" }).click(),
    async () => expect((await ui.state()).items).toEqual([3142, null, null, null, null, null]),
  );
  let left = {} as Awaited<ReturnType<UI["state"]>>;
  await step(
    "Ahri, then back to Zed: as Reset and Undo left him",
    async () => {
      left = await ui.state();
      for (const name of ["ahri", "zed"]) {
        const search = ui.card("Champion").getByRole("searchbox", { name: "Champion" });
        await search.click();
        await search.fill(name);
        await search.press("Enter");
      }
    },
    async () => expect(await ui.state()).toEqual(left),
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
