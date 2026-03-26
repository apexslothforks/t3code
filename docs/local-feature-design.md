# Local Feature Design

## Scope

This document summarizes the local T3 Code features built on top of `upstream/main` in this branch.

Out of scope:

- external account switching
- quota/account tooling handled by the separate wrapper
- `codex-swap`

The focus here is the T3 app behavior that remains in this repo.

## Goals

- Reduce manual babysitting for long-running work.
- Keep automation predictable under load.
- Keep delayed follow-ups reliable across restarts and transient failures.
- Make pending automated work visible in the UI.
- Preserve Codex launch overrides in normal chat flows.

## Feature Set

### Per-Thread Auto-Continue

Auto-continue is configured per thread instead of being treated as a broad session-wide toggle.

The model supports:

- enabled or disabled per thread
- follow-up delay
- cooldown reuse
- heuristic stopping behavior

The server owns actual dispatch. It watches settled assistant replies, blocked states, and session readiness, then decides when the next turn should be sent.

Important behavior:

- survives server restart by rebuilding pending candidates on startup
- cancels stale wake timers when settings or thread state change
- pauses on approvals and user-input requests instead of silently dropping automation
- retries transient dispatch failures instead of killing the candidate immediately

Main files:

- `packages/contracts/src/orchestration.ts`
- `packages/shared/src/autoContinue.ts`
- `apps/server/src/orchestration/decider.ts`
- `apps/server/src/orchestration/Services/AutoContinueReactor.ts`
- `apps/server/src/orchestration/projector.ts`
- `apps/web/src/session-logic.ts`
- `apps/web/src/store.ts`

### Quick Automation UI

The composer exposes a small inline task field for quickly arming automation without a separate popup flow.

Submitting the quick preset:

- enables automation for the current thread
- sets a one-minute follow-up delay
- enables heuristic stop behavior
- sends a canned prompt prefix for autonomous follow-up work
- renames the current thread to the entered task when the thread exists server-side
- keeps the last task visible as placeholder text for later reference

There is also a lightweight sidebar toggle for enabling or disabling automation per thread.

Main files:

- `apps/web/src/automationPreset.ts`
- `apps/web/src/components/ChatView.tsx`
- `apps/web/src/components/Sidebar.tsx`
- `apps/web/src/composerDraftStore.ts`

### Delayed Send

The web app supports scheduling a message for later dispatch.

The delayed-send system is renderer-owned and backed by a small persistent store plus a global runner. It can:

- schedule against an existing thread
- schedule before a server thread exists yet
- create the thread at fire time if needed
- preserve model, runtime mode, and interaction mode
- wait for a thread to become idle and unblocked
- continue to dispatch even when the session is in an idle error state
- retry transient failures instead of deleting the queued message immediately

The UI surfaces delayed-send state through timer/status components instead of hiding it in background state.

Main files:

- `apps/web/src/delayedSendStore.ts`
- `apps/web/src/delayedSendRunner.tsx`
- `apps/web/src/components/ComposerStatusPanel.tsx`
- `apps/web/src/routes/__root.tsx`
- `apps/web/src/chatSend.ts`
- `apps/web/src/components/ChatView.tsx`

### Restart-Time Stale Request Cleanup

Provider restarts previously left behind stale pending approvals and structured input requests. Those could remain visible even though the live provider session no longer knew about them.

The current behavior marks stale pending interactions as failed when the provider session exits, and shared interaction derivation treats them as terminal cleanup. This prevents old pending requests from hanging forever after restart.

Main files:

- `apps/server/src/orchestration/Services/ProviderRuntimeIngestion.ts`
- `packages/shared/src/threadInteractions.ts`
- `apps/web/src/session-logic.ts`

### Custom Codex Provider Path Passthrough

The web app can carry configured Codex binary and home overrides into normal provider launches.

This matters because the custom path settings are only useful if ordinary chat sends, delayed sends, and follow-up turns actually pass them to the server. The current branch restores that passthrough.

Main files:

- `apps/web/src/appSettings.ts`
- `apps/web/src/routes/_chat.settings.tsx`
- `apps/web/src/codexProviderOptions.ts`
- `apps/web/src/components/ChatView.tsx`
- `apps/web/src/delayedSendRunner.tsx`
- `packages/contracts/src/provider.ts`
- `packages/contracts/src/orchestration.ts`
- `apps/server/src/orchestration/Services/ProviderCommandReactor.ts`
- `apps/server/src/codexAppServerManager.ts`

### Session Phase Fixes

The web app now derives session phase from orchestration status plus `activeTurnId`, not only from the raw provider session status.

This reduces cases where the UI says a thread is still working after the server already considers it idle, and it makes send controls, automation timers, and delayed-send readiness more consistent.

Main files:

- `apps/web/src/session-logic.ts`
- `apps/web/src/types.ts`
- `apps/web/src/components/ChatView.tsx`

## State Model

The implementation is split across three layers:

- server orchestration state
  - thread settings
  - auto-continue candidates
  - provider session lifecycle
- client persisted state
  - delayed-send queue
  - draft and quick-automation UI state
- derived client view state
  - timer bars
  - thread phase
  - pending interaction state

The key design choice is that dispatch decisions stay server-owned for auto-continue, while delayed send remains a client-owned scheduler.

## Failure Handling

The recent work biases toward predictability:

- restart should not silently drop auto-continue timers
- stale scheduled wakes should not accumulate in the background
- blocked approvals and user-input states should pause automation instead of destroying it
- transient send failures should not immediately destroy delayed work
- stale pending requests after restart should be cleared instead of hanging forever

## Known Limits

- Normal restart still depends on provider-side `thread/resume` for true Codex memory continuity.
- Delayed send and auto-continue use different ownership models, so their lifecycle behavior is not identical.
- The sidebar automation toggle still relies on the normal server-event path rather than a strong optimistic local update.
- A large amount of contact surface with upstream still lives in `ChatView.tsx` and surrounding session UI.

## Commit Scope

This document primarily covers the local work in:

- `3a08c8fe` `automation: add per-chat auto-continue and delayed send`
- `3283a1ad` `automation: tighten quick actions and delayed send`
- `60f0caf8` `web: tighten automation shortcuts and session state`
- `5cd41323` `runtime: clear stale approvals after restart`

The wrapper/account work is intentionally excluded because it belongs to the separate tool boundary, not the main T3 app feature surface.
