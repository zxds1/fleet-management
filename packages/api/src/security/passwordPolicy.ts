// packages/api/src/security/passwordPolicy.ts
// Password strength policy for self-service admin signup (02-auth.md §2). Argon2id handles the
// hashing; this gates weak secrets before they ever reach the DB. OWASP-aligned: length-led,
// requires character-class variety, and rejects passwords that embed the account email or sit on a
// small built-in deny-list of common/seasons.

export interface PasswordCheck {
  ok: boolean;
  /** Human-readable reasons the password was rejected (empty when ok). */
  reasons: string[];
  /** 0–4 strength estimate for UI hints (weak..strong). */
  score: 0 | 1 | 2 | 3 | 4;
}

const MIN_LENGTH = 12;
const COMMON = new Set([
  "password", "password1", "password123", "admin", "administrator", "fleet", "fleet123",
  "welcome", "welcome1", "letmein", "qwerty", "abc123", "changeme", "p@ssw0rd",
  "iloveyou", "monkey", "dragon", "sunshine", "princess", "football", "baseball",
  "qwerty123", "1q2w3e4r", "passw0rd", "p@ssword", "fleetmanagement", "fleetadmin",
]);

export function hasLower(s: string): boolean {
  return /[a-z]/.test(s);
}
export function hasUpper(s: string): boolean {
  return /[A-Z]/.test(s);
}
export function hasDigit(s: string): boolean {
  return /[0-9]/.test(s);
}
export function hasSymbol(s: string): boolean {
  return /[^A-Za-z0-9]/.test(s);
}

function scoreOf(p: { length: number; lower: boolean; upper: boolean; digit: boolean; symbol: boolean }): 0 | 1 | 2 | 3 | 4 {
  let classes = 0;
  if (p.lower) classes++;
  if (p.upper) classes++;
  if (p.digit) classes++;
  if (p.symbol) classes++;
  if (p.length >= 16 && classes === 4) return 4;
  if (p.length >= 12 && classes >= 4) return 3;
  if (p.length >= 12 && classes >= 3) return 2;
  if (p.length >= 8) return 1;
  return 0;
}

/**
 * Validates a candidate password for admin self-signup.
 * @param plain    the candidate password
 * @param email    the account email, used to reject passwords that embed the local-part
 */
export function checkPasswordStrength(plain: string, email?: string): PasswordCheck {
  const reasons: string[] = [];
  const lower = hasLower(plain);
  const upper = hasUpper(plain);
  const digit = hasDigit(plain);
  const symbol = hasSymbol(plain);

  if (plain.length < MIN_LENGTH) {
    reasons.push(`Password must be at least ${MIN_LENGTH} characters long.`);
  }
  if (!lower) reasons.push("Add a lowercase letter.");
  if (!upper) reasons.push("Add an uppercase letter.");
  if (!digit) reasons.push("Add a number.");
  if (!symbol) reasons.push("Add a symbol (e.g. !@#$%).");

  const normalized = plain.toLowerCase();
  if (COMMON.has(normalized)) {
    reasons.push("This password is too common.");
  }
  for (const word of COMMON) {
    if (normalized.includes(word) && word.length >= 4) {
      reasons.push("Avoid common words in your password.");
      break;
    }
  }

  const local = email ? email.split("@")[0]?.toLowerCase() ?? "" : "";
  if (local && local.length >= 3 && normalized.includes(local)) {
    reasons.push("Password must not contain your email.");
  }

  const score = scoreOf({ length: plain.length, lower, upper, digit, symbol });
  return { ok: reasons.length === 0, reasons, score };
}
