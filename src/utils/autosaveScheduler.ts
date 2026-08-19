import type { PlatformResult } from "../platform/result";

export interface AutosaveScheduler {
  tick(): Promise<void>;
  dispose(): void;
}

export function createAutosaveScheduler(
  run: () => Promise<PlatformResult<void>>,
  report: (result: PlatformResult<void>) => void | Promise<void>,
): AutosaveScheduler {
  let active = true;
  let inFlight = false;
  let generation = 0;
  return {
    async tick() {
      if (!active || inFlight) return;
      inFlight = true;
      const current = ++generation;
      try {
        const result = await run();
        if (active && current === generation) await report(result);
      } finally {
        if (current === generation) inFlight = false;
      }
    },
    dispose() {
      active = false;
      generation++;
      inFlight = false;
    },
  };
}
