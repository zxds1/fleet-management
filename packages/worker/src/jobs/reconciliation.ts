// packages/worker/src/jobs/reconciliation.ts
// `reconciliation` job (05 §2 #13, A1.9). Parses an uploaded fuel-card statement CSV via a
// column mapping and matches each line to a fuel_purchase on date + amount + last-four. Matching
// key is (card_last_four, transaction_at, amount) per the schema index.

import { transaction } from "@fleet/db";
import { logger } from "@fleet/shared";
import type { PoolLike } from "@fleet/shared";

export interface StatementLine {
  transactionAt: Date;
  cardLastFour: string;
  amount: number;
  stationName?: string;
  raw: Record<string, unknown>;
}

export interface CsvParser {
  parse(buffer: Buffer, columnMapping: Record<string, string>): StatementLine[];
}

export class ReconciliationJob {
  constructor(private readonly pool: PoolLike, private readonly parser: CsvParser) {}

  /** Reconcile one statement by media object id. */
  async run(statementMediaObjectId: string): Promise<{ lines: number; matched: number }> {
    const stmt = await transaction(this.pool, async (tx) =>
      tx.client.query<{ id: string; column_mapping: Record<string, string>; media_object_id: string }>(
        `SELECT id, column_mapping, media_object_id FROM app.fuel_card_statements WHERE media_object_id = $1`,
        [statementMediaMediaId(statementMediaObjectId)],
      ),
    );
    const row = stmt.rows[0];
    if (!row) return { lines: 0, matched: 0 };

    // In production the CSV bytes come from S3 via MediaPresigner; here we take the stored raw
    // via a provided buffer hook. We parse from the stored line rows instead (already shredded).
    const lines = await transaction(this.pool, async (tx) =>
      tx.client.query<{ id: number; transaction_at: Date; card_last_four: string; amount: number }>(
        `SELECT id, transaction_at, card_last_four, amount FROM app.fuel_card_statement_lines
         WHERE statement_id = $1 AND match_status = 'UNMATCHED' ORDER BY transaction_at`,
        [row.id],
      ),
    );

    let matched = 0;
    for (const l of lines.rows) {
      const m = await transaction(this.pool, async (tx) =>
        tx.client.query<{ purchase_id: string | null }>(
          `SELECT id AS purchase_id FROM app.fuel_purchases
           WHERE fuel_card_last_four = $1 AND purchased_at BETWEEN $2 - interval '1 day' AND $2 + interval '1 day'
             AND total_cost = $3 AND admin_verified = false AND rejected_at IS NULL
           LIMIT 1`,
          [l.card_last_four, l.transaction_at, l.amount],
        ),
      );
      const purchaseId = m.rows[0]?.purchase_id;
      if (purchaseId) {
        await transaction(this.pool, async (tx) =>
          tx.client.query(
            `UPDATE app.fuel_card_statement_lines
             SET match_status='MATCHED', matched_purchase_id=$1, matched_at=now()
             WHERE id=$2`,
            [purchaseId, l.id],
          ),
        );
        matched++;
      }
    }
    await transaction(this.pool, async (tx) =>
      tx.client.query(
        `UPDATE app.fuel_card_statements SET processed_at=now(), matched_count=$1, unmatched_count=$2
         WHERE id=$3`,
        [matched, (lines.rowCount ?? 0) - matched, row.id],
      ),
    );
    logger.info("reconciliation", { statementId: row.id, lines: lines.rowCount, matched });
    return { lines: lines.rowCount ?? 0, matched };
  }
}

// The reconciliation is keyed by the statement's media_object_id; the query binds it directly.
function statementMediaMediaId(id: string): string {
  return id;
}

/**
 * Simple CSV tokenizer that handles RFC-4180 quoting (fields wrapped in double quotes,
 * embedded quotes escaped as ""). Sufficient for fuel-card statement imports.
 */
function parseCsvLine(line: string): string[] {
  const fields: string[] = [];
  let cur = "";
  let inQuotes = false;
  let i = 0;
  while (i < line.length) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i++;
        continue;
      }
      cur += ch;
      i++;
    } else if (ch === '"') {
      inQuotes = true;
      i++;
    } else if (ch === ",") {
      fields.push(cur);
      cur = "";
      i++;
    } else {
      cur += ch;
      i++;
    }
  }
  fields.push(cur);
  return fields;
}

/**
 * Real CSV parser driven by a per-statement column-mapping (A1.9). The mapping maps source
 * CSV header → canonical field name so the same parser works across bank formats. Injected
 * only when `RECONCILIATION_ENABLED=1` (audit L10); otherwise NoopParser returns [].
 */
export class ColumnMappingCsvParser implements CsvParser {
  parse(buffer: Buffer, columnMapping: Record<string, string>): StatementLine[] {
    const text = buffer.toString("utf-8");
    const rawLines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
    if (rawLines.length < 2) return [];

    const headers = parseCsvLine(rawLines[0] ?? "").map((h) => h.trim());
    const lines: StatementLine[] = [];

    for (let i = 1; i < rawLines.length; i++) {
      const vals = parseCsvLine(rawLines[i] ?? "");
      const row: Record<string, string> = {};
      for (let j = 0; j < headers.length; j++) {
        row[headers[j] ?? ""] = vals[j] ?? "";
      }

      const mapped: Record<string, string> = {};
      for (const [source, target] of Object.entries(columnMapping)) {
        mapped[target] = row[source] ?? "";
      }

      const rawTransactionAt = mapped["transactionAt"] ?? mapped["transaction_at"];
      const transactionAt = rawTransactionAt ? new Date(rawTransactionAt) : new Date(NaN);
      if (Number.isNaN(transactionAt.getTime())) continue;

      const cardLastFour = mapped["cardLastFour"] ?? mapped["card_last_four"] ?? "";
      const amountStr = mapped["amount"] ?? "0";
      const amount = parseFloat(amountStr);
      if (Number.isNaN(amount)) continue;

      const line: StatementLine = {
        transactionAt,
        cardLastFour,
        amount,
        raw: row,
      };
      const station = mapped["stationName"] ?? mapped["station_name"];
      if (station) line.stationName = station;
      lines.push(line);
    }

    return lines;
  }
}
