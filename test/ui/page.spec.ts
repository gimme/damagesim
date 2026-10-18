// Around the cards: the state's code in the URL hash and in storage across reloads, a link entered on
// the page, Share (copying the code, the link and the JSON, with or without the Clipboard API, and a
// code pasted), Reset, dark mode.

import { test, expect, codeOf, type UI } from "./ui.ts";

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
    () => reload(ui, "#" + codeOf({ champion: "Lux", target: { mode: "bruiser" } })),
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
    "a code cut short: the state saved",
    () => reload(ui, "#" + codeOf({ champion: "Zed", target: { mode: "tank" } }).slice(0, -2)),
    async () => {
      await expect(champion).toHaveValue("Lux");
      expect(await saved()).toBe(true);
    },
  );
  await step(
    "an item the patch hasn't (one since removed): its slot empty, the rest kept",
    () => reload(ui, "#" + codeOf({ champion: "Zed", items: [3142, 9999, null, null, null, null], target: { mode: "tank" } })),
    async () => {
      await expect(champion).toHaveValue("Zed");
      await expect(tank).toHaveAttribute("aria-pressed", "true");
      expect((await ui.state()).items).toEqual([3142, null, null, null, null, null]);
    },
  );
  await step("the first link again", () => reload(ui, hash), shows);
});

test("a link entered in the address bar on the page loads, as Back and Forward do", async ({ ui }) => {
  const { page, step } = ui;
  const champion = ui.card("Champion").getByRole("searchbox", { name: "Champion" });
  const level = ui.card("Champion").getByRole("slider", { name: "Champion level" });
  const lux = { champion: "Lux", target: { mode: "bruiser" } };
  // Set before the link: still there after it, so the page didn't reload.
  const stayed = () => page.evaluate(() => (window as any).stayed === true);
  let entries = 0;

  await step(
    "Zed",
    async () => {
      await ui.open({ champion: "Zed" });
      await page.evaluate(() => ((window as any).stayed = true));
      entries = await page.evaluate(() => history.length);
    },
    () => expect(champion).toHaveValue("Zed"),
  );
  await step(
    "level 20: the hash its code, written over (no new history entry)",
    async () => {
      await level.focus();
      await level.press("End");
    },
    async () => {
      expect((await ui.state()).level).toBe(20);
      expect(await page.evaluate(() => history.length)).toBe(entries);
    },
  );
  await step(
    "a link to Lux against a bruiser: Lux, without a reload",
    () => page.goto("/#" + codeOf(lux)),
    async () => {
      await expect(champion).toHaveValue("Lux");
      await expect(ui.card("Target").getByRole("button", { name: "Bruiser" })).toHaveAttribute("aria-pressed", "true");
      expect(await stayed()).toBe(true);
      expect(new URL(page.url()).hash).toBe("#" + codeOf(lux));
    },
  );
  await step(
    "Back: Zed at 20",
    () => page.goBack(),
    async () => {
      await expect(champion).toHaveValue("Zed");
      await expect(level).toHaveValue("20");
    },
  );
  await step(
    "Forward: Lux",
    () => page.goForward(),
    () => expect(champion).toHaveValue("Lux"),
  );
  await step(
    "a hash that isn't a code: nothing changes, and the hash is Lux's code again",
    () => page.goto("/#notacode!!"),
    async () => {
      await expect(champion).toHaveValue("Lux");
      expect(new URL(page.url()).hash).toBe("#" + codeOf(lux));
      expect(await stayed()).toBe(true);
    },
  );
});

/** Zed with Youmuu's. */
const zed = { champion: "Zed", combo: "W E Q AA R", items: [3142, null, null, null, null, null] };

/** Share, the panel it opens, and the panel's parts. */
const shareOf = (ui: UI) => {
  const header = ui.page.locator("header");
  const panel = header.getByRole("group", { name: "Share" });
  return {
    button: header.getByRole("button", { name: "Share" }),
    panel,
    code: panel.getByRole("textbox", { name: "Scenario code" }),
    paste: panel.getByRole("textbox", { name: "Paste a code" }),
    copyCode: panel.getByRole("button", { name: "Copy code" }),
    copyLink: panel.getByRole("button", { name: "Copy link" }),
    copyJSON: panel.getByRole("button", { name: "copy the scenario JSON" }),
    status: panel.getByRole("status"),
  };
};

