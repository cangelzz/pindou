import { describe, expect, it, vi } from "vitest";
import { createInitialAssetRelease } from "./initialAssetRelease";

describe("initial web asset release notification", () => {
  it.each(["close-first", "cleanup-first"])("notifies owner once when %s", (order) => {
    const notify = vi.fn();
    const release = createInitialAssetRelease("web-1", notify);
    if (order === "close-first") {
      release();
      release(); // React cleanup after close
    } else {
      release(); // React unmount cleanup
      release(); // any later close callback
    }
    expect(notify).toHaveBeenCalledTimes(1);
    expect(notify).toHaveBeenCalledWith("web-1");
  });
});
