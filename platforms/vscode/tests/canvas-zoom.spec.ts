import { test, expect } from "@playwright/test";
import {
  cleanupHarness,
  loadProject,
  setupPage,
} from "./helpers";

test.describe("Canvas smooth wheel zoom", () => {
  test.afterEach(() => cleanupHarness());

  test.beforeEach(async ({ page }) => {
    await setupPage(page);
    await loadProject(page);
  });

  test("real browser wheel is canceled and uses the latest viewport", async ({ page }) => {
    const center = await page.evaluate(() => {
      const element = document.querySelector<HTMLElement>("[data-canvas-container]");
      if (!element) throw new Error("canvas container not found");
      const store = (window as any).__pindouStore;
      store.setState({ zoom: 1, cellSize: 16, offsetX: 100, offsetY: 80, isDirty: false });
      (window as any).__wheelDefaults = [];
      (window as any).__wheelViews = [];
      window.addEventListener("wheel", (event) => {
        (window as any).__wheelDefaults.push(event.defaultPrevented);
      });
      store.subscribe((state: any) => {
        (window as any).__wheelViews.push({
          zoom: state.zoom,
          cellSize: state.cellSize,
          offsetX: state.offsetX,
          offsetY: state.offsetY,
        });
      });
      const rect = element.getBoundingClientRect();
      return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    });

    await page.mouse.move(center.x, center.y);
    await page.mouse.wheel(0, -100);
    await page.mouse.wheel(0, -100);

    await expect.poll(() => page.evaluate(() => (window as any).__wheelViews.length)).toBe(2);
    const result = await page.evaluate(() => ({
      defaults: (window as any).__wheelDefaults as boolean[],
      views: (window as any).__wheelViews as Array<{
        zoom: number;
        cellSize: number;
        offsetX: number;
        offsetY: number;
      }>,
      isDirty: (window as any).__pindouStore.getState().isDirty as boolean,
    }));

    expect(result.defaults).toEqual([true, true]);
    expect(result.views).toHaveLength(2);
    expect(result.views[0].zoom).toBeCloseTo(1.1, 8);
    expect(result.views[0].zoom).toBeLessThan(1.25);
    expect(result.views[1].zoom).toBeGreaterThan(result.views[0].zoom);
    expect(result.views[1].zoom).toBeCloseTo(1.21, 8);
    expect(result.views[1].cellSize).toBeCloseTo(16 * result.views[1].zoom, 8);
    expect(result.isDirty).toBe(false);
  });

  test("small pixel deltas change zoom immediately and retain fractional cell size", async ({ page }) => {
    const result = await page.evaluate(() => {
      const element = document.querySelector<HTMLElement>("[data-canvas-container]");
      if (!element) throw new Error("canvas container not found");
      const store = (window as any).__pindouStore;
      store.setState({ zoom: 1, cellSize: 16, offsetX: 100, offsetY: 80, isDirty: false });
      const zooms: number[] = [];
      const unsubscribe = store.subscribe((state: any) => zooms.push(state.zoom));
      const rect = element.getBoundingClientRect();
      for (let index = 0; index < 2; index += 1) {
        element.dispatchEvent(new WheelEvent("wheel", {
          bubbles: true,
          cancelable: true,
          clientX: rect.left + rect.width / 2,
          clientY: rect.top + rect.height / 2,
          deltaY: -1,
          deltaMode: WheelEvent.DOM_DELTA_PIXEL,
        }));
      }
      unsubscribe();
      const state = store.getState();
      return { zooms, zoom: state.zoom, cellSize: state.cellSize, isDirty: state.isDirty };
    });

    expect(result.zooms).toHaveLength(2);
    expect(result.zooms[0]).toBeGreaterThan(1);
    expect(result.zooms[1]).toBeGreaterThan(result.zooms[0]);
    expect(result.cellSize).toBeCloseTo(16 * result.zoom, 10);
    expect(Number.isInteger(result.cellSize)).toBe(false);
    expect(result.isDirty).toBe(false);
  });

  for (const modifier of [
    { name: "Ctrl", ctrlKey: true, metaKey: false },
    { name: "Cmd", ctrlKey: false, metaKey: true },
  ]) {
    test(`explicit ${modifier.name}+wheel follows smooth zoom and keeps the pointer anchored`, async ({ page }) => {
      const result = await page.evaluate(({ ctrlKey, metaKey }) => {
        const element = document.querySelector<HTMLElement>("[data-canvas-container]");
        if (!element) throw new Error("canvas container not found");
        const store = (window as any).__pindouStore;
        store.setState({ zoom: 1, cellSize: 16, offsetX: 73, offsetY: 41, isDirty: false });
        const rect = element.getBoundingClientRect();
        const pointer = { x: rect.left + rect.width * 0.7, y: rect.top + rect.height * 0.35 };
        const before = store.getState();
        const event = new WheelEvent("wheel", {
          bubbles: true,
          cancelable: true,
          ctrlKey,
          metaKey,
          clientX: pointer.x,
          clientY: pointer.y,
          deltaY: -100,
          deltaMode: WheelEvent.DOM_DELTA_PIXEL,
        });
        const gridBefore = {
          x: (event.clientX - rect.left - before.offsetX) / before.cellSize,
          y: (event.clientY - rect.top - before.offsetY) / before.cellSize,
        };
        element.dispatchEvent(event);
        const after = store.getState();
        return {
          defaultPrevented: event.defaultPrevented,
          zoom: after.zoom,
          gridBefore,
          gridAfter: {
            x: (event.clientX - rect.left - after.offsetX) / after.cellSize,
            y: (event.clientY - rect.top - after.offsetY) / after.cellSize,
          },
          isDirty: after.isDirty,
        };
      }, modifier);

      expect(result.defaultPrevented).toBe(true);
      expect(result.zoom).toBeCloseTo(1.1, 8);
      expect(result.gridAfter.x).toBeCloseTo(result.gridBefore.x, 8);
      expect(result.gridAfter.y).toBeCloseTo(result.gridBefore.y, 8);
      expect(result.isDirty).toBe(false);
    });
  }

  test("wheel outside the canvas leaves viewport and dirty state unchanged", async ({ page }) => {
    const result = await page.evaluate(() => {
      const store = (window as any).__pindouStore;
      store.setState({ zoom: 1, cellSize: 16, offsetX: 100, offsetY: 80, isDirty: false });
      const before = store.getState();
      const event = new WheelEvent("wheel", {
        bubbles: true,
        cancelable: true,
        clientX: 0,
        clientY: 0,
        deltaY: -100,
        deltaMode: WheelEvent.DOM_DELTA_PIXEL,
      });
      document.body.dispatchEvent(event);
      const after = store.getState();
      return {
        defaultPrevented: event.defaultPrevented,
        before: { zoom: before.zoom, cellSize: before.cellSize, offsetX: before.offsetX, offsetY: before.offsetY, isDirty: before.isDirty },
        after: { zoom: after.zoom, cellSize: after.cellSize, offsetX: after.offsetX, offsetY: after.offsetY, isDirty: after.isDirty },
      };
    });

    expect(result.defaultPrevented).toBe(false);
    expect(result.after).toEqual(result.before);
  });

  for (const boundary of [
    { name: "maximum", zoom: 40, deltaY: -100 },
    { name: "minimum", zoom: 0.5, deltaY: 100 },
  ]) {
    test(`${boundary.name} zoom boundary does not drift offsets`, async ({ page }) => {
      const result = await page.evaluate(({ zoom, deltaY }) => {
        const element = document.querySelector<HTMLElement>("[data-canvas-container]");
        if (!element) throw new Error("canvas container not found");
        const store = (window as any).__pindouStore;
        store.setState({ zoom, cellSize: 16 * zoom, offsetX: 123.25, offsetY: -47.5, isDirty: false });
        const rect = element.getBoundingClientRect();
        const event = new WheelEvent("wheel", {
          bubbles: true,
          cancelable: true,
          clientX: rect.left + rect.width * 0.8,
          clientY: rect.top + rect.height * 0.2,
          deltaY,
          deltaMode: WheelEvent.DOM_DELTA_PIXEL,
        });
        element.dispatchEvent(event);
        const state = store.getState();
        return {
          defaultPrevented: event.defaultPrevented,
          zoom: state.zoom,
          cellSize: state.cellSize,
          offsetX: state.offsetX,
          offsetY: state.offsetY,
          isDirty: state.isDirty,
        };
      }, boundary);

      expect(result.defaultPrevented).toBe(true);
      expect(result.zoom).toBe(boundary.zoom);
      expect(result.cellSize).toBe(16 * boundary.zoom);
      expect(result.offsetX).toBe(123.25);
      expect(result.offsetY).toBe(-47.5);
      expect(result.isDirty).toBe(false);
    });
  }

  test("wheel is actively canceled and publishes one consistent viewport", async ({ page }) => {
    const result = await page.evaluate(() => {
      const element = document.querySelector<HTMLElement>("[data-canvas-container]");
      if (!element) throw new Error("canvas container not found");
      const store = (window as any).__pindouStore;
      store.setState({ zoom: 1, cellSize: 16, offsetX: 100, offsetY: 80, isDirty: false });
      const notifications: Array<{ zoom: number; cellSize: number; offsetX: number; offsetY: number }> = [];
      const unsubscribe = store.subscribe((state: any) => {
        notifications.push({
          zoom: state.zoom,
          cellSize: state.cellSize,
          offsetX: state.offsetX,
          offsetY: state.offsetY,
        });
      });
      const rect = element.getBoundingClientRect();
      const events = [0, 1].map(() => new WheelEvent("wheel", {
        bubbles: true,
        cancelable: true,
        clientX: rect.left + rect.width / 2,
        clientY: rect.top + rect.height / 2,
        deltaY: -100,
        deltaMode: WheelEvent.DOM_DELTA_PIXEL,
      }));

      const accepted = events.map((event) => element.dispatchEvent(event));
      unsubscribe();
      const state = store.getState();
      return {
        accepted,
        defaultPrevented: events.map((event) => event.defaultPrevented),
        notifications,
        view: {
          zoom: state.zoom,
          cellSize: state.cellSize,
          offsetX: state.offsetX,
          offsetY: state.offsetY,
          isDirty: state.isDirty,
        },
      };
    });

    expect(result.accepted).toEqual([false, false]);
    expect(result.defaultPrevented).toEqual([true, true]);
    expect(result.notifications).toHaveLength(2);
    expect(result.notifications[1]).toEqual({
      zoom: result.view.zoom,
      cellSize: result.view.cellSize,
      offsetX: result.view.offsetX,
      offsetY: result.view.offsetY,
    });
    expect(result.notifications[1].zoom).toBeGreaterThan(result.notifications[0].zoom);
    expect(result.view.zoom).toBeCloseTo(1.21, 8);
    expect(result.view.cellSize).toBeCloseTo(16 * result.view.zoom, 8);
    expect(result.view.isDirty).toBe(false);
  });
});
