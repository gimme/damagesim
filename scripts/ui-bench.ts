// Time what the web UI does on a state change: builds the app for production (unminified, so the
// profile names its functions), serves it, and in headless Chromium does each action --runs times (the
// level up, keystrokes in the combo's shorthand, a target, a champion, the Resist sweep tab). Each is
// done with raw input and timed for a while after it, long enough for Item value's ranking, a quarter
// of a second later, so nothing of the script's runs in the page meanwhile. For each it reports the
// main thread's time from a CPU profile, by what it was doing (the simulation the page shows, Item
// value's ranking, the Resist sweep, the scenario's bookkeeping, React rendering, the browser's own
// work and garbage collection), its longest busy stretch, and the interaction's latency (Event
// Timing: from the input to the next paint), what the user waits for.
// Usage: node scripts/ui-bench.ts [--runs 5] [--url http://localhost:5173 (a running server, else a fresh build)]

import { execFileSync } from "node:child_process";
import { createServer } from "node:http";
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { extname, join } from "node:path";
import { parseArgs } from "node:util";
import { setTimeout as sleep } from "node:timers/promises";
import { chromium, type CDPSession, type Locator } from "@playwright/test";

const { values: args } = parseArgs({ options: { runs: { type: "string", default: "5" }, url: { type: "string" } } });
const runs = Math.max(1, Number(args.runs));
const ROOT = new URL("..", import.meta.url).pathname;

let url = args.url;
let close = () => {};
if (!url) {
  const out = mkdtempSync(join(tmpdir(), "damagesim-ui-bench-"));
  execFileSync("node", ["scripts/gen-kit-index.ts"], { cwd: ROOT, stdio: "ignore" });
  execFileSync("npx", ["vite", "build", "--minify", "false", "--outDir", out, "--emptyOutDir"], { cwd: ROOT, stdio: "ignore" });
  const types: Record<string, string> = {
    ".js": "text/javascript",
    ".css": "text/css",
    ".html": "text/html",
    ".json": "application/json",
    ".svg": "image/svg+xml",
  };
  const server = createServer((req, res) => {
    const path = join(out, decodeURIComponent(new URL(req.url!, "http://x").pathname));
    const file = existsSync(path) && statSync(path).isFile() ? path : join(out, "index.html");
    res.writeHead(200, { "content-type": types[extname(file)] ?? "application/octet-stream" });
    res.end(readFileSync(file));
  });
  await new Promise<void>((ok) => server.listen(0, "127.0.0.1", ok));
  url = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  close = () => {
    server.close();
    rmSync(out, { recursive: true, force: true });
  };
}

// --- The profile, by what the main thread was doing.

interface ProfileNode {
  id: number;
  callFrame: { functionName: string; url: string };
  children?: number[];
}
interface Profile {
  nodes: ProfileNode[];
  samples: number[];
  timeDeltas: number[];
}

/** What a sample's stack was doing: the outermost of these on it names it. */
const CATEGORIES: [string, RegExp][] = [
  ["Item value ranking (rankItems)", /^rankItems$/],
  ["Resist sweep (resistSweep)", /^resistSweep$/],
  ["page's simulation (simulate)", /^simulate$/],
  ["Sim for the page's controls (new Sim)", /^Sim$/],
  ["scenario: toScenario, address", /^(toScenario|encodeState|encodePage|decodeState|decodePage)$/],
];
/** React's work loop and event dispatch: what isn't one of the above under it is React's rendering. */
const REACT =
  /^(performWorkOnRoot|performSyncWorkOnRoot|performWorkUntilDeadline|flushSyncWorkAcrossRoots_impl|processRootScheduleInMicrotask|dispatchDiscreteEvent|dispatchEvent|commitRoot|renderRootSync)$/;
const BUSY = "main thread busy";
const LONGEST = "longest busy stretch";

function categorize(p: Profile): Map<string, number> {
  const byId = new Map(p.nodes.map((n) => [n.id, n]));
  const parent = new Map<number, number>();
  for (const n of p.nodes) for (const c of n.children ?? []) parent.set(c, n.id);
  const out = new Map<string, number>([[BUSY, 0]]);
  let stretch = 0;
  let longest = 0;
  for (let i = 0; i < p.samples.length; i++) {
    // A sample stands for the time until the next one.
    const dt = (p.timeDeltas[i + 1] ?? 0) / 1000;
    const stack: ProfileNode[] = [];
    for (let id: number | undefined = p.samples[i]; id !== undefined; id = parent.get(id)) stack.push(byId.get(id)!);
    stack.reverse();
    const leaf = stack[stack.length - 1].callFrame.functionName;
    if (leaf === "(idle)") {
      stretch = 0;
      continue;
    }
    longest = Math.max(longest, (stretch += dt));
    let cat: string | undefined;
    if (leaf === "(garbage collector)") cat = "garbage collection";
    else if (leaf === "(program)") cat = "browser's own work: input, style, layout, paint (program)";
    else {
      for (const n of stack) {
        cat = CATEGORIES.find(([, re]) => re.test(n.callFrame.functionName))?.[0];
        if (cat) break;
      }
      cat ??= stack.some((n) => REACT.test(n.callFrame.functionName)) ? "React: render and commit" : "other script";
    }
    out.set(cat, (out.get(cat) ?? 0) + dt);
    out.set(BUSY, out.get(BUSY)! + dt);
  }
  out.set(LONGEST, longest);
  return out;
}

// --- The page.

const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=", "base64");

