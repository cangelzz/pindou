import { describe, expect, it, vi } from "vitest";
import { saveDocument } from "./saveDocument";

function dependencies(overrides: Record<string, unknown> = {}) {
  return {
    applyEdit: vi.fn(async () => true),
    save: vi.fn(async () => true),
    replace: vi.fn(),
    postMessage: vi.fn(async () => true),
    ...overrides,
  };
}

describe("saveDocument", () => {
  it("acknowledges only after applyEdit and document.save succeed", async () => {
    const deps = dependencies();
    await saveDocument({ requestId: 7, content: "saved" }, deps);
    expect(deps.replace).toHaveBeenCalledWith("saved");
    expect(deps.postMessage).toHaveBeenCalledWith({ type: "saveResult", requestId: 7, success: true });
  });

  it.each([
    ["applyEdit false", { applyEdit: vi.fn(async () => false) }],
    ["document.save false", { save: vi.fn(async () => false) }],
    ["applyEdit throws", { applyEdit: vi.fn(async () => { throw new Error("apply failed"); }) }],
    ["document.save throws", { save: vi.fn(async () => { throw new Error("save failed"); }) }],
  ])("reports %s", async (_name, override) => {
    const deps = dependencies(override);
    await saveDocument({ requestId: 9, content: "saved" }, deps);
    expect(deps.postMessage).toHaveBeenCalledWith(expect.objectContaining({ type: "saveResult", requestId: 9, success: false, error: expect.any(String) }));
  });
});
