# Security Specification (`security.md`)

**Status:** Design (no code). **Scope:** backend (`@fleet/api`, `@fleet/worker`, `@fleet/ws`), mobile
apps (`packages/mobile`), infra/CI, and data. **Cross-cutting** — referenced by both
`docs/backend/IMPLEMENTATION-PROMPT.md` and `docs/apps/IMPLEMENTATION-PROMPT.md`.
**Compliance baseline:** Kenya DPA 2019 (mandatory) **+ ISO/IEC 27001 + SOC 2 (Type II)**.

**Approved decisions (locked):**
| # | Decision |
|---|---|
| S-1 | Telemetry webhook: **HMAC signature + per-IP rate limit**. |
| S-2 | Uploaded media: **malware scan on PUT** (block on hit). |
| S-3 | Edge: **cloud WAF + app rate limiting** (per-IP/per-user; stricter on auth + presign). |
| S-4 | Mobile: **cert pinning + root/jailbreak refusal + obfuscation + anti-tamper + deep-link validation**. |
| S-5 | CI: **SCA + secret scan + container scan + SAST + annual penetration test**. |
| S-6 | Secrets: **Vault/SSM + rotation policy + gitleaks (pre-commit + CI)**. |
| S-7 | Compliance: **DPA + ISO 27001 + SOC 2**. |

Goal: protect every endpoint and the app from injection, XSS, serialization/deserialization attacks,
abuse by automated scanners/credential stuffing, malware uploads, and breach/break-in — with defense
in depth, not a single control.

Legend: ✅ already designed/implemented (verify in code) · 🆕 to implement.

---

## 1. Edge, transport & abuse protection

- ✅ `helmet()` sets safe headers; `express.json({ limit: "1mb" })`.
- 🆕 **WAF** (AWS WAF / Cloudflare) in front of the API: managed rule sets, bot-control, rate-based
  rules, and a generic/obscure server banner (no `x-powered-by`, no stack traces).
- 🆕 **App rate limiting** (Redis): per-IP and per-user sliding windows; strictest on
  `POST /auth/login`, `/auth/mfa/*`, `/media/upload-url`, `/telemetry/webhook`. Return `429` with
  `RATE_LIMITED`/`OFFLINE_PIN_LOCKED` as already coded.
- 🆕 **DDoS**: WAF + autoscale + connection caps; telemetry webhook throttled hard (S-1).
- ✅ **CORS** must be explicit (no `*` with credentials); confirm `ws` `cors:{origin:false}` and set a
  strict API CORS allowlist (mobile origins only).
- 🆕 **TLS everywhere** + **HSTS** (includeSubDomains, preload) at the ingress; HTTP→HTTPS redirect.
- 🆕 **Security headers** for any web surface: `Content-Security-Policy`, `X-Frame-Options: DENY`
  (clickjacking), `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`,
  `Permissions-Policy` restricted.

## 2. Authentication, sessions & the public webhook

- ✅ JWT HS256 with current+previous key (kid), 15 min access / 7 day refresh, 24 h offline window.
- ✅ MFA/TOTP (admin-provisioned for drivers), device-only offline PIN (5-fail lock / 10-fail wipe),
  permission union, 10-session cap, login throttling, argon2id passwords.
- 🆕 **Telemetry webhook auth (S-1):** require an `X-Signature` HMAC-SHA256 over the raw body using a
  shared secret (mounted from Vault, S-6); reject on mismatch (`401`/silent drop) and apply per-IP rate
  limit + replay protection (timestamp/nonce window). Add idempotency on the ingest side keyed on
  `traccar_position_id` (already present in backfill) so duplicates are dropped.
- 🆕 Extend brute-force protection beyond login to **all** auth/MFA endpoints (unified counter +
  `RATE_LIMITED`).

## 3. Input validation & serialization (the "input serializations" ask)

- ✅ **zod** schemas validate every request (no `body as any` → no mass assignment). Keep this strict.
- 🆕 **Prototype-pollution-safe JSON parsing:** configure `express.json` with a `reviver` that drops
  `__proto__` / `constructor` / `prototype` keys, or use `Object.defineProperty`-safe parsing; reject
  payloads containing them. Never call `JSON.parse` then `Object.assign` into prototypes.
