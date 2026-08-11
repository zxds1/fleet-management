// packages/mobile/src/services.ts
//
// Composition root. Builds the core services (`ApiClient`, `Session`, `AuthFlow`, `OfflineQueue`,
// `Drainer`, `SocketClient`) from injected ports. The default ports are in-memory fakes so the app
// boots and is unit-testable without native modules; the React Native entry point passes real
// implementations (expo-secure-store, expo-sqlite, expo-local-authentication, socket.io-client,
// fetch) via `createServices({ ports })`.

import { ApiClient } from "./core/apiClient"
import { Session, type SecureStorePort, type BiometricPort } from "./core/session"
import { AuthFlow, type AuthFlowConfig } from "./core/auth/flow"
import { OfflineQueue } from "./core/offlineQueue"
import { createMemoryStore } from "./core/offlineQueue/store"
import { Drainer } from "./core/offlineQueue/drainer"
import { SocketClient, type SocketFactory } from "./core/socket"
import { socketIoFactory, resolveWsUrl } from "./socketFactory"
import type { QueueStore } from "./core/offlineQueue/types"
import { MediaService, type ReadBytesPort } from "./core/media"
import { Security, defaultSecurityConfig, type PinnedEndpoint } from "./core/security"
import { ShiftsService, RefuelService, InspectionsService, AccidentsService, VehicleIssueService, FeedService, OnboardingService, TrainingService } from "./core/driver"
import type { OnlinePredicate } from "./core/driver/types"
import { createAdminServices, type AdminServices } from "./core/admin"

export interface ServicePorts {
  baseUrl: string
  fetchImpl: typeof fetch
  secureStore: SecureStorePort
  biometric?: BiometricPort
  queueStore?: QueueStore
  /** Overrides the Socket.IO factory. Defaults to the real `socket.io-client` implementation;
   * pass `null` to run without a real-time backend (demo mode). */
  socketFactory?: SocketFactory | null
  wsUrl?: string
  readBytes?: ReadBytesPort
  online?: OnlinePredicate
  /** Certificate pins for SPKI verification (S-4). When provided, the ApiClient enforces
   * pin verification on every request. */
  certPins?: PinnedEndpoint[]
}

export interface Services {
  api: ApiClient
  session: Session
  flow: AuthFlow
  queue: OfflineQueue
  drainer: Drainer
  socket: SocketClient
  media: MediaService
  shifts: ShiftsService
  refuel: RefuelService
  inspections: InspectionsService
  accidents: AccidentsService
  /** Driver-reported vehicle defects (non-accident), spec `report_vehicle_issue`. */
  vehicleIssue: VehicleIssueService
  feed: FeedService
  onboarding: OnboardingService
  training: TrainingService
  admin: AdminServices
}

const DEFAULT_CONSENT_VERSION = "2026.1"

export function createServices(ports: ServicePorts, flowConfig?: Partial<AuthFlowConfig>): Services {
  // Declared before `api` because the token getter closes over it; `session` is assigned just
  // below. The getter is safe because `session` is always set before any request is made.
  let session: Session

  const security = new Security({
    integrity: { isRooted: () => false, isTampered: () => false },
    config: defaultSecurityConfig(ports.certPins ?? []),
  })

  const api = new ApiClient({
    baseUrl: ports.baseUrl,
    fetchImpl: ports.fetchImpl,
    getToken: () => session?.token,
    security: ports.certPins && ports.certPins.length > 0 ? security : undefined,
  })

  session = new Session(api, ports.secureStore, {
    biometric: ports.biometric,
  })

  const flow = new AuthFlow(session, { consentVersion: DEFAULT_CONSENT_VERSION, ...flowConfig })
  const queue = new OfflineQueue(ports.queueStore ?? createMemoryStore())
  const drainer = new Drainer({ queue, api, isOnline: () => true })
  const socket = new SocketClient({
    url: resolveWsUrl(ports.wsUrl, ports.baseUrl),
    getToken: () => session.token,
    factory: ports.socketFactory === null ? undefined : (ports.socketFactory ?? socketIoFactory),
  })

  const media = new MediaService({
    api,
    fetchImpl: ports.fetchImpl,
    readBytes: ports.readBytes ?? { async read() { return new Uint8Array() } },
    online: ports.online ?? (() => true),
  })
  const driverDeps = { api, media, queue, online: ports.online ?? (() => true) }
  const shifts = new ShiftsService(driverDeps)
  const refuel = new RefuelService(driverDeps)
  const inspections = new InspectionsService(driverDeps)
  const accidents = new AccidentsService(driverDeps)
  const vehicleIssue = new VehicleIssueService(driverDeps)
  const feed = new FeedService(api, socket)
  const onboarding = new OnboardingService(api)
  const training = new TrainingService(api)
  const admin = createAdminServices(api, socket)

  return { api, session, flow, queue, drainer, socket, media, shifts, refuel, inspections, accidents, vehicleIssue, feed, onboarding, training, admin }
}

/** In-memory secure store for tests / boot without native deps. */
export function createMemorySecureStore(initial: Record<string, string> = {}): SecureStorePort {
  const m = new Map(Object.entries(initial))
  return {
    async get(k) {
      return m.get(k)
    },
    async set(k, v) {
      m.set(k, v)
    },
    async delete(k) {
      m.delete(k)
    },
  }
}
