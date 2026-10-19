// The Combo card: keys, a key dragged in, steps reordered, crits, shorthand typed in place, variants,
// a step's numbers, the combo refitted when the champion changes and back as it was when they return,
// steps that do nothing for now kept, muted, and forms.

import { test, expect, type UI } from "./ui.ts";

const parts = (ui: UI) => {
  const card = ui.card("Combo");
  return {
    card,
    chips: card.getByRole("listitem"),
    key: (name: string) => card.locator(".combo-palette").getByRole("button", { name, exact: true }),
    shorthand: card.getByRole("textbox", { name: "Combo shorthand" }),
    pencil: card.getByRole("button", { name: "Edit as text" }),
    crits: (c: string) => card.getByRole("group", { name: "Crits" }).getByRole("button", { name: c }),
    /** The combo's steps, as the state has them. */
    steps: async () => (await ui.state()).combo.split(" ").filter(Boolean),
    /** Types a combo's shorthand in place of the steps. */
    type: async (text: string) => {
      await card.getByRole("button", { name: "Edit as text" }).click();
      await card.getByRole("textbox", { name: "Combo shorthand" }).fill(text);
      await card.getByRole("textbox", { name: "Combo shorthand" }).press("Enter");
    },
  };
};

/** `xs` with item `from` moved to index `to` of the others. */
const moved = <T>(xs: T[], from: number, to: number) => {
  const rest = xs.filter((_, i) => i !== from);
  rest.splice(to, 0, xs[from]);
  return rest;
};

const pickChampion = async (ui: UI, name: string) => {
  const search = ui.card("Champion").getByRole("searchbox", { name: "Champion" });
  await search.click();
  await search.fill(name);
  await search.press("Enter");
};

/** The index of the focused step, or -1. */
const focusedStep = (ui: UI) =>
  ui.page.evaluate(() => {
    const el = document.activeElement;
    return el?.getAttribute("role") === "listitem" ? [...el.parentElement!.querySelectorAll(":scope > [role=listitem]")].indexOf(el) : -1;
  });

