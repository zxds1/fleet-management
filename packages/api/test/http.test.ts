// packages/api/test/http.test.ts
// Unit tests for the thin HTTP edge: authn/authz middleware, idempotency guard, zod validation,
// cursor pagination, the RFC7807 problem handler, request correlation, and the write-path subject
// resolver. These are pure/dependency-injected so they run without a live PG/Redis.

import { Unauthenticated, Forbidden, ValidationError, ServiceUnavailable, NotFound, type PermissionCode, type Principal } from "@fleet/shared";
import { authenticate, principalOf } from "../src/middleware/authenticate";
import { requirePermission, requireSelfOrPermission } from "../src/middleware/requirePermission";
import { idempotency, routeKey } from "../src/middleware/idempotency";
import { parseBody, parseQuery, parseParams } from "../src/http/validate";
import { encodeCursor, decodeCursor, buildPage, resolveSortColumn } from "../src/http/pagination";
import { problemHandler, toAppError } from "../src/http/problem";
import { requestContext } from "../src/http/requestContext";
import { writeSubject } from "../src/http/write";
import { z } from "zod";

function makeRes() {
  const res: any = {
    statusCode: 0,
    body: undefined as unknown,
    status(c: number) {
      this.statusCode = c;
      return this;
    },
    json(b: unknown) {
      this.body = b;
      return this;
    },
    type() {
      return this;
    },
    setHeader() {
      return this;
    },
    end() {
      return this;
    },
  };
  return res;
}

const claims = {
  sub: "u1",
  email: "a@b.c",
  roles: ["ADMIN" as const],
  permissions: ["fuel:verify" as PermissionCode],
  sid: "s1",
  locale: "en" as const,
};

describe("authenticate middleware", () => {
  it("rejects a missing bearer token", (done) => {
    const req: any = { header: () => "" };
    authenticate({ tokens: { verifyAccessToken: () => claims } as any, sessions: { available: false } as any })(
      req,
      makeRes(),
      (err: unknown) => {
        expect(err).toBeInstanceOf(Unauthenticated);
        done();
      },
    );
  });

  it("attaches the principal on a valid token", (done) => {
    const req: any = { header: () => "Bearer tok", principal: undefined };
    authenticate({ tokens: { verifyAccessToken: () => claims } as any, sessions: { available: false } as any })(
      req,
      makeRes(),
      (err: unknown) => {
        expect(err).toBeUndefined();
        expect(req.principal.userId).toBe("u1");
        done();
      },
    );
  });

  it("rejects a revoked session when Redis is healthy", (done) => {
    const req: any = { header: () => "Bearer tok" };
    authenticate({
      tokens: { verifyAccessToken: () => claims } as any,
      sessions: { available: true, has: async () => false } as any,
    })(req, makeRes(), (err: unknown) => {
      expect(err).toBeInstanceOf(Unauthenticated);
      done();
    });
  });

  it("principalOf throws when unauthenticated", () => {
    expect(() => principalOf({} as any)).toThrow(Unauthenticated);
  });
});

describe("requirePermission middleware", () => {
  const principal: Principal = { userId: "u1", email: "a@b.c", tenantId: "00000000-0000-0000-0000-000000000001", roles: [], permissions: new Set<PermissionCode>(["fuel:verify"]), locale: "en" };

  it("passes when a required permission is held", (done) => {
    const req: any = { principal };
    requirePermission("fuel:verify")(req, makeRes(), (err: unknown) => {
      expect(err).toBeUndefined();
      done();
    });
  });

  it("403 when no required permission is held", (done) => {
    const req: any = { principal };
    requirePermission("asset:create")(req, makeRes(), (err: unknown) => {
      expect(err).toBeInstanceOf(Forbidden);
      done();
    });
  });

  it("self-or-permission allows the owner", (done) => {
    const req: any = { principal, params: { userId: "u1" } };
    requireSelfOrPermission("userId", "asset:create")(req, makeRes(), (err: unknown) => {
      expect(err).toBeUndefined();
      done();
    });
  });

  it("self-or-permission 403 for another user without the permission", (done) => {
    const req: any = { principal, params: { userId: "other" } };
    requireSelfOrPermission("userId", "asset:create")(req, makeRes(), (err: unknown) => {
      expect(err).toBeInstanceOf(Forbidden);
      done();
    });
  });
});

