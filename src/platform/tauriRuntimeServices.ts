import type { ExternalLinkService, WindowService } from "./services";

export const tauriExternalLinks: ExternalLinkService = {
  availability: "available",
  async open(url) {
    try {
      const { open } = await import("@tauri-apps/plugin-shell");
      await open(url);
      return { ok: true, value: undefined };
    } catch (cause) { return { ok: false, code: "unknown", cause }; }
  },
};

export const tauriWindowService: WindowService = {
  setTitle(title) {
    void import("@tauri-apps/api/window")
      .then(({ getCurrentWindow }) => getCurrentWindow().setTitle(title))
      .catch(() => {});
  },
  installDirtyCloseGuard(isDirty) {
    let active = true;
    let showing = false;
    let unlisten: (() => void) | undefined;
    void import("@tauri-apps/api/window").then(async ({ getCurrentWindow }) => {
      if (!active) return;
      const win = getCurrentWindow();
      const dispose = await win.onCloseRequested(async (event) => {
        if (!active || !isDirty()) return;
        event.preventDefault();
        if (showing) return;
        showing = true;
        let shouldClose = false;
        try {
          const { ask } = await import("@tauri-apps/plugin-dialog");
          shouldClose = await ask("有未保存的修改，确定要退出吗？", { title: "退出确认", kind: "warning" });
        } catch {
          shouldClose = true;
        } finally {
          showing = false;
        }
        if (shouldClose) {
          unlisten?.();
          unlisten = undefined;
          await win.close().catch(() => {});
        }
      });
      if (!active) dispose();
      else unlisten = dispose;
    }).catch(() => {});
    return () => { active = false; unlisten?.(); unlisten = undefined; };
  },
};