declare global {
  interface Window {
    __events: number[];
  }
}

/** In the page before its scripts: the interactions' latency (Event Timing). */
function watch() {
  window.__events = [];
  new PerformanceObserver((l) => {
    for (const e of l.getEntries()) if ((e as PerformanceEventTiming & { interactionId?: number }).interactionId) window.__events.push(e.duration);
  }).observe({ type: "event", durationThreshold: 16 } as PerformanceObserverInit);
}

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
await page.context().route(
  (u) => u.origin !== new URL(url!).origin,
  (route) => (route.request().resourceType() === "image" ? route.fulfill({ body: PNG, contentType: "image/png" }) : route.abort()),
);
await page.addInitScript(watch);
const cdp: CDPSession = await page.context().newCDPSession(page);
await cdp.send("Profiler.enable");
await cdp.send("Profiler.setSamplingInterval", { interval: 100 });

/** Item value has ranked the build as it is. */
const ranked = () =>
  page.waitForFunction(
    () => !document.querySelector("[aria-busy=true]") && ![...document.querySelectorAll(".card .muted.small")].some((e) => e.textContent === "Simulating…"),
  );
/** Time enough after an action for everything it sets off: the ranking starts 250 ms after it. */
const AFTER = 800;

await page.goto(url + "/");
await page.locator(".hero .value").first().waitFor();
await ranked();

const card = (title: string) => page.locator("section.card").filter({ has: page.locator("h2", { hasText: new RegExp(`^${title}(?![a-z])`) }) });
const click = async (l: Locator) => {
  const b = (await l.boundingBox())!;
  return () => page.mouse.click(b.x + b.width / 2, b.y + b.height / 2);
};

/**
 * Actions: `prepare` (not timed) returns the timed input, raw keys or a click where the element was;
 * `undo` (not timed) brings the page back, so every run starts where the first did.
 */
const ACTIONS: { name: string; prepare: () => Promise<() => Promise<void>>; undo: () => Promise<void> }[] = [
  {
    name: "level up",
    prepare: async () => {
      await card("Champion").getByRole("slider", { name: "Champion level" }).focus();
      return () => page.keyboard.press("ArrowRight");
    },
    undo: () => card("Champion").getByRole("slider", { name: "Champion level" }).press("ArrowLeft"),
  },
  {
    name: "combo: type ' AA' in its shorthand (3 keystrokes, 2 of which parse)",
    prepare: async () => {
      await card("Combo").getByRole("button", { name: "Edit as text" }).click();
      await card("Combo").getByRole("textbox", { name: "Combo shorthand" }).press("End");
      return () => page.keyboard.type(" AA", { delay: 30 });
    },
    undo: async () => {
      const box = card("Combo").getByRole("textbox", { name: "Combo shorthand" });
      for (let i = 0; i < 3; i++) await box.press("Backspace");
      await box.press("Enter");
    },
  },
  {
    name: "target: Tank",
    prepare: () => click(card("Target").getByRole("group", { name: "Target" }).getByRole("button", { name: "Tank" })),
    undo: () => card("Target").getByRole("group", { name: "Target" }).getByRole("button", { name: "Squishy" }).click(),
  },
  {
    name: "champion: type Zed in the search, Enter",
    prepare: async () => {
      await card("Champion").getByRole("searchbox", { name: "Champion" }).click();
      return async () => {
        await page.keyboard.type("Zed", { delay: 30 });
        await page.keyboard.press("Enter");
      };
    },
    undo: async () => {
      const search = card("Champion").getByRole("searchbox", { name: "Champion" });
      await search.click();
      await search.fill("Ahri");
      await search.press("Enter");
    },
  },
  {
    name: "details tab: Resist sweep",
    prepare: () => click(page.getByRole("tab", { name: "Resist sweep" })),
    undo: () => page.getByRole("tab", { name: "Timeline" }).click(),
  },
];

const fmt = (v: number) => v.toFixed(1).padStart(7);
const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[xs.length >> 1];
console.log(`web UI at ${url}, production build, ${runs} runs of each action (ms: median of the runs)`);
for (const action of ACTIONS) {
  const rows: Map<string, number>[] = [];
  // The first run warms up.
  for (let k = 0; k <= runs; k++) {
    const input = await action.prepare();
    await page.evaluate(() => (window.__events = []));
    await cdp.send("Profiler.start");
    await input();
    await sleep(AFTER);
    const { profile } = (await cdp.send("Profiler.stop")) as { profile: Profile };
    const latency = await page.evaluate(() => Math.max(0, ...window.__events));
    await ranked();
    await action.undo();
    await ranked();
    if (k === 0) continue;
    rows.push(new Map([...categorize(profile), ["slowest interaction (input to next paint)", latency]]));
  }
  console.log(`\n${action.name}:`);
  const names = [...new Set(rows.flatMap((r) => [...r.keys()]))];
  const order = (n: string) => (n === BUSY ? 0 : n === LONGEST ? 1 : n.startsWith("slowest") ? 3 : 2);
  const stats = names.map((n) => [n, median(rows.map((r) => r.get(n) ?? 0))] as const);
  stats.sort((a, b) => order(a[0]) - order(b[0]) || b[1] - a[1]);
  // Event Timing reports only interactions of 16 ms or more.
  for (const [n, v] of stats)
    if (v >= 0.05 || order(n) === 3) console.log(`  ${order(n) === 3 && v < 16 ? "    <16" : fmt(v)}  ${order(n) === 2 ? "  " : ""}${n}`);
}

await browser.close();
close();
