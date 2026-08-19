import { afterEach, describe, expect, it, vi } from "vitest";
import { createBrowserCapabilities, createMobileCapabilities } from "./capabilities";
import {
  getPlatformServices,
  resetPlatformServicesForTest,
  setPlatformServices,
} from "./serviceRegistry";
import { createLegacyPlatformServices } from "./services";
import type {
  ExternalLinkService,
  GitHubService,
  ImageService,
  ProjectFileService,
  RecoveryService,
  StorageService,
} from "./services";
import type { PlatformAdapter } from "../adapters";

type Assert<T extends true> = T;
type HasNoAdapter<T> = "adapter" extends keyof T ? false : true;
type ServiceBoundaryAssertions = [
  Assert<HasNoAdapter<ProjectFileService>>,
  Assert<HasNoAdapter<ImageService>>,
  Assert<HasNoAdapter<RecoveryService>>,
  Assert<"listProjects" | "uploadProject" | "downloadProject" | "deleteProject" extends keyof GitHubService ? true : false>,
];
const serviceBoundaryAssertions: ServiceBoundaryAssertions = [true, true, true, true];

describe("platform capabilities", () => {
  afterEach(() => resetPlatformServicesForTest());

  it("keeps domain services structurally isolated", () => {
    expect(serviceBoundaryAssertions).toEqual([true, true, true, true]);
  });

  it("enables gist sync but disables AI in Chrome", () => {
    const capabilities = createBrowserCapabilities("chrome", true);

    expect(capabilities).toEqual({
      runtime: "browser-extension",
      browserBrand: "chrome",
      projectFileHandles: true,
      downloadFallback: true,
      githubDeviceFlow: true,
      gistSync: true,
      ai: false,
      browserImageTasks: true,
      basicVoiceControl: true,
      environmentLabel: "Browser Extension (Chrome)",
    });
  });

  it("describes each mobile runtime without browser-only capabilities", () => {
    expect(createMobileCapabilities("android")).toMatchObject({
      runtime: "android",
      downloadFallback: false,
      browserImageTasks: false,
      basicVoiceControl: true,
    });
    expect(createMobileCapabilities("ios").runtime).toBe("ios");
  });

  it("throws when platform services are not initialized", () => {
    expect(() => getPlatformServices()).toThrow(/not initialized/i);
  });

  it("accepts replaceable available services", async () => {
    const storage: StorageService = {
      availability: "available",
      get: async <T>() => ({ ok: true, value: "stored" as T }),
      set: async () => ({ ok: true, value: undefined }),
      remove: async () => ({ ok: true, value: undefined }),
    };
    const links: ExternalLinkService = {
      availability: "available",
      open: async () => ({ ok: true, value: undefined }),
    };

    expect(await storage.get<string>("key")).toEqual({ ok: true, value: "stored" });
    expect(await links.open("https://example.com")).toEqual({ ok: true, value: undefined });
  });

  it("delegates each adapter-backed domain without losing this", async () => {
    const adapter = {
      marker: "bound",
      saveProject: vi.fn(function (this: { marker: string }, path: string) {
        return Promise.resolve(`${this.marker}:${path}`);
      }),
      previewImage: vi.fn(function (this: { marker: string }, path: string) {
        return Promise.resolve({ marker: this.marker, path });
      }),
      listSnapshots: vi.fn(function (this: { marker: string }) {
        return Promise.resolve([{ path: this.marker }]);
      }),
    } as unknown as PlatformAdapter;
    const services = createLegacyPlatformServices(adapter, createMobileCapabilities("ios"));

    expect(await services.projectFiles.saveProject({} as never, {
      displayName: "project.pindou",
      writable: true,
    })).toEqual({ ok: true, value: { displayName: "project.pindou", writable: true } });
    expect(await services.images.previewImage("image.png")).toEqual({ marker: "bound", path: "image.png" });
    expect(await services.recovery.listSnapshots()).toEqual({ ok: true, value: [{ path: "bound" }] });
    expect(adapter.saveProject).toHaveBeenCalledOnce();
    expect(adapter.saveProject).toHaveBeenCalledWith("project.pindou", {});
    expect(adapter.previewImage).toHaveBeenCalledOnce();
    expect(adapter.previewImage).toHaveBeenCalledWith("image.png");
    expect(adapter.listSnapshots).toHaveBeenCalledOnce();
  });

  it("exports legacy projects with writeProjectFile without switching save context", async () => {
    const adapter = {
      showSaveDialog: vi.fn(async () => "export.pindou"),
      writeProjectFile: vi.fn(async () => {}),
      saveProject: vi.fn(async () => {}),
    } as unknown as PlatformAdapter;
    const services = createLegacyPlatformServices(adapter, createMobileCapabilities("ios"));
    expect(await services.projectFiles.exportProject({} as never, "suggested.pindou")).toEqual({ ok: true, value: undefined });
    expect(adapter.writeProjectFile).toHaveBeenCalledWith("export.pindou", {});
    expect(adapter.saveProject).not.toHaveBeenCalled();
  });

  it("registers distinct transitional services as unsupported", async () => {
    const adapter = {} as PlatformAdapter;
    const services = createLegacyPlatformServices(adapter, createMobileCapabilities("ios"));
    setPlatformServices(services);

    expect(getPlatformServices()).toBe(services);
    expect(services.projectFiles).not.toBe(services.images);
    expect("adapter" in services.projectFiles).toBe(false);
    expect("previewImage" in services.projectFiles).toBe(false);
    expect("saveProject" in services.images).toBe(false);
    expect("saveSnapshot" in services.images).toBe(false);
    expect("exportImage" in services.recovery).toBe(false);
    expect(await services.github.getSession()).toMatchObject({ ok: false, code: "unsupported" });
    expect(await services.github.login()).toMatchObject({ ok: false, code: "unsupported" });
    expect(await services.github.logout()).toMatchObject({ ok: false, code: "unsupported" });
    expect(await services.github.listProjects()).toMatchObject({ ok: false, code: "unsupported" });
    expect(await services.github.uploadProject("test", {} as any)).toMatchObject({ ok: false, code: "unsupported" });
    expect(await services.github.downloadProject("gist-id")).toMatchObject({ ok: false, code: "unsupported" });
    expect(await services.github.deleteProject("gist-id")).toMatchObject({ ok: false, code: "unsupported" });
    expect(await services.storage.get<string>("key")).toMatchObject({ ok: false, code: "unsupported" });
    expect(await services.storage.set("key", "value")).toMatchObject({ ok: false, code: "unsupported" });
    expect(await services.storage.remove("key")).toMatchObject({ ok: false, code: "unsupported" });
    expect(await services.externalLinks.open("https://example.com")).toMatchObject({
      ok: false,
      code: "unsupported",
    });

    resetPlatformServicesForTest();
    expect(() => getPlatformServices()).toThrow(/not initialized/i);
  });
});
