import { expect, it, vi } from "vitest";
import { createImageTaskSchedulerLifecycle } from "./imageTaskSchedulerLifecycle";

it("StrictMode setup-cleanup-setup leaves the second scheduler active", () => {
  const schedulers = [
    { enqueue: vi.fn(), dispose: vi.fn() },
    { enqueue: vi.fn(), dispose: vi.fn() },
  ];
  let index = 0;
  let listener: ((task: { id: string; createdAt: number }) => void) | undefined;
  const inbox = { subscribe: vi.fn((fn) => { listener = fn; return vi.fn(); }) };
  const ref = { current: null as any };
  const lifecycle = createImageTaskSchedulerLifecycle(() => schedulers[index++] as never, inbox, ref);
  const cleanupFirst = lifecycle.setup(); cleanupFirst();
  const cleanupSecond = lifecycle.setup();
  listener?.({ id: "B", createdAt: 2 });
  expect(schedulers[0].dispose).toHaveBeenCalledOnce();
  expect(schedulers[1].enqueue).toHaveBeenCalledWith({ id: "B", createdAt: 2 });
  expect(ref.current).toBe(schedulers[1]);
  cleanupSecond(); expect(schedulers[1].dispose).toHaveBeenCalledOnce(); expect(ref.current).toBeNull();
});
