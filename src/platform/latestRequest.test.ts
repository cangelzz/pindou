import { describe, expect, it } from "vitest";
import { LatestRequest } from "./latestRequest";
describe("LatestRequest", () => {
  it("only applies the newest request", () => { const r = new LatestRequest(); const a = r.begin(); const b = r.begin(); expect(r.current(a)).toBe(false); expect(r.current(b)).toBe(true); });
  it("invalidation makes pending requests stale", () => { const r = new LatestRequest(); const a = r.begin(); r.invalidate(); expect(r.current(a)).toBe(false); });
  it("an old failure cannot own loading or error state", () => { const r = new LatestRequest(); const a = r.begin(); const b = r.begin(); expect(r.current(a)).toBe(false); expect(r.current(b)).toBe(true); });
});