describe("idempotency middleware", () => {
  it("rejects a missing/invalid key", (done) => {
    const req: any = { header: () => undefined, method: "POST", baseUrl: "/api/v1", path: "/x", route: { path: "/x" } };
    idempotency({ idempotency: { start: async () => ({ status: "NEW" }) } as any })(
      req,
      makeRes(),
      (err: unknown) => {
        expect(err).toBeInstanceOf(ValidationError);
        done();
      },
    );
  });

  it("proceeds on a NEW claim and records request metadata", (done) => {
    const req: any = {
      header: () => "11111111-1111-4111-8111-111111111111",
      method: "POST",
      baseUrl: "/api/v1",
      path: "/shifts",
      route: { path: "/shifts" },
      body: { a: 1 },
      principal: { userId: "u1" },
    };
    idempotency({ idempotency: { start: async () => ({ status: "NEW" }) } as any })(
      req,
      makeRes(),
      (err: unknown) => {
        expect(err).toBeUndefined();
        expect(req.idempotency.key).toBe("11111111-1111-4111-8111-111111111111");
        expect(routeKey(req)).toBe("POST /api/v1/shifts");
        done();
      },
    );
  });

  it("short-circuits on a REPLAY with the cached response", async () => {
    const req: any = {
      header: () => "22222222-2222-4222-8222-222222222222",
      method: "POST",
      baseUrl: "/api/v1",
      path: "/shifts",
      route: { path: "/shifts" },
      body: {},
      principal: { userId: "u1" },
    };
    const res = makeRes();
    await idempotency({
      idempotency: { start: async () => ({ status: "REPLAY", response: { httpStatus: 200, body: { id: "x" } } }) } as any,
    })(req, res, () => undefined);
    expect(res.statusCode).toBe(200);
    expect((res.body as { id: string }).id).toBe("x");
  });
});

describe("validation helpers", () => {
  const S = z.object({ n: z.number() });
  it("parseBody throws ValidationError on bad input", () => {
    expect(() => parseBody(S, { body: { n: "x" } } as any)).toThrow(ValidationError);
  });
  it("parseQuery / parseParams succeed on valid input", () => {
    expect(parseQuery(S, { query: { n: 1 } } as any).n).toBe(1);
    expect(parseParams(S, { params: { n: 2 } } as any).n).toBe(2);
  });
});

describe("cursor pagination", () => {
  it("round-trips an opaque cursor", () => {
    const c = encodeCursor({ sort: "2026", id: "abc" });
    expect(decodeCursor(c)).toEqual({ sort: "2026", id: "abc" });
  });
  it("rejects a malformed cursor", () => {
    expect(() => decodeCursor("not-base64!!")).toThrow(ValidationError);
  });
  it("buildPage sets has_more and next_cursor only when over limit", () => {
    const rows = [1, 2, 3];
    const page = buildPage(rows, 2, (r: number) => ({ sort: String(r), id: String(r) }));
    expect(page.has_more).toBe(true);
    expect(page.data).toEqual([1, 2]);
    expect(page.next_cursor).not.toBeNull();
    const full = buildPage([1], 2, (r: number) => ({ sort: String(r), id: String(r) }));
    expect(full.has_more).toBe(false);
    expect(full.next_cursor).toBeNull();
  });
  it("resolveSortColumn enforces the allow-list", () => {
    const allow = { created: "created_at", name: "name" } as const;
    expect(resolveSortColumn(allow, "name", "created")).toBe("name");
    expect(resolveSortColumn(allow, undefined, "created")).toBe("created_at");
    expect(() => resolveSortColumn(allow, "evil", "created")).toThrow(ValidationError);
  });
});

describe("problem handler", () => {
  it("maps transport errors to 503 and serialises RFC7807", () => {
    const transport = new Error("connect ECONNREFUSED");
    (transport as NodeJS.ErrnoException).code = "ECONNREFUSED";
    expect(toAppError(transport).error_code).toBe("SERVICE_UNAVAILABLE");
  });
  it("passes AppError through and wraps plain errors as TransactionError", () => {
    expect(toAppError(new NotFound()).error_code).toBe("NOT_FOUND");
    expect(toAppError(new Error("x")).error_code).toBe("TRANSACTION_FAILED");
  });
  it("serialises an AppError as problem+json with the requestId instance", () => {
    const req: any = { method: "POST", path: "/x", requestId: "r1", principal: { userId: "u1" } };
    const res = makeRes();
    problemHandler()(new ServiceUnavailable("down"), req, res, () => undefined);
    expect(res.statusCode).toBe(503);
    expect((res.body as { error_code: string }).error_code).toBe("SERVICE_UNAVAILABLE");
    expect((res.body as { instance: string }).instance).toBe("r1");
  });
});

describe("requestContext", () => {
  it("echoes an inbound request id or mints a UUID", (done) => {
    const req: any = { header: () => "11111111-1111-4111-8111-111111111111", requestId: "", headers: {} };
    const res: any = { setHeader: (k: string, v: string) => (req.headers[k] = v) };
    requestContext()(req, res, () => {
      expect(req.requestId).toBe("11111111-1111-4111-8111-111111111111");
      expect(req.headers["x-request-id"]).toBe(req.requestId);
      done();
    });
  });
});

describe("writeSubject", () => {
  it("prefers the principal userId, then email, then ip", () => {
    expect(writeSubject({ principal: { userId: "u1" } } as any)).toBe("u1");
    expect(writeSubject({ body: { email: "a@b.c" } } as any)).toBe("a@b.c");
    expect(writeSubject({ ip: "1.2.3.4" } as any)).toBe("1.2.3.4");
  });
});
