import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

const DISABLED_AUTO_CONTINUE_JSON = JSON.stringify({
  enabled: false,
  messages: [],
  stopWithHeuristic: false,
  delayMinutes: 3,
  cooldownMinutes: 5,
});

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`
    ALTER TABLE projection_threads
    ADD COLUMN auto_continue_json TEXT
  `;

  yield* sql`
    UPDATE projection_threads
    SET auto_continue_json = ${DISABLED_AUTO_CONTINUE_JSON}
    WHERE auto_continue_json IS NULL
  `;
});
