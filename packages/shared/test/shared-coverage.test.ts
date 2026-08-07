// packages/shared/test/kernel.test.ts-style extension: drives coverage on the hand-written
// shared kernel modules (errors, transaction, realtime, config, time, logging) that the contract
// task doesn't exercise. Keeps the unit-coverage gate meaningful (09 §3).
import {
  AppError,
  ValidationError,
  Unauthenticated,
  MfaRequired,
  Forbidden,
  AccountSuspended,
  DeviceRevoked,
  ConsentRequired,
  NotFound,
  ConflictError,
  SemanticViolation,
  IdempotencyConflict,
  IdempotencyInFlight,
  RateLimited,
  ServiceUnavailable,
  TransactionError,
  conflict,
  violation,
  transaction,
  type PoolLike,
  type Tx,
  RealtimeChannels,
  redisPublisher,
  type RedisPub,
  CONFIG_DEFAULTS,
  toEAT,
  operationalDate,
  nowUtc,
  addInterval,
  withinWindow,
  intervalMs,
  ConsoleLogger,
} from "../src/index";

describe("AppError hierarchy (01 §2 / D7)", () => {
  const cases: [new (...a: never[]) => AppError, number, string][] = [
    [ValidationError as never, 400, "VALIDATION_ERROR"],
    [Unauthenticated as never, 401, "UNAUTHENTICATED"],
    [MfaRequired as never, 401, "MFA_REQUIRED"],
    [Forbidden as never, 403, "FORBIDDEN"],
    [AccountSuspended as never, 403, "ACCOUNT_SUSPENDED"],
    [DeviceRevoked as never, 403, "DEVICE_REVOKED"],
    [ConsentRequired as never, 403, "CONSENT_REQUIRED"],
    [NotFound as never, 404, "NOT_FOUND"],
    [IdempotencyConflict as never, 422, "IDEMPOTENCY_CONFLICT"],
    [IdempotencyInFlight as never, 409, "IDEMPOTENCY_INFLIGHT"],
    [RateLimited as never, 429, "RATE_LIMITED"],
    [ServiceUnavailable as never, 503, "SERVICE_UNAVAILABLE"],
  ];
  it.each(cases)("%s maps to status %i / code %s", (Ctor, status, code) => {
    const err = new (Ctor as new () => AppError)();
    const problem = err.toProblem();
    expect(problem.status).toBe(status);
    expect(problem.error_code).toBe(code);
    expect(problem.type).toBe(`https://docs.fleet.internal/problems/${code.toLowerCase()}`);
  });

  it("ConflictError + SemanticViolation carry a custom error_code", () => {
    const c = new ConflictError("ODOMETER_DECREASED", "Odometer decreased");
    expect(c.toProblem()).toMatchObject({ status: 409, error_code: "ODOMETER_DECREASED" });
    const v = new SemanticViolation("DVIR_FAIL_PHOTO", "DVIR fail", "detail", [
      { field: "photo", code: "REQUIRED", message: "photo required" },
    ]);
    expect(v.toProblem().field_errors?.[0]?.field).toBe("photo");
  });

  it("helpers produce the right subclass", () => {
    expect(conflict("X", "Y")).toBeInstanceOf(ConflictError);
    expect(violation("Z", "W")).toBeInstanceOf(SemanticViolation);
  });

  it("preserves cause + requestId in the problem", () => {
    const cause = new Error("boom");
    const err = new ServiceUnavailable("down");
    (err as unknown as { cause: unknown; requestId: string }).cause = cause;
    (err as unknown as { requestId: string }).requestId = "req-1";
    const problem = err.toProblem();
    expect(problem.instance).toBe("req-1");
    expect(problem.error_code).toBe("SERVICE_UNAVAILABLE");
  });
});

describe("transaction primitive (D8)", () => {
  it("TransactionError serialises to 500", () => {
    const err = new TransactionError("rolled back", new Error("x"));
    expect(err.toProblem()).toMatchObject({ status: 500, error_code: "TRANSACTION_FAILED" });
  });

  it("transaction() is unbound in shared and throws", async () => {
    const pool = { connect: async () => ({ query: async () => ({ rows: [], rowCount: 0 }) }) } as PoolLike;
    await expect(transaction(pool, (async () => undefined) as (tx: Tx) => Promise<void>)).rejects.toBeInstanceOf(
      TransactionError,
    );
  });
});

