export interface NewProjectCommandPanel {
  webview: {
    postMessage(message: { type: "requestNewProject" }): Thenable<boolean>;
  };
}

export interface NewProjectCommandDependencies {
  getActivePanel(): NewProjectCommandPanel | undefined;
  clearActivePanel(panel: NewProjectCommandPanel): void;
  createUntitled(): Promise<void>;
  showSendError(message: string): void;
}

const SEND_ERROR = "无法向当前 PindouVerse 编辑器发送新建请求，请重试";

export async function dispatchNewProjectCommand(deps: NewProjectCommandDependencies): Promise<void> {
  const panel = deps.getActivePanel();
  if (!panel) {
    await deps.createUntitled();
    return;
  }

  try {
    const delivered = await panel.webview.postMessage({ type: "requestNewProject" });
    if (delivered) return;
  } catch {
    // Treat rejected delivery exactly like a false result. Never bypass the
    // current editor's dirty guard by creating a document directly.
  }

  deps.clearActivePanel(panel);
  deps.showSendError(SEND_ERROR);
}
