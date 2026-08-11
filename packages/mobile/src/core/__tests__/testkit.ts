// packages/mobile/src/core/__tests__/testkit.ts
// Shared fakes for driver-journey tests.
import { ApiClient } from "../apiClient"
import { OfflineQueue } from "../offlineQueue"
import { createMemoryStore } from "../offlineQueue/store"
import { MediaService, type ReadBytesPort } from "../media"
import type { SubmitResult } from "../driver/types"

export interface FakeNetwork {
  /** responses keyed by method+path (path = full url for PUT-to-S3) */
  onRequest: (method: string, url: string, body: unknown) => { status: number; json?: unknown }
  /** records every fetch call (optional; guard in makeFetch) */
  calls?: Array<{ method: string; url: string; body?: unknown }>
  /** when true, fetchImpl throws to simulate a transport failure */
  transportFail?: boolean
}

export function makeFetch(net: FakeNetwork): typeof fetch {
  return (async (input: any, init?: any) => {
    const url = typeof input === "string" ? input : String(input)
    const method = (init?.method ?? "GET").toUpperCase()
    let body: unknown
    try {
      body = init?.body ? JSON.parse(init.body) : undefined
    } catch {
      body = init?.body
    }
    net.calls?.push({ method, url, body })
    if (net.transportFail) throw new Error("network down")
    const res = net.onRequest(method, url, body)
    return {
      ok: res.status >= 200 && res.status < 300,
      status: res.status,
      async text() {
        return res.json !== undefined ? JSON.stringify(res.json) : ""
      },
    } as Response
  }) as unknown as typeof fetch
}

export function makeApi(net: FakeNetwork): ApiClient {
  return new ApiClient({
    baseUrl: "https://api.fleet.internal/api/v1",
    fetchImpl: makeFetch(net),
    getToken: () => "tok",
    makeIdempotencyKey: () => "idem-1",
  })
}

export const readBytesFake: ReadBytesPort = {
  async read() {
    return new Uint8Array([1, 2, 3])
  },
}

export function makeMedia(api: ApiClient, net?: FakeNetwork, online = true): MediaService {
  const fetchImpl = net ? makeFetch(net) : makeFetch({ calls: [], onRequest: () => ({ status: 200 }) })
  return new MediaService({ api, fetchImpl, readBytes: readBytesFake, online: () => online })
}

/** Valid RFC-4122-ish uuid used by the shared response schemas (they enforce `.uuid()`). */
export function uid(n: number): string {
  return `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`
}

export function makeQueue(): OfflineQueue {
  return new OfflineQueue(createMemoryStore())
}

export function photo(uri = "file://x.jpg"): { uri: string; width: number; height: number; size: number; createdAt: string } {
  return { uri, width: 1200, height: 900, size: 100_000, createdAt: "2026-01-01T10:00:00.000Z" }
}

export function assertDone(r: SubmitResult): string {
  if (r.kind !== "done") throw new Error("expected done")
  return r.id
}