- 🆕 **Content-type enforcement:** accept only `application/json` (and the multipart presign flow
  separately); reject other content-types with `415`/`400`. Never parse XML/YAML from clients.
- 🆕 **Depth & size limits:** enforce max JSON depth (e.g. 8) and 1 mb body (done) — reject deeply
  nested payloads to prevent parser bombs.
- 🆕 **ReDoS-safe regex:** audit all zod/regex (odometer, plate, phone, email) for catastrophic
  backtracking; prefer linear validators or anchored, bounded patterns. Add a regex lint in CI.
- ✅ No `eval` / `Function` / `vm` on user input anywhere (verify in SAST, S-5).
- 🆕 **Array/string caps:** bound list lengths and string sizes in schemas (notes, descriptions, media
  counts) to prevent oversized-field abuse.

## 4. Injection prevention

- ✅ **SQL injection:** repositories use `$1,$2,…` parameterised SQL only; dynamic identifiers
  (sort/filter) from an allow-list. DB constraints are the final authority. (Verify no string concat
  in code via SAST.)
- ✅ **Command/OS/NoSQL/LDAP injection:** N/A (no shell exec, no NoSQL, no LDAP). Confirm none added.
- 🆕 **SSRF:** all outbound calls (Traccar REST, Google Vision, FCM, Africa's Talking) use
  **config-sourced, allow-listed** URLs — never user-supplied. If any user-influenced URL is ever
  introduced, enforce an allow-list + block link-local/metadata IPs (169.254.169.254, localhost).
- 🆕 **Path traversal:** media keys are DB `media_object_id`s, never raw paths; presign is scoped to a
  pre-inserted id (done). Reject any `/`, `..`, or absolute segments in identifier fields.
- 🆕 **Header/response splitting:** set headers via framework helpers only; never interpolate
  user input into header values.
- ✅ **ORM/query injection:** n/a (parameterised `BaseRepository`).

## 5. XSS / output encoding

- ✅ API is JSON + RFC7807; no HTML is rendered by the backend. Classic reflected/stored XSS risk is
  low for the **React Native** driver/admin apps (no DOM). 
- 🆕 If any **WebView / HTML** surface is added (help/docs/email), sanitize with DOMPurify + a strict
  **CSP**; never `dangerouslySetInnerHTML` with user data.
- 🆕 **Push / deep-link injection:** validate deep-link schemes/hosts; treat notification `body` as
  untrusted text (no auto-navigation to arbitrary screens); encode in any rendered view.
- 🆕 Stored-text fields (accident description, DVIR notes) are treated as untrusted if ever shown in a
  web context; RN `Text` is safe by default.

## 6. Media & object storage

- ✅ Private S3 buckets; 60 s presigned PUT scoped to a pre-inserted `media_object_id`; accident bucket
  **Object Lock** (WORM). API never receives bytes.
- 🆕 **Malware scan on PUT (S-2):** trigger an AV scan (Lambda + ClamAV, or GCS malware scanner) on
  object creation; until "clean", the `media_objects` row stays `quarantined` and is **not** servable;
  on hit → delete/isolate + alert (S-10) + `security` audit row. Presign should not return a readable
  GET URL until scanned.
- 🆕 Optional: scan-on-download + image dimension/type validation at capture (≤500 KB, ≤1080 px, EXIF
  stripped — C5.2 already in app).

## 7. Secrets, config & key management

- ✅ Secrets come from the platform secret store (env), never `system_config`; MFA secret AES-GCM
  encrypted; logs redact secrets/PII.
- 🆕 **Vault/SSM + rotation (S-6):** JWT signing key, FCM SA, Vision key, Africa's Talking key, S3/KMS,
  DB/Redis URLs in Vault/SSM; **rotation policy** (JWT 24 h overlap already designed; rotate others on
  a schedule + on staff offboarding).
- 🆕 **Secret scanning (S-6):** `gitleaks` pre-commit hook **and** CI step; block commits/PRs with
  leaked secrets; rotate any historical exposure.

## 8. Supply chain & CI security (S-5)

- 🆕 **SCA:** `npm audit` / Snyk in CI; Dependabot for bumps; enforce lockfile integrity (no
  `--no-package-lock`). Fail build on high/critical.
- 🆕 **Container scan:** Trivy on `deploy/Dockerfile` images; fail on critical CVEs.
- 🆕 **IaC scan:** check `deploy/k8s/manifests.yaml` / Terraform for public buckets, wildcard IAM,
  missing encryption.
- 🆕 **SAST:** Semgrep / CodeQL on every PR — flags `eval`, `child_process` with user input, SQL
  concatenation, unsafe deserialization, prototype-pollution patterns.
- 🆕 **DAST + dependency license check** in the staging pipeline.
- 🆕 **Annual penetration test** by a third party; findings tracked to closure before launch (R-101
  gate aligns with DPIA sign-off).

## 9. Mobile app hardening (S-4)

- 🆕 **Certificate pinning:** pin the API + WS + S3/Google endpoints' CA/spki; fail closed on mismatch.
- 🆕 **Root/jailbreak detection:** refuse to run (or force re-auth + block offline PIN) on rooted/
  jailbroken devices; block known bypass frameworks.
- 🆕 **Obfuscation + anti-tamper:** EAS `javascriptCodeSigning`/minify + native obfuscation; detect
  repackaging (signature/hash check) and refuse offline PIN if tampered.
- 🆕 **Deep-link / intent validation:** allow-list schemes/hosts; validate `Idempotency-Key`/params;
  never auto-execute sensitive actions from a link without confirmation.
- ✅ Already: `expo-secure-store` (tokens), biometric local unlock, device-only offline PIN, zod on
  client, no secrets in logs.

## 10. Monitoring, response & resilience

- ✅ Audit logs, outbox, Sentry hook (C5.7); immutable `audit_logs`/`accident_telemetry`/`accident_media`.
- 🆕 **Security event telemetry:** emit/alert on bursts of `401/403/429`, `IDEMPOTENCY_CONFLICT` spikes,
  impossible-travel logins, WAF blocks, AV quarantines, root/jailbreak attempts. Route to SIEM/Sentry.
- 🆕 **Incident response runbook** + on-call; break-glass secret rotation.
- 🆕 **Backups:** encrypted RDS snapshots + PITR; periodically restore-test; outbox/audit retained per
  retention policy (activate `retention` job wet-run after sign-off, D6).

## 11. Data protection & privacy (DPA + ISO 27001 + SOC 2)

- ✅ Encryption in transit (TLS), PII redaction in logs, field encryption for MFA secret, cross-border
  transfers (Google/Vision/FCM) documented in DPIA (R-101).
- 🆕 Encryption at rest confirmed via KMS for PG + S3; least-privilege IAM; access reviews; retention/
  minimization enforced; SOC 2 criteria (security, availability, confidentiality) mapped to controls
  above; ISO 27001 Annex A control mapping maintained.

---

## 12. Definition of Done

- WAF + app rate limiting live; telemetry webhook HMAC-verified + throttled (S-1/S-3).
- All inputs parsed pollution-safe, content-typed, depth/size-bounded; ReDoS-safe regex linted.
- Media AV-scaned on PUT; quarantined on hit (S-2).
- Secrets in Vault + rotated + gitleaks in pre-commit/CI (S-6).
- CI runs SCA + container + IaC + SAST; annual pen test passed (S-5).
- Mobile pinned + root/jailbreak-refusing + obfuscated + deep-link-validated (S-4).
- Security telemetry + IR runbook + encrypted backups in place; compliance mapped (S-7).

## 13. Invariants this document locks

1. No user input reaches SQL/Shell/Header/Path without parameterisation or allow-listing.
2. JSON is parsed pollution-safe; content-type and depth/size are enforced.
3. The telemetry webhook is authenticated (HMAC) and rate-limited.
4. Uploaded media is AV-scanned before it is servable.
5. Secrets never hit logs or VCS; scanning + rotation are mandatory.
6. Mobile rejects rooted/jailbroken + unpinned/repackaged runs.
7. Compliance controls target DPA + ISO 27001 + SOC 2.
