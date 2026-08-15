import { AppConstants } from "../data/constants";

export function fmtDateTime(ms: number): string {
  if (!ms) return "—";
  const d = new Date(ms);
  return d.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

export function fmtDate(ms: number): string {
  if (!ms) return "—";
  return new Date(ms).toLocaleDateString(undefined, { dateStyle: "medium" });
}

export function relativeTime(ms: number): string {
  if (!ms) return "";
  const diff = Date.now() - ms;
  const m = Math.round(diff / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  return `${d}d ago`;
}

export function money(amount: number | null | undefined): string {
  if (amount == null) return "—";
  return `${AppConstants.CURRENCY_SYMBOL} ${amount.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}

