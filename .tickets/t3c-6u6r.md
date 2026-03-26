---
id: t3c-6u6r
status: open
deps: []
links: []
created: 2026-03-26T17:11:30Z
type: epic
priority: 0
assignee: apexsloth
tags: [automation, web, ui]
---

# Epic: Automation UI Redesign

Redesign the automation UI surfaces. Currently: automation settings are in a massive ChatView.tsx (4868 lines) with ~20 useState hooks for automation drafts, a dialog for auto-continue settings, a separate dialog for delayed-send, a quick-automation input in the composer toolbar, a progress bar/countdown, and a sidebar toggle. Problems: ChatView is bloated, UI for auto-continue and delayed-send are disconnected, too many draft state variables. Goal: extract automation UI into focused components, unify the auto-continue + delayed-send UX, make the countdown/status display driven by server-pushed state instead of client polling.
