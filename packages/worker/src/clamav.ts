// packages/worker/src/clamav.ts
// AV-scan boundary for the media-scanner worker (S-2). Wraps the `clamscan` npm package,
// which connects to a clamd daemon (TCP) or spawns the `clamdscan` binary. The scanner is
// a separate, injectable collaborator so the job and its tests stay hermetic.
//
// Production: a clamd daemon runs in the worker pod or via the AWS Lambda trigger
// (see deploy/k8s/manifests.yaml). When no clamd is reachable the scan fails with
// status ERROR so the media object stays quarantined and ops can investigate.

import { NodeClam } from "clamscan";
import { logger } from "@fleet/shared";

export type ScanStatus = "CLEAN" | "VIRUS" | "ERROR";

export interface ScanOutcome {
  status: ScanStatus;
  /** EICAR test string for VIRUS, clamd version for CLEAN, error text for ERROR. */
  detail: string | null;
  scannerVersion: string | null;
}

export interface MediaScanClient {
  /** Scans an in-memory buffer and returns the outcome. */
  scanBuffer(buffer: Buffer, name: string): Promise<ScanOutcome>;
}

export class ClamAvScanner implements MediaScanClient {
  private clam: NodeClam | null = null;
  private version: string | null = null;
  private ready: Promise<void>;

  constructor(clamdHost: string, clamdPort: number) {
    this.ready = this.init(clamdHost, clamdPort);
  }

  private async init(clamdHost: string, clamdPort: number): Promise<void> {
    try {
      const instance = new NodeClam();
      this.clam = await instance.init({
        removeInfected: false,
        scanLog: null,
        preference: "clamdscan",
        clamdscan: {
          socket: false,
          host: clamdHost,
          port: clamdPort,
          timeout: 60_000,
          localFallback: false,
          bypassTest: false,
          active: true,
        },
      });
      this.version = await this.clam.getVersion();
      logger.info("media-scanner: clamd connected", { version: this.version });
    } catch (e) {
      logger.error("media-scanner: clamd init failed", { message: (e as Error).message });
      this.clam = null;
      this.version = null;
    }
  }

  async scanBuffer(buffer: Buffer, name: string): Promise<ScanOutcome> {
    await this.ready;
    if (!this.clam) {
      return { status: "ERROR", detail: "clamd not connected", scannerVersion: null };
    }
    try {
      const result = await this.clam.scanBuffer(buffer, name);
      if (result.isInfected) {
        return {
          status: "VIRUS",
          detail: result.viruses?.join(", ") ?? "infected",
          scannerVersion: this.version,
        };
      }
      return { status: "CLEAN", detail: null, scannerVersion: this.version };
    } catch (e) {
      return { status: "ERROR", detail: (e as Error).message, scannerVersion: this.version };
    }
  }
}
