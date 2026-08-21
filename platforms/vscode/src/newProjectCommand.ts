export interface NewProjectCommandPanel {
  webview: {
    postMessage(message: { type: "requestNewProject" }): Thenable<boolean>;
  };
}

export interface NewProjectCommandDependencies {
  language?: string;
  getActivePanel(): NewProjectCommandPanel | undefined;
  clearActivePanel(panel: NewProjectCommandPanel): void;
  createUntitled(): Promise<void>;
  showSendError(message: string): void;
}

export function hostText(language: string | undefined, key: "sendNewProjectError"): string {
  const zh = language?.toLowerCase().startsWith("zh");
  const resources = {
    sendNewProjectError: zh
      ? "无法向当前 PindouVerse 编辑器发送新建请求，请重试"
      : "Could not send the new-project request to the current PindouVerse editor. Please try again.",
  };
  return resources[key];
}

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
  deps.showSendError(hostText(deps.language, "sendNewProjectError"));
}