test("Share: the code, the link and the scenario JSON copied; Reset", async ({ ui, context }) => {
  const { page, step } = ui;
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  const clipboard = () => page.evaluate(() => navigator.clipboard.readText());
  const share = shareOf(ui);
  let fresh = {} as Awaited<ReturnType<UI["state"]>>;

  await step(
    "load",
    () => ui.open(),
    async () => {
      fresh = await ui.state();
    },
  );
  await step(
    "Zed with Youmuu's, Share: the scenario's code, Copy code focused",
    async () => {
      await reload(ui, "#" + codeOf(zed));
      await share.button.click();
    },
    async () => {
      await expect(share.button).toHaveAttribute("aria-expanded", "true");
      await expect(share.code).toHaveValue(codeOf(zed));
      await expect(share.copyCode).toBeFocused();
    },
  );
  await step(
    "Copy code: the code, letters and digits; it says so a moment",
    () => share.copyCode.click(),
    async () => {
      await expect(share.status).toHaveText("Copied the code");
      expect(await clipboard()).toBe(codeOf(zed));
      expect(codeOf(zed)).toMatch(/^[0-9A-Za-z]{10,40}$/);
      await expect(share.status).toHaveText("");
    },
  );
  await step(
    "Copy link: the page's address, which ends in the code",
    () => share.copyLink.click(),
    async () => {
      await expect(share.status).toHaveText("Copied the link");
      expect(await clipboard()).toBe(page.url());
      expect(page.url()).toMatch(new RegExp(`/#${codeOf(zed)}$`));
    },
  );
  await step(
    "copy the scenario JSON: the CLI's and MCP's",
    () => share.copyJSON.click(),
    async () => {
      await expect(share.status).toHaveText("Copied the scenario JSON");
      expect(JSON.parse(await clipboard())).toMatchObject({ champion: "Zed", items: [3142], combo: "W E Q AA R", target: { preset: "squishy" } });
    },
  );
  await step(
    "Escape: closed, back on Share",
    () => page.keyboard.press("Escape"),
    async () => {
      await expect(share.panel).toHaveCount(0);
      await expect(share.button).toBeFocused();
      await expect(share.button).toHaveAttribute("aria-expanded", "false");
    },
  );
  await step(
    "Share, then a click elsewhere: closed",
    async () => {
      await share.button.click();
      await expect(share.panel).toBeVisible();
      await page.locator("header h1").click();
    },
    () => expect(share.panel).toHaveCount(0),
  );
  await step(
    "Reset: the default state",
    () => page.locator("header").getByRole("button", { name: "Reset" }).click(),
    async () => expect(await ui.state()).toEqual(fresh),
  );
  await step(
    "Undo in Items: the items before Reset",
    () => ui.card("Items").getByRole("button", { name: "Undo" }).click(),
    async () => expect((await ui.state()).items).toEqual([3142, null, null, null, null, null]),
  );
});

test("Share without the Clipboard API, as over plain http from another machine", async ({ ui, context }) => {
  const { page, step } = ui;
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  // A page that isn't a secure context has no navigator.clipboard; the test keeps it to read what was copied.
  await page.addInitScript(() => {
    const clipboard = navigator.clipboard;
    (window as any).readClipboard = () => clipboard.readText();
    Object.defineProperty(Navigator.prototype, "clipboard", { get: () => undefined });
  });
  const clipboard = () => page.evaluate(() => (window as any).readClipboard());
  const share = shareOf(ui);

  await step(
    "Zed with Youmuu's, Share",
    async () => {
      await ui.open(zed);
      await share.button.click();
    },
    () => expect(page.evaluate(() => navigator.clipboard)).resolves.toBeUndefined(),
  );
  await step(
    "Copy code: copied all the same, and the focus is back on Copy code",
    () => share.copyCode.click(),
    async () => {
      await expect(share.status).toHaveText("Copied the code");
      expect(await clipboard()).toBe(codeOf(zed));
      await expect(share.copyCode).toBeFocused();
    },
  );
  await step(
    "Copy link: the link",
    () => share.copyLink.click(),
    async () => {
      await expect(share.status).toHaveText("Copied the link");
      expect(await clipboard()).toBe(page.url());
    },
  );
  await step(
    "the copy command refused too: it says so, and selects the code to copy by hand",
    async () => {
      await page.evaluate(() => (document.execCommand = () => false));
      await share.copyCode.click();
    },
    async () => {
      await expect(share.status).toHaveText("Couldn't copy: the browser didn't let the page");
      await expect(share.code).toBeFocused();
      expect(await share.code.evaluate((e: HTMLInputElement) => [e.selectionStart, e.selectionEnd])).toEqual([0, codeOf(zed).length]);
      expect(await clipboard()).toBe(page.url());
    },
  );
});

test("Share: a code pasted loads", async ({ ui }) => {
  const { page, step } = ui;
  const share = shareOf(ui);
  const champion = ui.card("Champion").getByRole("searchbox", { name: "Champion" });
  const bruiser = ui.card("Target").getByRole("button", { name: "Bruiser" });
  const lux = { champion: "Lux", target: { mode: "bruiser" } };

  await step(
    "load, Share",
    async () => {
      await ui.open();
      await share.button.click();
    },
    () => expect(share.paste).toHaveValue(""),
  );
  await step(
    "Lux against a bruiser's code: that scenario, its code the one shown",
    () => share.paste.fill(codeOf(lux)),
    async () => {
      await expect(champion).toHaveValue("Lux");
      await expect(bruiser).toHaveAttribute("aria-pressed", "true");
      await expect(share.status).toHaveText("Loaded the code");
      await expect(share.paste).toHaveValue("");
      await expect(share.code).toHaveValue(codeOf(lux));
      expect(new URL(page.url()).hash).toBe("#" + codeOf(lux));
    },
  );
  await step(
    "a link to Zed with Youmuu's, from another machine: Zed",
    () => share.paste.fill(` http://192.168.1.20:5173/#${codeOf(zed)} `),
    async () => {
      await expect(champion).toHaveValue("Zed");
      expect((await ui.state()).items).toEqual(zed.items);
      await expect(share.paste).toHaveValue("");
    },
  );
  await step(
    "not a code: it says so, nothing changes",
    () => share.paste.fill("hello"),
    async () => {
      await expect(share.panel.getByText("Not a scenario code")).toBeVisible();
      await expect(share.paste).toHaveAttribute("aria-invalid", "true");
      await expect(champion).toHaveValue("Zed");
      expect(new URL(page.url()).hash).toBe("#" + codeOf(zed));
    },
  );
  await step(
    "emptied: no complaint",
    () => share.paste.fill(""),
    async () => {
      await expect(share.panel.getByText("Not a scenario code")).toHaveCount(0);
      await expect(share.paste).toHaveAttribute("aria-invalid", "false");
    },
  );
  await step(
    "Undo in Items: the items before the code",
    () => ui.card("Items").getByRole("button", { name: "Undo" }).click(),
    async () => expect((await ui.state()).items).toEqual([6655, 3020, null, null, null, null]),
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
