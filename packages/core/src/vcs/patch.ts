export * as VcsPatch from "./patch"

import { formatPatch, structuredPatch } from "diff"

export const MAX_PATCH_BYTES = 10_000_000
export const MAX_TOTAL_PATCH_BYTES = 10_000_000

export const emptyPatch = (file: string) => formatPatch(structuredPatch(file, file, "", "", "", "", { context: 0 }))

export const totalPatch = (file: string, patch: string, total: number) => {
  if (total + Buffer.byteLength(patch) <= MAX_TOTAL_PATCH_BYTES) return { patch, capped: false }
  return { patch: emptyPatch(file), capped: true }
}
