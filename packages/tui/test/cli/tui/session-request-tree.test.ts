import { describe, expect, test } from "bun:test"
import type { PermissionRequest, QuestionRequest, Session } from "@opencode-ai/sdk/v2"
import { sessionTreeRequests } from "../../../src/routes/session/session-request-tree"

const session = (id: string, parentID?: string): Session => ({
  id,
  parentID,
  slug: id,
  projectID: "project",
  directory: "/workspace",
  title: id,
  version: "0.0.0-test",
  time: { created: 0, updated: 0 },
})
const permission = (id: string, sessionID: string): PermissionRequest => ({
  id,
  sessionID,
  permission: "bash",
  patterns: [],
  metadata: {},
  always: [],
})
const question = (id: string, sessionID: string): QuestionRequest => ({ id, sessionID, questions: [] })

describe("sessionTreeRequests", () => {
  test("includes all grandchild permissions unchanged", () => {
    const sessions = [session("root"), session("child", "root"), session("grandchild", "child")]
    const first = permission("permission-1", "grandchild")
    const second = permission("permission-2", "grandchild")

    const result = sessionTreeRequests(sessions, { grandchild: [first, second] }, "root")

    expect(result).toEqual([first, second])
    expect(result[0]).toBe(first)
    expect(result[1]).toBe(second)
  })

  test("includes a grandchild question unchanged", () => {
    const sessions = [session("root"), session("child", "root"), session("grandchild", "child")]
    const request = question("question-1", "grandchild")

    const result = sessionTreeRequests(sessions, { grandchild: [request] }, "root")

    expect(result).toEqual([request])
    expect(result[0]).toBe(request)
  })

  test("orders root and shallower requests before deeper requests", () => {
    const sessions = [
      session("root"),
      session("first-child", "root"),
      session("grandchild", "first-child"),
      session("second-child", "root"),
    ]
    const root = permission("permission-root", "root")
    const shallow = permission("permission-shallow", "second-child")
    const deep = permission("permission-deep", "grandchild")

    expect(
      sessionTreeRequests(
        sessions,
        {
          root: [root],
          grandchild: [deep],
          "second-child": [shallow],
        },
        "root",
      ),
    ).toEqual([root, shallow, deep])
  })

  test("terminates safely when the session tree contains a cycle", () => {
    const sessions = [
      session("root", "grandchild"),
      session("child", "root"),
      session("grandchild", "child"),
    ]
    const root = permission("permission-root", "root")
    const child = permission("permission-child", "child")
    const grandchild = permission("permission-grandchild", "grandchild")

    expect(
      sessionTreeRequests(
        sessions,
        {
          root: [root],
          child: [child],
          grandchild: [grandchild],
        },
        "root",
      ),
    ).toEqual([root, child, grandchild])
  })
})
