// packages/db/src/dead-letter.ts
// Dead-letter repositories (audit item #4). One row per failed ingest entry / wedged
// scheduled job, written via parameterised queries (06 §2 / 00 §4). The ingest DLQ
// carries the raw payload so poison entries can be replayed; the job DLQ records the
// failing job name for ops visibility.

import type { DbClient } from "@fleet/shared";

export interface IngestDeadLetter {
  stream: string;
  streamId: string;
  payloadJson: unknown;
  errorMessage: string;
  errorCode?: string | null;
  tenantId?: string | null;
}

export interface JobDeadLetter {
  jobName: string;
  payloadJson?: unknown | null;
  errorMessage: string;
  errorCode?: string | null;
}

const INSERT_INGEST_DL = `
  INSERT INTO app.ingest_dead_letter (stream, stream_id, payload_json, error_message, error_code, tenant_id)
  VALUES ($1, $2, $3, $4, $5, $6)`;

const INSERT_JOB_DL = `
  INSERT INTO app.job_dead_letter (job_name, payload_json, error_message, error_code)
  VALUES ($1, $2, $3, $4)`;

export class DeadLetterRepository {
  constructor(private readonly client: DbClient) {}

  async insertIngest(dl: IngestDeadLetter): Promise<void> {
    await this.client.query(INSERT_INGEST_DL, [
      dl.stream,
      dl.streamId,
      dl.payloadJson,
      dl.errorMessage,
      dl.errorCode ?? null,
      dl.tenantId ?? null,
    ]);
  }

  async insertJob(dl: JobDeadLetter): Promise<void> {
    await this.client.query(INSERT_JOB_DL, [
      dl.jobName,
      dl.payloadJson ?? null,
      dl.errorMessage,
      dl.errorCode ?? null,
    ]);
  }
}
