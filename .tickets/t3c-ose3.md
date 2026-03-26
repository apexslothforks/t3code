---
id: t3c-ose3
status: closed
deps: [t3c-e4c8]
links: []
created: 2026-03-26T17:13:02Z
type: task
priority: 2
assignee: apexsloth
parent: t3c-6u6r
tags: [automation, web, ui]
---

# Extract DelayedSendDialog component from ChatView

Extract the delayed-send dialog (currently lines ~4714-4766 in ChatView.tsx) into its own component: apps/web/src/components/DelayedSendDialog.tsx

This dialog should encapsulate its own draft state (delayedSendMinutesDraft, isSchedulingDelayedSend, isDelayedSendDialogOpen).

After server-owned delayed-send lands, this dialog dispatches a thread.delayed-send.schedule command to the server instead of writing to a local Zustand store.

Props:

- open: boolean
- onOpenChange: (open: boolean) => void
- threadId: ThreadId
- hasExistingScheduledSend: boolean
- onSchedule: (delayMinutes: number) => Promise<void>

Acceptance: ChatView loses the delayed-send dialog code and its useState hooks. bun typecheck passes.
