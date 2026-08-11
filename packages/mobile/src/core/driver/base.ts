// packages/mobile/src/core/driver/base.ts
//
// Shared plumbing for driver journey services. Each journey (shifts/refuel/inspections/accidents)
// follows the same pattern: try the online path, and if the network call fails *after* any required
// evidence was already uploaded, park the business request in the offline outbox (idempotent replay,
// C5.1) so the Drainer can flush it later. Pure over injected ports.

import { ApiClient, ApiError } from "../apiClient"
import { MediaService } from "../media"
import { OfflineQueue } from "../offlineQueue"
import { NetworkOfflineError, type OnlinePredicate, type SubmitResult } from "./types"

export interface DriverServiceDeps {
  api: ApiClient
  media: MediaService
  /** Offline outbox; when omitted, transport failures surface to the caller instead of queuing. */
  queue?: OfflineQueue
  online?: OnlinePredicate
}

export abstract class DriverService {
  protected readonly api: ApiClient
  protected readonly media: MediaService
  protected readonly queue?: OfflineQueue
  protected readonly online: OnlinePredicate

  constructor(deps: DriverServiceDeps) {
    this.api = deps.api
    this.media = deps.media
    this.queue = deps.queue
    this.online = deps.online ?? (() => true)
  }

  /**
   * Commit a business request online. On a transport failure (not a domain 4xx/5xx), park it in the
   * outbox when a queue is wired; otherwise rethrow. Evidence photos are uploaded by the caller
   * *before* this runs, so a queued item already carries valid `media_object_id`s.
   */
  protected async commit(
    method: "POST" | "PUT" | "PATCH",
    path: string,
    body: unknown,
    label: string,
  ): Promise<{ done?: unknown; queued?: string }> {
    if (this.online() === false) {
      return this.park(method, path, body, label)
    }
    try {
      const res = await this.api.request(path, { method, body })
      return { done: res }
    } catch (e) {
      if (e instanceof ApiError) throw e
      return this.park(method, path, body, label)
    }
  }

  private async park(
    method: "POST" | "PUT" | "PATCH",
    path: string,
    body: unknown,
    label: string,
  ): Promise<{ done?: unknown; queued?: string }> {
    if (!this.queue) {
      // No outbox configured — surface as offline so the UI can decide.
      throw new NetworkOfflineError()
    }
    const item = await this.queue.enqueue({ method, path, body, label })
    return { queued: item.id }
  }

  protected toResult(id: string, r: { done?: unknown; queued?: string }): SubmitResult {
    return r.queued ? { kind: "queued", id: r.queued } : { kind: "done", id }
  }
}
