import type { ThreadAutoContinueSettings, ThreadId } from "@t3tools/contracts";
import { normalizeAutoContinueSettings } from "@t3tools/shared/autoContinue";
import { Clock3Icon, XIcon, ZapIcon } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { Alert, AlertDescription, AlertTitle } from "./ui/alert";
import { Button } from "./ui/button";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "./ui/dialog";
import { Field, FieldDescription, FieldLabel } from "./ui/field";
import { Input } from "./ui/input";
import { Switch } from "./ui/switch";
import { Textarea } from "./ui/textarea";
import { Toggle, ToggleGroup } from "./ui/toggle-group";

export type AutomationPanelTab = "auto-continue" | "schedule-send";

interface AutomationPanelProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  defaultTab: AutomationPanelTab;
  threadId: ThreadId;
  currentSettings: ThreadAutoContinueSettings | null | undefined;
  onSave: (settings: ThreadAutoContinueSettings) => Promise<void>;
  hasExistingScheduledSend: boolean;
  defaultDelayMinutes?: number;
  draftScheduledMessage: string;
  onDraftScheduledMessageChange: (value: string) => void;
  draftAttachmentCount: number;
  scheduleDisabledReason: string | null;
  onSchedule: (delayMinutes: number) => Promise<void>;
  onCancelScheduledSend: () => Promise<void>;
}

function normalizeDelayedSendMinutesInput(value: string): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) {
    return 5;
  }
  return Math.min(Math.max(parsed, 0), 24 * 60);
}

