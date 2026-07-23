/** @jsxImportSource @opentui/solid */
import { testRender } from "@opentui/solid"
import type { Agent, Provider, Session } from "@opencode-ai/sdk/v2"
import { expect, test } from "bun:test"
import { mkdir } from "node:fs/promises"
import path from "node:path"
import { onMount } from "solid-js"
import { TuiConfigProvider } from "../../../src/config"
import { ArgsProvider } from "../../../src/context/args"
import { ExitProvider } from "../../../src/context/exit"
import { KVProvider } from "../../../src/context/kv"
import { LocalProvider, useLocal } from "../../../src/context/local"
import { PermissionProvider } from "../../../src/context/permission"
import { ProjectProvider } from "../../../src/context/project"
import { RouteProvider, useRoute } from "../../../src/context/route"
import { SDKProvider } from "../../../src/context/sdk"
import { SyncProvider } from "../../../src/context/sync"
import { ThemeProvider } from "../../../src/context/theme"
import { ToastProvider } from "../../../src/ui/toast"
import { tmpdir } from "../../fixture/fixture"
import { TestTuiContexts } from "../../fixture/tui-environment"
import { createTuiResolvedConfig } from "../../fixture/tui-runtime"
import { createFetch, directory, eventSource, json } from "../../fixture/tui-sdk"

const sol = {
  id: "gpt-5.6-sol",
  providerID: "openai",
  api: { id: "gpt-5.6-sol", url: "https://example.test", npm: "@ai-sdk/openai" },
  name: "Sol",
  capabilities: {
    temperature: false,
    reasoning: true,
    attachment: false,
    toolcall: true,
    input: { text: true, audio: false, image: false, video: false, pdf: false },
    output: { text: true, audio: false, image: false, video: false, pdf: false },
    interleaved: false,
  },
  cost: { input: 0, output: 0, cache: { read: 0, write: 0 } },
  limit: { context: 500_000, output: 128_000 },
  status: "active",
  options: {},
  headers: {},
  release_date: "2026-01-01",
  variants: {
    low: { reasoningEffort: "low" },
    medium: { reasoningEffort: "medium" },
    high: { reasoningEffort: "high" },
    xhigh: { reasoningEffort: "xhigh" },
  },
} satisfies Provider["models"][string]

const terra = {
  ...sol,
  id: "gpt-5.6-terra",
  api: { ...sol.api, id: "gpt-5.6-terra" },
  name: "Terra",
} satisfies Provider["models"][string]

const provider = {
  id: "openai",
  name: "OpenAI",
  source: "config",
  env: [],
  options: {},
  models: { [sol.id]: sol, [terra.id]: terra },
} satisfies Provider

const agents = [
  {
    name: "build",
    mode: "primary",
    hidden: false,
    permission: [],
    model: { providerID: provider.id, modelID: sol.id },
    options: { reasoningEffort: "medium" },
  },
  {
    name: "plan",
    mode: "primary",
    hidden: false,
    permission: [],
    model: { providerID: provider.id, modelID: sol.id },
    options: { reasoningEffort: "high" },
  },
] satisfies Agent[]

function session(id: string): Session {
  return {
    id,
    slug: id,
    projectID: "proj_test",
    directory,
    title: id,
    version: "test",
    time: { created: 0, updated: 0 },
  }
}

async function wait(fn: () => boolean | Promise<boolean>, timeout = 2000) {
  const start = Date.now()
  while (!(await fn())) {
    if (Date.now() - start > timeout) throw new Error("timed out waiting for condition")
    await Bun.sleep(10)
  }
}

