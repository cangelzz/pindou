import { expect, test } from "@playwright/test";
import { withPersistentContext } from "./fixtures";

test("profile is removed when persistent context launch rejects", async () => {
  let removed = false;
  await expect(withPersistentContext(
    async () => { throw new Error("launch failed"); },
    async () => { throw new Error("must not run"); },
    { makeProfile: () => "profile", remove: async () => { removed = true; } },
  )).rejects.toThrow("launch failed");
  expect(removed).toBe(true);
});
