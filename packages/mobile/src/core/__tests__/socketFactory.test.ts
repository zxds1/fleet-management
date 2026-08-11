// packages/mobile/src/core/__tests__/socketFactory.test.ts
// The composition root's ws URL resolution. `socketIoFactory` itself is not exercised here because
// instantiating socket.io-client would open a real transport; it is covered by the SocketClient
// contract tests via the injected fake.
import { resolveWsUrl, DEFAULT_WS_URL } from "../../socketFactory"

describe("resolveWsUrl", () => {
  it("prefers an explicit EXPO_PUBLIC_WS_URL", () => {
    expect(resolveWsUrl("ws://gateway:4001", "http://api:4000/api/v1")).toBe("ws://gateway:4001")
  })

  it("derives the gateway origin from the API base url", () => {
    expect(resolveWsUrl(undefined, "http://localhost:4000/api/v1")).toBe("ws://localhost:4000")
  })

  it("upgrades to wss when the API is served over https", () => {
    expect(resolveWsUrl(undefined, "https://fleet.example.com/api/v1")).toBe("wss://fleet.example.com")
  })

  it("falls back to the documented default when nothing is configured", () => {
    expect(resolveWsUrl()).toBe(DEFAULT_WS_URL)
    expect(resolveWsUrl(undefined, "not-a-url")).toBe(DEFAULT_WS_URL)
  })
})
