---
id: t3c-fzxr
status: closed
deps: [t3c-husd]
links: []
created: 2026-03-26T17:12:54Z
type: task
priority: 2
assignee: apexsloth
parent: t3c-6u6r
tags: [automation, web, ui]
---

# Extract AutomationSettingsDialog component from ChatView

Extract the automation settings dialog (currently lines ~4617-4712 in ChatView.tsx) into its own component: apps/web/src/components/AutomationSettingsDialog.tsx

This dialog currently has ~10 useState hooks in ChatView for draft state (automationEnabledDraft, automationMessagesTextDraft, automationStopWithHeuristicDraft, automationDelayMinutesDraft, automationCooldownMinutesDraft, automationSaveError, isSavingAutomation, isAutomationDialogOpen). All of this should be encapsulated in the new component.

Props:

- open: boolean
- onOpenChange: (open: boolean) => void
- threadId: ThreadId
- currentSettings: ThreadAutoContinueSettings | null
- onSave: (settings: ThreadAutoContinueSettings) => Promise<void>

The component owns its own draft state internally. ChatView just opens/closes it.

Acceptance: ChatView loses ~100 lines and ~10 useState hooks. Same visual behavior. bun typecheck passes.
