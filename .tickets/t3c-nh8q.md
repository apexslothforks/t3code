---
id: t3c-nh8q
status: open
deps: [t3c-fzxr, t3c-ose3]
links: []
created: 2026-03-26T17:13:22Z
type: task
priority: 2
assignee: apexsloth
parent: t3c-6u6r
tags: [automation, web, ui]
---

# Unify auto-continue and delayed-send into single Automation panel

Replace the two separate dialogs (AutomationSettingsDialog + DelayedSendDialog) with a single unified Automation panel/dialog. This should cover both use cases:

Use case A - Auto-continue (push agent forward):

- Enable/disable toggle
- Message rotation list
- Delay after completion
- Cooldown between sends
- Heuristic stop

Use case B - Scheduled send (start at a set time/delay):

- Schedule a specific message to send after N minutes
- Cancel a scheduled send
- Show existing scheduled send status

Design approach:

- Single dialog with two sections or tabs: 'Auto-Continue' and 'Schedule Send'
- Or a unified view where auto-continue is the 'repeating' mode and delayed-send is 'one-shot' mode
- The countdown/status display in the toolbar shows whichever is active (or both if both are armed)

This ticket is about the UX unification. The underlying server commands remain separate (thread.auto-continue.set vs thread.delayed-send.schedule).

Acceptance: single coherent automation UI, both use cases accessible, bun typecheck passes.
