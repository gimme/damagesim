// The ranking worker in the page (src/web/ranking.ts): Item value's simulations, off the page's thread.
// A search for sets of items answers with its progress and then its result while the page keeps
// drawing frames; a lane's next job stops the one before, which never answers.

import { test, expect } from "./ui.ts";

const base = { champion: "Ahri", level: 11, items: [6655, 3020], combo: "E Q W R AA R", target: { preset: "squishy" } };

test("the ranking worker", async ({ ui }) => {
  const { page, step } = ui;
  await step("load", () => ui.open());

  await step("a search for 3 items: progress, then the best sets, the page drawing all the while", async () => {
    const run = await page.evaluate(async (base) => {
      const { openLane } = await import(/* @vite-ignore */ `${"/ranking.ts"}`);
      const lane = openLane();
      const frames: number[] = [];
      let drawing = true;
      const draw = (t: number) => {
        frames.push(t);
        if (drawing) requestAnimationFrame(draw);
      };
      requestAnimationFrame(draw);
      const start = performance.now();
      let progress = 0;
      const result: any = await new Promise((resolve, reject) =>
        lane.run({ kind: "sets", base, size: 3, slots: 6 }, { progress: () => progress++, result: resolve, error: reject }),
      );
      drawing = false;
      lane.close();
      const gaps = frames.slice(1).map((t, i) => t - frames[i]);
      return { ms: performance.now() - start, progress, sets: result.sets.length, evaluated: result.evaluated, longestFrame: Math.max(...gaps) };
    }, base);
    console.info(`[ranking] 3 items: ${run.evaluated} simulations in ${Math.round(run.ms)} ms; longest frame ${Math.round(run.longestFrame)} ms`);
    expect(run.sets).toBeGreaterThan(0);
    expect(run.progress).toBeGreaterThan(1);
    // A frame every 100ms at worst, though the search takes far longer.
    expect(run.longestFrame).toBeLessThan(100);
  });

  await step("a lane's next job in place of the one under way, which never answers", async () => {
    const { started, answers } = await page.evaluate(async (base) => {
      const { openLane } = await import(/* @vite-ignore */ `${"/ranking.ts"}`);
      const lane = openLane();
      let started = false;
      const answers: string[] = [];
      // Pairs: a search of some 700 simulations, under way once it has told how far it is.
      await new Promise<void>((resolve) =>
        lane.run(
          { kind: "sets", base, size: 2, slots: 6 },
          {
            progress: () => {
              started = true;
              resolve();
            },
            result: () => answers.push("first"),
            error: () => answers.push("first failed"),
          },
        ),
      );
      await new Promise((resolve) =>
        lane.run({ kind: "items", base }, { result: () => resolve(answers.push("second")), error: () => resolve(answers.push("second failed")) }),
      );
      // Time enough for the first to have answered, had it gone on.
      await new Promise((resolve) => setTimeout(resolve, 1500));
      lane.close();
      return { started, answers };
    }, base);
    expect(started).toBe(true);
    expect(answers).toEqual(["second"]);
  });
});
