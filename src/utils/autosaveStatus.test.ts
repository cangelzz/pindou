import { describe, expect, it } from "vitest";
import { autosaveErrorKey } from "./autosaveStatus";

describe("autosaveErrorKey", () => {
  it("distinguishes the same error code across projects", () => {
    const a = autosaveErrorKey({ projectGeneration: 1, projectId: "A", contentRevision: 2 }, "network");
    const b = autosaveErrorKey({ projectGeneration: 2, projectId: "B", contentRevision: 0 }, "network");
    expect(a).not.toBe(b);
  });
});
