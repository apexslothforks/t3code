import {
  CommandId,
  DEFAULT_PROVIDER_INTERACTION_MODE,
  EventId,
  MessageId,
  ProjectId,
  ThreadId,
  TurnId,
} from "@t3tools/contracts";
import { Effect, Exit, Layer, ManagedRuntime, Scope } from "effect";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ServerConfig } from "../../config.ts";
import {
  OrchestrationCommandInvariantError,
  OrchestrationListenerCallbackError,
} from "../Errors.ts";
import { OrchestrationCommandReceiptRepositoryLive } from "../../persistence/Layers/OrchestrationCommandReceipts.ts";
import { OrchestrationEventStoreLive } from "../../persistence/Layers/OrchestrationEventStore.ts";
import { SqlitePersistenceMemory } from "../../persistence/Layers/Sqlite.ts";
import { OrchestrationEngineLive } from "./OrchestrationEngine.ts";
import { OrchestrationProjectionPipelineLive } from "./ProjectionPipeline.ts";
import { ScheduledDispatchReactorLive } from "./ScheduledDispatchReactor.ts";
import { OrchestrationEngineService } from "../Services/OrchestrationEngine.ts";
import { ScheduledDispatchReactor } from "../Services/ScheduledDispatchReactor.ts";

const asProjectId = (value: string): ProjectId => ProjectId.makeUnsafe(value);
const asThreadId = (value: string): ThreadId => ThreadId.makeUnsafe(value);
const asMessageId = (value: string): MessageId => MessageId.makeUnsafe(value);
const asTurnId = (value: string): TurnId => TurnId.makeUnsafe(value);

