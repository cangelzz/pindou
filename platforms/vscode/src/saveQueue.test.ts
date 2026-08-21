import { describe, expect, it } from "vitest";
import { SaveQueue } from "./saveQueue";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

describe("SaveQueue", () => {
  it("serializes overlapping saves and remains saving until the final request finishes", async () => {
    const first = deferred<void>(), second = deferred<void>();
    const states: boolean[] = [], events: string[] = [];
    const queue = new SaveQueue((saving) => states.push(saving));

    const a = queue.run(async () => { events.push("a-start"); await first.promise; events.push("a-end"); });
    const b = queue.run(async () => { events.push("b-start"); await second.promise; events.push("b-end"); });
    await Promise.resolve();
    expect(events).toEqual(["a-start"]);
    expect(states).toEqual([true]);

    first.resolve(); await a;
    await expect.poll(() => events).toEqual(["a-start", "a-end", "b-start"]);
    expect(states).toEqual([true]);

    second.resolve(); await b;
    await expect.poll(() => states).toEqual([true, false]);
  });
});