test("keys, drags and order", async ({ ui }) => {
  const { page, step } = ui;
  const { card, chips, key, steps } = parts(ui);
  const box = async (i: number) => (await chips.nth(i).boundingBox())!;
  let was: string[] = [];

  await step("load", () => ui.open());
  await step(
    "Clear: a hint in place of the steps",
    () => card.locator("h2").getByRole("button", { name: "Clear" }).click(),
    async () => {
      await expect(chips).toHaveCount(0);
      await expect(card.getByText("Click or drag abilities here to build a combo.")).toBeVisible();
      expect(await steps()).toEqual([]);
    },
  );
  await step(
    "keys Q W E AA Ignite Wait R: a step each, in order",
    async () => {
      for (const k of ["Q", "W", "E", "AA", "Ignite", "Wait", "R"]) await key(k).click();
    },
    async () => {
      expect(await steps()).toEqual(["Q", "W", "E", "AA", "ignite", "wait", "R"]);
      await expect(chips).toHaveCount(7);
      await expect(chips.first()).toHaveAttribute("aria-label", /^Step 1 of 7: Q\./);
    },
  );
  await step(
    "drag the E key in before step 2",
    async () => {
      was = await steps();
      await ui.drag(key("E"), chips.nth(1));
    },
    async () => expect(await steps()).toEqual([was[0], "E", ...was.slice(1)]),
  );
  await step(
    "drag the Q key off the steps: nothing added",
    async () => {
      was = await steps();
      await ui.drag(key("Q"), { x: 1000, y: 30 }, async () => {
        await expect(card.locator(".combo-seq.receiving")).toHaveCount(1);
        await expect(card.locator(".combo-seq.over")).toHaveCount(0);
      });
    },
    async () => expect(await steps()).toEqual(was),
  );
  await step(
    "the Ignite key grabbed by its corner: its step centered under the pointer, away and over the steps; Escape adds nothing",
    async () => {
      was = await steps();
      const k = (await key("Ignite").boundingBox())!;
      const seq = (await card.getByRole("list", { name: "Combo sequence" }).boundingBox())!;
      await page.mouse.move(k.x + 3, k.y + 3);
      await page.mouse.down();
      for (const [x, y] of [
        [k.x + 300, k.y - 40],
        [seq.x + seq.width * 0.6, seq.y + seq.height / 2],
      ]) {
        await page.mouse.move(x, y, { steps: 8 });
        await ui.settle();
        const c = (await card.locator(".chip.dragging").boundingBox())!;
        expect(Math.abs(c.x + c.width / 2 - x)).toBeLessThan(1);
        expect(Math.abs(c.y + c.height / 2 - y)).toBeLessThan(1);
      }
      await page.keyboard.press("Escape");
      await page.mouse.up();
    },
    async () => expect(await steps()).toEqual(was),
  );
  await step(
    "drag step 1 to after step 4",
    async () => {
      was = await steps();
      const b = await box(3);
      await ui.drag(chips.nth(0), { x: b.x + b.width * 0.9, y: b.y + b.height / 2 });
    },
    async () => expect(await steps()).toEqual(moved(was, 0, 3)),
  );
  await step(
    "drag step 5 to the front",
    async () => {
      was = await steps();
      const b = await box(0);
      await ui.drag(chips.nth(4), { x: b.x + 2, y: b.y + b.height / 2 });
    },
    async () => expect(await steps()).toEqual(moved(was, 4, 0)),
  );
  await step(
    "Escape during a drag puts the step back",
    async () => {
      was = await steps();
      await ui.drag(chips.nth(0), chips.nth(3), () => page.keyboard.press("Escape"));
    },
    async () => expect(await steps()).toEqual(was),
  );
  await step(
    "ArrowRight moves the focused step 2, the focus with it",
    async () => {
      was = await steps();
      await chips.nth(1).focus();
      await page.keyboard.press("ArrowRight");
    },
    async () => {
      expect(await steps()).toEqual(moved(was, 1, 2));
      expect(await focusedStep(ui)).toBe(2);
    },
  );
  await step(
    "ArrowLeft on the first step does nothing",
    async () => {
      was = await steps();
      await chips.first().focus();
      await page.keyboard.press("ArrowLeft");
    },
    async () => expect(await steps()).toEqual(was),
  );
  await step(
    "Delete removes the focused step 3, the focus on the next",
    async () => {
      was = await steps();
      await chips.nth(2).focus();
      await page.keyboard.press("Delete");
    },
    async () => {
      expect(await steps()).toEqual(was.filter((_, i) => i !== 2));
      expect(await focusedStep(ui)).toBe(2);
    },
  );
  await step(
    "Backspace removes the last step, the focus on the one before",
    async () => {
      was = await steps();
      await chips.last().focus();
      await page.keyboard.press("Backspace");
    },
    async () => {
      expect(await steps()).toEqual(was.slice(0, -1));
      expect(await focusedStep(ui)).toBe(was.length - 2);
    },
  );
  await step(
    "a step's ✕ removes it",
    async () => {
      was = await steps();
      await chips.first().hover();
      await chips.first().getByRole("button", { name: "Remove step" }).click();
    },
    async () => expect(await steps()).toEqual(was.slice(1)),
  );
  const wait = card.getByRole("spinbutton", { name: "Seconds to wait" });
  await step(
    "drag the wait step by its empty seconds field to the front",
    async () => {
      was = await steps();
      const b = await box(0);
      await ui.drag(wait, { x: b.x + 2, y: b.y + b.height / 2 });
    },
    async () => expect(await steps()).toEqual(moved(was, was.indexOf("wait"), 0)),
  );
  await step(
    "wait 2.5 seconds, Enter",
    async () => {
      await wait.fill("2.5");
      await wait.press("Enter");
    },
    async () => expect(await steps()).toContain("wait{2.5s}"),
  );
  await step(
    "a drag from the field with 2.5 in it marks the text: the step stays",
    async () => {
      was = await steps();
      await ui.drag(wait, chips.last());
    },
    async () => expect(await steps()).toEqual(was),
  );
  await step(
    "the wait emptied: 1 second, its placeholder",
    async () => {
      await wait.fill("");
      await wait.press("Tab");
    },
    async () => {
      expect(await steps()).toContain("wait");
      await expect(wait).toHaveAttribute("placeholder", "1");
    },
  );
  await step(
    "Clear, then drag the R key into the empty steps",
    async () => {
      await card.locator("h2").getByRole("button", { name: "Clear" }).click();
      await ui.drag(key("R"), card.getByRole("list", { name: "Combo sequence" }));
    },
    async () => expect(await steps()).toEqual(["R"]),
  );
});

