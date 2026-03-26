import { describe, expect, it } from "vitest";

import { resolveEffectiveAutoContinueDelayResetAt } from "./autoContinueRunner";

describe("resolveEffectiveAutoContinueDelayResetAt", () => {
  it("prefers the newer local reset when automation was just armed", () => {
    const effectiveResetAt = resolveEffectiveAutoContinueDelayResetAt({
      activityDelayResetAt: "2026-03-26T10:00:00.000Z",
      localDelayResetAtMs: Date.parse("2026-03-26T10:05:00.000Z"),
    });

    expect(effectiveResetAt).toBe("2026-03-26T10:05:00.000Z");
  });

  it("keeps the newer activity reset when it is more recent than the local one", () => {
    const effectiveResetAt = resolveEffectiveAutoContinueDelayResetAt({
      activityDelayResetAt: "2026-03-26T10:06:00.000Z",
      localDelayResetAtMs: Date.parse("2026-03-26T10:05:00.000Z"),
    });

    expect(effectiveResetAt).toBe("2026-03-26T10:06:00.000Z");
  });
});
