// The ranking worker: Item value's simulations, off the page's thread (see ranking-runner.ts for what
// it does, ranking.ts for the page's side). The page sends it the game data first, which it already
// has, rather than the worker's bundle carrying another copy. It waits between slices with a message
// to itself, which, unlike setTimeout, isn't held back 4ms each time.

import type { GameData } from "../engine/gamedata.ts";
import { ranker, type FromWorker, type ToWorker } from "./ranking-runner.ts";

const scope = self as unknown as { postMessage(m: FromWorker): void; onmessage: ((e: MessageEvent<GameData | ToWorker>) => void) | null };
const tick = new MessageChannel();
let next: (() => void) | null = null;
tick.port1.onmessage = () => next?.();
let receive: ((m: ToWorker) => void) | null = null;
scope.onmessage = (e) => {
  if (receive) return receive(e.data as ToWorker);
  receive = ranker(
    e.data as GameData,
    (m) => scope.postMessage(m),
    (fn) => {
      next = fn;
      tick.port2.postMessage(null);
    },
  );
};
