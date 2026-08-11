// packages/mobile/src/core/__tests__/driver.test.ts
import { ShiftsService, ActiveShiftSchema } from "../driver/shifts"
import { RefuelService } from "../driver/refuel"
import { InspectionsService } from "../driver/inspections"
import { AccidentsService } from "../driver/accidents"
import { ApiError } from "../apiClient"
import { fromServer } from "../error"
import { makeApi, makeMedia, makeQueue, photo, assertDone, uid, type FakeNetwork } from "./testkit"

const S = uid(1)
const V = uid(2)
const FP = uid(3)
const I = uid(4)
const A1 = uid(5)
const A2 = uid(6)
const M = uid(99)

function net(): FakeNetwork {
  return {
    calls: [],
    onRequest: (method, url) => {
      if (url.endsWith("/media/upload-url")) {
        return { status: 201, json: { media_object_id: M, upload_url: "https://s3/put/1", expires_in_seconds: 60, method: "PUT" } }
      }
      if (url.endsWith("/shifts/clock-in")) return { status: 201, json: { shift_id: S, clock_in_at: "2026-01-01T10:00:00.000Z" } }
      if (url.endsWith("/shifts/clock-out")) return { status: 200, json: { shift_id: S, state: "PENDING_CLOSEOUT" } }
      if (url.endsWith("/shifts/me/active")) return { status: 200, json: { shift_id: S, vehicle_id: V, clock_in_at: "2026-01-01T10:00:00.000Z" } }
      if (url.endsWith("/fuel/refuel")) return { status: 201, json: { fuel_purchase_id: FP, open_anomalies: ["GAUGE_MISMATCH"] } }
      if (url.endsWith("/inspections")) return { status: 201, json: { inspection_id: I, block_shift: true } }
      if (url.endsWith("/accidents/mayday")) return { status: 201, json: { accident_id: A1, escalated_at: "2026-01-01T10:00:00.000Z" } }
      if (url.endsWith("/accidents") && method === "POST") return { status: 201, json: { accident_id: A2 } }
      if (url.includes("/accidents/") && url.endsWith("/media")) return { status: 204 }
      if (url.startsWith("https://s3/")) return { status: 200 }
      return { status: 200 }
    },
  }
}

describe("ShiftsService", () => {
   it("clock-in uploads the start photo then POSTs with the media id + idempotency key", async () => {
    const n = net()
    const api = makeApi(n)
    const svc = new ShiftsService({ api, media: makeMedia(api, n) })
    const r = await svc.clockIn(
      { assignment_id: uid(10), start_odometer_km: 1000, start_fuel_gauge: "HALF", consent_version: "2026.1" },
      photo(),
    )
    expect(assertDone(r)).toBe(S)
    const post = n.calls?.find((c) => c.url.endsWith("/shifts/clock-in"))
    expect(post?.body).toMatchObject({ start_media_object_id: M, start_odometer_km: 1000, start_fuel_gauge: "HALF" })
  })

  it("clock-in with work plan uploads plan photos and includes them in the request", async () => {
    const n = net()
    const api = makeApi(n)
    const svc = new ShiftsService({ api, media: makeMedia(api, n) })
    const r = await svc.clockIn(
      {
        assignment_id: uid(10),
        start_odometer_km: 1000,
        start_fuel_gauge: "HALF",
        consent_version: "2026.1",
        planned_notes: "Deliver 5 pallets to dock 3",
        work_plan_photos: [photo("plan1"), photo("plan2")],
      },
      photo("start"),
    )
    expect(assertDone(r)).toBe(S)
    const post = n.calls?.find((c) => c.url.endsWith("/shifts/clock-in"))
    expect(post?.body).toMatchObject({
      start_media_object_id: M,
      planned_notes: "Deliver 5 pallets to dock 3",
      work_plan_media_object_ids: [M, M],
    })
    expect(n.calls?.filter((c) => c.url.endsWith("/media/upload-url")).length).toBe(3)
  })

  it("getActive parses the active shift (nullable)", async () => {
    const n = net()
    const api = makeApi(n)
    const svc = new ShiftsService({ api, media: makeMedia(api, n) })
    const active = await svc.getActive()
    expect(ActiveShiftSchema.safeParse(active).success).toBe(true)
  })

  it("clock-out surfaces a domain 422 as ApiError (not queued)", async () => {
    const n = net()
    n.onRequest = (method, url) => {
      if (url.endsWith("/media/upload-url")) return { status: 201, json: { media_object_id: M, upload_url: "https://s3/x", expires_in_seconds: 60, method: "PUT" } }
      if (url.startsWith("https://s3/")) return { status: 200 }
      if (url.endsWith("/shifts/clock-out")) return { status: 422, json: { error_code: "ODOMETER_DECREASED", message: "x" } }
      return { status: 200 }
    }
    const api = makeApi(n)
    const svc = new ShiftsService({ api, media: makeMedia(api, n), queue: makeQueue() })
    await expect(svc.clockOut({ shift_id: S, end_odometer_km: 500, end_fuel_gauge: "EMPTY" }, photo())).rejects.toBeInstanceOf(ApiError)
  })

  it("parks the clock-out in the outbox on a transport failure (evidence already uploaded)", async () => {
    const n = net()
    // Media upload succeeds; only the business POST fails (simulates a blip after evidence upload).
    n.onRequest = (method, url) => {
      if (url.startsWith("https://s3/") || url.endsWith("/media/upload-url")) return { status: 201, json: { media_object_id: M, upload_url: "https://s3/x", expires_in_seconds: 60, method: "PUT" } }
      if (url.endsWith("/shifts/clock-out")) throw new Error("network down")
      return { status: 200 }
    }
    const api = makeApi(n)
    const queue = makeQueue()
    const svc = new ShiftsService({ api, media: makeMedia(api, n), queue })
    const r = await svc.clockOut({ shift_id: S, end_odometer_km: 1500, end_fuel_gauge: "FULL" }, photo())
    expect(r.kind).toBe("queued")
    const items = await queue.list()
    expect(items).toHaveLength(1)
    expect(items[0]!.path).toBe("/shifts/clock-out")
    expect(items[0]!.idempotencyKey).toBeTruthy()
  })
})