async function renderLocal(input: { state: string; initialSession?: string; model?: string }) {
  await Bun.write(path.join(input.state, "kv.json"), "{}")
  const sessions = [session("ses_a"), session("ses_b")]
  const fetch = createFetch((url) => {
    if (url.pathname === "/config/providers") return json({ providers: [provider], default: { openai: sol.id } })
    if (url.pathname === "/provider")
      return json({ all: [provider], default: { openai: sol.id }, connected: [provider.id] })
    if (url.pathname === "/agent") return json(agents)
    if (url.pathname === "/config") return json({ model: `${provider.id}/${sol.id}` })
    if (url.pathname === "/session") return json(sessions)
    return undefined
  })
  let local!: ReturnType<typeof useLocal>
  let route!: ReturnType<typeof useRoute>
  let mounted!: () => void
  const ready = new Promise<void>((resolve) => {
    mounted = resolve
  })

  function Probe() {
    local = useLocal()
    route = useRoute()
    onMount(mounted)
    return <text>{local.model.variant.current()}</text>
  }

  const app = await testRender(() => (
    <ExitProvider exit={() => {}}>
      <TestTuiContexts directory={directory} paths={{ state: input.state }}>
        <ArgsProvider model={input.model}>
          <KVProvider>
            <ToastProvider>
              <RouteProvider
                initialRoute={
                  input.initialSession ? { type: "session", sessionID: input.initialSession } : { type: "home" }
                }
              >
                <TuiConfigProvider config={createTuiResolvedConfig()}>
                  <SDKProvider url="http://test" directory={directory} events={eventSource()} fetch={fetch.fetch}>
                    <PermissionProvider>
                      <ProjectProvider>
                        <SyncProvider>
                          <ThemeProvider mode="dark">
                            <LocalProvider>
                              <Probe />
                            </LocalProvider>
                          </ThemeProvider>
                        </SyncProvider>
                      </ProjectProvider>
                    </PermissionProvider>
                  </SDKProvider>
                </TuiConfigProvider>
              </RouteProvider>
            </ToastProvider>
          </KVProvider>
        </ArgsProvider>
      </TestTuiContexts>
    </ExitProvider>
  ))
  await ready
  await wait(() => local.model.ready && local.model.current() !== undefined)
  return { app, local, route }
}

test("keeps variants isolated by session and agent", async () => {
  await using tmp = await tmpdir()
  const state = path.join(tmp.path, "state")
  await mkdir(state, { recursive: true })
  const { app, local, route } = await renderLocal({ state, initialSession: "ses_a" })

  try {
    expect(local.model.variant.current()).toBe("medium")
    expect(local.model.variant.request()).toBeUndefined()
    local.model.set({ providerID: provider.id, modelID: terra.id })
    local.model.variant.set("xhigh")
    expect(local.model.variant.request()).toBe("xhigh")

    local.agent.set("plan")
    expect(local.model.current()?.modelID).toBe(sol.id)
    expect(local.model.variant.current()).toBe("high")
    expect(local.model.variant.request()).toBeUndefined()
    local.model.variant.set("low")

    route.navigate({ type: "session", sessionID: "ses_b" })
    expect(local.model.variant.current()).toBe("high")
    local.model.variant.set("xhigh")

    route.navigate({ type: "session", sessionID: "ses_a" })
    expect(local.model.variant.current()).toBe("low")
    local.agent.set("build")
    expect(local.model.current()?.modelID).toBe(terra.id)
    expect(local.model.variant.current()).toBe("xhigh")

    route.navigate({ type: "session", sessionID: "ses_b" })
    expect(local.model.current()?.modelID).toBe(sol.id)
    expect(local.model.variant.current()).toBe("medium")
    local.agent.set("plan")
    expect(local.model.variant.current()).toBe("xhigh")
  } finally {
    app.renderer.destroy()
  }
})

