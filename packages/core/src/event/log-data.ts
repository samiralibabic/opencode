import { SessionV1 } from "@opencode-ai/schema/session-v1"

/**
 * The copy of an encoded durable payload that the event log stores. Every
 * `message.updated` repeats the session's file diffs so far; the message row
 * keeps them, so the log stores an empty list (the schema requires the field
 * once a summary exists). Projectors and live subscribers get the full payload.
 */
export function logData(type: string, data: Record<string, unknown>): Record<string, unknown> {
  if (type !== SessionV1.Event.MessageUpdated.type) return data
  const info = data.info
  if (!isRecord(info) || !isRecord(info.summary) || !Array.isArray(info.summary.diffs)) return data
  return { ...data, info: { ...info, summary: { ...info.summary, diffs: [] } } }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)
