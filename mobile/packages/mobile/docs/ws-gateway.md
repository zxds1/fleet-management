# What `packages/ws` must provide for this app

A tested reference implementation is in `packages/ws/src/gateway.ts` (8 tests over real sockets: ACL, snapshot, per-user notifications, 10-session cap, kick on revoke).
It was written without access to your gateway repo, so merge it in by supplying the three hooks (`verify`, `scopeFor`, `snapshot`) and calling `publish()` from your event source.

1. **Auth**: accept `auth: { token }` on the Socket.IO handshake (the app sends a freshly refreshed JWT on every reconnect). Reject expired/revoked sessions.
2. **Subscribe**: client emits `subscribe` with a channel name; server ACLs it. Drivers may only join `driver:shift:{theirShift}`, `driver:vehicle:{theirVehicle}`,
   `driver:accident:{theirUserId}` and `notifications`. Admins may join `map:vehicle-states`, `accident:live`, `notifications`. Anything else is refused.
3. **Events**: emit on the channel name itself (payloads are only a hint; the app invalidates and refetches over REST).
4. **Snapshot**: after every (re)connect and subscribe, emit `snapshot` with `{ vehicle_state?, shift? }` for the subscribed channels.
5. **10-session cap** per user: when an 11th connects, drop the oldest.
6. The app reads `sub` from the access token as the user id for `driver:accident:{userId}`.
