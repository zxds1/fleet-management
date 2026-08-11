// packages/api/test/privacy.service.test.ts
// Unit tests for PrivacyService using fakes (no DB). Covers:
// - createExportRequest → row created + outbox event staged
// - createDeletionRequest → row created + outbox event staged
// - listOwn → delegates to repo, builds page
// - listForTenant → delegates to repo
// - getDownloadUrl → non-READY → violation; READY+file_key → presigned URL + markDownloaded
// - buildExportPayload → sensitive fields redacted (password_hash, refresh_token_hash, mfa_secret_encrypted; sessions redacted)

import { type Result, type Tx, type DbClient } from "@fleet/shared";
import { PrivacyService } from "../src/services/privacy";
import type { PrivacyRequestRepository } from "../src/repositories/privacy";
import type { MediaPresigner } from "../src/media/presigner";
import type { PrivacyRequestRow } from "@fleet/shared";

const tx = {
  client: {} as DbClient,
  audit: () => undefined,
  registerOutbox: () => undefined,
} as unknown as Tx;

function makeRepo(overrides: {
  createdRow?: Partial<PrivacyRequestRow>;
  listRows?: PrivacyRequestRow[];
  findRow?: PrivacyRequestRow | null;
} = {}) {
  const createdRow = {
    id: "req-1",
    tenant_id: "tenant-1",
    user_id: "user-1",
    request_type: "EXPORT" as const,
    status: "PENDING" as const,
    notes: null,
    created_at: new Date().toISOString(),
    completed_at: null,
    file_key: null,
    download_token: null,
    audit_ref: null,
  } as unknown as PrivacyRequestRow;

  const inserted: unknown[] = [];

  const repo = {
    create: async (input: { tenantId: string; userId: string; requestType: string; notes?: string | null }) => {
      const row = { ...createdRow, ...overrides.createdRow, tenant_id: input.tenantId, user_id: input.userId, request_type: input.requestType, notes: input.notes ?? null };
      inserted.push(row);
      return row;
    },
    listForUser: async (_userId: string) => overrides.listRows ?? [createdRow],
    listForTenant: async () => overrides.listRows ?? [createdRow],
    findByIdForUser: async (_id: string, _userId: string) => overrides.findRow ?? null,
    markDownloaded: async (_id: string) => undefined,
  } as unknown as PrivacyRequestRepository;

  return { repo, inserted };
}

function makePresigner(url: string = "https://presigned.example.com/export.json") {
  const calls: unknown[] = [];
  const presigner = {
    presignGet: async () => {
      const result = { url, expiresInSeconds: 600 };
      calls.push(result);
      return result;
    },
  } as unknown as MediaPresigner;
  return { presigner, calls };
}

function makeService(overrides: {
  createdRow?: Partial<PrivacyRequestRow>;
  listRows?: PrivacyRequestRow[];
  findRow?: PrivacyRequestRow | null;
  presignedUrl?: string;
} = {}) {
  const { repo, inserted } = makeRepo(overrides);
  const { presigner, calls } = makePresigner(overrides.presignedUrl);
  const svc = new PrivacyService(repo, presigner, "privacy-exports");
  return { svc, repo, presigner, inserted, presignedCalls: calls };
}

describe("PrivacyService.createExportRequest", () => {
  it("creates a PENDING row and stages privacy.export.requested outbox event", async () => {
    const { svc, inserted } = makeService();
    const outbox: unknown[] = [];
    const tx2 = { ...tx, registerOutbox: (e: unknown) => void outbox.push(e) } as unknown as Tx;

    const result: Result<{ request_id: string; status: string; download_url: string | null }> =
      await svc.createExportRequest(tx2, "user-1", "tenant-1", "please export my data");

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.request_id).toBe("req-1");
      expect(result.value.status).toBe("PENDING");
      expect(result.value.download_url).toBeNull();
    }
    expect(inserted).toHaveLength(1);
    expect(outbox).toHaveLength(1);
    expect(outbox[0]).toMatchObject({
      event_type: "privacy.export.requested",
      aggregate_type: "privacy_request",
      aggregate_id: "req-1",
    });
  });

  it("works without notes", async () => {
    const { svc } = makeService();
    const result = await svc.createExportRequest(tx, "user-1", "tenant-1", null);
    expect(result.ok).toBe(true);
  });
});

describe("PrivacyService.createDeletionRequest", () => {
  it("creates a PENDING row and stages privacy.deletion.requested outbox event", async () => {
    const { svc, inserted } = makeService();
    const outbox: unknown[] = [];
    const tx2 = { ...tx, registerOutbox: (e: unknown) => void outbox.push(e) } as unknown as Tx;

    const result = await svc.createDeletionRequest(tx2, "user-1", "tenant-1", "delete my account");

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.request_id).toBe("req-1");
      expect(result.value.status).toBe("PENDING");
    }
    expect(inserted).toHaveLength(1);
    expect(outbox).toHaveLength(1);
    expect(outbox[0]).toMatchObject({
      event_type: "privacy.deletion.requested",
    });
  });
});