test("restoring a session does not alter another session or a new draft", async () => {
  await using tmp = await tmpdir()
  const state = path.join(tmp.path, "state")
  await mkdir(state, { recursive: true })
  const { app, local, route } = await renderLocal({ state, initialSession: "ses_a" })

  try {
    local.model.variant.set("xhigh")
    route.navigate({ type: "session", sessionID: "ses_b" })
    local.model.variant.set("low")

    local.model.restore("ses_a", "build", { providerID: provider.id, modelID: terra.id, variant: "low" })

    expect(local.model.variant.current()).toBe("low")

    route.navigate({ type: "session", sessionID: "ses_a" })
    expect(local.model.variant.current()).toBe("xhigh")
    route.navigate({ type: "session", sessionID: "ses_b" })
    expect(local.model.variant.current()).toBe("low")

    local.agent.set("plan")
    local.model.restore("ses_b", "plan", { providerID: provider.id, modelID: sol.id })
    expect(local.model.variant.current()).toBe("high")

    route.navigate({ type: "home" })
    local.agent.set("build")
    expect(local.model.current()?.modelID).toBe(sol.id)
    expect(local.model.variant.current()).toBe("medium")

    local.model.set({ providerID: provider.id, modelID: terra.id })
    local.model.variant.set("xhigh")
    local.model.promote("ses_new")
    route.navigate({ type: "session", sessionID: "ses_new" })
    expect(local.model.current()?.modelID).toBe(terra.id)
    expect(local.model.variant.current()).toBe("xhigh")

    route.navigate({ type: "plugin", id: "test" })
    route.navigate({ type: "home" })
    expect(local.model.current()?.modelID).toBe(sol.id)
    expect(local.model.variant.current()).toBe("medium")
  } finally {
    app.renderer.destroy()
  }
})

test("keeps command-line model precedence and clears variants when switching models", async () => {
  await using tmp = await tmpdir()
  const state = path.join(tmp.path, "state")
  await mkdir(state, { recursive: true })
  const { app, local } = await renderLocal({
    state,
    initialSession: "ses_a",
    model: `${provider.id}/${terra.id}`,
  })

  try {
    expect(local.model.current()?.modelID).toBe(terra.id)
    expect(local.model.variant.current()).toBe("medium")
    local.model.restore("ses_a", "build", { providerID: provider.id, modelID: sol.id, variant: "xhigh" })
    expect(local.model.current()?.modelID).toBe(terra.id)
    local.model.variant.set("xhigh")
    local.model.set({ providerID: provider.id, modelID: sol.id })
    expect(local.model.variant.selected()).toBeUndefined()
    expect(local.model.variant.current()).toBe("medium")
  } finally {
    app.renderer.destroy()
  }
})

test("cycles configured variants and restores sessions after an invalid command-line model", async () => {
  await using tmp = await tmpdir()
  const state = path.join(tmp.path, "state")
  await mkdir(state, { recursive: true })
  const { app, local } = await renderLocal({
    state,
    initialSession: "ses_a",
    model: `${provider.id}/missing`,
  })

  try {
    local.model.restore("ses_a", "build", { providerID: provider.id, modelID: terra.id, variant: "xhigh" })
    expect(local.model.current()?.modelID).toBe(terra.id)
    expect(local.model.variant.current()).toBe("xhigh")

    local.agent.set("plan")
    expect(local.model.variant.current()).toBe("high")
    local.model.variant.cycle()
    expect(local.model.variant.current()).toBe("xhigh")
    local.model.variant.cycle()
    expect(local.model.variant.current()).toBe("high")
    local.model.variant.cycle()
    expect(local.model.variant.current()).toBe("low")
  } finally {
    app.renderer.destroy()
  }
})

test("ignores legacy variants and persists only recents and favorites", async () => {
  await using tmp = await tmpdir()
  const state = path.join(tmp.path, "state")
  await mkdir(state, { recursive: true })
  const file = path.join(state, "model.json")
  await Bun.write(
    file,
    JSON.stringify({
      recent: [{ providerID: provider.id, modelID: sol.id }],
      favorite: [],
      variant: { [`${provider.id}/${sol.id}`]: "xhigh" },
    }),
  )
  const { app, local } = await renderLocal({ state })

  try {
    expect(local.model.variant.current()).toBe("medium")
    local.model.toggleFavorite({ providerID: provider.id, modelID: sol.id })
    await wait(async () => {
      const saved = await Bun.file(file).json()
      return saved.favorite?.length === 1 && saved.variant === undefined
    })
    expect(await Bun.file(file).json()).toEqual({
      recent: [{ providerID: provider.id, modelID: sol.id }],
      favorite: [{ providerID: provider.id, modelID: sol.id }],
    })
  } finally {
    app.renderer.destroy()
  }
})
