import { Effect, Layer, Option, Schema } from "effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import * as SqlSchema from "effect/unstable/sql/SqlSchema";

import { toPersistenceSqlError } from "../Errors.ts";
import {
  DeleteProjectionDelayedSendInput,
  GetProjectionDelayedSendInput,
  ProjectionDelayedSend,
  ProjectionDelayedSendRepository,
  type ProjectionDelayedSendRepositoryShape,
} from "../Services/ProjectionDelayedSends.ts";

const ProjectionDelayedSendDbRow = Schema.Struct({
  threadId: ProjectionDelayedSend.fields.threadId,
  messageId: ProjectionDelayedSend.fields.messageId,
  text: ProjectionDelayedSend.fields.text,
  attachments: Schema.fromJsonString(ProjectionDelayedSend.fields.attachments),
  dueAt: ProjectionDelayedSend.fields.dueAt,
  modelSelection: Schema.NullOr(Schema.fromJsonString(ProjectionDelayedSend.fields.modelSelection)),
  runtimeMode: ProjectionDelayedSend.fields.runtimeMode,
  interactionMode: ProjectionDelayedSend.fields.interactionMode,
  createThread: Schema.NullOr(Schema.fromJsonString(Schema.Unknown)),
  createdAt: ProjectionDelayedSend.fields.createdAt,
});
type ProjectionDelayedSendDbRow = typeof ProjectionDelayedSendDbRow.Type;

function normalizeProjectionDelayedSend(row: ProjectionDelayedSendDbRow): ProjectionDelayedSend {
  return {
    threadId: row.threadId,
    messageId: row.messageId,
    text: row.text,
    attachments: row.attachments,
    dueAt: row.dueAt,
    ...(row.modelSelection !== null ? { modelSelection: row.modelSelection } : {}),
    runtimeMode: row.runtimeMode,
    interactionMode: row.interactionMode,
    ...(row.createThread !== null
      ? { createThread: row.createThread as ProjectionDelayedSend["createThread"] }
      : {}),
    createdAt: row.createdAt,
  };
}

const makeProjectionDelayedSendRepository = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  const upsertProjectionDelayedSendRow = SqlSchema.void({
    Request: ProjectionDelayedSend,
    execute: (row) =>
      sql`
        INSERT INTO projection_delayed_sends (
          thread_id,
          message_id,
          text,
          attachments_json,
          due_at,
          model_selection_json,
          runtime_mode,
          interaction_mode,
          create_thread_json,
          created_at
        )
        VALUES (
          ${row.threadId},
          ${row.messageId},
          ${row.text},
          ${JSON.stringify(row.attachments)},
          ${row.dueAt},
          ${row.modelSelection ? JSON.stringify(row.modelSelection) : null},
          ${row.runtimeMode},
          ${row.interactionMode},
          ${row.createThread ? JSON.stringify(row.createThread) : null},
          ${row.createdAt}
        )
        ON CONFLICT (thread_id)
        DO UPDATE SET
          message_id = excluded.message_id,
          text = excluded.text,
          attachments_json = excluded.attachments_json,
          due_at = excluded.due_at,
          model_selection_json = excluded.model_selection_json,
          runtime_mode = excluded.runtime_mode,
          interaction_mode = excluded.interaction_mode,
          create_thread_json = excluded.create_thread_json,
          created_at = excluded.created_at
      `,
  });

  const getProjectionDelayedSendRow = SqlSchema.findOneOption({
    Request: GetProjectionDelayedSendInput,
    Result: ProjectionDelayedSendDbRow,
    execute: ({ threadId }) =>
      sql`
        SELECT
          thread_id AS "threadId",
          message_id AS "messageId",
          text,
          attachments_json AS "attachments",
          due_at AS "dueAt",
          model_selection_json AS "modelSelection",
          runtime_mode AS "runtimeMode",
          interaction_mode AS "interactionMode",
          create_thread_json AS "createThread",
          created_at AS "createdAt"
        FROM projection_delayed_sends
        WHERE thread_id = ${threadId}
      `,
  });

  const deleteProjectionDelayedSendRow = SqlSchema.void({
    Request: DeleteProjectionDelayedSendInput,
    execute: ({ threadId }) =>
      sql`
        DELETE FROM projection_delayed_sends
        WHERE thread_id = ${threadId}
      `,
  });

  const upsert: ProjectionDelayedSendRepositoryShape["upsert"] = (row) =>
    upsertProjectionDelayedSendRow(row).pipe(
      Effect.mapError(toPersistenceSqlError("ProjectionDelayedSendRepository.upsert:query")),
    );

  const getById: ProjectionDelayedSendRepositoryShape["getById"] = (input) =>
    getProjectionDelayedSendRow(input).pipe(
      Effect.map((result) => Option.map(result, normalizeProjectionDelayedSend)),
      Effect.mapError(toPersistenceSqlError("ProjectionDelayedSendRepository.getById:query")),
    );

  const deleteById: ProjectionDelayedSendRepositoryShape["deleteById"] = (input) =>
    deleteProjectionDelayedSendRow(input).pipe(
      Effect.mapError(toPersistenceSqlError("ProjectionDelayedSendRepository.deleteById:query")),
    );

  return {
    upsert,
    getById,
    deleteById,
  } satisfies ProjectionDelayedSendRepositoryShape;
});

export const ProjectionDelayedSendRepositoryLive = Layer.effect(
  ProjectionDelayedSendRepository,
  makeProjectionDelayedSendRepository,
);
