import { describe, expect } from "bun:test"
import { Effect, Exit, Fiber, Stream } from "effect"
import { eq } from "drizzle-orm"
import { Database } from "@opencode-ai/core/database/database"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { EventV2 } from "@opencode-ai/core/event"
import { EventTable } from "@opencode-ai/core/event/sql"
import { ModelV2 } from "@opencode-ai/core/model"
import { Project } from "@opencode-ai/core/project"
import { ProjectTable } from "@opencode-ai/core/project/sql"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { SessionProjector } from "@opencode-ai/core/session/projector"
import { MessageTable } from "@opencode-ai/core/session/sql"
import { Session } from "@opencode-ai/schema/session"
import { SessionV1 } from "@opencode-ai/schema/session-v1"
import { testEffect } from "./lib/effect"

const it = testEffect(AppNodeBuilder.build(LayerNode.group([Database.node, EventV2.node, SessionProjector.node])))

const diffs = [
  { file: "data.json", patch: "@@ -1 +1 @@\n-old\n+new\n", additions: 1, deletions: 1, status: "modified" as const },
]

const sessionInfo = (sessionID: Session.ID) => ({
  id: sessionID,
  slug: "test",
  projectID: Project.ID.global,
  directory: "/project",
  title: "test",
  version: "test",
  summary: { additions: 1, deletions: 1, files: 1, diffs },
  time: { created: 0, updated: 0 },
})

const userMessage = (sessionID: Session.ID) => ({
  id: SessionV1.MessageID.ascending(),
  sessionID,
  role: "user" as const,
  time: { created: 1 },
  summary: { title: "turn", diffs },
  agent: "build",
  model: { providerID: ProviderV2.ID.make("provider"), modelID: ModelV2.ID.make("model") },
})

const setup = Effect.gen(function* () {
  const { db } = yield* Database.Service
  const events = yield* EventV2.Service
  yield* db
    .insert(ProjectTable)
    .values({ id: Project.ID.global, worktree: AbsolutePath.make("/project"), sandboxes: [] })
    .run()
  const sessionID = Session.ID.create()
  const created = yield* events.publish(SessionV1.Event.Created, { sessionID, info: sessionInfo(sessionID) })
  return { db, events, sessionID, created }
})

const stored = (db: Database.Interface["db"], id: EventV2.ID) =>
  db
    .select({ data: EventTable.data })
    .from(EventTable)
    .where(eq(EventTable.id, id))
    .get()
    .pipe(
      Effect.orDie,
      Effect.map((row) => row?.data),
    )

describe("event log message diffs", () => {
  it.effect("stores message.updated in the event log without summary diffs", () =>
    Effect.gen(function* () {
      const { db, events, sessionID } = yield* setup
      const message = userMessage(sessionID)
      const event = yield* events.publish(SessionV1.Event.MessageUpdated, { sessionID, info: message })

      expect(yield* stored(db, event.id)).toEqual({
        sessionID,
        info: { ...message, summary: { title: "turn", diffs: [] } },
      })
    }),
  )

  it.effect("keeps summary diffs on the message row", () =>
    Effect.gen(function* () {
      const { db, events, sessionID } = yield* setup
      const message = userMessage(sessionID)
      yield* events.publish(SessionV1.Event.MessageUpdated, { sessionID, info: message })

      const row = yield* db
        .select({ data: MessageTable.data })
        .from(MessageTable)
        .where(eq(MessageTable.id, message.id))
        .get()
        .pipe(Effect.orDie)
      expect(row?.data).toMatchObject({ summary: { title: "turn", diffs } })
    }),
  )

  it.effect("stores other event types unchanged", () =>
    Effect.gen(function* () {
      const { db, events, sessionID, created } = yield* setup
      const updated = yield* events.publish(SessionV1.Event.Updated, {
        sessionID,
        info: { ...sessionInfo(sessionID), title: "renamed" },
      })

      expect(yield* stored(db, created.id)).toEqual({ sessionID, info: sessionInfo(sessionID) })
      expect(yield* stored(db, updated.id)).toEqual({
        sessionID,
        info: { ...sessionInfo(sessionID), title: "renamed" },
      })
    }),
  )

  it.effect("delivers summary diffs to live subscribers", () =>
    Effect.gen(function* () {
      const { events, sessionID } = yield* setup
      const listened = new Array<EventV2.Payload>()
      yield* events.listen((event) => Effect.sync(() => listened.push(event)))
      const fiber = yield* events
        .subscribe(SessionV1.Event.MessageUpdated)
        .pipe(Stream.take(1), Stream.runCollect, Effect.forkScoped)
      yield* Effect.yieldNow
      const message = userMessage(sessionID)
      const published = yield* events.publish(SessionV1.Event.MessageUpdated, { sessionID, info: message })
      const [subscribed] = Array.from(yield* Fiber.join(fiber))

      expect(published.data.info).toEqual(message)
      expect(subscribed?.data.info).toEqual(message)
      expect(listened.find((event) => event.id === published.id)?.data).toEqual({ sessionID, info: message })
    }),
  )

  it.effect("accepts a replayed message.updated with diffs at an already stored sequence", () =>
    Effect.gen(function* () {
      const { db, events, sessionID } = yield* setup
      const message = userMessage(sessionID)
      const event = yield* events.publish(SessionV1.Event.MessageUpdated, { sessionID, info: message })
      const replay = () =>
        events
          .replay({
            id: event.id,
            type: EventV2.versionedType(SessionV1.Event.MessageUpdated.type, 1),
            seq: event.durable!.seq,
            aggregateID: sessionID,
            data: { sessionID, info: message },
          })
          .pipe(Effect.exit)

      expect(Exit.isSuccess(yield* replay())).toBe(true)

      // Rows written before diffs were left out of the log still hold them.
      yield* db
        .update(EventTable)
        .set({ data: { sessionID, info: message } })
        .where(eq(EventTable.id, event.id))
        .run()
        .pipe(Effect.orDie)
      expect(Exit.isSuccess(yield* replay())).toBe(true)
    }),
  )
})
