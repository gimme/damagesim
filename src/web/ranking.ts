// The page's side of the ranking worker (ranking.worker.ts): Item value's rankings, simulated off the
// page's thread so typing and dragging stay smooth while they run. One worker, started with the first
// job; each user of it has a lane of its own, whose next job stops the one before.

import { useEffect, useMemo, useRef, useState } from "react";
import type { SearchProgress } from "../engine/analysis.ts";
import { DATA } from "./data.ts";
import type { FromWorker, RankJob, RankResult, ToWorker } from "./ranking-runner.ts";

export type { RankJob, RankResult } from "./ranking-runner.ts";

let worker: Worker | null = null;
/** Each open lane: the job it's waiting on, and what to do with the worker's answers. */
const lanes = new Map<number, { id: () => number; receive: (m: FromWorker) => void }>();
let opened = 0;

function connect(): Worker {
  if (worker) return worker;
  worker = new Worker(new URL("./ranking.worker.ts", import.meta.url), { type: "module" });
  // The game data first: the worker has none of its own.
  worker.postMessage(DATA);
  worker.onmessage = (e: MessageEvent<FromWorker>) => lanes.get(e.data.lane)?.receive(e.data);
  // A worker that fails to load fails every lane's job; the next job starts another.
  worker.onerror = (e) => {
    e.preventDefault();
    worker?.terminate();
    worker = null;
    for (const [lane, l] of lanes) l.receive({ lane, id: l.id(), error: e.message || "The ranking worker failed to start." });
  };
  return worker;
}

export interface RankHandlers<J extends RankJob> {
  progress?: (p: SearchProgress) => void;
  result: (r: RankResult<J>) => void;
  error: (message: string) => void;
}

export interface Lane {
  /** Runs a job in place of the lane's last one; `on` hears how far it is, then its result or error. */
  run<J extends RankJob>(job: J, on: RankHandlers<J>): void;
  /** Stops the lane's job, which then never answers. */
  stop(): void;
  /** Stops it, for good. */
  close(): void;
}

export function openLane(): Lane {
  const lane = ++opened;
  let id = 0;
  let on: RankHandlers<any> | null = null;
  lanes.set(lane, {
    id: () => id,
    receive: (m) => {
      // An answer to a job since stopped or replaced.
      if (m.id !== id || !on) return;
      if ("progress" in m) return on.progress?.(m.progress);
      const done = on;
      on = null;
      if ("result" in m) done.result(m.result);
      else done.error(m.error);
    },
  });
  const send = (job: RankJob | null) => connect().postMessage({ lane, id, job } satisfies ToWorker);
  return {
    run(job, handlers) {
      id++;
      on = handlers;
      send(job);
    },
    stop() {
      if (!on) return;
      id++;
      on = null;
      send(null);
    },
    close() {
      this.stop();
      lanes.delete(lane);
    },
  };
}

/**
 * A job's result from the worker: run at once the first time, then `delay` ms after the job last
 * changed, so a run doesn't start on every keystroke. A change stops the run under way; the last
 * result stays meanwhile, stale, and `progress` tells how far the next one is (searchItemSets' jobs).
 */
export function useRanking<J extends RankJob>(job: J | null, delay: number) {
  const key = useMemo(() => (job ? JSON.stringify(job) : null), [job]);
  const lane = useRef<Lane | null>(null);
  const [res, setRes] = useState<{ key: string; result?: RankResult<J>; error?: string } | null>(null);
  const [progress, setProgress] = useState<SearchProgress | null>(null);
  useEffect(() => {
    lane.current = openLane();
    return () => lane.current?.close();
  }, []);
  useEffect(() => {
    const l = lane.current!;
    l.stop();
    setProgress(null);
    if (!job || key == null) return;
    const t = setTimeout(
      () =>
        l.run(job, {
          progress: setProgress,
          result: (result) => {
            setProgress(null);
            setRes({ key, result });
          },
          error: (error) => {
            setProgress(null);
            setRes({ key, error });
          },
        }),
      res ? delay : 0,
    );
    return () => clearTimeout(t);
  }, [key]);
  return { result: res?.result ?? null, error: res?.error, stale: res?.key !== key, progress };
}