test("the crit buttons only with a step that can crit: none with Q W, back with an attack", async ({ ui }) => {
  const { step } = ui;
  const { card, key, crits } = parts(ui);
  const group = card.getByRole("group", { name: "Crits" });
  await step(
    "load with Q W: no crit buttons",
    () => ui.open({ combo: "Q W" }),
    () => expect(group).toHaveCount(0),
  );
  await step(
    "an attack added: the buttons, expected",
    () => key("AA").click(),
    async () => {
      await expect(group).toHaveCount(1);
      await expect(crits("expected")).toHaveAttribute("aria-pressed", "true");
    },
  );
  await step(
    "always, then Clear: gone again; an attack added is plain, nothing remembered",
    async () => {
      await crits("always").click();
      await ui.settle();
      expect((await ui.state()).combo).toBe("Q W AA!");
      await card.getByRole("button", { name: "Clear" }).click();
      await ui.settle();
      await expect(group).toHaveCount(0);
      await key("AA").click();
    },
    async () => {
      expect((await ui.state()).combo).toBe("AA");
      await expect(crits("expected")).toHaveAttribute("aria-pressed", "true");
    },
  );
});

test("crits and shorthand", async ({ ui }) => {
  const { step } = ui;
  const { card, key, shorthand, pencil, crits, steps } = parts(ui);
  const error = card.locator(":scope > div.small");
  const attacks = async () => (await steps()).filter((s) => s.startsWith("AA"));

  await step(
    "load: crits as expected, plain attacks",
    () => ui.open(),
    async () => {
      await expect(crits("expected")).toHaveAttribute("aria-pressed", "true");
      expect(await attacks()).toEqual(["AA"]);
    },
  );
  await step(
    "always: attacks marked to crit",
    () => crits("always").click(),
    async () => {
      await expect(crits("always")).toHaveAttribute("aria-pressed", "true");
      expect(await attacks()).toEqual(["AA!"]);
    },
  );
  await step(
    "never: marked not to",
    () => crits("never").click(),
    async () => expect(await attacks()).toEqual(["AA?"]),
  );
  await step(
    "a new attack follows",
    () => key("AA").click(),
    async () => expect(await attacks()).toEqual(["AA?", "AA?"]),
  );
  await step(
    "expected: plain again",
    () => crits("expected").click(),
    async () => expect(await attacks()).toEqual(["AA", "AA"]),
  );
  const combo = (await ui.state()).combo;
  let total = 0;
  await step(
    "the pencil: the combo as shorthand, focused",
    async () => {
      total = await ui.total();
      await pencil.click();
    },
    async () => {
      await expect(shorthand).toHaveValue(combo);
      await expect(shorthand).toBeFocused();
    },
  );
  await step(
    "Q W ZZZ: an error, the combo and result as they were",
    () => shorthand.fill("Q W ZZZ"),
    async () => {
      await expect(error).toContainText("ZZZ");
      expect((await ui.state()).combo).toBe(combo);
      expect(await ui.total()).toBe(total);
    },
  );
  await step(
    "Q W E R AA AA: the combo as typed, the result with it",
    () => shorthand.fill("Q W E R AA AA"),
    async () => {
      await expect(error).toHaveCount(0);
      expect((await ui.state()).combo).toBe("Q W E R AA AA");
      expect(await ui.total()).not.toBe(total);
    },
  );
  await step(
    "a key while typing adds to the text, the focus stays",
    () => key("Ignite").click(),
    async () => {
      await expect(shorthand).toHaveValue("Q W E R AA AA ignite");
      await expect(shorthand).toBeFocused();
    },
  );
  await step(
    "Enter: the steps",
    () => shorthand.press("Enter"),
    async () => {
      await expect(shorthand).toHaveCount(0);
      await expect(card.getByRole("listitem")).toHaveCount(7);
    },
  );
  for (const [how, leave] of [
    ["Escape", () => shorthand.press("Escape")],
    ["a click elsewhere", () => ui.page.locator("header .badge").click()],
  ] as const)
    await step(
      `the pencil, ${how}: the steps`,
      async () => {
        await pencil.click();
        await leave();
      },
      () => expect(shorthand).toHaveCount(0),
    );
  await step(
    "the pencil, a combo that doesn't parse, a click elsewhere: the last that did",
    async () => {
      await pencil.click();
      await shorthand.fill("E Q W R AA R ???");
      await ui.page.locator("header .badge").click();
    },
    async () => expect((await ui.state()).combo).toBe("Q W E R AA AA ignite"),
  );
});

