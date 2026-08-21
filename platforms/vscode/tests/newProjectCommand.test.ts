import { test, expect } from "@playwright/test";
import { dispatchNewProjectCommand, type NewProjectCommandPanel } from "../src/newProjectCommand";

function harness(result: boolean | Error, active = true, language = "zh-cn") {
  const panel: NewProjectCommandPanel = {
    webview: {
      postMessage: async () => {
        if (result instanceof Error) throw result;
        return result;
      },
    },
  };
  const calls = { created: 0, errors: [] as string[], cleared: 0 };
  return {
    panel,
    calls,
    deps: {
      getActivePanel: () => active ? panel : undefined,
      clearActivePanel: (candidate: NewProjectCommandPanel) => {
        if (candidate === panel) calls.cleared++;
      },
      createUntitled: async () => { calls.created++; },
      showSendError: (message: string) => { calls.errors.push(message); },
      language,
    },
  };
}

test("successful delivery uses the active editor guard", async () => {
  const h = harness(true);
  await dispatchNewProjectCommand(h.deps);
  expect(h.calls).toEqual({ created: 0, errors: [], cleared: 0 });
});

test("false delivery clears that panel and reports error without fallback creation", async () => {
  const h = harness(false);
  await dispatchNewProjectCommand(h.deps);
  expect(h.calls.created).toBe(0);
  expect(h.calls.cleared).toBe(1);
  expect(h.calls.errors).toEqual(["无法向当前 PindouVerse 编辑器发送新建请求，请重试"]);
});

test("uses an English host error in an English VS Code locale", async () => {
  const h = harness(false, true, "en");
  await dispatchNewProjectCommand(h.deps);
  expect(h.calls.errors).toEqual(["Could not send the new-project request to the current PindouVerse editor. Please try again."]);
});

test("rejected delivery reports error without fallback creation", async () => {
  const h = harness(new Error("disposed"));
  await dispatchNewProjectCommand(h.deps);
  expect(h.calls.created).toBe(0);
  expect(h.calls.cleared).toBe(1);
  expect(h.calls.errors).toHaveLength(1);
});

test("no active editor creates an untitled project", async () => {
  const h = harness(true, false);
  await dispatchNewProjectCommand(h.deps);
  expect(h.calls).toEqual({ created: 1, errors: [], cleared: 0 });
});
