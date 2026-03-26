import { CheckIcon, Clock3Icon, ZapIcon } from "lucide-react";
import { useCallback, useMemo, useState } from "react";

import { type AutoContinueStatusSnapshot } from "../automationStatus";
import { cn } from "~/lib/utils";
import { type AutomationPanelTab } from "./AutomationPanel";
import { Button } from "./ui/button";
import { Input } from "./ui/input";

interface AutomationToolbarProps {
  isLocalDraftThread: boolean;
  isConnecting: boolean;
  automationStatus: AutoContinueStatusSnapshot | null;
  automationEnabled: boolean;
  quickAutomationPlaceholder: string;
  delayedSendDisabledReason: string | null;
  onApplyQuickAutomation: (task: string) => Promise<void>;
  onOpenAutomationPanel: (defaultTab: AutomationPanelTab) => void;
}

function formatCompactCountdown(durationMs: number): string {
  const totalSeconds = Math.max(0, Math.ceil(durationMs / 1_000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

export function AutomationToolbar({
  isLocalDraftThread,
  isConnecting,
  automationStatus,
  automationEnabled,
  quickAutomationPlaceholder,
  delayedSendDisabledReason,
  onApplyQuickAutomation,
  onOpenAutomationPanel,
}: AutomationToolbarProps) {
  const [quickAutomationTask, setQuickAutomationTask] = useState("");

  const automationCountdownLabel = useMemo(() => {
    if (!automationStatus) {
      return null;
    }
    if (automationStatus.blockedBy === "approval") {
      return "approval";
    }
    if (automationStatus.blockedBy === "user-input") {
      return "input";
    }
    return formatCompactCountdown(automationStatus.remainingMs);
  }, [automationStatus]);

  const automationControlsDisabled = isLocalDraftThread || isConnecting;
  const quickAutomationTaskTrimmed = quickAutomationTask.trim();

  const handleApplyQuickAutomation = useCallback(async () => {
    if (quickAutomationTaskTrimmed.length === 0) {
      return;
    }
    try {
      await onApplyQuickAutomation(quickAutomationTaskTrimmed);
      setQuickAutomationTask("");
    } catch {
      return;
    }
  }, [onApplyQuickAutomation, quickAutomationTaskTrimmed]);

  return (
    <div className="hidden min-w-0 items-center gap-1.5 md:flex">
      <div className="w-36 lg:w-44">
        <Input
          size="sm"
          value={quickAutomationTask}
          onChange={(event) => setQuickAutomationTask(event.target.value)}
          onKeyDown={(event) => {
            if (event.key !== "Enter") {
              return;
            }
            event.preventDefault();
            void handleApplyQuickAutomation();
          }}
          placeholder={quickAutomationPlaceholder}
          disabled={automationControlsDisabled}
          aria-label="Quick automation task"
        />
      </div>
      <Button
        type="button"
        size="sm"
        variant={automationEnabled ? "default" : "ghost"}
        className="h-8 w-8 rounded-full p-0"
        onClick={() => void handleApplyQuickAutomation()}
        disabled={automationControlsDisabled || quickAutomationTaskTrimmed.length === 0}
        title="Enable automation with this task"
        aria-label="Enable automation with this task"
      >
        {automationEnabled ? <CheckIcon className="size-3.5" /> : <ZapIcon className="size-3.5" />}
      </Button>
      <Button
        type="button"
        size="sm"
        variant="ghost"
        className="h-8 gap-1.5 rounded-full px-2.5 text-muted-foreground/80"
        onClick={() => onOpenAutomationPanel("auto-continue")}
        disabled={automationControlsDisabled}
        title={
          isLocalDraftThread
            ? "Automation settings are available after the thread starts"
            : "Automation settings"
        }
        aria-label="Automation settings"
      >
        <ZapIcon className="size-3.5" />
        <span className="text-xs">Auto</span>
      </Button>
      <Button
        type="button"
        size="sm"
        variant="ghost"
        className="h-8 gap-1.5 rounded-full px-2.5 text-muted-foreground/80"
        onClick={() => onOpenAutomationPanel("schedule-send")}
        disabled={delayedSendDisabledReason !== null}
        title={delayedSendDisabledReason ?? "Schedule this message to send later"}
        aria-label="Send later"
      >
        <Clock3Icon className="size-3.5" />
        <span className="text-xs">Later</span>
      </Button>
      {automationStatus ? (
        <div className="hidden w-28 flex-col gap-1 lg:flex">
          <div className="flex items-center justify-between text-[10px] text-muted-foreground/80">
            <span>{`Auto ${automationStatus.sentCount + 1}`}</span>
            <span>{automationCountdownLabel}</span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-border/70">
            <div
              className={cn(
                "h-full rounded-full transition-[width] duration-700 ease-out",
                automationStatus.blockedBy === null ? "bg-primary/80" : "bg-amber-500/70",
              )}
              style={{
                width: `${Math.max(4, Math.round(automationStatus.progressRatio * 100))}%`,
              }}
            />
          </div>
        </div>
      ) : null}
    </div>
  );
}
