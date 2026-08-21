export type ExportItem = "blueprint" | "mirrorBlueprint" | "preview" | "mirrorPreview";

type Translate = (key: string, values?: Record<string, string>) => string;

export interface ExportFailure {
  item: ExportItem;
  diagnostic?: unknown;
}

export function buildExportOutcomeMessage(
  t: Translate,
  completed: ExportItem[],
  failures: ExportFailure[],
): string {
  const results = completed.map((item) => t(`export.items.${item}`)).join("\n");
  const errors = failures.map(({ item }) => t(`export.errors.${item}`)).join("\n");
  const successMessage = results ? t("export.success", { results }) : "";
  const failureMessage = errors ? `\n\n${t("export.partialFailure", { errors })}` : "";
  return `${successMessage}${failureMessage}`.trim() || t("export.none");
}