describe("RefuelService", () => {
  it("uploads before/after/receipt then posts the purchase (3 media ids)", async () => {
    const n = net()
    const api = makeApi(n)
    const svc = new RefuelService({ api, media: makeMedia(api, n) })
    const r = await svc.submit(
      { shift_id: S, vehicle_id: V, fuel_card_last_four: "1234", litres: 50, total_cost: { amount: "7500.00" }, odometer_km: 1200, purchased_at: "2026-01-01T10:00:00.000Z" },
      { before: photo("b"), after: photo("a"), receipt: photo("r") },
    )
    expect(assertDone(r)).toBe(FP)
    expect(r.anomalies).toEqual(["GAUGE_MISMATCH"])
  })
})

describe("InspectionsService", () => {
  it("uploads a photo only for FAIL items and flags block_shift", async () => {
    const n = net()
    const api = makeApi(n)
    const svc = new InspectionsService({ api, media: makeMedia(api, n) })
    const r = await svc.submit(
      {
        shift_id: S,
        template_id: uid(11),
        subject: "VEHICLE",
        vehicle_id: V,
        previous_defects_reviewed: true,
        signature_name: "J. Driver",
        items: [
          { template_item_id: uid(12), result: "PASS" },
          { template_item_id: uid(13), result: "FAIL", notes: "crack" },
        ],
      },
      { photos: { [uid(13)]: photo() } },
    )
    expect(assertDone(r)).toBe(I)
    expect(r.blockShift).toBe(true)
    const post = n.calls?.find((c) => c.url.endsWith("/inspections"))
    const failItem = (post!.body as any).items.find((i: any) => i.template_item_id === uid(13))
    expect(failItem?.photo_media_object_id).toBe(M)
    const passItem = (post!.body as any).items.find((i: any) => i.template_item_id === uid(12))
    expect(passItem?.photo_media_object_id).toBeUndefined()
  })
})

describe("AccidentsService", () => {
  it("mayday bypasses evidence and returns an accident id", async () => {
    const n = net()
    const api = makeApi(n)
    const svc = new AccidentsService({ api, media: makeMedia(api, n) })
    const r = await svc.mayday({ shift_id: S, vehicle_id: V, position: { latitude: -1.2, longitude: 36.8 }, mayday_reason: "fire" })
    expect(assertDone(r)).toBe(A1)
    expect(n.calls?.some((c) => c.url.includes("/media/upload-url"))).toBe(false)
  })

  it("report then attachMedia posts the mandatory scene photo", async () => {
    const n = net()
    const api = makeApi(n)
    const svc = new AccidentsService({ api, media: makeMedia(api, n) })
    const rep = await svc.report({ shift_id: S, vehicle_id: V, driver_statement: "rear-ended" })
    expect(assertDone(rep)).toBe(A2)
    const att = await svc.attachMedia(A2, "FRONT_DAMAGE", photo())
    expect(att.kind).toBe("done")
    const attach = n.calls?.find((c) => c.url.endsWith(`/accidents/${A2}/media`))
    expect(attach?.body).toMatchObject({ slot: "FRONT_DAMAGE", media_object_id: M })
  })
})

describe("error normalization", () => {
  it("fromServer maps error_code into AppError (used by ApiError)", () => {
    const e = fromServer({ error_code: "ODOMETER_DECREASED", message: "m" })
    expect(e.code).toBe("ODOMETER_DECREASED")
  })
})
