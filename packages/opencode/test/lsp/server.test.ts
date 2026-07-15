import { describe, expect, spyOn, test } from "bun:test"
import { Effect } from "effect"
import fs from "fs/promises"
import path from "path"
import { Npm } from "@opencode-ai/core/npm"
import { ProjectV2 } from "@opencode-ai/core/project"
import { RuntimeFlags } from "@/effect/runtime-flags"
import type { InstanceContext } from "@/project/instance-context"
import * as LSPServer from "@/lsp/server"
import { tmpdir } from "../fixture/fixture"

const createContext = (directory: string): InstanceContext => ({
  directory,
  worktree: directory,
  project: {
    id: ProjectV2.ID.global,
    worktree: directory,
    time: {
      created: 0,
      updated: 0,
    },
    sandboxes: [],
  },
})

const flags = () =>
  Effect.runPromise(
    Effect.gen(function* () {
      return yield* RuntimeFlags.Service
    }).pipe(Effect.provide(RuntimeFlags.layer())),
  )

const writePackage = async (dir: string, marker: string) => {
  await fs.mkdir(dir, { recursive: true })
  await Bun.write(path.join(dir, marker), marker.endsWith(".json") ? "{}" : "")
}

const writeTypescript = async (dir: string) => {
  await writePackage(dir, "package.json")
  await fs.mkdir(path.join(dir, "node_modules", "typescript", "lib"), { recursive: true })
  await Bun.write(path.join(dir, "node_modules", "typescript", "lib", "tsserver.js"), "")
}

describe("LSP server definitions", () => {
  test("TypeScript root detects child package.json", async () => {
    await using tmp = await tmpdir()
    const root = path.join(tmp.path, "apps", "api")
    await writePackage(root, "package.json")

    const result = await LSPServer.Typescript.root(path.join(root, "src", "server.ts"), createContext(tmp.path))

    expect(result).toBe(root)
  })

  test("TypeScript root detects child tsconfig.json", async () => {
    await using tmp = await tmpdir()
    const root = path.join(tmp.path, "apps", "api")
    await writePackage(root, "tsconfig.json")

    const result = await LSPServer.Typescript.root(path.join(root, "src", "server.ts"), createContext(tmp.path))

    expect(result).toBe(root)
  })

  test("TypeScript root skips Deno projects", async () => {
    await using tmp = await tmpdir()
    await writePackage(tmp.path, "package.json")
    await writePackage(tmp.path, "deno.json")

    const result = await LSPServer.Typescript.root(path.join(tmp.path, "src", "main.ts"), createContext(tmp.path))

    expect(result).toBeUndefined()
  })

  test("ESLint root detects child package.json", async () => {
    await using tmp = await tmpdir()
    const root = path.join(tmp.path, "apps", "web")
    await writePackage(root, "package.json")

    const result = await LSPServer.ESLint.root(path.join(root, "src", "App.tsx"), createContext(tmp.path))

    expect(result).toBe(root)
  })

  test("Astro root detects child package.json", async () => {
    await using tmp = await tmpdir()
    const root = path.join(tmp.path, "apps", "site")
    await writePackage(root, "package.json")

    const result = await LSPServer.Astro.root(path.join(root, "src", "index.astro"), createContext(tmp.path))

    expect(result).toBe(root)
  })

  test("TypeScript spawn resolves TypeScript from workspace root first", async () => {
    await using tmp = await tmpdir()
    const root = path.join(tmp.path, "apps", "api")
    await writeTypescript(root)
    const npmWhich = spyOn(Npm, "which").mockResolvedValue(undefined)

    try {
      await LSPServer.Typescript.spawn(root, createContext(tmp.path), await flags())
      expect(npmWhich).toHaveBeenCalledWith("typescript-language-server")
    } finally {
      npmWhich.mockRestore()
    }
  })

  test("TypeScript spawn resolves TypeScript from an ancestor workspace", async () => {
    await using tmp = await tmpdir()
    const root = path.join(tmp.path, "apps", "api")
    await fs.mkdir(root, { recursive: true })
    await writeTypescript(tmp.path)
    const npmWhich = spyOn(Npm, "which").mockResolvedValue(undefined)

    try {
      await LSPServer.Typescript.spawn(root, createContext(tmp.path), await flags())
      expect(npmWhich).toHaveBeenCalledWith("typescript-language-server")
    } finally {
      npmWhich.mockRestore()
    }
  })
})
