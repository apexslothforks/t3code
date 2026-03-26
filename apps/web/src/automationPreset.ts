import type { ThreadAutoContinueSettings } from "@t3tools/contracts";

export const QUICK_AUTOMATION_FALLBACK_COOLDOWN_MINUTES = 5;
export const QUICK_AUTOMATION_DELAY_MINUTES = 1;
export const QUICK_AUTOMATION_PREFIX = "work on ";
export const QUICK_AUTOMATION_SUFFIX =
  ", use your best jugment to push this forward, check children to work on, and rebase often";

export function buildQuickAutomationMessage(task: string): string {
  return `${QUICK_AUTOMATION_PREFIX}${task.trim()}${QUICK_AUTOMATION_SUFFIX}`;
}

export function extractQuickAutomationTask(message: string | null | undefined): string | null {
  if (typeof message !== "string") {
    return null;
  }
  const trimmed = message.trim();
  if (!trimmed.startsWith(QUICK_AUTOMATION_PREFIX) || !trimmed.endsWith(QUICK_AUTOMATION_SUFFIX)) {
    return null;
  }
  const task = trimmed.slice(
    QUICK_AUTOMATION_PREFIX.length,
    trimmed.length - QUICK_AUTOMATION_SUFFIX.length,
  );
  return task.trim().length > 0 ? task.trim() : null;
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
