import { describe, expect, it } from "vitest";
import { canonicalizeProject } from "./gistSync";
const base: any = { version: 3, canvasSize: { width: 1, height: 1 }, canvasData: [[{ colorIndex: 1 }]], layers: [{ id: "l", name: "L", visible: true, opacity: 1, data: [[{ colorIndex: 1 }]] }], gridConfig: { groupSize: 5, visible: true }, projectInfo: { title: "T", author: "A" }, createdAt: "c", updatedAt: "u" };
describe("canonicalizeProject", () => {
  it("ignores layer property insertion order", () => { const layer = { data: base.layers[0].data, opacity: 1, visible: true, name: "L", id: "l" }; expect(canonicalizeProject({ ...base, layers: [layer] })).toBe(canonicalizeProject(base)); });
  it("ignores projectInfo and grid property order", () => { const changed = { ...base, gridConfig: { visible: true, groupSize: 5 }, projectInfo: { author: "A", title: "T" } }; expect(canonicalizeProject(changed)).toBe(canonicalizeProject(base)); });
  it("detects actual cell changes", () => { const changed = structuredClone(base); changed.layers[0].data[0][0].colorIndex = 2; expect(canonicalizeProject(changed)).not.toBe(canonicalizeProject(base)); });
});
