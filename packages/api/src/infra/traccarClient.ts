// packages/api/src/infra/traccarClient.ts
// Minimal Traccar REST client used by the hardware-provisioning path (A1.1).
//
// Failure model:
//  - network timeout / DNS failure -> transient, caller should surface "try again"
//  - 4xx from Traccar -> permanent (bad IMEI, duplicate, bad auth), do not retry
//  - 5xx from Traccar -> transient, caller may retry once
//
// The client is intentionally thin: it does NOT cache state or retry internally.
// Retry/backoff is the caller's responsibility.

const DEFAULT_TIMEOUT_MS = 8_000;

function basicAuth(username: string, password: string): string {
  return `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}`;
}

export interface TraccarDeviceInput {
  name: string; // IMEI is the stable unique identifier
  uniqueId: string; // the IMEI itself
  phoneNumber?: string | null;
  model?: string | null;
  manufacturer?: string | null;
}

export interface TraccarDevice {
  id: number;
  uniqueId: string;
  name: string;
}

export class TraccarClient {
  constructor(
    private readonly baseUrl: string,
    private readonly username: string,
    private readonly password: string,
    private readonly timeoutMs = DEFAULT_TIMEOUT_MS,
  ) {}

  async createDevice(input: TraccarDeviceInput): Promise<TraccarDevice> {
    const url = `${this.baseUrl.replace(/\/$/, "")}/api/devices`;
    const body = JSON.stringify({
      name: input.uniqueId,
      uniqueId: input.uniqueId,
      phoneNumber: input.phoneNumber ?? "",
      model: input.model ?? "",
      manufacturer: input.manufacturer ?? "",
    });
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: basicAuth(this.username, this.password),
        },
        body,
        signal: controller.signal,
      });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(`Traccar createDevice failed ${res.status}: ${text}`);
      }
      return await res.json();
    } finally {
      clearTimeout(timer);
    }
  }

  async getDevice(uniqueId: string): Promise<TraccarDevice | null> {
    const url = `${this.baseUrl.replace(/\/$/, "")}/api/devices?uniqueId=${encodeURIComponent(uniqueId)}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const res = await fetch(url, {
        headers: {
          authorization: basicAuth(this.username, this.password),
        },
        signal: controller.signal,
      });
      if (!res.ok) return null;
      const list = (await res.json()) as TraccarDevice[];
      return list.find((d) => d.uniqueId === uniqueId) ?? null;
    } finally {
      clearTimeout(timer);
    }
  }
}
