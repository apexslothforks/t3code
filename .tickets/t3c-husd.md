---
id: t3c-husd
status: closed
deps: []
links: []
created: 2026-03-26T17:10:55Z
type: task
priority: 1
assignee: apexsloth
parent: t3c-eh7q
tags: [automation, contracts]
---

# Add auto-continue trigger command to contracts

Add thread.auto-continue.trigger command to packages/contracts/src/orchestration.ts. This command is dispatched by the server reactor (not the client) when auto-continue fires. Fields: threadId, messageId, text, triggeringAssistantMessageId, triggeringTurnId (optional), messageIndex, createdAt.

This command should produce:

1. A user message (thread.message-sent event)
2. A turn start (thread.turn-started event)
3. An activity record (thread.activity-appended with kind 'auto-continue.sent')

The worktree .worktrees/tb-rwpj/apps/server/src/orchestration/Layers/AutoContinueReactor.ts line 348 shows how this was used. Align the schema with that usage.
