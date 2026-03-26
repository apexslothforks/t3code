---
id: t3c-4t0a
status: closed
deps: [t3c-a1po]
links: []
created: 2026-03-26T17:12:44Z
type: task
priority: 1
assignee: apexsloth
parent: t3c-d0fc
tags: [automation, web]
---

# Create client-side automation status derivation module

Create apps/web/src/automationStatus.ts — pure derivation functions for automation UI status.

Move from autoContinueRunner.tsx before deleting it:

- deriveAutoContinueStatusSnapshot (and its AutoContinueStatusSnapshot type)
- deriveAutomationTimerSnapshot
- resolveEffectiveAutoContinueDelayResetAt
- resolveAutoContinueMessage
- deriveAutoContinueTriggerCount

These are pure functions that derive UI display state from thread data. They do NOT dispatch anything. The client uses them to render countdown timers and status indicators.

Also add a new function for delayed-send status derivation (derive from server-pushed thread state that includes scheduled-send info).

Acceptance: ChatView.tsx imports from this module instead of autoContinueRunner.tsx, all derive functions have the same behavior, bun typecheck passes.