function now() {
  return new Date().toISOString();
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function readThread(
  runtime: ManagedRuntime.ManagedRuntime<OrchestrationEngineService, unknown>,
  threadId: ThreadId,
) {
  const engine = await runtime.runPromise(Effect.service(OrchestrationEngineService));
  const readModel = await runtime.runPromise(engine.getReadModel());
  return readModel.threads.find((thread) => thread.id === threadId) ?? null;
}

async function waitForThread(
  runtime: ManagedRuntime.ManagedRuntime<OrchestrationEngineService, unknown>,
  threadId: ThreadId,
  predicate: (thread: Awaited<ReturnType<typeof readThread>>) => boolean,
  timeoutMs = 2_000,
) {
  const deadline = performance.now() + timeoutMs;
  while (performance.now() < deadline) {
    const thread = await readThread(runtime, threadId);
    if (thread && predicate(thread)) {
      return thread;
    }
    await sleep(10);
  }
  throw new Error("Timed out waiting for thread state");
}

async function createRuntime() {
  const orchestrationLayer = OrchestrationEngineLive.pipe(
    Layer.provide(OrchestrationProjectionPipelineLive),
    Layer.provide(OrchestrationEventStoreLive),
    Layer.provide(OrchestrationCommandReceiptRepositoryLive),
    Layer.provide(SqlitePersistenceMemory),
    Layer.provideMerge(ServerConfig.layerTest(process.cwd(), { prefix: "t3-scheduled-dispatch-" })),
    Layer.provideMerge(NodeServices.layer),
  );
  const runtime = ManagedRuntime.make(orchestrationLayer);
  const engine = await runtime.runPromise(Effect.service(OrchestrationEngineService));
  return { runtime, engine };
}

async function startReactor(engine: OrchestrationEngineService["Service"]) {
  const reactor = await Effect.runPromise(
    Effect.service(ScheduledDispatchReactor).pipe(
      Effect.provide(
        ScheduledDispatchReactorLive.pipe(
          Layer.provide(Layer.succeed(OrchestrationEngineService, engine)),
        ),
      ),
    ),
  );
  const scope = await Effect.runPromise(Scope.make("sequential"));
  await Effect.runPromise(reactor.start.pipe(Scope.provide(scope)));
  await sleep(25);
  return { reactor, scope };
}

async function seedThread(input: {
  readonly runtime: ManagedRuntime.ManagedRuntime<OrchestrationEngineService, unknown>;
  readonly engine: OrchestrationEngineService["Service"];
  readonly projectId: ProjectId;
  readonly threadId: ThreadId;
  readonly createdAt: string;
  readonly autoContinue: {
    readonly enabled: boolean;
    readonly messages: ReadonlyArray<string>;
    readonly stopWithHeuristic: boolean;
    readonly delayMinutes: number;
    readonly cooldownMinutes: number;
  };
}) {
  await input.runtime.runPromise(
    input.engine.dispatch({
      type: "project.create",
      commandId: CommandId.makeUnsafe(`cmd-project-create-${input.projectId}`),
      projectId: input.projectId,
      title: "Project",
      workspaceRoot: `/tmp/${input.projectId}`,
      defaultModelSelection: {
        provider: "codex",
        model: "gpt-5-codex",
      },
      createdAt: input.createdAt,
    }),
  );
  await input.runtime.runPromise(
    input.engine.dispatch({
      type: "thread.create",
      commandId: CommandId.makeUnsafe(`cmd-thread-create-${input.threadId}`),
      threadId: input.threadId,
      projectId: input.projectId,
      title: "Thread",
      modelSelection: {
        provider: "codex",
        model: "gpt-5-codex",
      },
      interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
      runtimeMode: "approval-required",
      branch: null,
      worktreePath: null,
      autoContinue: input.autoContinue,
      createdAt: input.createdAt,
    }),
  );
  await input.runtime.runPromise(
    input.engine.dispatch({
      type: "thread.session.set",
      commandId: CommandId.makeUnsafe(`cmd-thread-session-set-${input.threadId}`),
      threadId: input.threadId,
      session: {
        threadId: input.threadId,
        status: "ready",
        providerName: "codex",
        runtimeMode: "approval-required",
        activeTurnId: null,
        lastError: null,
        updatedAt: input.createdAt,
      },
      createdAt: input.createdAt,
    }),
  );
  await input.runtime.runPromise(
    input.engine.dispatch({
      type: "thread.auto-continue.set",
      commandId: CommandId.makeUnsafe(`cmd-thread-auto-continue-set-${input.threadId}`),
      threadId: input.threadId,
      autoContinue: input.autoContinue,
      createdAt: input.createdAt,
    }),
  );
}

describe("ScheduledDispatchReactor", () => {
  let runtime: ManagedRuntime.ManagedRuntime<OrchestrationEngineService, unknown> | null = null;
  let scope: Scope.Closeable | null = null;

  afterEach(async () => {
    vi.restoreAllMocks();
    if (scope) {
      await Effect.runPromise(Scope.close(scope, Exit.void));
    }
    scope = null;
    if (runtime) {
      await runtime.dispose();
    }
    runtime = null;
  });

  it("arms when an assistant message completes with auto-continue enabled", async () => {
    const system = await createRuntime();
    runtime = system.runtime;
    ({ scope } = await startReactor(system.engine));

    const threadId = asThreadId("thread-arms-enabled");
    await seedThread({
      runtime,
      engine: system.engine,
      projectId: asProjectId("project-arms-enabled"),
      threadId,
      createdAt: now(),
      autoContinue: {
        enabled: true,
        messages: ["go on"],
        stopWithHeuristic: false,
        delayMinutes: 0,
        cooldownMinutes: 0,
      },
    });

    await runtime.runPromise(
      system.engine.dispatch({
        type: "thread.message.assistant.complete",
        commandId: CommandId.makeUnsafe("cmd-assistant-complete-arms-enabled"),
        threadId,
        messageId: asMessageId("assistant-arms-enabled"),
        turnId: asTurnId("turn-arms-enabled"),
        createdAt: now(),
      }),
    );

    const thread = await waitForThread(
      runtime,
      threadId,
      (candidate) =>
        candidate !== null &&
        candidate.messages.some((message) => message.role === "user" && message.text === "go on") &&
        candidate.activities.some((activity) => activity.kind === "auto-continue.sent"),
    );

    expect(thread.activities.some((activity) => activity.kind === "auto-continue.sent")).toBe(true);
  });

  it("does not arm when auto-continue is disabled", async () => {
    const system = await createRuntime();
    runtime = system.runtime;
    ({ scope } = await startReactor(system.engine));

    const threadId = asThreadId("thread-disabled");
    await seedThread({
      runtime,
      engine: system.engine,
      projectId: asProjectId("project-disabled"),
      threadId,
      createdAt: now(),
      autoContinue: {
        enabled: false,
        messages: [],
        stopWithHeuristic: false,
        delayMinutes: 0,
        cooldownMinutes: 0,
      },
    });

    await runtime.runPromise(
      system.engine.dispatch({
        type: "thread.message.assistant.complete",
        commandId: CommandId.makeUnsafe("cmd-assistant-complete-disabled"),
        threadId,
        messageId: asMessageId("assistant-disabled"),
        turnId: asTurnId("turn-disabled"),
        createdAt: now(),
      }),
    );

    await sleep(100);

    const thread = await readThread(runtime, threadId);
    expect(thread?.messages.some((message) => message.role === "user")).toBe(false);
    expect(thread?.activities.some((activity) => activity.kind === "auto-continue.sent")).toBe(
      false,
    );
  });

  it("disarms when a user sends a manual message", async () => {
    const baseMs = Date.parse("2026-03-26T10:00:00.000Z");
    let currentMs = baseMs;
    vi.spyOn(Date, "now").mockImplementation(() => currentMs);

    const system = await createRuntime();
    runtime = system.runtime;
    ({ scope } = await startReactor(system.engine));

    const threadId = asThreadId("thread-manual-disarm");
    await seedThread({
      runtime,
      engine: system.engine,
      projectId: asProjectId("project-manual-disarm"),
      threadId,
      createdAt: new Date(currentMs).toISOString(),
      autoContinue: {
        enabled: true,
        messages: ["go on"],
        stopWithHeuristic: false,
        delayMinutes: 1,
        cooldownMinutes: 0,
      },
    });

    await runtime.runPromise(
      system.engine.dispatch({
        type: "thread.message.assistant.complete",
        commandId: CommandId.makeUnsafe("cmd-assistant-complete-manual-disarm"),
        threadId,
        messageId: asMessageId("assistant-manual-disarm"),
        turnId: asTurnId("turn-manual-disarm"),
        createdAt: new Date(currentMs).toISOString(),
      }),
    );

    currentMs += 10_000;
    await runtime.runPromise(
      system.engine.dispatch({
        type: "thread.turn.start",
        commandId: CommandId.makeUnsafe("cmd-manual-turn-start"),
        threadId,
        message: {
          messageId: asMessageId("manual-message"),
          role: "user",
          text: "manual override",
          attachments: [],
        },
        runtimeMode: "approval-required",
        interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
        createdAt: new Date(currentMs).toISOString(),
      }),
    );

    currentMs = baseMs + 75_000;
    await runtime.runPromise(
      system.engine.dispatch({
        type: "thread.session.set",
        commandId: CommandId.makeUnsafe("cmd-session-pulse-manual-disarm"),
        threadId,
        session: {
          threadId,
          status: "ready",
          providerName: "codex",
          runtimeMode: "approval-required",
          activeTurnId: null,
          lastError: null,
          updatedAt: new Date(currentMs).toISOString(),
        },
        createdAt: new Date(currentMs).toISOString(),
      }),
    );

    await sleep(100);

    const thread = await readThread(runtime, threadId);
    expect(
      thread?.messages.filter((message) => message.role === "user" && message.text === "go on"),
    ).toHaveLength(0);
    expect(thread?.messages.some((message) => message.text === "manual override")).toBe(true);
  });

  it("fires at the computed dispatch time after delay and cooldown", async () => {
    const baseMs = Date.parse("2026-03-26T11:00:00.000Z");
    let currentMs = baseMs;
    vi.spyOn(Date, "now").mockImplementation(() => currentMs);

    const system = await createRuntime();
    runtime = system.runtime;
    ({ scope } = await startReactor(system.engine));

    const threadId = asThreadId("thread-delay-cooldown");
    await seedThread({
      runtime,
      engine: system.engine,
      projectId: asProjectId("project-delay-cooldown"),
      threadId,
      createdAt: new Date(baseMs - 60_000).toISOString(),
      autoContinue: {
        enabled: true,
        messages: ["go on"],
        stopWithHeuristic: false,
        delayMinutes: 1,
        cooldownMinutes: 2,
      },
    });

    await runtime.runPromise(
      system.engine.dispatch({
        type: "thread.activity.append",
        commandId: CommandId.makeUnsafe("cmd-previous-auto-continue"),
        threadId,
        activity: {
          id: EventId.makeUnsafe("activity-previous-auto-continue"),
          tone: "info",
          kind: "auto-continue.sent",
          summary: "Auto-continue sent",
          payload: {
            messageIndex: 0,
          },
          turnId: null,
          createdAt: new Date(baseMs - 30_000).toISOString(),
        },
        createdAt: new Date(baseMs - 30_000).toISOString(),
      }),
    );

    await runtime.runPromise(
      system.engine.dispatch({
        type: "thread.message.assistant.complete",
        commandId: CommandId.makeUnsafe("cmd-assistant-complete-delay-cooldown"),
        threadId,
        messageId: asMessageId("assistant-delay-cooldown"),
        turnId: asTurnId("turn-delay-cooldown"),
        createdAt: new Date(baseMs).toISOString(),
      }),
    );

    currentMs = baseMs + 70_000;
    await runtime.runPromise(
      system.engine.dispatch({
        type: "thread.session.set",
        commandId: CommandId.makeUnsafe("cmd-session-pulse-before-due"),
        threadId,
        session: {
          threadId,
          status: "ready",
          providerName: "codex",
          runtimeMode: "approval-required",
          activeTurnId: null,
          lastError: null,
          updatedAt: new Date(currentMs).toISOString(),
        },
        createdAt: new Date(currentMs).toISOString(),
      }),
    );

    let thread = await readThread(runtime, threadId);
    expect(
      thread?.messages.some((message) => message.role === "user" && message.text === "go on"),
    ).toBe(false);

    currentMs = baseMs + 95_000;
    await runtime.runPromise(
      system.engine.dispatch({
        type: "thread.session.set",
        commandId: CommandId.makeUnsafe("cmd-session-pulse-after-due"),
        threadId,
        session: {
          threadId,
          status: "ready",
          providerName: "codex",
          runtimeMode: "approval-required",
          activeTurnId: null,
          lastError: null,
          updatedAt: new Date(currentMs).toISOString(),
        },
        createdAt: new Date(currentMs).toISOString(),
      }),
    );

    thread = await waitForThread(
      runtime,
      threadId,
      (candidate) =>
        candidate !== null &&
        candidate.messages.some((message) => message.role === "user" && message.text === "go on") &&
        candidate.activities.filter((activity) => activity.kind === "auto-continue.sent").length >=
          2,
    );

    expect(
      thread.activities.filter((activity) => activity.kind === "auto-continue.sent"),
    ).toHaveLength(2);
  });

  it("blocks while approvals are pending", async () => {
    const system = await createRuntime();
    runtime = system.runtime;
    ({ scope } = await startReactor(system.engine));

    const threadId = asThreadId("thread-pending-approval");
    const createdAt = now();
    await seedThread({
      runtime,
      engine: system.engine,
      projectId: asProjectId("project-pending-approval"),
      threadId,
      createdAt,
      autoContinue: {
        enabled: true,
        messages: ["go on"],
        stopWithHeuristic: false,
        delayMinutes: 0,
        cooldownMinutes: 0,
      },
    });

    await runtime.runPromise(
      system.engine.dispatch({
        type: "thread.activity.append",
        commandId: CommandId.makeUnsafe("cmd-approval-requested"),
        threadId,
        activity: {
          id: EventId.makeUnsafe("activity-approval-requested"),
          tone: "approval",
          kind: "approval.requested",
          summary: "Approval requested",
          payload: {
            requestId: "approval-request-1",
            requestKind: "command",
          },
          turnId: null,
          createdAt,
        },
        createdAt,
      }),
    );

    await runtime.runPromise(
      system.engine.dispatch({
        type: "thread.message.assistant.complete",
        commandId: CommandId.makeUnsafe("cmd-assistant-complete-pending-approval"),
        threadId,
        messageId: asMessageId("assistant-pending-approval"),
        turnId: asTurnId("turn-pending-approval"),
        createdAt: now(),
      }),
    );

    await sleep(100);

    let thread = await readThread(runtime, threadId);
    expect(thread?.messages.some((message) => message.role === "user")).toBe(false);

    const resolvedAt = now();
    await runtime.runPromise(
      system.engine.dispatch({
        type: "thread.activity.append",
        commandId: CommandId.makeUnsafe("cmd-approval-resolved"),
        threadId,
        activity: {
          id: EventId.makeUnsafe("activity-approval-resolved"),
          tone: "info",
          kind: "approval.resolved",
          summary: "Approval resolved",
          payload: {
            requestId: "approval-request-1",
            requestKind: "command",
          },
          turnId: null,
          createdAt: resolvedAt,
        },
        createdAt: resolvedAt,
      }),
    );

    thread = await waitForThread(
      runtime,
      threadId,
      (candidate) =>
        candidate !== null &&
        candidate.messages.some((message) => message.role === "user" && message.text === "go on"),
    );

    expect(thread.activities.some((activity) => activity.kind === "auto-continue.sent")).toBe(true);
  });

  it("retries on transient dispatch errors", async () => {
    const system = await createRuntime();
    runtime = system.runtime;

    let remainingFailures = 1;
    const reactorEngine: OrchestrationEngineService["Service"] = {
      ...system.engine,
      dispatch: (command: Parameters<typeof system.engine.dispatch>[0]) =>
        command.type === "thread.auto-continue.trigger" && remainingFailures-- > 0
          ? Effect.fail(
              new OrchestrationListenerCallbackError({
                listener: "domain-event",
                detail: "Temporary provider/session race",
              }),
            )
          : system.engine.dispatch(command),
    };

    ({ scope } = await startReactor(reactorEngine));

    const threadId = asThreadId("thread-transient-retry");
    await seedThread({
      runtime,
      engine: system.engine,
      projectId: asProjectId("project-transient-retry"),
      threadId,
      createdAt: now(),
      autoContinue: {
        enabled: true,
        messages: ["go on"],
        stopWithHeuristic: false,
        delayMinutes: 0,
        cooldownMinutes: 0,
      },
    });

    await runtime.runPromise(
      system.engine.dispatch({
        type: "thread.message.assistant.complete",
        commandId: CommandId.makeUnsafe("cmd-assistant-complete-transient-retry"),
        threadId,
        messageId: asMessageId("assistant-transient-retry"),
        turnId: asTurnId("turn-transient-retry"),
        createdAt: now(),
      }),
    );

    const thread = await waitForThread(
      runtime,
      threadId,
      (candidate) =>
        candidate !== null &&
        candidate.messages.some((message) => message.role === "user" && message.text === "go on"),
      6_000,
    );

    expect(
      thread.messages.filter((message) => message.role === "user" && message.text === "go on"),
    ).toHaveLength(1);
    expect(thread.activities.some((activity) => activity.kind === "auto-continue.failed")).toBe(
      false,
    );
  }, 10_000);

  it("does not fire when the heuristic stop condition matches", async () => {
    const baseMs = Date.parse("2026-03-26T12:00:00.000Z");
    let currentMs = baseMs;
    vi.spyOn(Date, "now").mockImplementation(() => currentMs);

    const system = await createRuntime();
    runtime = system.runtime;
    ({ scope } = await startReactor(system.engine));

    const threadId = asThreadId("thread-heuristic-stop");
    await seedThread({
      runtime,
      engine: system.engine,
      projectId: asProjectId("project-heuristic-stop"),
      threadId,
      createdAt: new Date(currentMs).toISOString(),
      autoContinue: {
        enabled: true,
        messages: ["go on"],
        stopWithHeuristic: true,
        delayMinutes: 0,
        cooldownMinutes: 5,
      },
    });

    await runtime.runPromise(
      system.engine.dispatch({
        type: "thread.message.assistant.complete",
        commandId: CommandId.makeUnsafe("cmd-assistant-complete-heuristic-first"),
        threadId,
        messageId: asMessageId("assistant-heuristic-first"),
        turnId: asTurnId("turn-heuristic-first"),
        createdAt: new Date(currentMs).toISOString(),
      }),
    );

    await waitForThread(
      runtime,
      threadId,
      (candidate) =>
        candidate !== null &&
        candidate.messages.some((message) => message.role === "user" && message.text === "go on"),
    );

    currentMs += 60_000;
    await runtime.runPromise(
      system.engine.dispatch({
        type: "thread.message.assistant.complete",
        commandId: CommandId.makeUnsafe("cmd-assistant-complete-heuristic-second"),
        threadId,
        messageId: asMessageId("assistant-heuristic-second"),
        turnId: asTurnId("turn-heuristic-second"),
        createdAt: new Date(currentMs).toISOString(),
      }),
    );

    await sleep(100);

    const thread = await readThread(runtime, threadId);
    expect(
      thread?.messages.filter((message) => message.role === "user" && message.text === "go on"),
    ).toHaveLength(1);
    expect(
      thread?.activities.filter((activity) => activity.kind === "auto-continue.sent"),
    ).toHaveLength(1);
  });

  it("records a failure activity after a terminal dispatch error", async () => {
    const system = await createRuntime();
    runtime = system.runtime;

    const reactorEngine: OrchestrationEngineService["Service"] = {
      ...system.engine,
      dispatch: (command: Parameters<typeof system.engine.dispatch>[0]) =>
        command.type === "thread.auto-continue.trigger"
          ? Effect.fail(
              new OrchestrationCommandInvariantError({
                commandType: command.type,
                detail: "thread is no longer eligible",
              }),
            )
          : system.engine.dispatch(command),
    };

    ({ scope } = await startReactor(reactorEngine));

    const threadId = asThreadId("thread-terminal-failure");
    await seedThread({
      runtime,
      engine: system.engine,
      projectId: asProjectId("project-terminal-failure"),
      threadId,
      createdAt: now(),
      autoContinue: {
        enabled: true,
        messages: ["go on"],
        stopWithHeuristic: false,
        delayMinutes: 0,
        cooldownMinutes: 0,
      },
    });

    await runtime.runPromise(
      system.engine.dispatch({
        type: "thread.message.assistant.complete",
        commandId: CommandId.makeUnsafe("cmd-assistant-complete-terminal-failure"),
        threadId,
        messageId: asMessageId("assistant-terminal-failure"),
        turnId: asTurnId("turn-terminal-failure"),
        createdAt: now(),
      }),
    );

    const thread = await waitForThread(
      runtime,
      threadId,
      (candidate) =>
        candidate !== null &&
        candidate.activities.some((activity) => activity.kind === "auto-continue.failed"),
    );

    expect(
      thread.messages.some((message) => message.role === "user" && message.text === "go on"),
    ).toBe(false);
    expect(
      thread.activities.find((activity) => activity.kind === "auto-continue.failed")?.payload,
    ).toMatchObject({
      detail:
        "Orchestration command invariant failed (thread.auto-continue.trigger): thread is no longer eligible",
    });
  }, 10_000);
});
