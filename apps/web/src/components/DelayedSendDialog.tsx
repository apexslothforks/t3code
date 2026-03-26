import { useEffect, useState } from "react";
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

interface DelayedSendDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  hasExistingScheduledSend: boolean;
  defaultDelayMinutes?: number;
  onSchedule: (delayMinutes: number) => Promise<void>;
}

function normalizeDelayedSendMinutesInput(value: string): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) {
    return 5;
  }
  return Math.min(Math.max(parsed, 0), 24 * 60);
}

export function DelayedSendDialog({
  open,
  onOpenChange,
  hasExistingScheduledSend,
  defaultDelayMinutes = 5,
  onSchedule,
}: DelayedSendDialogProps) {
  const [delayedSendMinutesDraft, setDelayedSendMinutesDraft] = useState(
    String(defaultDelayMinutes),
  );
  const [isSchedulingDelayedSend, setIsSchedulingDelayedSend] = useState(false);

  useEffect(() => {
    if (!open) {
      return;
    }
    setDelayedSendMinutesDraft(String(defaultDelayMinutes));
  }, [defaultDelayMinutes, open]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogPopup className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Send Later</DialogTitle>
          <DialogDescription>
            Queue this exact message for the active thread and send it after a one-off delay.
          </DialogDescription>
        </DialogHeader>
        <DialogPanel className="space-y-4">
          <Field>
            <FieldLabel htmlFor="delayed-send-minutes">Delay</FieldLabel>
            <FieldDescription>
              This is only for the current queued send. It does not change automation settings.
            </FieldDescription>
            <Input
              id="delayed-send-minutes"
              type="number"
              min={0}
              max={1440}
              step={1}
              value={delayedSendMinutesDraft}
              onChange={(event) => setDelayedSendMinutesDraft(event.target.value)}
              inputMode="numeric"
            />
          </Field>
          {hasExistingScheduledSend ? (
            <Alert>
              <AlertTitle>Existing delayed send</AlertTitle>
              <AlertDescription>
                Saving again replaces the existing delayed send for this thread.
              </AlertDescription>
            </Alert>
          ) : null}
        </DialogPanel>
        <DialogFooter variant="bare">
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={isSchedulingDelayedSend}
          >
            Cancel
          </Button>
          <Button
            type="button"
            onClick={() => {
              void (async () => {
                setIsSchedulingDelayedSend(true);
                try {
                  await onSchedule(normalizeDelayedSendMinutesInput(delayedSendMinutesDraft));
                } finally {
                  setIsSchedulingDelayedSend(false);
                }
              })();
            }}
            disabled={isSchedulingDelayedSend}
          >
            {isSchedulingDelayedSend ? "Scheduling..." : "Schedule"}
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}
