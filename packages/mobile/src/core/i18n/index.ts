// packages/mobile/src/core/i18n/index.ts
//
// Tiny i18n runtime. Deliberately dependency-free and synchronous so it can be unit-tested in node
// and used by pure core modules (no React, no native). The UI layer reads `getLocale()` from a
// session-backed source; we keep the locale in a module-level ref that `session` sets on restore.
//
// D-10: every user-facing string comes through here. There are NO hardcoded strings in components.
// `t()` returns the key (developer-visible) if a translation is missing, so gaps are loud, not silent.

import en from "./en.json";
import sw from "./sw.json";

export type Locale = "en" | "sw";

const TABLES: Record<Locale, Record<string, unknown>> = {
  en,
  sw,
};

let current: Locale = "en";

export function getLocale(): Locale {
  return current;
}

export function setLocale(locale: Locale): void {
  if (locale === "en" || locale === "sw") current = locale;
}

export function availableLocales(): Locale[] {
  return ["en", "sw"];
}

/** `{{name}}` → args.name. Escapes nothing (copy is trusted, authored by us). */
export function interpolate(template: string, args?: Record<string, string | number>): string {
  if (!args) return template;
  return template.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (whole, key: string) => {
    const value = args[key];
    return value === undefined || value === null ? whole : String(value);
  });
}

function lookup(table: Record<string, unknown>, key: string): string | undefined {
  // Supports dots ("errors.VALIDATION_ERROR") and flat keys.
  if (key in table && typeof table[key] === "string") return table[key] as string;
  const parts = key.split(".");
  let node: unknown = table;
  for (const part of parts) {
    if (node && typeof node === "object" && part in (node as Record<string, unknown>)) {
      node = (node as Record<string, unknown>)[part];
    } else {
      return undefined;
    }
  }
  return typeof node === "string" ? node : undefined;
}

/**
 * Translate `key` for the active locale (falling back to en, then to the key itself).
 * `count` enables plural keys (e.g. `offlineBanner.pending` / `offlineBanner.pending_other`).
 */
export function t(
  key: string,
  args?: Record<string, string | number>,
): string {
  const primary = lookup(TABLES[current], key);
  const fallback = primary ?? (current === "en" ? undefined : lookup(TABLES.en, key));
  const chosen =
    fallback ??
    // plural fallback: if "x_other" is missing, try "x"
    (args && typeof args.count === "number" && !primary
      ? lookup(TABLES[current], `${key.replace(/_other$/, "")}`) ??
        (current === "en" ? lookup(TABLES.en, `${key.replace(/_other$/, "")}`) : undefined)
      : undefined);
  const template = chosen ?? key;
  return interpolate(template, args);
}
