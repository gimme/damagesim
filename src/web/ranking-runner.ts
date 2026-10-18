// What the ranking worker (ranking.worker.ts) does with the jobs it's sent: Item value's ranking of
// the next item (rankItems) or of sets of items (searchItemSets), run a slice at a time so a job sent
// after it is read in between. A lane runs one job at a time: a new one takes the place of the one
// before, which stops where it is and never answers. It takes the game data and how to post and to
// wait as arguments, so Node runs it too.

import type { GameData } from "../engine/gamedata.ts";
import type { Scenario } from "../engine/sim.ts";
import type { ItemData } from "../engine/data-types.ts";
import { rankItems, searchItemSets, type SearchProgress } from "../engine/analysis.ts";

export type RankJob =
  /** What each candidate would add as the next item (all of them, unlimited). */
  | { kind: "items"; base: Scenario; candidates?: number[] }
  /** The best sets of `size` candidates to add, in a build of `slots` slots (7 with the bot lane quest's boots slot). */
  | { kind: "sets"; base: Scenario; size: number; slots: number; candidates?: number[] };

export type ItemRanking = ReturnType<typeof rankItems>;
export type SetRanking = ReturnType<typeof searchItemSets> extends Generator<unknown, infer R> ? R : never;
export type RankResult<J extends RankJob = RankJob> = J extends { kind: "items" } ? ItemRanking : SetRanking;

/** A lane's job (null: none, stopping the one it has). */
export interface ToWorker {
  lane: number;
  id: number;
  job: RankJob | null;
}

export type FromWorker = { lane: number; id: number } & ({ progress: SearchProgress } | { result: RankResult } | { error: string });

/** The slots for items other than boots: the inventory's six; the bot lane quest's seventh is for boots. */
const INVENTORY = 6;

function* steps(data: GameData, job: RankJob): Generator<SearchProgress, RankResult> {
  if (job.kind === "items") return rankItems(data, job.base, { candidates: job.candidates, limit: Infinity });
  const fits = (items: ItemData[]) => items.length <= job.slots && items.filter((it) => !it.tags.includes("Boots")).length <= INVENTORY;
  return yield* searchItemSets(data, job.base, { size: job.size, candidates: job.candidates, fits });
}

/**
 * The worker's side: takes each message sent to it, and runs the lanes' jobs `slice` milliseconds
 * each in turn, then `later` again while any is left. Posts a job's progress after each slice, then
 * its result or its error.
 */
export function ranker(data: GameData, post: (m: FromWorker) => void, later: (next: () => void) => void, slice = 30) {
  const jobs = new Map<number, { id: number; run: Generator<SearchProgress, RankResult> }>();
  let waiting = false;
  const pump = () => {
    waiting = false;
    for (const [lane, { id, run }] of jobs) {
      const until = performance.now() + slice;
      try {
        let step = run.next();
        while (!step.done && performance.now() < until) step = run.next();
        if (step.done) {
          jobs.delete(lane);
          post({ lane, id, result: step.value });
        } else post({ lane, id, progress: step.value });
      } catch (e) {
        jobs.delete(lane);
        post({ lane, id, error: (e as Error).message });
      }
    }
    wait();
  };
  const wait = () => {
    if (waiting || !jobs.size) return;
    waiting = true;
    later(pump);
  };
  return (m: ToWorker) => {
    if (m.job) jobs.set(m.lane, { id: m.id, run: steps(data, m.job) });
    else jobs.delete(m.lane);
    wait();
  };
}