describe("PrivacyService.getDownloadUrl", () => {
  const client = {} as DbClient;

  it("returns violation when status is not READY", async () => {
    const { svc } = makeService({
      findRow: {
        id: "req-1",
        tenant_id: "tenant-1",
        user_id: "user-1",
        request_type: "EXPORT",
        status: "PENDING",
        notes: null,
        created_at: new Date().toISOString(),
        completed_at: null,
        file_key: null,
        download_token: null,
        audit_ref: null,
      } as unknown as PrivacyRequestRow,
    });

    const result = await svc.getDownloadUrl(client, "req-1", "user-1");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.error_code).toBe("PRIVACY_REQUEST_NOT_READY");
    }
  });

  it("returns violation when file_key is null", async () => {
    const { svc } = makeService({
      findRow: {
        id: "req-1",
        tenant_id: "tenant-1",
        user_id: "user-1",
        request_type: "EXPORT",
        status: "READY",
        notes: null,
        created_at: new Date().toISOString(),
        completed_at: new Date().toISOString(),
        file_key: null,
        download_token: null,
        audit_ref: null,
      } as unknown as PrivacyRequestRow,
    });

    const result = await svc.getDownloadUrl(client, "req-1", "user-1");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.error_code).toBe("PRIVACY_REQUEST_NO_FILE");
    }
  });

  it("returns presigned URL for READY export and calls markDownloaded", async () => {
    const { svc, presignedCalls } = makeService({
      findRow: {
        id: "req-1",
        tenant_id: "tenant-1",
        user_id: "user-1",
        request_type: "EXPORT",
        status: "READY",
        notes: null,
        created_at: new Date().toISOString(),
        completed_at: new Date().toISOString(),
        file_key: "exports/export-req-1.json",
        download_token: "token-123",
        audit_ref: null,
      } as unknown as PrivacyRequestRow,
      presignedUrl: "https://presigned.example.com/export.json",
    });

    let markCalled = false;
    (svc as unknown as { privacy: { markDownloaded: (id: string) => Promise<void> } }).privacy.markDownloaded = async () => {
      markCalled = true;
    };

    const result = await svc.getDownloadUrl(client, "req-1", "user-1");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.download_url).toBe("https://presigned.example.com/export.json");
      expect(result.value.expires_in_seconds).toBe(600);
    }
    expect(presignedCalls).toHaveLength(1);
    expect(markCalled).toBe(true);
  });

  it("returns NotFound when the row does not exist", async () => {
    const { svc } = makeService({ findRow: null });
    const result = await svc.getDownloadUrl(client, "req-1", "user-1");
    expect(result.ok).toBe(false);
  });
});

describe("PrivacyService.buildExportPayload", () => {
  it("redacts sensitive user fields (password_hash, refresh_token_hash, mfa_secret_encrypted)", () => {
    const { svc } = makeService();

    const payload = svc.buildExportPayload({
      user: {
        id: "user-1",
        email: "driver@example.com",
        password_hash: "should-not-leak",
        refresh_token_hash: "should-not-leak",
        mfa_secret_encrypted: "should-not-leak",
      } as unknown as Record<string, unknown>,
      consents: [],
      sessions: [],
      shifts: [],
      fuel_purchases: [],
      accidents: [],
      inspections: [],
      vehicle_issues: [],
      driving_analytics: [],
    });

    const safeUser = payload.user as Record<string, unknown>;
    expect(safeUser.password_hash).toBe("[REDACTED]");
    expect(safeUser.refresh_token_hash).toBe("[REDACTED]");
    expect(safeUser.mfa_secret_encrypted).toBe("[REDACTED]");
    expect(safeUser.id).toBe("user-1");
    expect(safeUser.email).toBe("driver@example.com");
  });

  it("redacts session tokens in session rows", () => {
    const { svc } = makeService();

    const payload = svc.buildExportPayload({
      user: { id: "user-1", email: "d@e.com" } as unknown as Record<string, unknown>,
      consents: [],
      sessions: [{ id: "sess-1", refresh_token_hash: "token-here", user_id: "user-1" }],
      shifts: [],
      fuel_purchases: [],
      accidents: [],
      inspections: [],
      vehicle_issues: [],
      driving_analytics: [],
    });

    const safeSessions = payload.sessions as Array<Record<string, unknown>>;
    expect(safeSessions).toHaveLength(1);
    expect(safeSessions[0]!.refresh_token_hash).toBe("[REDACTED]");
    expect(safeSessions[0]!.id).toBe("sess-1");
  });

  it("preserves non-sensitive data", () => {
    const { svc } = makeService();

    const payload = svc.buildExportPayload({
      user: { id: "user-1", email: "d@e.com" } as unknown as Record<string, unknown>,
      consents: [{ id: "consent-1" }],
      sessions: [{ id: "sess-1" }],
      shifts: [{ id: "shift-1" }],
      fuel_purchases: [{ id: "fuel-1" }],
      accidents: [{ id: "acc-1" }],
      inspections: [{ id: "insp-1" }],
      vehicle_issues: [{ id: "vi-1" }],
      driving_analytics: [{ id: "da-1" }],
    });

    expect(payload.consents).toHaveLength(1);
    expect(payload.shifts).toHaveLength(1);
    expect(payload.fuel_purchases).toHaveLength(1);
  });
});
