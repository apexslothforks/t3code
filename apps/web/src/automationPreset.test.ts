import { describe, expect, it } from "vitest";

import {
  buildQuickAutomationMessage,
  buildQuickAutomationPreset,
  extractQuickAutomationTask,
  QUICK_AUTOMATION_DELAY_MINUTES,
  QUICK_AUTOMATION_FALLBACK_COOLDOWN_MINUTES,
} from "./automationPreset";

describe("buildQuickAutomationMessage", () => {
  it("uses the inline preset wording", () => {
    expect(
      buildQuickAutomationMessage("xxx and its children one by one with your own judgment"),
    ).toBe(
      "work on xxx and its children one by one with your own judgment, use your best jugment to push this forward, check children to work on, and rebase often",
    );
  });
});

describe("buildQuickAutomationPreset", () => {
  it("enables automation with the quick preset defaults", () => {
    expect(
      buildQuickAutomationPreset({
        task: "clean up the branch",
        cooldownMinutes: 7,
      }),
    ).toEqual({
      enabled: true,
      messages: [
        "work on clean up the branch, use your best jugment to push this forward, check children to work on, and rebase often",
      ],
      stopWithHeuristic: true,
      delayMinutes: QUICK_AUTOMATION_DELAY_MINUTES,
      cooldownMinutes: 7,
    });
  });

  it("falls back to the default cooldown when the current one is invalid", () => {
    expect(
      buildQuickAutomationPreset({
        task: "stabilize automation",
        cooldownMinutes: 0,
      }).cooldownMinutes,
    ).toBe(QUICK_AUTOMATION_FALLBACK_COOLDOWN_MINUTES);
  });
});

describe("extractQuickAutomationTask", () => {
  it("parses the task back out of the quick preset wording", () => {
    expect(
      extractQuickAutomationTask(
        "work on stabilize automation, use your best jugment to push this forward, check children to work on, and rebase often",
      ),
    ).toBe("stabilize automation");
  });

  it("returns null for unrelated text", () => {
    expect(extractQuickAutomationTask("do something else")).toBeNull();
  });
});