test("variants, numbers and refits", async ({ ui }) => {
  const { page, step } = ui;
  const { card, key, chips, shorthand, type, steps } = parts(ui);
  const variant = card.locator(".step-variant > button");
  const menu = card.getByRole("listbox");
  const number = (label: string) => card.getByRole("spinbutton", { name: label });

  await step("load", () => ui.open());
  await step(
    "Xerath: W has a variant",
    () => pickChampion(ui, "xerath"),
    async () => {
      await expect(variant).toHaveCount(1);
      await expect(variant).toHaveAttribute("aria-label", "W variant: W");
    },
  );
  let total = 0;
  await step(
    "its menu by a click: the plain W selected, the menu focused",
    async () => {
      total = await ui.total();
      await variant.click();
    },
    async () => {
      expect(await menu.getByRole("option").count()).toBeGreaterThan(1);
      await expect(menu.getByRole("option").first()).toHaveAttribute("aria-selected", "true");
      await expect(menu).toBeFocused();
    },
  );
  await step(
    "click center: the step casts it, the result changes, the menu closes",
    () => menu.getByRole("option", { name: "W: center" }).click(),
    async () => {
      expect(await steps()).toContain("W:center");
      await expect(variant).toHaveAttribute("aria-label", "W variant: W: center");
      await expect(menu).toHaveCount(0);
      await expect(variant).toBeFocused();
      expect(await ui.total()).not.toBe(total);
    },
  );
  for (const [how, close] of [
    ["a click on it", () => variant.click()],
    ["a click outside", () => page.locator("header .badge").click()],
  ] as const)
    await step(
      `${how} closes the menu`,
      async () => {
        await variant.click();
        await expect(menu).toBeVisible();
        await close();
      },
      () => expect(menu).toHaveCount(0),
    );
  for (const [keys, picks] of [
    [["ArrowDown", "Home", "Enter"], "W"],
    [["ArrowUp", "ArrowDown", " "], "W:center"],
    [["ArrowDown", "Home", "Escape"], "W:center"],
  ] as const)
    await step(
      `${keys.join(", ")}: ${keys.at(-1) === "Escape" ? "closed, kept" : picks}`,
      async () => {
        await variant.focus();
        for (const k of keys) await page.keyboard.press(k);
      },
      async () => {
        await expect(menu).toHaveCount(0);
        expect(await steps()).toContain(picks);
      },
    );
  await step(
    "ArrowDown, Tab: closed",
    async () => {
      await variant.focus();
      await page.keyboard.press("ArrowDown");
      await expect(menu).toBeVisible();
      await page.keyboard.press("Tab");
    },
    () => expect(menu).toHaveCount(0),
  );

  const shots = number("R shots");
  await step(
    "Q W E R AA typed: R's shots, empty, the default as its placeholder",
    () => type("Q W E R AA"),
    async () => {
      await expect(shots).toHaveValue("");
      const [shown, max] = [Number(await shots.getAttribute("placeholder")), Number(await shots.getAttribute("max"))];
      expect(shown).toBeGreaterThan(0);
      expect(shown).toBeLessThanOrEqual(max);
    },
  );
  await step(
    "99 shots: the most once left",
    async () => {
      await shots.fill("99");
      await shots.press("Tab");
    },
    async () => {
      const max = (await shots.getAttribute("max"))!;
      await expect(shots).toHaveValue(max);
      expect(await steps()).toContain(`R{${max}}`);
    },
  );
  await step(
    "2 shots, Enter",
    async () => {
      await shots.fill("2");
      await shots.press("Enter");
    },
    async () => expect(await steps()).toContain("R{2}"),
  );
  let most = 0;
  await step(
    "R rank 1: the shots set become the most it has then",
    async () => {
      most = Number(await shots.getAttribute("max"));
      await shots.fill(String(most));
      await shots.press("Enter");
      await ui.card("Champion").getByRole("spinbutton", { name: "R rank" }).fill("1");
    },
    async () => {
      const max = Number(await shots.getAttribute("max"));
      expect(max).toBeLessThan(most);
      await expect(shots).toHaveValue(String(max));
      expect(await steps()).toContain(`R{${max}}`);
    },
  );

  const seconds = number("R seconds");
  await step(
    "Katarina, Q E R AA typed: R's seconds",
    async () => {
      await pickChampion(ui, "katarina");
      await type("Q E R AA");
    },
    () => expect(seconds).toHaveValue(""),
  );
  await step(
    "R seconds 1.25, Enter",
    async () => {
      await seconds.fill("1.25");
      await seconds.press("Enter");
    },
    async () => expect(await steps()).toContain("R{1.25s}"),
  );
  await step(
    "R seconds −3: the least once left",
    async () => {
      await seconds.fill("-3");
      await seconds.press("Tab");
    },
    async () => {
      const value = await seconds.inputValue();
      expect(Number(value)).toBeCloseTo(Number(await seconds.getAttribute("min")), 2);
      expect(await steps()).toContain(`R{${value}s}`);
    },
  );
  await step(
    "R seconds emptied: the default",
    async () => {
      await seconds.fill("");
      await seconds.press("Enter");
    },
    async () => expect(await steps()).toContain("R"),
  );
  await step(
    "Q E R{1.25s} AA, then Zed: refitted to his kit, his R has no seconds",
    async () => {
      await type("Q E R{1.25s} AA");
      await expect(chips).toHaveCount(4);
      await pickChampion(ui, "zed");
    },
    async () => {
      expect(await steps()).toEqual(["Q", "E", "R", "AA"]);
      await expect(seconds).toHaveCount(0);
    },
  );
  let keys = 0;
  await step(
    "Profane Hydra bought: a key for its active",
    async () => {
      keys = await card.locator(".combo-palette .combo-key").count();
      const items = ui.card("Items");
      await items.locator(".slots > .slot").nth(2).click();
      await items.getByRole("searchbox", { name: "Search items" }).fill("profane");
      await items.getByRole("searchbox", { name: "Search items" }).press("Enter");
    },
    () => expect(card.locator(".combo-palette .combo-key")).toHaveCount(keys + 1),
  );
  await step(
    "click it: the item's step, its chip named as the key",
    () => key("Heretical Cleave").click(),
    async () => {
      expect((await steps()).at(-1)).toBe("item:Profane_Hydra");
      await expect(chips.last()).toHaveText(/^Heretical Cleave/);
      await expect(chips.last().locator("img")).toHaveAttribute("src", (await key("Heretical Cleave").locator("img").getAttribute("src"))!);
    },
  );
  await step(
    "on to Lux: no variant, the item's step kept",
    () => pickChampion(ui, "lux"),
    async () => {
      await expect(variant).toHaveCount(0);
      expect((await steps()).at(-1)).toBe("item:Profane_Hydra");
      await expect(shorthand).toHaveCount(0);
    },
  );
});

