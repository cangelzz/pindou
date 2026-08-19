import { describe, expect, it, vi } from "vitest";
import { captureUploadIntent, runAuthorizedUpload, runInitialUpload, type UploadCoordinatorDeps } from "./cloudUploadCoordinator";

const project: any = { version: 3, canvasSize: { width: 1, height: 1 }, canvasData: [[{ colorIndex: 1 }]], createdAt: "c", updatedAt: "u" };
function setup(patch: Partial<UploadCoordinatorDeps> = {}) {
  let state = { projectGeneration: 1, contentRevision: 2, cloudOperationGeneration: 3, cloudGistId: "g", cloudVersion: "v1" };
  const deps: UploadCoordinatorDeps = {
    current: () => state,
    begin: () => ++state.cloudOperationGeneration,
    buildProject: () => project,
    metadata: vi.fn(async () => ({ ok: true as const, value: { updatedAt: "u", version: "v1" } })),
    download: vi.fn(async (_id, version) => ({ ok: true as const, value: { gistId: "g", name: "N", updatedAt: "u", version: version!, project } })),
    upload: vi.fn(async () => ({ ok: true as const, value: { gistId: "g", updatedAt: "u2", version: "v2" } })),
    ...patch,
  };
  return { deps, state, set: (next: Partial<typeof state>) => Object.assign(state, next) };
}

describe("cloudUploadCoordinator", () => {
  it("returns success without compare", async () => { const { deps } = setup(); const i = captureUploadIntent(deps, "N", "g"); expect(await runInitialUpload(deps, i)).toMatchObject({ type: "success" }); expect(deps.download).not.toHaveBeenCalled(); });
  it.each(["network", "authentication"] as const)("returns %s error without compare", async (code) => { const { deps } = setup({ metadata: vi.fn(async () => ({ ok: false as const, code })) }); const r = await runInitialUpload(deps, captureUploadIntent(deps, "N", "g")); expect(r).toMatchObject({ type: "error", error: { code } }); expect(deps.download).not.toHaveBeenCalled(); });
  it("linked different revision compares exact revision", async () => { const { deps } = setup({ metadata: vi.fn(async () => ({ ok: true as const, value: { updatedAt: "same", version: "v2" } })) }); const r = await runInitialUpload(deps, captureUploadIntent(deps, "N", "g")); expect(r).toMatchObject({ type: "compare", linked: true, remote: { version: "v2" } }); expect(deps.download).toHaveBeenCalledWith("g", "v2"); });
  it("unlinked same-name compare does not mutate association", async () => { const { deps, state } = setup(); state.cloudGistId = null as any; state.cloudVersion = null as any; const r = await runInitialUpload(deps, captureUploadIntent(deps, "N", "g")); expect(r).toMatchObject({ type: "compare", linked: false }); expect(state.cloudGistId).toBeNull(); });
  it("authorized same revision uploads once", async () => { const { deps } = setup(); const i = captureUploadIntent(deps, "N", "g"); expect(await runAuthorizedUpload(deps, i, "v1")).toMatchObject({ type: "success" }); expect(deps.upload).toHaveBeenCalledTimes(1); expect(deps.metadata).not.toHaveBeenCalled(); });
  it("authorized changed revision returns exact latest compare", async () => { const upload = vi.fn(async () => ({ ok: false as const, code: "conflict" as const })); const { deps } = setup({ upload, metadata: vi.fn(async () => ({ ok: true as const, value: { updatedAt: "u", version: "v3" } })) }); const r = await runAuthorizedUpload(deps, captureUploadIntent(deps, "N", "g"), "v1"); expect(r).toMatchObject({ type: "compare", remote: { version: "v3" } }); expect(deps.download).toHaveBeenCalledWith("g", "v3"); });
  it("project generation stale makes no request", async () => { const { deps, set } = setup(); const i = captureUploadIntent(deps, "N", "g"); set({ projectGeneration: 2 }); expect(await runInitialUpload(deps, i)).toEqual({ type: "stale" }); expect(deps.metadata).not.toHaveBeenCalled(); });
  it("content revision stale makes no request", async () => { const { deps, set } = setup(); const i = captureUploadIntent(deps, "N", "g"); set({ contentRevision: 3 }); expect(await runInitialUpload(deps, i)).toEqual({ type: "stale" }); expect(deps.metadata).not.toHaveBeenCalled(); });
  it("post-PATCH unverifiable conflict reloads compare", async () => { const { deps } = setup({ upload: vi.fn(async () => ({ ok: false as const, code: "conflict" as const })), metadata: vi.fn(async () => ({ ok: true as const, value: { updatedAt: "u", version: "v4" } })) }); expect(await runAuthorizedUpload(deps, captureUploadIntent(deps, "N", "g"), "v1")).toMatchObject({ type: "compare", remote: { version: "v4" } }); });
  it("upload during edit uses captured snapshot then becomes stale", async () => { let resolve!: (x: any) => void; const upload: any = vi.fn((_n, p) => new Promise(r => { expect(p).toBe(project); resolve = r; })); const { deps, set } = setup({ upload }); const intent = captureUploadIntent(deps, "N"); const pending = runInitialUpload(deps, intent); await vi.waitFor(() => expect(resolve).toBeTypeOf("function")); set({ contentRevision: 4 }); resolve({ ok: true, value: { gistId: "g", updatedAt: "u", version: "v" } }); expect(await pending).toEqual({ type: "stale" }); });
  it("cloud ticket stale makes no request", async () => { const { deps, set } = setup(); const i = captureUploadIntent(deps, "N", "g"); set({ cloudOperationGeneration: 99 }); expect(await runAuthorizedUpload(deps, i, "v1")).toEqual({ type: "stale" }); expect(deps.upload).not.toHaveBeenCalled(); });
});
