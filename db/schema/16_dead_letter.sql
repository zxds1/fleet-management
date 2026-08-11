-- packages/db/schema/16_dead_letter.sql
-- Dead-letter stores for poison isolation + delayed observability (audit item #4).
--  * app.ingest_dead_letter : per-entry poison positions from the Redis Stream ingest
--    consumer. One row per failed entry so a single bad payload never redelivers the
--    whole batch (04 §2, §6). Durable + queryable (contrast: a Redis DLQ stream is
--    volatile and not queryable by tenant).
--  * app.job_dead_letter    : recurring scheduled-job failures that keep failing every
--    tick (05 §2). Lets ops see which jobs are wedged without scraping logs.

CREATE TABLE IF NOT EXISTS app.ingest_dead_letter (
  id            bigserial PRIMARY KEY,
  stream        text NOT NULL,
  stream_id     text NOT NULL,
  payload_json  jsonb NOT NULL,
  error_message text NOT NULL,
  error_code    text,
  tenant_id     text,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ix_ingest_dead_letter_created
  ON app.ingest_dead_letter (created_at DESC);
CREATE INDEX IF NOT EXISTS ix_ingest_dead_letter_tenant
  ON app.ingest_dead_letter (tenant_id, created_at DESC);

CREATE TABLE IF NOT EXISTS app.job_dead_letter (
  id            bigserial PRIMARY KEY,
  job_name      text NOT NULL,
  payload_json  jsonb,
  error_message text NOT NULL,
  error_code    text,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ix_job_dead_letter_created
  ON app.job_dead_letter (created_at DESC);
CREATE INDEX IF NOT EXISTS ix_job_dead_letter_job
  ON app.job_dead_letter (job_name, created_at DESC);