test.describe(() => {
  // The last steps check Item value's ranking.
  test.use({ itemValue: true });

  test("each champion's combo, and steps that do nothing for now", async ({ ui }) => {
    const { step } = ui;
    const { card, key, chips, type, steps } = parts(ui);
    const inert = card.locator(".chip.inert");
    const rank = (k: string) => ui.card("Champion").getByRole("spinbutton", { name: `${k} rank` });
    const items = ui.card("Items");
    const slot = items.locator(".slots > .slot:not(.vacated)").nth(2);
    const buy = async (name: string) => {
      await slot.click();
      await items.getByRole("searchbox", { name: "Search items" }).fill(name);
      await items.getByRole("searchbox", { name: "Search items" }).press("Enter");
    };

    await step("load", () => ui.open());
    await step(
      "Yunara, Q R W E AA typed (in her R, W and E are its forms by themselves), R rank 1",
      async () => {
        await pickChampion(ui, "yunara");
        await type("Q R W E AA");
        await rank("R").fill("1");
      },
      async () => expect(await steps()).toEqual(["Q", "R", "W", "E", "AA"]),
    );
    await step(
      "Katarina: Yunara's combo, default leveling; then P",
      async () => {
        await pickChampion(ui, "katarina");
        await key("P").click();
      },
      async () => {
        expect(await steps()).toEqual(["Q", "R", "W", "E", "AA", "P"]);
        expect((await ui.state()).ranks).toBeNull();
        await expect(inert).toHaveCount(0);
      },
    );
    await step(
      "Back to Yunara: her combo as she had it, her R rank",
      () => ui.page.goBack(),
      async () => {
        expect(await steps()).toEqual(["Q", "R", "W", "E", "AA"]);
        await expect(rank("R")).toHaveValue("1");
      },
    );
    await step(
      "Forward to Katarina: hers, P and all",
      () => ui.page.goForward(),
      async () => expect(await steps()).toEqual(["Q", "R", "W", "E", "AA", "P"]),
    );
    await step(
      "on to Lux, who has no P step: P kept, muted, saying why",
      () => pickChampion(ui, "lux"),
      async () => {
        expect(await steps()).toEqual(["Q", "R", "W", "E", "AA", "P"]);
        await expect(key("P")).toHaveCount(0);
        await expect(inert).toHaveCount(1);
        await expect(chips.last()).toHaveClass(/\binert\b/);
        await expect(chips.last()).toHaveAttribute("title", "Skipped: Lux has no P step");
      },
    );
    let total = 0;
    await step(
      "Hextech Gunblade bought, its active's key: a step that fires",
      async () => {
        await buy("gunblade");
        await key("Lightning Bolt").click();
      },
      async () => {
        expect((await steps()).at(-1)).toBe("item:Hextech_Gunblade");
        await expect(inert).toHaveCount(1);
        total = await ui.total();
      },
    );
    await step(
      "Gunblade sold: its step kept, muted, saying why",
      async () => {
        await slot.hover();
        await slot.getByRole("button", { name: /^Sell / }).click();
      },
      async () => {
        expect((await steps()).at(-1)).toBe("item:Hextech_Gunblade");
        await expect(key("Lightning Bolt")).toHaveCount(0);
        await expect(inert).toHaveCount(2);
        await expect(chips.last()).toHaveAttribute("title", "Skipped: Hextech Gunblade isn't in the build");
        expect(await ui.total()).toBeLessThan(total);
      },
    );
    const value = ui.card("Item value");
    await step(
      "Item value: Gunblade's worth has its Lightning Bolt",
      async () => {
        const all = value.getByRole("button", { name: "Show more" });
        if (await all.count()) await all.click();
        await value.getByRole("row").filter({ hasText: "Hextech Gunblade" }).locator(".iv-track").hover();
      },
      () => expect(ui.tooltip).toContainText("Lightning Bolt"),
    );
    await step("the pointer away", () => ui.unhover());
    await step(
      "bought back: it fires again, the total as it was",
      () => buy("gunblade"),
      async () => {
        await expect(inert).toHaveCount(1);
        await expect(chips.last()).not.toHaveClass(/\binert\b/);
        await expect(chips.last()).not.toHaveAttribute("title");
        expect(await ui.total()).toBe(total);
      },
    );
  });
});

