import type { Session } from "@opencode-ai/sdk/v2"

export function sessionTreeRequests<T>(
  sessions: Session[],
  requests: Record<string, T[] | undefined>,
  sessionID?: string,
) {
  if (!sessionID) return []

  const children = sessions.reduce((result, session) => {
    if (!session.parentID) return result
    const items = result.get(session.parentID)
    if (items) items.push(session.id)
    if (!items) result.set(session.parentID, [session.id])
    return result
  }, new Map<string, string[]>())

  const result: T[] = []
  const seen = new Set([sessionID])
  const queue = [sessionID]
  for (const id of queue) {
    result.push(...(requests[id] ?? []))
    for (const child of children.get(id) ?? []) {
      if (seen.has(child)) continue
      seen.add(child)
      queue.push(child)
    }
  }
  return result
}
