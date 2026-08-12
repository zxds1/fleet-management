// packages/worker/src/jobs/vision.ts
// Real Google Vision adapter (A1.4 / 05 §2 #12). Sends fuel receipts to the Google Vision
// REST API (TEXT_DETECTION) and parses the extracted OCR text into an OcrResult. Injected
// only when `VISION_ENABLED=1` (audit L10); otherwise NoopVision keeps OCR non-functional
// by design in dev/test/local.

import { fetchWithTimeout } from "../infra/http";
import { logger } from "@fleet/shared";
import type { PoolLike } from "@fleet/shared";
import type { VisionAdapter, OcrResult } from "./ocr";
import type { MediaPresigner } from "../media/presigner";
import type { Env } from "../config/env";

const VISION_API_BASE = "https://vision.googleapis.com/v1/images:annotate";

function emptyResult(): OcrResult {
  return {
    amount: null,
    liters: null,
    pricePerLiter: null,
    receiptDate: null,
    stationName: null,
    confidence: null,
    raw: null,
  };
}

/**
 * Heuristic extraction of the numeric total from OCR text — looks for the largest
 * number in a "TOTAL" / "AMOUNT" context line. Returns null when nothing matches.
 */
function extractAmount(text: string): number | null {
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  const totalLine = lines.find((l) => /total|amount|sub\s*total/i.test(l));
  const candidates = (totalLine ?? text).match(/[\d,]+\.?\d*/g) ?? [];
  if (candidates.length === 0) return null;
  let best = 0;
  let found = false;
  for (const c of candidates) {
    const n = parseFloat(c.replace(/,/g, ""));
    if (!Number.isNaN(n) && n > best) {
      best = n;
      found = true;
    }
  }
  return found ? best : null;
}

/** Extract litres from a line mentioning "L" or "LITRES". */
function extractLiters(text: string): number | null {
  const m = text.match(/(\d+(?:\.\d+)?)\s*(?:L|LITRES|LITERS|Ltrs?)\b/i);
  if (!m) return null;
  const n = parseFloat(m[1] ?? "");
  return Number.isNaN(n) || n <= 0 ? null : n;
}

/** Extract a YYYY-MM-DD date from the OCR text. */
function extractDate(text: string): string | null {
  const m = text.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (!m) {
    const m2 = text.match(/(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})/);
    if (m2) {
      const a = m2[1] ?? "";
      const b = m2[2] ?? "";
      const c = m2[3] ?? "";
      if (!a || !b || !c) return null;
      const d = c.length === 2 ? 2000 + parseInt(c) : parseInt(c);
      if (Number.isNaN(d)) return null;
      return `${d}-${a.padStart(2, "0")}-${b.padStart(2, "0")}`;
    }
    return null;
  }
  return `${m[1] ?? ""}-${m[2] ?? ""}-${m[3] ?? ""}`;
}

/** Station name is assumed to be the first non-numeric line in the OCR text. */
function extractStationName(text: string): string | null {
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  for (const l of lines) {
    if (!/^\d+(?:\.\d+)?$/.test(l.trim())) {
      return l.trim().slice(0, 100);
    }
  }
  return null;
}

export class GoogleVisionAdapter implements VisionAdapter {
  private readonly apiUrl: string;

  constructor(
    private readonly apiKey: string,
    private readonly env: Env,
    private readonly pool: PoolLike,
    private readonly presigner: MediaPresigner,
  ) {
    this.apiUrl = `${VISION_API_BASE}?key=${apiKey}`;
  }

  async analyse(mediaObjectId: string): Promise<OcrResult> {
    const client = await this.pool.connect();
    try {
      const res = await client.query<{ bucket: string; object_key: string }>(
        `SELECT bucket, object_key FROM app.media_objects WHERE id = $1 AND deleted_at IS NULL`,
        [mediaObjectId],
      );
      const row = res.rows[0];
      if (!row) {
        logger.warn("vision: media object not found", { mediaObjectId });
        return emptyResult();
      }

      const buf = await this.presigner.getObject(row.bucket, row.object_key);
      if (!buf || buf.length === 0) {
        logger.warn("vision: media object unavailable for OCR", { mediaObjectId, bucket: row.bucket, key: row.object_key });
        return emptyResult();
      }

      const content = buf.toString("base64");
      const resp = await fetchWithTimeout(this.apiUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          requests: [
            {
              image: { content },
              features: [{ type: "TEXT_DETECTION", maxResults: 1 }],
            },
          ],
        }),
      });

      const json = (await resp.json()) as {
        responses?: Array<{ textAnnotations?: Array<{ description?: string; confidence?: number }> }>;
      };

      const ta = json.responses?.[0]?.textAnnotations;
      const text = ta?.[0]?.description ?? "";
      const confidence = ta?.[0]?.confidence ?? null;

      if (!text) return emptyResult();

      const amount = extractAmount(text);
      const liters = extractLiters(text);
      const pricePerLiter = amount != null && liters != null && liters > 0 ? Math.round((amount / liters) * 100) / 100 : null;

      return {
        amount,
        liters,
        pricePerLiter,
        receiptDate: extractDate(text),
        stationName: extractStationName(text),
        confidence: confidence != null ? Math.max(0, Math.min(1, confidence)) : null,
        raw: json,
      };
    } finally {
      client.release?.();
    }
  }
}