test("forms: keys and steps as cast, unchanged while dragged", async ({ ui }) => {
  const { step } = ui;
  const { chips, key, steps } = parts(ui);
  const distance = (i: number) => chips.nth(i).getByRole("spinbutton", { name: "Q distance" });

  await step(
    "Nidalee Q R Q W: the Q before R is Javelin Toss with its distance, after it Takedown; the keys cast in cougar form",
    () => ui.open({ champion: "Nidalee", level: 16, combo: "Q R Q W" }),
    async () => {
      await expect(distance(0)).toHaveCount(1);
      await expect(distance(2)).toHaveCount(0);
      await expect(key("Q")).toHaveAttribute("title", "Takedown");
      await expect(key("W")).toHaveAttribute("title", "Pounce");
    },
  );
  await step(
    "Takedown dragged across R keeps its look until let go (it changed size and looped), then is Javelin Toss",
    async () => {
      const b = (await chips.nth(0).boundingBox())!;
      await ui.drag(chips.nth(2), { x: b.x + 2, y: b.y + b.height / 2 }, () => expect(distance(2)).toHaveCount(0));
    },
    async () => {
      expect(await steps()).toEqual(["Q", "Q", "R", "W"]);
      await expect(distance(0)).toHaveCount(1);
      await expect(distance(1)).toHaveCount(1);
    },
  );
  await step(
    "a Javelin Toss dragged after R keeps its distance until let go",
    async () => {
      const b = (await chips.nth(3).boundingBox())!;
      // By its icon: its middle is its distance field.
      await ui.drag(chips.nth(0).locator(".icon"), { x: b.x + b.width - 2, y: b.y + b.height / 2 }, () => expect(distance(0)).toHaveCount(1));
    },
    async () => {
      expect(await steps()).toEqual(["Q", "R", "W", "Q"]);
      await expect(distance(3)).toHaveCount(0);
    },
  );
});

test("Energize: a key once the build has an Energized item, adding the step that makes the next attack Energized; Energized at start a parameter", async ({
  ui,
}) => {
  const { step } = ui;
  const { chips, key, steps } = parts(ui);
  await step(
    "Jinx with no Energized item: no Energize key",
    () => ui.open({ champion: "Jinx", items: [3031, null, null, null, null, null], combo: "AA AA" }),
    () => expect(key("Energize")).toHaveCount(0),
  );
  await step(
    "with Rapid Firecannon, not Energized at start: the key adds energize at the end",
    async () => {
      await ui.open({ champion: "Jinx", items: [3094, null, null, null, null, null], options: { "energized.ready": 0 }, combo: "AA AA" });
      await key("Energize").click();
    },
    async () => {
      expect(await steps()).toEqual(["AA", "AA", "energize"]);
      await expect(chips).toHaveCount(3);
    },
  );
  await step(
    "the parameters: Energized at start, a checkbox, off",
    () => ui.page.locator("summary", { hasText: "parameters" }).click(),
    () => expect(ui.page.getByRole("checkbox", { name: "Energized at start" })).not.toBeChecked(),
  );
});
