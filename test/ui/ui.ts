// What the web UI's smoke test shares: a page whose icons are stubbed, steps that act, wait for the
// page to settle and check what should have happened, readers for the state in the URL hash and the
// numbers shown, and the one check every test makes: the console stays empty.

import { test as base, expect, type Locator, type Page } from "@playwright/test";
import { loadGameData } from "../../src/node/load.ts";
import { DEFAULT_STATE, decodeState, encodeState, type UIState } from "../../src/web/state.ts";

export { expect };

declare global {
  interface Window {
    __quiet: { reset(): void; frames(): number };
  }
}

/** Every icon, from Data Dragon or CommunityDragon: a 1×1 PNG, so the test needs no network and every icon loads (none falls back to initials). */
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=", "base64");

/** The dev server's and React's development greetings; anything else on the console is the UI's. */
const GREETINGS = [/^\[vite\] (connecting|connected)/, /Download the React DevTools/];

/** In the page before its scripts: counts the frames since the DOM last changed. */
function watchQuiet() {
  let frames = 0;
  new MutationObserver(() => (frames = 0)).observe(document, { subtree: true, childList: true, attributes: true, characterData: true });
  const tick = () => {
    frames++;
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
  window.__quiet = { reset: () => (frames = 0), frames: () => frames };
}

/** In the page: whether it has settled, nothing changing for 3 frames and nothing pending; Item value's ranking too, with `itemValue`. */
function isSettled(itemValue: boolean) {
  // Item value ranks the build's next item a moment after the build changes, busy meanwhile.
  if (itemValue && document.querySelector("[aria-busy=true]")) return false;
  if (itemValue && [...document.querySelectorAll(".card .muted.small")].some((e) => e.textContent === "Simulating…")) return false;
  // A dragged item or step gliding into place: the script's animations (the CSS ones are decoration, some endless).
  if (document.getAnimations().some((a) => a.playState === "running" && !(a instanceof CSSAnimation) && !(a instanceof CSSTransition))) return false;
  return window.__quiet.frames() >= 3;
}

/** The game data the page has, for the scenario codes. */
const DATA = loadGameData();

/** A state's code; what's left out is the default, in the target and the settings field by field. */
export const codeOf = (state: Record<string, any>) =>
  encodeState(DATA, {
    ...DEFAULT_STATE,
    ...state,
    target: { ...DEFAULT_STATE.target, ...state.target },
    settings: { ...DEFAULT_STATE.settings, ...state.settings },
  });

/** The state in a code, a hash or a link. */
export function stateOf(code: string): UIState {
  const state = decodeState(DATA, code);
  if (!state) throw new Error(`not a scenario code: ${code}`);
  return state;
}

/** The first number in a text: 1317 in "Total damage 1,317", −5 in "−5 (lvl 6)". */
export const num = (text: string) => Number(/[−-]?\d[\d,]*(\.\d+)?/.exec(text)![0].replace(/,/g, "").replace("−", "-"));

/** The visible text of each element a locator matches, on one line. */
export const texts = async (loc: Locator) => (await loc.allInnerTexts()).map((t) => t.replace(/\s+/g, " ").trim());

/** An attribute of each element a locator matches. */
export const attrs = (loc: Locator, name: string) => loc.evaluateAll((els, name) => els.map((e) => e.getAttribute(name)), name);

export interface UI {
  page: Page;
  /** Opens the app with a state in the hash (what's left out is the default), and waits for it to settle. */
  open(state?: object): Promise<void>;
  /** Runs one step: `act`, then once the page has settled, `check`. */
  step(name: string, act: () => Promise<unknown>, check?: () => Promise<unknown>): Promise<void>;
  /** Waits until nothing changes for a few frames and nothing glides, and with the `itemValue` option, for Item value's ranking. */
  settle(): Promise<void>;
  /** The state in the URL hash. */
  state(): Promise<UIState>;
  /** A card by its heading. */
  card(title: string): Locator;
  /** The card with the result's tabs. */
  details(): Locator;
  /** The result's total damage. */
  total(): Promise<number>;
  /** The hover card. */
  hovercard: Locator;
  /** A chart's or Item value's tooltip. */
  tooltip: Locator;
  /** Moves the pointer off everything, and waits for what it showed to close. */
  unhover(): Promise<void>;
  /** Drags `from` by its middle onto the middle of `to` (or a point), with the mouse; `held` runs before it's let go. */
  drag(from: Locator, to: Locator | { x: number; y: number }, held?: () => Promise<void>): Promise<void>;
}

export const test = base.extend<{ ui: UI; itemValue: boolean }>({
  // Whether each step waits for Item value to rank the build as it then is: ~100 simulations, a
  // quarter of a second after each change. Only what checks the ranking needs it.
  itemValue: [false, { option: true }],
  ui: async ({ page, context, baseURL, itemValue }, use) => {
    // What reaches the console, by the step it came in.
    const messages: string[] = [];
    let at = "load";
    page.on("console", (m) => {
      if (!GREETINGS.some((g) => g.test(m.text()))) messages.push(`${at}: ${m.type()}: ${m.text()}`);
    });
    page.on("pageerror", (e) => messages.push(`${at}: pageerror: ${e.message}`));
    const app = new URL(baseURL!).origin;
    await context.route(
      (url) => url.origin !== app,
      (route) => {
        if (route.request().resourceType() === "image") return route.fulfill({ body: PNG, contentType: "image/png" });
        messages.push(`${at}: request: ${route.request().url()}`);
        return route.abort();
      },
    );
    await page.addInitScript(watchQuiet);

    const settle = async (ranked = itemValue) => {
      await page.evaluate(() => window.__quiet.reset());
      await page.waitForFunction(isSettled, ranked, { polling: "raf" });
    };
    const ui: UI = {
      page,
      open: async (state) => {
        await page.goto("/" + (state ? "#" + codeOf(state) : ""));
        await expect(page.locator("section.card").first()).toBeVisible();
        await settle(true);
      },
      step: (name, act, check) =>
        test.step(name, async () => {
          at = name;
          await act();
          await settle();
          await check?.();
        }),
      settle: () => settle(),
      state: async () => stateOf(new URL(page.url()).hash),
      card: (title) => page.locator("section.card").filter({ has: page.locator("h2", { hasText: new RegExp(`^${title}(?![a-z])`) }) }),
      details: () => page.locator("section.card").filter({ has: page.getByRole("tablist") }),
      total: async () => num(await page.locator(".hero .value").first().innerText()),
      hovercard: page.locator(".tooltip.hovercard"),
      tooltip: page.locator(".tooltip[role=status]"),
      unhover: async () => {
        await page.mouse.move(1, 1);
        await expect(page.locator(".tooltip")).toHaveCount(0);
      },
      drag: async (from, to, held) => {
        await settle();
        const middle = async (l: Locator) => {
          const b = (await l.boundingBox())!;
          return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
        };
        const a = await middle(from);
        const b = "x" in to ? to : await middle(to);
        await page.mouse.move(a.x, a.y);
        await page.mouse.down();
        await page.mouse.move(b.x, b.y, { steps: 16 });
        await settle();
        await held?.();
        await page.mouse.up();
      },
    };
    await use(ui);
    expect.soft(messages, "the console stays empty").toEqual([]);
  },
});
