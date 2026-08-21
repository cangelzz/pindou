import type { ExternalLinkService, WindowService } from "./services";
import { i18n } from "../i18n";

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
          shouldClose = await ask(i18n.t("window.closeConfirm"), { title: i18n.t("window.closeTitle"), kind: "warning" });
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
