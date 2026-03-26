---
id: t3c-cabm
status: open
deps: [t3c-a1po, t3c-4itk]
links: []
created: 2026-03-26T17:13:34Z
type: task
priority: 2
assignee: apexsloth
parent: t3c-6u6r
tags: [automation, web, ui]
---

# Server-driven automation status display (replace client polling)

Currently the automation countdown is derived client-side with a 1-second nowTick clock (useMemo in ChatView.tsx). The server-side reactor now owns the actual dispatch timing.

Change the automation status display to be driven by server-pushed state:

1. Include automation status in the orchestration snapshot (or as a separate push channel): armed, dispatchAtMs, blockedBy, sentCount, nextMessage
2. Client derives the countdown from server-provided dispatchAtMs minus local Date.now() — no more deriving dispatchAtMs client-side from activities/messages
3. The progress bar + countdown label update reactively from the server-pushed data

This eliminates the complex client-side timer derivation chain (deriveAutomationTimerSnapshot -> getAutoContinueDispatchAtMs -> delay anchors -> etc). The server reactor already computed all of this — just push it.

Acceptance: countdown display works the same visually, but driven by server state. No client-side setInterval for timer derivation. bun typecheck passes.
