// packages/ws/test/realtime.test.ts
// Proves the real-time publishing contract the producers (worker/api) rely on: the shared
// channel names match what the gateway subscribes to, and redisPublisher is null-safe / correct.
import { redisPublisher, RealtimeChannels, type RedisPub } from "@fleet/shared";

describe("real-time producer contract", () => {
  it("exposes the channel names the gateway subscribes to", () => {
    expect(RealtimeChannels.vehicleStates).toBe("ws:map:vehicle-states");
    expect(RealtimeChannels.notifications).toBe("ws:notifications");
    expect(RealtimeChannels.accidentLive).toBe("ws:accident:live");
  });

  it("is a no-op when Redis is absent (gateway falls back to its snapshot)", async () => {
    const pub = redisPublisher(null);
    await expect(pub.publish(RealtimeChannels.vehicleStates, {})).resolves.toBeUndefined();
  });

  it("publishes a JSON payload to the Redis client", async () => {
    const publish = jest.fn(async () => 1) as unknown as RedisPub["publish"];
    const client: RedisPub = { publish };
    const pub = redisPublisher(client);
    const payload = { userId: "u1", notification: { id: "n1" } };
    await pub.publish(RealtimeChannels.notifications, payload);

    expect(publish).toHaveBeenCalledTimes(1);
    expect(publish).toHaveBeenCalledWith(RealtimeChannels.notifications, JSON.stringify(payload));
  });

  it("passes a string payload through untouched", async () => {
    const publish = jest.fn(async () => 1) as unknown as RedisPub["publish"];
    const pub = redisPublisher({ publish });
    await pub.publish(RealtimeChannels.accidentLive, "raw");
    expect(publish).toHaveBeenCalledWith(RealtimeChannels.accidentLive, "raw");
  });
});
