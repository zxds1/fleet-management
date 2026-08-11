// packages/mobile/src/core/__tests__/idempotencyKey.regression.test.ts
//
// REGRESSION SUITE — C5.1 idempotency key.
//
// The key previously defaulted to the empty string, which the server rejects with 400
// (`Idempotency-Key` must be a UUID). These tests pin the *real* default path: when no key is
// injected and no override is passed, `ApiClient` must fall back to `randomUUID()` from core/uuid.ts
// and send a syntactically valid RFC-4122 v4 UUID on every state-changing verb.
//
// `global.fetch` is mocked so the exact outgoing headers can be inspected.

import { ApiClient } from "../apiClient"
import { randomUUID } from "../uuid"

/** RFC-4122 v4: 8-4-4-4-12 hex, version nibble `4`, variant nibble 8/9/a/b. */
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

interface Captured {
  url: string
  method: string
  headers: Record<string, string>
}

function mockFetch(captured: Captured[], status = 200, json: unknown = { ok: true }): jest.Mock {
  return jest.fn(async (input: unknown, init?: unknown) => {
    const opts = (init ?? {}) as { method?: string; headers?: Record<string, string> }
    captured.push({
      url: String(input),
      method: (opts.method ?? "GET").toUpperCase(),
      headers: { ...(opts.headers ?? {}) },
    })
    return {
      ok: status >= 200 && status < 300,
      status,
      async text() {
        return JSON.stringify(json)
      },
    } as unknown as Response
  })
}

/** Client built WITHOUT `makeIdempotencyKey` so the production default path is exercised. */
function clientUsingGlobalFetch(): ApiClient {
  return new ApiClient({
    baseUrl: "https://api.fleet.internal/api/v1",
    fetchImpl: (...args: Parameters<typeof fetch>) => (global.fetch as typeof fetch)(...args),
    getToken: () => "tok",
  })
}

describe("REGRESSION apiClient — idempotency-key must be a real UUIDv4, never empty", () => {
  const realFetch = global.fetch
  let captured: Captured[]

  beforeEach(() => {
    captured = []
    global.fetch = mockFetch(captured) as unknown as typeof fetch
  })

  afterEach(() => {
    global.fetch = realFetch
  })

  it("randomUUID() itself produces a v4 UUID", () => {
    const id = randomUUID()
    expect(id).toMatch(UUID_V4)
    expect(id).not.toBe("")
  })

  it.each(["POST", "PUT", "PATCH"] as const)(
    "%s sends a non-empty UUIDv4 idempotency-key by default",
    async (method) => {
      const api = clientUsingGlobalFetch()
      await api.send(method, "/shifts/clock-in", { vehicle_id: "v1" })

      expect(captured).toHaveLength(1)
      const key = captured[0]!.headers["idempotency-key"]
      expect(key).toBeDefined()
      expect(key).not.toBe("")
      expect(key).toMatch(UUID_V4)
      expect(captured[0]!.method).toBe(method)
    },
  )

  it("a POST made through request() (not send()) also carries the key", async () => {
    const api = clientUsingGlobalFetch()
    await api.request("/fuel/purchases", { method: "POST", body: { litres: 40 } })

    const key = captured[0]!.headers["idempotency-key"]
    expect(key).toMatch(UUID_V4)
  })

  it("two consecutive POSTs get DIFFERENT keys (each is a distinct operation)", async () => {
    const api = clientUsingGlobalFetch()
    await api.send("POST", "/shifts/clock-in", {})
    await api.send("POST", "/shifts/clock-in", {})

    const k1 = captured[0]!.headers["idempotency-key"]
    const k2 = captured[1]!.headers["idempotency-key"]
    expect(k1).toMatch(UUID_V4)
    expect(k2).toMatch(UUID_V4)
    expect(k1).not.toBe(k2)
  })

  it("an explicit idempotencyKey override is honoured verbatim (offline-queue retry)", async () => {
    const api = clientUsingGlobalFetch()
    const retryKey = "11111111-2222-4333-8444-555555555555"
    await api.send("POST", "/fuel/purchases", { litres: 40 }, retryKey)

    expect(captured[0]!.headers["idempotency-key"]).toBe(retryKey)
  })

  it("GET and DELETE do NOT carry an idempotency-key", async () => {
    const api = clientUsingGlobalFetch()
    await api.request("/vehicles", { method: "GET" })
    await api.request("/devices/d1", { method: "DELETE" })

    expect(captured[0]!.headers["idempotency-key"]).toBeUndefined()
    expect(captured[1]!.headers["idempotency-key"]).toBeUndefined()
  })

  it("an injected test generator is used verbatim (documents the `??` fallback semantics)", async () => {
    // The fixed defect was the *default* being `""`; the default path is covered above. The
    // injected-generator hook is a test seam, so its value is passed through as-is — note that
    // `??` only falls back on null/undefined, so an injected `""` would NOT be replaced. No
    // production code path injects an empty generator (see testkit.ts: `() => "idem-1"`).
    const api = new ApiClient({
      baseUrl: "https://api.fleet.internal/api/v1",
      fetchImpl: (...args: Parameters<typeof fetch>) => (global.fetch as typeof fetch)(...args),
      getToken: () => "tok",
      makeIdempotencyKey: () => "idem-fixed-1",
    })
    await api.send("POST", "/shifts/clock-in", {})

    expect(captured[0]!.headers["idempotency-key"]).toBe("idem-fixed-1")
  })

  it("the default key is generated per-request, so no request can ever send an empty header", async () => {
    const api = clientUsingGlobalFetch()
    for (const path of ["/shifts/clock-in", "/shifts/clock-out", "/inspections", "/accidents"]) {
      await api.send("POST", path, {})
    }

    const keys = captured.map((c) => c.headers["idempotency-key"])
    expect(keys).toHaveLength(4)
    for (const k of keys) {
      expect(k).toBeTruthy()
      expect(k).toMatch(UUID_V4)
    }
    expect(new Set(keys).size).toBe(4)
  })
})
