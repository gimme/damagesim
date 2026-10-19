// Around the cards: the page's address (the champion in the path, the rest as codes in the hash,
// the reset page's the path alone), the demo at the site's root, a link entered on the page, Back
// and Forward, a link that isn't a page's, another champion's page, Reset, dark mode.

import { RESET_STATE } from "../../src/web/state.ts";
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

/** A scenario's codes, its address's hash. */
const codeOf = (state: Record<string, any>) => addressOf(state).split("#")[1];

const lux = { champion: "Lux", target: { mode: "bruiser" } };

test("the state survives a reload, and a link that isn't a page's has a page of its own", async ({ ui }) => {
  const { page, step } = ui;
  const champion = ui.card("Champion").getByRole("searchbox", { name: "Champion" });
  const level = ui.card("Champion").getByRole("slider", { name: "Champion level" });
  const tank = ui.card("Target").getByRole("button", { name: "Tank" });
  const badLink = page.getByRole("alert");
  let changed = {} as Awaited<ReturnType<UI["state"]>>;

  await step(
    "level 20, Rabadon's, a tank, Q E W R AA: Ahri's address, the codes in its hash",
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
      expect(address(ui)).toMatch(/^\/ahri\/#[0-9A-Za-z]+\+[0-9A-Za-z]+$/);
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
    "the site's root: the demo, at its address",
    async () => {
      await page.goto("/");
      await ui.settle();
    },
    async () => {
      expect(address(ui)).toBe(addressOf({}));
      await expect(level).toHaveValue("11");
    },
  );
  await step(
    "a link: its state",
    () => reload(ui, addressOf(lux)),
    async () => {
      expect(address(ui)).toBe(addressOf(lux));
      await expect(champion).toHaveValue("Lux");
      await expect(ui.card("Target").getByRole("button", { name: "Bruiser" })).toHaveAttribute("aria-pressed", "true");
    },
  );
  await step(
    "a hash that isn't a page's: a page saying so, the address kept; its title leads to the demo",
    () => reload(ui, "/zed/#notastate!!"),
    async () => {
      await expect(badLink).toContainText("This link couldn't be read");
      await expect(page.locator("section.card")).toHaveCount(0);
      expect(address(ui)).toBe("/zed/#notastate!!");
      await page.locator("h1").getByRole("link", { name: "damagesim" }).click();
      await expect(page.locator("section.card").first()).toBeVisible();
      await ui.settle();
      expect(address(ui)).toBe(addressOf({}));
    },
  );
  await step(
    "a path that isn't a champion's: the same",
    () => reload(ui, "/nobody/"),
    async () => {
      await expect(badLink).toContainText("This link couldn't be read");
      expect(address(ui)).toBe("/nobody/");
    },
  );
  await step(
    "a champion's name as written, with no slash after: that champion",
    () => reload(ui, "/MissFortune#" + codeOf({ target: { mode: "tank" } })),
    async () => {
      await expect(champion).toHaveValue("Miss Fortune");
      expect(address(ui)).toBe("/miss-fortune/#" + codeOf({ champion: "MissFortune", target: { mode: "tank" } }));
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

test("the champion is in the code too: a link to the site's root with a code opens its champion's page, at their path; a build's code alone, at the reset setup", async ({
  ui,
}) => {
  const { page, step } = ui;
  const champion = ui.card("Champion").getByRole("searchbox", { name: "Champion" });
  const zed = { champion: "Zed", level: 16, target: { mode: "tank" } };
  await step(
    "the root with Zed's codes: Zed, at his path",
    async () => {
      await page.goto("/#" + codeOf(zed));
      await ui.settle();
    },
    async () => {
      await expect(champion).toHaveValue("Zed");
      expect(address(ui)).toBe(addressOf(zed));
    },
  );
  await step(
    "Lux's path with Zed's codes: Lux, the path winning",
    async () => {
      await page.goto("/lux/#" + codeOf(zed));
      await ui.settle();
    },
    async () => {
      await expect(champion).toHaveValue("Lux");
      expect(address(ui)).toBe(addressOf({ ...zed, champion: "Lux" }));
    },
  );
  await step(
    "the build's code alone: its items and runes at the reset setup, level 11 against a squishy, no combo (the builds' shared one isn't the build's)",
    async () => {
      await page.goto("/zed/#" + codeOf(zed).split("+")[0]);
      await ui.settle();
    },
    async () => {
      const build = { ...RESET_STATE, champion: "Zed", items: [6655, 3020, null, null, null, null], runes: (await ui.state()).runes };
      expect(await ui.state()).toEqual(build);
      expect(build.runes.picks).toHaveLength(6);
      expect(address(ui)).toBe(addressOf(build));
    },
  );
});

test("a link entered in the address bar on the page loads, as Back and Forward do; another champion is a page of their own, Back returning", async ({ ui }) => {
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
      expect(address(ui)).toBe(addressOf({ champion: "Zed" }));
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
    "a hash that isn't a page's: nothing changes, and the address is the page's again",
    () => page.goto("/zed/#notacode!!"),
    async () => {
      await expect(bruiser).toHaveAttribute("aria-pressed", "true");
      expect(address(ui)).toBe(addressOf(bruiserZed));
      expect(await stayed()).toBe(true);
    },
  );
  await step(
    "Lux picked, her option a link to her page: a fresh build of hers against the bruiser, a history entry of its own",
    async () => {
      before = await entries();
      await champion.click();
      await champion.fill("lux");
      const option = ui.card("Champion").getByRole("option").filter({ hasText: /^Lux/ });
      await expect(option).toHaveAttribute(
        "href",
        addressOf({ champion: "Lux", items: [null, null, null, null, null, null], runes: RESET_STATE.runes, target: { mode: "bruiser" } }),
      );
      await option.click();
    },
    async () => {
      expect(await ui.state()).toEqual({ ...RESET_STATE, champion: "Lux", combo: "E Q W R AA R", target: { ...RESET_STATE.target, mode: "bruiser" } });
      expect(address(ui)).toBe(
        addressOf({ champion: "Lux", items: [null, null, null, null, null, null], runes: RESET_STATE.runes, target: { mode: "bruiser" } }),
      );
      expect(await entries()).toBe(before + 1);
      expect(await stayed()).toBe(true);
    },
  );
  await step(
    "Back: Zed's page as it was",
    () => page.goBack(),
    async () => {
      await expect(champion).toHaveValue("Zed");
      expect(address(ui)).toBe(addressOf(bruiserZed));
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
  const search = ui.card("Champion").getByRole("searchbox", { name: "Champion" });

  await step(
    "Zed at 16 with Youmuu's, against a tank",
    () => ui.open({ champion: "Zed", level: 16, combo: "W E Q AA R", items: [3142, null, null, null, null, null], target: { mode: "tank" } }),
    () => expect(search).toHaveValue("Zed"),
  );
  await step(
    "Reset, its title naming Zed: still Zed, at his reset address, with no items, runes or combo, the rest plain",
    async () => {
      const reset = page.locator("header").getByRole("button", { name: "Reset" });
      await expect(reset).toHaveAttribute("title", "Reset Zed: a fresh page, one build with no items, runes or combo (Back undoes it)");
      await reset.click();
    },
    async () => {
      expect(await ui.state()).toEqual({ ...RESET_STATE, champion: "Zed" });
      expect(address(ui)).toBe("/zed/");
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
    "Ahri picked: a fresh build of hers with the rest as it is; Back: Zed as Reset and Undo left him",
    async () => {
      left = await ui.state();
      await search.click();
      await search.fill("ahri");
      await search.press("Enter");
      await ui.settle();
      expect(await ui.state()).toEqual({ ...left, champion: "Ahri", items: [null, null, null, null, null, null] });
      await page.goBack();
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
