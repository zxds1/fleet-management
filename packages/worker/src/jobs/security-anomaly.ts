// packages/worker/src/jobs/security-anomaly.ts
// `security-anomaly` job (security Layer 4 — proactive resilience & audit). Scans audit_logs for
// behavioural anomalies: impossible travel (auth from two distant geos in a short window) and
// bulk-download / volume-spike patterns (e.g. >N `export` or bulk-read actions per user per window).
// On a hit it emits a structured logger.warn + reportError so the SOC has a complete audit trail.
// Live geo-IP enrichment is out of scope here; we flag distinct source IPs as a proxy for "new geo".

import { logger, reportError } from "@fleet/shared";

/** Minimum distinct source IPs within the window to flag impossible-travel / new-geo. */
export const IMPOSSIBLE_TRAVEL_DISTINCT_IPS = 2;
/** Bulk-download action threshold per user within the window. */
export const BULK_DOWNLOAD_ACTION_THRESHOLD = 25;

export interface SecurityAnomalyRepository {
  /** Distinct source IPs behind AUTH_SUCCESS actions for a user within `since`. */
  distinctAuthIps(userId: string, since: Date): Promise<string[]>;
  /** Count of bulk-read / export-style actions for a user within `since`. */
  bulkReadCount(userId: string, since: Date): Promise<number>;
  /** All distinct users that have any activity within the window (scan cursor). */
  activeUserIds(since: Date, limit: number, offset: number): Promise<string[]>;
}

export interface SecurityAnomalyFinding {
  kind: "IMPOSSIBLE_TRAVEL" | "BULK_DOWNLOAD";
  userId: string;
  detail: string;
}

/** Pure detector: decides whether the gathered signals constitute a finding (unit-tested). */
export function detectAnomalies(input: {
  distinctAuthIps: string[];
  bulkReadCount: number;
}): SecurityAnomalyFinding[] {
  const findings: SecurityAnomalyFinding[] = [];
  if (input.distinctAuthIps.length >= IMPOSSIBLE_TRAVEL_DISTINCT_IPS) {
    findings.push({
      kind: "IMPOSSIBLE_TRAVEL",
      userId: "",
      detail: `auth from ${input.distinctAuthIps.length} distinct IPs: ${input.distinctAuthIps.join(",")}`,
    });
  }
  if (input.bulkReadCount >= BULK_DOWNLOAD_ACTION_THRESHOLD) {
    findings.push({
      kind: "BULK_DOWNLOAD",
      userId: "",
      detail: `bulk-read/export actions: ${input.bulkReadCount} >= ${BULK_DOWNLOAD_ACTION_THRESHOLD}`,
    });
  }
  return findings;
}

export class SecurityAnomalyJob {
  constructor(
    private readonly repo: SecurityAnomalyRepository,
    private readonly windowMs: number = 60 * 60 * 1000,
  ) {}

  async run(batchLimit = 200): Promise<{ scanned: number; findings: number }> {
    const since = new Date(Date.now() - this.windowMs);
    let scanned = 0;
    let findings = 0;
    let offset = 0;

    // Paginate over active users so a large audit_logs never loads into memory at once.
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const users = await this.repo.activeUserIds(since, batchLimit, offset);
      if (users.length === 0) break;
      scanned += users.length;

      for (const userId of users) {
        const ips = await this.repo.distinctAuthIps(userId, since);
        const bulk = await this.repo.bulkReadCount(userId, since);
        const detected = detectAnomalies({ distinctAuthIps: ips, bulkReadCount: bulk });
        for (const f of detected) {
          findings += 1;
          const finding: SecurityAnomalyFinding = { ...f, userId };
          logger.warn("security anomaly detected", {
            service_name: "worker",
            flow_step: "security-anomaly",
            kind: finding.kind,
            user_id: finding.userId,
            detail: finding.detail,
          });
          reportError(new Error(`security-anomaly:${finding.kind}`), {
            route: "security-anomaly",
            serviceName: "worker",
          });
        }
      }

      if (users.length < batchLimit) break;
      offset += batchLimit;
    }

    return { scanned, findings };
  }
}