export function AutomationPanel({
  open,
  onOpenChange,
  defaultTab,
  threadId,
  currentSettings,
  onSave,
  hasExistingScheduledSend,
  defaultDelayMinutes = 5,
  draftScheduledMessage,
  onDraftScheduledMessageChange,
  draftAttachmentCount,
  scheduleDisabledReason,
  onSchedule,
  onCancelScheduledSend,
}: AutomationPanelProps) {
  const [selectedTab, setSelectedTab] = useState<AutomationPanelTab>(defaultTab);
  const [automationEnabledDraft, setAutomationEnabledDraft] = useState(false);
  const [automationMessagesTextDraft, setAutomationMessagesTextDraft] = useState("");
  const [automationStopWithHeuristicDraft, setAutomationStopWithHeuristicDraft] = useState(false);
  const [automationDelayMinutesDraft, setAutomationDelayMinutesDraft] = useState("1");
  const [automationCooldownMinutesDraft, setAutomationCooldownMinutesDraft] = useState("5");
  const [automationSaveError, setAutomationSaveError] = useState<string | null>(null);
  const [isSavingAutomation, setIsSavingAutomation] = useState(false);
  const [delayedSendMinutesDraft, setDelayedSendMinutesDraft] = useState(
    String(defaultDelayMinutes),
  );
  const [isSchedulingDelayedSend, setIsSchedulingDelayedSend] = useState(false);
  const [isCancelingDelayedSend, setIsCancelingDelayedSend] = useState(false);

  useEffect(() => {
    if (!open) {
      return;
    }
    setSelectedTab(defaultTab);
  }, [defaultTab, open]);

  // Keep a ref to the latest `currentSettings` so the init effect can read it
  // without depending on it — we only want to snapshot settings when the dialog
  // opens or the active thread changes, not on every background mutation.
  const currentSettingsRef = useRef(currentSettings);
  currentSettingsRef.current = currentSettings;

  // Only initialise draft fields when the dialog opens or the active thread
  // changes — NOT on every background `currentSettings` mutation.  Reacting to
  // `currentSettings` caused quick-automation presets (and optimistic store
  // updates / snapshot syncs) to silently overwrite the user's in-progress edits.
  useEffect(() => {
    if (!open) {
      return;
    }
    const nextSettings = normalizeAutoContinueSettings(currentSettingsRef.current);
    setAutomationEnabledDraft(nextSettings.enabled);
    setAutomationMessagesTextDraft(nextSettings.messages.join("\n"));
    setAutomationStopWithHeuristicDraft(nextSettings.stopWithHeuristic);
    setAutomationDelayMinutesDraft(String(nextSettings.delayMinutes));
    setAutomationCooldownMinutesDraft(String(nextSettings.cooldownMinutes));
    setAutomationSaveError(null);
  }, [open, threadId]);

  useEffect(() => {
    if (!open) {
      return;
    }
    setDelayedSendMinutesDraft(String(defaultDelayMinutes));
  }, [defaultDelayMinutes, open]);

  const handleSaveAutomation = useCallback(async () => {
    setAutomationSaveError(null);
    setIsSavingAutomation(true);
    try {
      await onSave(
        normalizeAutoContinueSettings({
          enabled: automationEnabledDraft,
          messages: automationMessagesTextDraft.split("\n"),
          stopWithHeuristic: automationStopWithHeuristicDraft,
          delayMinutes: Number.parseInt(automationDelayMinutesDraft, 10),
          cooldownMinutes: Number.parseInt(automationCooldownMinutesDraft, 10),
        }),
      );
      onOpenChange(false);
    } catch (error) {
      setAutomationSaveError(
        error instanceof Error ? error.message : "Failed to save automation settings.",
      );
    } finally {
      setIsSavingAutomation(false);
    }
  }, [
    automationCooldownMinutesDraft,
    automationDelayMinutesDraft,
    automationEnabledDraft,
    automationMessagesTextDraft,
    automationStopWithHeuristicDraft,
    onOpenChange,
    onSave,
  ]);

  const handleScheduleDelayedSend = useCallback(async () => {
    setIsSchedulingDelayedSend(true);
    try {
      await onSchedule(normalizeDelayedSendMinutesInput(delayedSendMinutesDraft));
    } finally {
      setIsSchedulingDelayedSend(false);
    }
  }, [delayedSendMinutesDraft, onSchedule]);

  const handleCancelDelayedSend = useCallback(async () => {
    setIsCancelingDelayedSend(true);
    try {
      await onCancelScheduledSend();
    } finally {
      setIsCancelingDelayedSend(false);
    }
  }, [onCancelScheduledSend]);

  const isBusy = isSavingAutomation || isSchedulingDelayedSend || isCancelingDelayedSend;
  const enabledId = `automation-enabled-${threadId}`;
  const messagesId = `automation-messages-${threadId}`;
  const stopHeuristicId = `automation-stop-heuristic-${threadId}`;
  const delayId = `automation-delay-${threadId}`;
  const cooldownId = `automation-cooldown-${threadId}`;
  const delayedSendMinutesId = `delayed-send-minutes-${threadId}`;
  const delayedSendMessageId = `delayed-send-message-${threadId}`;
  const scheduleDescription = useMemo(() => {
    if (draftAttachmentCount === 0) {
      return "The current draft message will be queued once, without changing automation settings.";
    }
    return `The current draft message and ${draftAttachmentCount} attachment${draftAttachmentCount === 1 ? "" : "s"} will be queued once, without changing automation settings.`;
  }, [draftAttachmentCount]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogPopup className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Automation</DialogTitle>
          <DialogDescription>
            Manage recurring follow-ups and one-off scheduled sends from the same panel.
          </DialogDescription>
        </DialogHeader>
        <DialogPanel className="space-y-5">
          <ToggleGroup
            className="w-full"
            variant="outline"
            value={[selectedTab]}
            onValueChange={(value) => {
              const nextTab = value[0];
              if (nextTab === "auto-continue" || nextTab === "schedule-send") {
                setSelectedTab(nextTab);
              }
            }}
          >
            <Toggle className="flex-1" value="auto-continue">
              <ZapIcon className="size-4" />
              Auto-Continue
            </Toggle>
            <Toggle className="flex-1" value="schedule-send">
              <Clock3Icon className="size-4" />
              Schedule Send
            </Toggle>
          </ToggleGroup>

          {selectedTab === "auto-continue" ? (
            <div className="space-y-4">
              <Field>
                <FieldLabel htmlFor={enabledId}>Enabled</FieldLabel>
                <Switch
                  checked={automationEnabledDraft}
                  onCheckedChange={(checked) => setAutomationEnabledDraft(checked)}
                  aria-label="Enable automation"
                  id={enabledId}
                />
              </Field>
              <Field>
                <FieldLabel htmlFor={messagesId}>Messages</FieldLabel>
                <FieldDescription>
                  One message per line. The runner rotates through them.
                </FieldDescription>
                <Textarea
                  id={messagesId}
                  value={automationMessagesTextDraft}
                  onChange={(event) => setAutomationMessagesTextDraft(event.target.value)}
                  placeholder="work on the next issue"
                />
              </Field>
              <Field>
                <FieldLabel htmlFor={stopHeuristicId}>Stop with heuristic</FieldLabel>
                <FieldDescription>
                  Stop chaining if an automation-triggered turn finishes faster than the cooldown.
                </FieldDescription>
                <Switch
                  checked={automationStopWithHeuristicDraft}
                  onCheckedChange={(checked) => setAutomationStopWithHeuristicDraft(checked)}
                  aria-label="Stop with heuristic"
                  id={stopHeuristicId}
                />
              </Field>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field>
                  <FieldLabel htmlFor={delayId}>Delay minutes</FieldLabel>
                  <Input
                    id={delayId}
                    type="number"
                    min={0}
                    max={1440}
                    step={1}
                    value={automationDelayMinutesDraft}
                    onChange={(event) => setAutomationDelayMinutesDraft(event.target.value)}
                    inputMode="numeric"
                  />
                </Field>
                <Field>
                  <FieldLabel htmlFor={cooldownId}>Cooldown minutes</FieldLabel>
                  <Input
                    id={cooldownId}
                    type="number"
                    min={0}
                    max={1440}
                    step={1}
                    value={automationCooldownMinutesDraft}
                    onChange={(event) => setAutomationCooldownMinutesDraft(event.target.value)}
                    inputMode="numeric"
                  />
                </Field>
              </div>
              {automationSaveError ? (
                <Alert variant="error">
                  <AlertTitle>Unable to save automation</AlertTitle>
                  <AlertDescription>{automationSaveError}</AlertDescription>
                </Alert>
              ) : null}
            </div>
          ) : (
            <div className="space-y-4">
              <Field>
                <FieldLabel htmlFor={delayedSendMessageId}>Message</FieldLabel>
                <FieldDescription>{scheduleDescription}</FieldDescription>
                <Textarea
                  id={delayedSendMessageId}
                  value={draftScheduledMessage}
                  onChange={(event) => onDraftScheduledMessageChange(event.target.value)}
                  placeholder="Write the message to schedule"
                />
              </Field>
              <Field>
                <FieldLabel htmlFor={delayedSendMinutesId}>Delay</FieldLabel>
                <FieldDescription>
                  This is only for the current queued send. It does not change automation settings.
                </FieldDescription>
                <Input
                  id={delayedSendMinutesId}
                  type="number"
                  min={0}
                  max={1440}
                  step={1}
                  value={delayedSendMinutesDraft}
                  onChange={(event) => setDelayedSendMinutesDraft(event.target.value)}
                  inputMode="numeric"
                />
              </Field>
              {scheduleDisabledReason ? (
                <Alert>
                  <AlertTitle>Unable to schedule yet</AlertTitle>
                  <AlertDescription>{scheduleDisabledReason}</AlertDescription>
                </Alert>
              ) : null}
              {hasExistingScheduledSend ? (
                <Alert>
                  <AlertTitle>Existing delayed send</AlertTitle>
                  <AlertDescription>
                    Scheduling again replaces the existing delayed send for this thread.
                  </AlertDescription>
                </Alert>
              ) : null}
            </div>
          )}
        </DialogPanel>
        <DialogFooter variant="bare" className="items-center justify-between gap-2 sm:flex-row">
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={isBusy}
          >
            Cancel
          </Button>
          {selectedTab === "auto-continue" ? (
            <Button
              type="button"
              onClick={() => void handleSaveAutomation()}
              disabled={isSavingAutomation}
            >
              {isSavingAutomation ? "Saving..." : "Save"}
            </Button>
          ) : (
            <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row">
              {hasExistingScheduledSend ? (
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => void handleCancelDelayedSend()}
                  disabled={isBusy}
                >
                  <XIcon className="size-4" />
                  {isCancelingDelayedSend ? "Canceling..." : "Cancel scheduled send"}
                </Button>
              ) : null}
              <Button
                type="button"
                onClick={() => void handleScheduleDelayedSend()}
                disabled={isBusy || scheduleDisabledReason !== null}
              >
                {isSchedulingDelayedSend
                  ? "Scheduling..."
                  : hasExistingScheduledSend
                    ? "Replace schedule"
                    : "Schedule"}
              </Button>
            </div>
          )}
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}
