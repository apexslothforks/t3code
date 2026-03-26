import { ThreadDelayedSend, ThreadId } from "@t3tools/contracts";
import { Option, Schema, ServiceMap } from "effect";
import type { Effect } from "effect";

import type { ProjectionRepositoryError } from "../Errors.ts";

export const ProjectionDelayedSend = ThreadDelayedSend;
export type ProjectionDelayedSend = typeof ProjectionDelayedSend.Type;

export const GetProjectionDelayedSendInput = Schema.Struct({
  threadId: ThreadId,
});
export type GetProjectionDelayedSendInput = typeof GetProjectionDelayedSendInput.Type;

export const DeleteProjectionDelayedSendInput = Schema.Struct({
  threadId: ThreadId,
});
export type DeleteProjectionDelayedSendInput = typeof DeleteProjectionDelayedSendInput.Type;

export interface ProjectionDelayedSendRepositoryShape {
  readonly upsert: (
    delayedSend: ProjectionDelayedSend,
  ) => Effect.Effect<void, ProjectionRepositoryError>;
  readonly getById: (
    input: GetProjectionDelayedSendInput,
  ) => Effect.Effect<Option.Option<ProjectionDelayedSend>, ProjectionRepositoryError>;
  readonly deleteById: (
    input: DeleteProjectionDelayedSendInput,
  ) => Effect.Effect<void, ProjectionRepositoryError>;
}

export class ProjectionDelayedSendRepository extends ServiceMap.Service<
  ProjectionDelayedSendRepository,
  ProjectionDelayedSendRepositoryShape
>()("t3/persistence/Services/ProjectionDelayedSends/ProjectionDelayedSendRepository") {}
