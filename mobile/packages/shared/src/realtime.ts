/**
 * Real-time contract, mirrored from `fleet-management/packages/shared/src/realtime.ts` and
 * `packages/ws/src/gateway.ts`.
 *
 * The gateway does NOT accept client-supplied channel names: it decides rooms from the verified
 * Principal (`packages/ws/src/gateway.ts` `handleConnection`) and pushes events. So the app listens
 * for EVENT names and never emits a `subscribe`. Room names are server-internal.
 */

export const RealtimeChannels = {
  /** Redis topic that triggers a vehicle display-state recompute + diff. */
  vehicleStates: 'ws:map:vehicle-states',
  /** A freshly-created notification for its recipient. */
  notifications: 'ws:notifications',
  /** Live accident events for the on-call roster. */
  accidentLive: 'ws:accident:live',
  /** Driver-scoped shift events (clock-in/out accepted, HOS changes, close-out required). */
  driverShift: 'ws:driver:shift',
  /** Driver-scoped vehicle display-state for the driver's own assignment. */
  driverVehicle: 'ws:driver:vehicle',
  /** Driver-scoped accident events on their own report. */
  driverAccident: 'ws:driver:accident',
} as const;
export type RealtimeChannel = (typeof RealtimeChannels)[keyof typeof RealtimeChannels];

/** The unprefixed event names the gateway actually emits over Socket.IO (07 §3). */
export const RealtimeEvents = {
  vehicleStates: 'map:vehicle-states',
  notifications: 'notifications',
  accidentLive: 'accident:live',
  driverShift: 'driver:shift',
  driverVehicle: 'driver:vehicle',
  driverAccident: 'driver:accident',
} as const;
export type RealtimeEvent = (typeof RealtimeEvents)[keyof typeof RealtimeEvents];

/** Maps a `ws:`-prefixed Redis topic to the emitted event name. */
export const EVENT_FOR_CHANNEL: Readonly<Record<string, RealtimeEvent>> = {
  [RealtimeChannels.vehicleStates]: RealtimeEvents.vehicleStates,
  [RealtimeChannels.notifications]: RealtimeEvents.notifications,
  [RealtimeChannels.accidentLive]: RealtimeEvents.accidentLive,
  [RealtimeChannels.driverShift]: RealtimeEvents.driverShift,
  [RealtimeChannels.driverVehicle]: RealtimeEvents.driverVehicle,
  [RealtimeChannels.driverAccident]: RealtimeEvents.driverAccident,
};

export const ALL_REALTIME_EVENTS = Object.values(RealtimeEvents);