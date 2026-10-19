// Item value's progress bar for a search for sets: shown only for one with a second or more left, as
// judged by its speed since its progress was first heard (on a page just opened the worker's start
// comes first), and, when a job changed under way takes the place of the one before, filling what's
// left of the bar from where it stood. The worker's progress is scripted: a stand-in passes each job
// to the real worker, sends a script's progress in place of the real one, and holds the real result
// back until the script has played.

import { test, expect, addressOf } from "./ui.ts";

/** A search's progress as the stand-in sends it: [ms after the job, done, total]; the result comes after the last. */
type Script = [number, number, number][];

/** Progress every 50 ms from `from` ms after the job, `done` rising by `step` to `total`. */
const steady = (from: number, done: number, step: number, total = 1000): Script =>
  Array.from({ length: Math.floor((total - done) / step) + 1 }, (_, k) => [from + 50 * k, done + step * k, total]);

/** In the page before its scripts: the stand-in worker, playing a script for each search for sets in turn. */
function standIn(scripts: Script[]) {
  const Real = window.Worker;
  window.Worker = class {
    onmessage: ((e: { data: any }) => void) | null = null;
    onerror: ((e: ErrorEvent) => void) | null = null;
    real: Worker;
    /** Each scripted job's result, once the real worker has it, and whether its script has played. */
    played = new Map<string, { result?: any; over: boolean }>();
    constructor(url: string | URL, options?: WorkerOptions) {
      this.real = new Real(url, options);
      this.real.onerror = (e) => this.onerror?.(e);
      this.real.onmessage = (e) => {
        const job = this.played.get(`${e.data.lane}:${e.data.id}`);
        if (!job) return this.onmessage?.(e);
        if ("progress" in e.data) return;
        job.result = e.data;
        if (job.over) this.onmessage?.(e);
      };
    }
    postMessage(m: any) {
      this.real.postMessage(m);
      if (m?.job?.kind !== "sets" || !scripts.length) return;
      const job: { result?: any; over: boolean } = { over: false };
      this.played.set(`${m.lane}:${m.id}`, job);
      const script = scripts.shift()!;
      for (const [ms, done, total] of script) setTimeout(() => this.onmessage?.({ data: { lane: m.lane, id: m.id, progress: { done, total } } }), ms);
      setTimeout(
        () => {
          job.over = true;
          if (job.result) this.onmessage?.({ data: job.result });
        },
        script.at(-1)![0] + 1,
      );
    }
    terminate() {
      this.real.terminate();
    }
  } as unknown as typeof Worker;
  // The bar's fill each time it changes, null while there's none.
  const fills: (number | null)[] = [];
  (window as any).__fills = fills;
  new MutationObserver(() => {
    const v = document.querySelector("[role=progressbar]")?.getAttribute("aria-valuenow");
    const fill = v == null ? null : Number(v);
    if (fills.at(-1) !== fill) fills.push(fill);
  }).observe(document, { subtree: true, childList: true, attributes: true, attributeFilter: ["aria-valuenow"] });
}

const fills = (ui: { page: import("@playwright/test").Page }) => ui.page.evaluate(() => (window as any).__fills as (number | null)[]);

test("a quick search on a page just opened shows no progress, its first word late with the worker's start", async ({ ui }) => {
  const { page, step } = ui;
  // Heard first 400 ms after the job, as a worker just started is; done 300 ms later.
  await page.addInitScript(standIn, [steady(400, 20, 160)]);
  await step(
    "load at 3 items",
    () => ui.open({ next: 3 }),
    async () => {
      // Judged from the job's start, 2% in 400 ms was some 20 s left.
      expect((await fills(ui)).filter((f) => f != null)).toEqual([]);
    },
  );
});

test("a long search's progress, and a job changed under way filling what's left of the bar", async ({ ui }) => {
  const { page } = ui;
  // Some 2.5 s, then 4 s in place of it. The steps don't wait for the page to settle: the bar moves till the end.
  await page.addInitScript(standIn, [steady(50, 0, 20), steady(50, 0, 12.5)]);
  const card = ui.card("Item value");
  const bar = card.getByRole("progressbar");
  const fill = async () => Number(await bar.getAttribute("aria-valuenow"));
  let from = 0;
  await test.step("load at 3 items, the search under way", async () => {
    await page.goto(addressOf({ next: 3 }));
    await expect(bar).toBeVisible();
    await expect.poll(fill).toBeGreaterThanOrEqual(30);
    from = await fill();
  });
  await test.step("2 items in place of 3", async () => {
    await card.getByRole("group", { name: "Items" }).getByRole("button", { name: "2", exact: true }).click();
    // The new run fills on from where the bar stood, where it held until the run caught up, some 1.5 s.
    await expect.poll(fill, { timeout: 1000 }).toBeGreaterThanOrEqual(from + 8);
    await expect(bar).toHaveCount(0, { timeout: 8000 });
  });
  // Never going back, and full before it went.
  const shown = (await fills(ui)).filter((f): f is number => f != null);
  expect(shown.every((f, i) => i === 0 || f >= shown[i - 1])).toBe(true);
  expect(shown.at(-1)).toBe(100);
});
