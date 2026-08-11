// packages/mobile/src/core/driver/types.ts
//
// Shared types for driver journeys. Pure; no React / native.

/** Evidence photo captured by the camera module (already resized/compressed/EXIF-stripped). */
export interface EvidencePhoto {
  uri: string
  width: number
  height: number
  /** Bytes. */
  size: number
  /** ISO-8601 capture time. */
  createdAt: string
}

/** Raised when a network operation cannot complete because the device is offline. */
export class NetworkOfflineError extends Error {
  constructor(message = "device offline") {
    super(message)
    this.name = "NetworkOfflineError"
  }
}

/** Result of a driver submission: either committed online or parked in the offline outbox. */
export type SubmitResult =
  | { kind: "done"; id: string }
  | { kind: "queued"; id: string }

/** Injected predicate the services consult before attempting a network call. */
export type OnlinePredicate = () => boolean
