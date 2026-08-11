// packages/mobile/src/core/__tests__/media.test.ts
import { MediaService, uploadSequence } from "../media"
import { ApiClient } from "../apiClient"
import { NetworkOfflineError } from "../driver/types"
import { makeFetch, readBytesFake, photo } from "./testkit"

describe("MediaService", () => {
  it("mints a presigned URL, PUTs bytes, and returns media_object_id", async () => {
    const calls: Array<{ method: string; url: string }> = []
    const fetchImpl = makeFetch({
      onRequest: (method, url) => {
        calls.push({ method, url })
        if (url.endsWith("/media/upload-url")) {
          return { status: 201, json: { media_object_id: "m1", upload_url: "https://s3/put/m1", expires_in_seconds: 60, method: "PUT" } }
        }
        return { status: 200 }
      },
    })
    const api = new ApiClient({ baseUrl: "https://api.fleet.internal/api/v1", fetchImpl, getToken: () => "tok" })
    const svc = new MediaService({ api, fetchImpl, readBytes: readBytesFake, online: () => true })

    const id = await svc.upload(
      { uri: "file://x", width: 100, height: 100, size: 10, createdAt: "2026-01-01T00:00:00.000Z" },
      { owner_kind: "WORK_LOG", retention_class: "WORK_PLAN", content_type: "image/jpeg" },
    )

    expect(id).toBe("m1")
    // Second call is the raw PUT to object storage, not the API host.
    const put = calls.find((c) => c.method === "PUT")
    expect(put?.url).toBe("https://s3/put/m1")
    expect(calls.some((c) => c.url.endsWith("/media/upload-url"))).toBe(true)
  })

  it("throws NetworkOfflineError without touching the network when offline", async () => {
    const fetchImpl = makeFetch({ onRequest: () => ({ status: 200 }) })
    const api = new ApiClient({ baseUrl: "x", fetchImpl, getToken: () => "tok" })
    const svc = new MediaService({ api, fetchImpl, readBytes: readBytesFake, online: () => false })
    await expect(
      svc.upload({ uri: "f", width: 1, height: 1, size: 1, createdAt: "2026-01-01T00:00:00.000Z" }, {
        owner_kind: "WORK_LOG",
        retention_class: "WORK_PLAN",
        content_type: "image/jpeg",
      }),
    ).rejects.toBeInstanceOf(NetworkOfflineError)
  })

  it("throws NetworkOfflineError when the presigned PUT fails", async () => {
    const fetchImpl = makeFetch({
      onRequest: (method, url) => {
        if (url.endsWith("/media/upload-url")) return { status: 201, json: { media_object_id: "m1", upload_url: "https://s3/x", expires_in_seconds: 60, method: "PUT" } }
        return { status: 500 }
      },
    })
    const api = new ApiClient({ baseUrl: "x", fetchImpl, getToken: () => "tok" })
    const svc = new MediaService({ api, fetchImpl, readBytes: readBytesFake, online: () => true })
    await expect(
      svc.upload({ uri: "f", width: 1, height: 1, size: 1, createdAt: "2026-01-01T00:00:00.000Z" }, {
        owner_kind: "WORK_LOG",
        retention_class: "WORK_PLAN",
        content_type: "image/jpeg",
      }),
    ).rejects.toBeInstanceOf(NetworkOfflineError)
  })
})

describe("uploadSequence (offline-first media ordering, D6)", () => {
  it("uploads every photo in order and returns the ids for the business record", async () => {
    let ticket = 0
    const calls: Array<{ method: string; url: string }> = []
    const fetchImpl = makeFetch({
      calls,
      onRequest: (method, url) => {
        if (url.endsWith("/media/upload-url")) {
          return { status: 201, json: { media_object_id: `m${++ticket}`, upload_url: `https://s3/put/${ticket}`, expires_in_seconds: 60, method: "PUT" } }
        }
        return { status: 200 }
      },
    })
    const api = new ApiClient({ baseUrl: "https://api.fleet.internal/api/v1", fetchImpl, getToken: () => "tok" })
    const svc = new MediaService({ api, fetchImpl, readBytes: readBytesFake, online: () => true })

    const photos = [photo("file://a.jpg"), photo("file://b.jpg"), photo("file://c.jpg")]
    const ids = await uploadSequence(svc, photos, () => ({ owner_kind: "ACCIDENT_REPORT", retention_class: "ACCIDENT", content_type: "image/jpeg" }))

    expect(ids).toEqual(["m1", "m2", "m3"])
    // The presigned PUTs go to object storage, not the API host.
    expect(calls.filter((c) => c.method === "PUT" && c.url.startsWith("https://s3/")).length).toBe(3)
  })

  it("fails closed when one upload fails, so no record references a missing object id", async () => {
    let ticket = 0
    const fetchImpl = makeFetch({
      onRequest: (method, url) => {
        if (url.endsWith("/media/upload-url")) {
          return { status: 201, json: { media_object_id: `m${++ticket}`, upload_url: `https://s3/put/${ticket}`, expires_in_seconds: 60, method: "PUT" } }
        }
        // Second PUT fails → sequence aborts.
        return { status: ticket === 2 ? 500 : 200 }
      },
    })
    const api = new ApiClient({ baseUrl: "x", fetchImpl, getToken: () => "tok" })
    const svc = new MediaService({ api, fetchImpl, readBytes: readBytesFake, online: () => true })
    const photos = [photo("file://a.jpg"), photo("file://b.jpg")]

    await expect(uploadSequence(svc, photos, () => ({ owner_kind: "ACCIDENT_REPORT", retention_class: "ACCIDENT", content_type: "image/jpeg" }))).rejects.toBeInstanceOf(NetworkOfflineError)
  })
})
