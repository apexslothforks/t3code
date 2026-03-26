---
id: t3c-4itk
status: closed
deps: [t3c-4t0a]
links: []
created: 2026-03-26T17:13:11Z
type: task
priority: 2
assignee: apexsloth
parent: t3c-6u6r
tags: [automation, web, ui]
---

# Extract AutomationToolbar component from ChatView composer

Extract the automation toolbar section from the ChatView composer area (currently lines ~4309-4402 in ChatView.tsx) into its own component: apps/web/src/components/AutomationToolbar.tsx

This section contains:

- Quick automation input + apply button
- 'Auto' settings button (opens dialog)
- 'Later' button (opens delayed-send dialog)
- Countdown progress bar + 'Auto N' label

Props:

- threadId: ThreadId
- isServerThread: boolean
- isConnecting: boolean
- automationStatus: AutoContinueStatusSnapshot | null
- automationEnabled: boolean
- onOpenAutomationSettings: () => void
- onOpenDelayedSend: () => void
- onApplyQuickAutomation: (task: string) => Promise<void>

The quick automation input state (quickAutomationTask) moves into this component.

Acceptance: ChatView composer area is cleaner, automation toolbar is reusable. bun typecheck passes.
