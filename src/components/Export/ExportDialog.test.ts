import { describe, expect, it } from "vitest";
import { buildExportOutcomeMessage } from "./exportOutcome";

const translations: Record<string, string> = {
  "export.success": "Exported:\n{{results}}",
  "export.partialFailure": "Some exports failed:\n{{errors}}",
  "export.none": "Nothing was exported.",
  "export.items.blueprint": "Blueprint",
  "export.items.preview": "Preview",
  "export.errors.blueprint": "Blueprint export failed.",
  "export.errors.preview": "Preview export failed.",
};
const t = (key: string, values?: Record<string, string>) =>
  Object.entries(values ?? {}).reduce((text, [name, value]) => text.replace(`{{${name}}}`, value), translations[key] ?? key);

describe("export outcome UI diagnostics", () => {
  it("uses stable translation keys without exposing output paths", () => {
    const message = buildExportOutcomeMessage(t, ["blueprint"], []);
    expect(message).toBe("Exported:\nBlueprint");
    expect(message).not.toContain("C:\\Users\\alice\\secret.pindou");
  });

  it("uses a localized operation error without exposing thrown diagnostics", () => {
    const diagnostic = new Error('C:\\Users\\alice\\secret.png: {"model":"raw-response"}');
    const message = buildExportOutcomeMessage(t, [], [{ item: "preview", diagnostic }]);
    expect(message).toBe("Some exports failed:\nPreview export failed.");
    expect(message).not.toContain(diagnostic.message);
    expect(message).not.toContain("raw-response");
  });
});
