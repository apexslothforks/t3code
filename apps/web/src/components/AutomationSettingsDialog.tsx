import type { ThreadAutoContinueSettings, ThreadId } from "@t3tools/contracts";
import { normalizeAutoContinueSettings } from "@t3tools/shared/autoContinue";
import { useCallback, useEffect, useState } from "react";

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

interface AutomationSettingsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  threadId: ThreadId;
  currentSettings: ThreadAutoContinueSettings | null | undefined;
  onSave: (settings: ThreadAutoContinueSettings) => Promise<void>;
}

export function AutomationSettingsDialog({
  open,
  onOpenChange,
  threadId,
  currentSettings,
  onSave,
}: AutomationSettingsDialogProps) {
  const [automationEnabledDraft, setAutomationEnabledDraft] = useState(false);
  const [automationMessagesTextDraft, setAutomationMessagesTextDraft] = useState("");
  const [automationStopWithHeuristicDraft, setAutomationStopWithHeuristicDraft] = useState(false);
  const [automationDelayMinutesDraft, setAutomationDelayMinutesDraft] = useState("1");
  const [automationCooldownMinutesDraft, setAutomationCooldownMinutesDraft] = useState("5");
  const [automationSaveError, setAutomationSaveError] = useState<string | null>(null);
  const [isSavingAutomation, setIsSavingAutomation] = useState(false);

  useEffect(() => {
    if (!open) {
      return;
    }
    const nextSettings = normalizeAutoContinueSettings(currentSettings);
    setAutomationEnabledDraft(nextSettings.enabled);
    setAutomationMessagesTextDraft(nextSettings.messages.join("\n"));
    setAutomationStopWithHeuristicDraft(nextSettings.stopWithHeuristic);
    setAutomationDelayMinutesDraft(String(nextSettings.delayMinutes));
    setAutomationCooldownMinutesDraft(String(nextSettings.cooldownMinutes));
    setAutomationSaveError(null);
  }, [currentSettings, open, threadId]);

  const handleSave = useCallback(async () => {
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

  const enabledId = `automation-enabled-${threadId}`;
  const messagesId = `automation-messages-${threadId}`;
  const stopHeuristicId = `automation-stop-heuristic-${threadId}`;
  const delayId = `automation-delay-${threadId}`;
  const cooldownId = `automation-cooldown-${threadId}`;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogPopup className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Automation</DialogTitle>
          <DialogDescription>
            Configure the follow-up message, delay, cooldown, and heuristic stop behavior.
          </DialogDescription>
        </DialogHeader>
        <DialogPanel className="space-y-4">
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
        </DialogPanel>
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={isSavingAutomation}
          >
            Cancel
          </Button>
          <Button type="button" onClick={() => void handleSave()} disabled={isSavingAutomation}>
            {isSavingAutomation ? "Saving..." : "Save"}
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}
