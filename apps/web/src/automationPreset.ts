import type { ThreadAutoContinueSettings } from "@t3tools/contracts";

export const QUICK_AUTOMATION_FALLBACK_COOLDOWN_MINUTES = 5;
export const QUICK_AUTOMATION_DELAY_MINUTES = 1;

export function buildQuickAutomationMessage(task: string): string {
  return `work on ${task.trim()}, use your best jugment to push this forward, check children to work on, and rebase often`;
}

export function buildQuickAutomationPreset(input: {
  task: string;
  cooldownMinutes: number;
}): ThreadAutoContinueSettings {
  const roundedCooldownMinutes = Math.round(input.cooldownMinutes);
  return {
    enabled: true,
    messages: [buildQuickAutomationMessage(input.task)],
    stopWithHeuristic: true,
    delayMinutes: QUICK_AUTOMATION_DELAY_MINUTES,
    cooldownMinutes:
      roundedCooldownMinutes > 0
        ? roundedCooldownMinutes
        : QUICK_AUTOMATION_FALLBACK_COOLDOWN_MINUTES,
  };
}
