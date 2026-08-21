import { describe, expect, it } from "vitest";
import { BlueprintImportError, blueprintImportErrorKey, type BlueprintImportStage } from "./blueprintImportTS";

const EXPECTED: BlueprintImportStage[] = [
  "loading-image",
  "detecting-grid",
  "sampling-colors",
  "matching-colors",
  "finalizing",
];

describe("blueprint import progress contract", () => {
  it("exposes stable language-neutral stage codes", async () => {
    const module = await import("./blueprintImportTS");
    expect(module.BLUEPRINT_IMPORT_STAGES).toEqual(EXPECTED);
    expect(module.BLUEPRINT_IMPORT_STAGES.join(" ")).not.toMatch(/[㐀-鿿]/);
  });

  it("maps structured import failures to localization keys without exposing messages", () => {
    const error = new BlueprintImportError("grid-not-found");
    expect(error.code).toBe("grid-not-found");
    expect(blueprintImportErrorKey(error)).toBe("import.blueprint.errors.grid-not-found");
    expect(blueprintImportErrorKey(new Error("private diagnostic"))).toBe("import.blueprint.errors.unknown");
  });
});
