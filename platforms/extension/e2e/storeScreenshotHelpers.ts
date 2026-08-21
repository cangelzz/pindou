import { expect, type BrowserContext, type Page } from "@playwright/test";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { normalizeProjectFromDisk } from "../../../src/utils/projectSerialization";
import { callStore } from "./fixtures";

export type StoreLocale = "en" | "zh-CN";
export const STORE_SCENARIOS = [
  { id: "editor", file: "01-editor.png", sample: "dinosaur-rex.pindou" },
  { id: "image-conversion", file: "02-image-conversion.png", sample: "dinosaur-triceratops.pindou" },
  { id: "layers", file: "03-layers.png", sample: "dinosaur-raptor.pindou" },
  { id: "export", file: "04-export.png", sample: "dinosaur-brachiosaurus.pindou" },
  { id: "cloud", file: "05-cloud.png", sample: "dinosaur-rex.pindou" },
] as const;
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
export const outputRoot = path.join(repoRoot, "platforms/extension/store-assets");
export const ephemeralRenderRoot = process.env.PINDOU_STORE_SCREENSHOT_OUTPUT ? null : fs.mkdtempSync(path.join(os.tmpdir(), "pindou-direct-screenshots-"));
export const renderRoot = process.env.PINDOU_STORE_SCREENSHOT_OUTPUT ?? ephemeralRenderRoot!;
export const outputDir = (locale: StoreLocale) => path.join(renderRoot, locale === "en" ? "global/en" : "localized/zh-CN");

export async function installDeterminism(context: BrowserContext, locale: StoreLocale) {
  await context.addInitScript(({ language }) => {
    const fixed = new Date("2026-06-15T12:00:00.000Z").valueOf();
    const NativeDate = Date; class FixedDate extends NativeDate { constructor(...args: any[]) { super(...(args.length ? args : [fixed]) as [any]); } static now() { return fixed; } }
    Object.defineProperty(globalThis, "Date", { value: FixedDate });
    document.addEventListener("DOMContentLoaded", () => { const style = document.createElement("style"); style.textContent = "*,*::before,*::after{animation:none!important;transition:none!important;caret-color:transparent!important}html{cursor:none!important}"; document.head.append(style); });
    const projects = [
      { id: "trex", name: "T. Rex Expedition", updated_at: "2026-06-15T10:00:00Z" },
      { id: "pterosaur", name: "Pterosaur Skies", updated_at: "2026-06-14T09:30:00Z" },
      { id: "ankylosaurus", name: "Ankylosaurus Trail", updated_at: "2026-06-13T08:15:00Z" },
    ];
    globalThis.fetch = async (input) => { const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url; if (url === "https://api.github.com/gists?per_page=100") return new Response(JSON.stringify(projects.map((p) => ({ ...p, description: `PindouVerse: ${p.name}`, files: { [`pindouverse__${p.name}.pindou`]: { filename: `pindouverse__${p.name}.pindou` } } }))), { status: 200 }); throw new Error(`External network blocked in screenshot: ${url}`); };
  }, { language: locale });
  await context.route("**/*", (route) => { const url = route.request().url(); if (url.startsWith("chrome-extension://")) return route.continue(); return route.abort(); });
}

export async function loadSample(page: Page, sample: string) {
  const project = normalizeProjectFromDisk(fs.readFileSync(path.join(repoRoot, "samples", sample), "utf8"));
  const names: Record<string, string> = { "dinosaur-rex.pindou": "T. Rex", "dinosaur-triceratops.pindou": "Triceratops", "dinosaur-raptor.pindou": "Raptor", "dinosaur-brachiosaurus.pindou": "Brachiosaurus" };
  project.projectInfo = { ...(project.projectInfo ?? {}), title: names[sample] ?? sample };
  project.layers = project.layers?.map((layer, index) => ({ ...layer, name: `Dinosaur Layer ${index + 1}` }));
  await callStore(page, "loadProjectDocument", [project, sample, false]);
  await callStore(page, "fitToWindow", [900, 650]);
  await expect.poll(async () => (await page.evaluate(() => (globalThis as any).__pindouExtensionTest.getStore(["projectInfo"]))).projectInfo?.title ?? "").not.toBe("");
}

export async function settle(page: Page) { await page.evaluate(async () => { await document.fonts.ready; await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))); }); await page.mouse.move(1279, 799); }

export async function captureCompositionGeometry(page: Page) {
  return page.evaluate(() => {
    const rect = (element: Element) => { const { x, y, width, height } = element.getBoundingClientRect(); return { x, y, width, height }; };
    const canvas = document.querySelector("[data-canvas-container]")!;
    const panel = document.querySelector("[data-testid='right-panel']")!;
    const state = (globalThis as any).__pindouExtensionTest.getStore(["canvasSize", "cellSize", "offsetX", "offsetY"]);
    return {
      canvas: rect(canvas),
      artwork: { x: canvas.getBoundingClientRect().x + state.offsetX, y: canvas.getBoundingClientRect().y + state.offsetY, width: state.canvasSize.width * state.cellSize, height: state.canvasSize.height * state.cellSize },
      panel: rect(panel),
      transform: { cellSize: state.cellSize, offsetX: state.offsetX, offsetY: state.offsetY },
    };
  });
}

export function writeScreenshotMetadata(file: string, locale: StoreLocale, scenario: (typeof STORE_SCENARIOS)[number], geometry: Awaited<ReturnType<typeof captureCompositionGeometry>>) {
  const bytes = fs.readFileSync(file);
  fs.writeFileSync(file.replace(/\.png$/, ".metadata.json"), `${JSON.stringify({ image: path.basename(file), locale, scenario: scenario.id, sample: scenario.sample, width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20), sha256: crypto.createHash("sha256").update(bytes).digest("hex"), geometry }, null, 2)}\n`);
}

export async function assertEnglishFunctionalUi(page: Page) {
  const text = await page.locator("body").evaluate((body) => {
    const audited = body.cloneNode(true) as HTMLElement;
    for (const node of audited.querySelectorAll('[data-testid="brand"], [data-color-index], [data-user-content]')) node.remove();
    return audited.innerText;
  });
  expect(text).not.toMatch(/[㐀-鿿]/);
}
