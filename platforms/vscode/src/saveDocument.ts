export interface SaveDocumentMessage {
  requestId: number;
  content: string;
}

export interface SaveDocumentDependencies {
  applyEdit(): PromiseLike<boolean>;
  save(): PromiseLike<boolean>;
  replace(content: string): void;
  postMessage(message: Record<string, unknown>): PromiseLike<unknown> | unknown;
}

export async function saveDocument(message: SaveDocumentMessage, dependencies: SaveDocumentDependencies): Promise<void> {
  try {
    dependencies.replace(message.content);
    if (!await dependencies.applyEdit()) throw new Error("VS Code rejected the document edit");
    if (!await dependencies.save()) throw new Error("VS Code failed to save the document");
    await dependencies.postMessage({ type: "saveResult", requestId: message.requestId, success: true });
  } catch (error) {
    await dependencies.postMessage({
      type: "saveResult",
      requestId: message.requestId,
      success: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
