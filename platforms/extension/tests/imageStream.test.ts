import { describe, expect, it, vi } from "vitest";
import { readResponseBlobWithLimit } from "../imageImportService";

function responseWithReader(chunks: Uint8Array[], reject?: Error) {
  let index = 0;
  const reader = {
    read: vi.fn(async () => {
      if (reject) throw reject;
      return index < chunks.length ? { done: false, value: chunks[index++] } : { done: true, value: undefined };
    }),
    cancel: vi.fn(async () => undefined),
  };
  return { response: { body: { getReader: () => reader } } as unknown as Response, reader };
}

describe("readResponseBlobWithLimit", () => {
  it("cancels a no-length stream as soon as chunks exceed the limit", async () => {
    const f = responseWithReader([new Uint8Array(3), new Uint8Array(3)]);
    await expect(readResponseBlobWithLimit(f.response, 5, "image/png")).resolves.toMatchObject({ ok: false, code: "invalid-data" });
    expect(f.reader.cancel).toHaveBeenCalledOnce();
  });

  it("combines normal chunks into an image blob", async () => {
    const f = responseWithReader([new Uint8Array([1, 2]), new Uint8Array([3])]);
    const result = await readResponseBlobWithLimit(f.response, 5, "image/png");
    expect(result).toMatchObject({ ok: true });
    if (result.ok) { expect(result.value.size).toBe(3); expect(result.value.type).toBe("image/png"); }
  });

  it("maps reader rejection to network", async () => {
    const f = responseWithReader([], new Error("stream reset"));
    await expect(readResponseBlobWithLimit(f.response, 5, "image/png")).resolves.toMatchObject({ ok: false, code: "network" });
  });
});