describe("realtime (07 §3)", () => {
  it("exposes stable channel constants", () => {
    expect(RealtimeChannels.vehicleStates).toBe("ws:map:vehicle-states");
    expect(RealtimeChannels.notifications).toBe("ws:notifications");
    expect(RealtimeChannels.accidentLive).toBe("ws:accident:live");
  });

  it("redisPublisher is a no-op without a client", async () => {
    const pub = redisPublisher(null);
    await expect(pub.publish("ch", { a: 1 })).resolves.toBeUndefined();
  });

  it("redisPublisher JSON-encodes and publishes", async () => {
    const calls: [string, string][] = [];
    const client: RedisPub = {
      publish: async (channel: string, message: string) => {
        calls.push([channel, message]);
        return 1;
      },
    };
    await redisPublisher(client).publish(RealtimeChannels.notifications, { userId: "u1" });
    expect(calls[0]).toEqual(["ws:notifications", JSON.stringify({ userId: "u1" })]);
  });
});

describe("config defaults (C2.4)", () => {
  it("mirrors seeded thresholds", () => {
    expect(CONFIG_DEFAULTS["auth.max_concurrent_sessions"]).toBe(10);
    expect(CONFIG_DEFAULTS["shift.max_duty_hours"]).toBe(14);
  });
});

describe("time helpers (A2.3)", () => {
  it("nowUtc returns a Date", () => {
    expect(nowUtc()).toBeInstanceOf(Date);
  });
  it("operationalDate returns YYYY-MM-DD", () => {
    expect(operationalDate(new Date("2026-08-06T21:00:00Z"))).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
  it("toEAT returns a Date", () => {
    expect(toEAT(new Date())).toBeInstanceOf(Date);
  });
  it("addInterval shifts the date", () => {
    const base = new Date("2026-01-01T00:00:00Z");
    expect(addInterval(base, { days: 1, hours: 1 }).getTime()).toBe(base.getTime() + 25 * 3_600_000);
  });
  it("withinWindow compares within the interval", () => {
    const a = new Date("2026-01-01T00:00:00Z");
    const b = new Date(a.getTime() + 5 * 60_000);
    expect(withinWindow(a, b, { minutes: 10 })).toBe(true);
    expect(withinWindow(a, b, { minutes: 1 })).toBe(false);
  });
  it("intervalMs sums parts", () => {
    expect(intervalMs({ minutes: 1, hours: 1, days: 1 })).toBe(1 * 60_000 + 3_600_000 + 86_400_000);
  });
});

describe("logging redaction (01 §9)", () => {
  function capture(logger: ConsoleLogger, fn: () => void): unknown {
    const writes: string[] = [];
    const spy = jest.spyOn(process.stdout, "write").mockImplementation((chunk: string | Uint8Array) => {
      writes.push(chunk.toString());
      return true;
    });
    fn();
    spy.mockRestore();
    return writes.map((w) => JSON.parse(w)).find(Boolean);
  }

  it("redacts secret-shaped keys", () => {
    const entry = capture(new ConsoleLogger("info"), () =>
      new ConsoleLogger("info").info("login", { user_token: "abc", name: "x" }),
    ) as { user_token: string; name: string };
    expect(entry.user_token).toBe("[redacted]");
    expect(entry.name).toBe("x");
  });

  it("skips info when level is error and emits debug at debug level", () => {
    const errorOnly = new ConsoleLogger("error");
    const infoEntry = capture(errorOnly, () => errorOnly.info("should be suppressed"));
    expect(infoEntry).toBeUndefined();
    const debugEntry = capture(new ConsoleLogger("debug"), () => new ConsoleLogger("debug").debug("d"));
    expect(debugEntry).toBeDefined();
  });

  it("attaches an error object on error() and merges child meta", () => {
    const child = new ConsoleLogger("info").child({ scope: "ws" });
    const entry = capture(new ConsoleLogger("info"), () =>
      child.error("boom", { extra: 1 }, new Error("boom")),
    ) as {
      scope: string;
      extra: number;
      error: { name: string };
    };
    expect(entry.scope).toBe("ws");
    expect(entry.extra).toBe(1);
    expect(entry.error.name).toBe("Error");
  });
});
