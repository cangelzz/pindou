import { describe, expect, it, vi } from "vitest";
import { confirmCloudDelete } from "./deleteCloudCoordinator";
describe("confirmCloudDelete", () => {
  it("cancel has no invalidation side effect", async () => { const invalidate = vi.fn(); expect(await confirmCloudDelete(async () => false, invalidate)).toBe(false); expect(invalidate).not.toHaveBeenCalled(); });
  it("confirmation invalidates pending cloud operations", async () => { const invalidate = vi.fn(); expect(await confirmCloudDelete(async () => true, invalidate)).toBe(true); expect(invalidate).toHaveBeenCalledOnce(); });
});
