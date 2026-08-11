# Data Protection Impact Assessment (DPIA)

**DPIA ID:** DPIA-2025-001  
**Document Status:** Approved for go-live  
**DPIA Ref ID:** R-101  
**Prepared by:** Helix Fleet Management Ltd – Data Protection Officer  
**Legal Counsel Sign-off:** Required before production go-live  
**Date:** 10 August 2026  
**Review Date:** 10 August 2027

---

## 1. Purpose and Scope

### 1.1 Purpose
This Data Protection Impact Assessment (DPIA) has been prepared in accordance with the Kenya Data Protection Act, 2019 (Cap 110A), Article 27, to evaluate the privacy risks associated with the processing of personal data by the Helix Fleet Management platform ("Platform") and to identify appropriate mitigation measures.

### 1.2 Scope
This DPIA covers the entire data processing lifecycle of the Platform, including:
- GPS telemetry collection and retention (off-shift discard per C5.6)
- Driver identity and contact information
- Vehicle and shift records
- Accident reports and media (tamper-evident telemetry per C3.4)
- DVIR inspection reports and photos
- Fuel purchase and expense data
- Maintenance records
- Audit logs and authentication data
- Cross-border transfers to Google services and FCM
- M-Pesa payment processing via Africa's Talking

This DPIA does **not** cover processing performed solely by the Controller (fleet customer) in their own systems, nor data processed by third-party services outside the scope of our sub-processing relationship.

### 1.3 Trigger
This DPIA was triggered by **R-101** in the Open Risk Register (`docs/architecture/02-open-risk-register.md`), which identifies that data residency is in Cape Town (af-south-1), not Kenya, and that Google Cloud Vision, Google Maps Geocoding, and FCM transfer personal data abroad. The DPIA also addresses **R-106** (over-retention of work-plan and DVIR photos at 7 years).

---

## 2. Data Protection Principles Assessment

| Principle | How Met | Evidence |
|---|---|---|
| **Lawfulness, fairness, transparency** | Legal basis documented in Privacy Policy §3; consent implemented for GPS tracking (C5.5) | `app.user_consents` table, `/consent` endpoints |
| **Purpose limitation** | Data used only for fleet management, safety, compliance, billing | Service boundaries §2, Privacy Policy §2 |
| **Data minimisation** | Off-shift GPS discarded (C5.6); drivers must accept consent before shift (C5.5); odometer photo authoritative (C4.2) | Ingest worker retention transform |
| **Accuracy** | Soft deletes (D3); "Unlock for Correction" preserves originals (B18); OBD cross-checks (M3) | `audit_logs`, `driver_duty_segments` |
| **Storage limitation** | 90-day raw GPS, 7-year records for compliance/disputes (C5.3, M7) | Retention job §7.3, service-boundaries |
| **Integrity & confidentiality** | TLS 1.3, encryption at rest, RBAC, MFA, audit logs, tamper-evident hashes | `docs/security.md` |
| **Accountability** | DPA, DPIA, audit logs, DPO appointed | This document |

---

## 3. Data Mapping (Personal Data Flows)

### 3.1 Data Flow Diagram

```
┌─────────────────────────────────────────────────────────────────────────┐
│                        DRIVER / ADMIN APP                               │
│  (Expo / React Native)                                                  │
│  • expo-secure-store (refresh token, biometric key)                     │
│  • expo-sqlite (offline queue)                                           │
│  • Camera (odometer, DVIR, accident, receipt photos)                    │
└────────────┬──────────────────────────────────────┬────────────────────┘
             │ (HTTPS)                              │ (push via FCM)
             ▼                                      │
┌─────────────────────────────────────────────────────────────────────────┐
│                    API (Express + TypeScript)                           │
│  • JWT HS256 auth (15-min access, 7-day refresh)                        │
│  • Idempotency on all writes (D4/C5.1)                                  │
│  • Zod validation, parameterised SQL                                  │
│  • Media: 60s presigned S3 PUT (never receives bytes)                 │
└────────────┬──────────┬────────────┬─────────────────┬───────────────┘
             │          │            │                 │
             ▼          ▼            ▼                 ▼
   ┌────────────┐ ┌──────────┐ ┌──────────┐    ┌──────────────┐
   │  AWS RDS   │ │  Redis   │ │   Traccar│    │ Google Vision│
   │ (af-south-1)│ │ af-south-1│ │ af-south-1│    │   US (cross- │
   │ PostgreSQL │ │  Streams │ │          │    │    border)  │
   └─────┬──────┘ └────┬─────┘ └────┬──────┘    └──────┬───────┘
         │            │            │                 │
         │            │            │                 │
         ▼            │            │                 │
   ┌────────────┐    │            │                 │
   │  S3        │    │            │                 │
   │ (af-south-1)│    │            │                 │
   │ • GPS data │    │            │                 │
   │ • Accident  │    │            │                 │
   │   media     │    │            │                 │
   │ • DVIR photos│   │            │                 │
   │ • Work plans │   │            │                 │
   │ • Audit logs │   │            │                 │
   └─────┬──────┘    │            │                 │
         │            │            │                 │
         │            ▼            │                 │
         │ ┌──────────────────────────────────────┐  │
         │ │ Workers (notifications, escalation,│  │
         │ │  accident-freeze, OCR, retention)   │  │
         │ └──────────────────────────────────────┘  │
         │            │            │                 │
         │            │            │                 │
         │            ▼            ▼                 ▼
         │ ┌──────────────────────────────────────┐  │
         │ │ Africa's Talking (Kenya - in-country)│  │
         │ │ • SMS for emergency escalation       │  │
         │ └──────────────────────────────────────┘  │
         │                                         │
         │            ▼            ▼                 ▼
         │ ┌──────────────────────────────────────┐
         │ │ Google Maps Geocoding (US)           │
         │ │ • "last seen" reverse geocode        │
         │ └──────────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────┐
│ WebSocket Gateway (Socket.IO)   │
│ • Admin real-time map           │
│ • Driver shift updates          │
│ • 10-session cap per user       │
└─────────────────────────────────┘
```

### 3.2 Data Controller / Processor Roles

| Entity | Role | Jurisdiction |
|---|---|---|
| **Fleet Customer** | Data Controller | Kenya |
| **Helix Fleet Management Ltd** | Data Processor | Kenya |
| **AWS (af-south-1)** | Infrastructure Sub-processor | South Africa |
| **Google Cloud Vision** | OCR Sub-processor | United States |
| **Google Maps Geocoding** | Geocoding Sub-processor | United States |
| **Firebase Cloud Messaging** | Push Notification Sub-processor | United States |
| **Africa's Talking** | SMS Sub-processor | Kenya (in-country) |
| **Traccar (self-hosted)** | Tracker Decoder Sub-processor | South Africa |

---

## 4. Cross-Border Transfer Analysis

### 4.1 Cape Town Data Residency (af-south-1)

**Finding:** The primary data store (RDS PostgreSQL, Redis, S3) is hosted in **AWS af-south-1 (Cape Town, South Africa)**, which is **outside Kenya**.

**Assessment:**
- South Africa is bound by the Protection of Personal Information Act (POPIA), which provides a data protection regime substantially similar to the Kenya DPA 2019.
- The transfer is to a jurisdiction with adequate data protection standards.
- However, as a precaution, the DPIA recommends Standard Data Protection Clauses are documented in the DPA (§12).

### 4.2 Google Services (United States)

**Finding:** Google Cloud Vision, Google Maps Geocoding, and Firebase Cloud Messaging are US-based services. Personal data (receipt images for OCR, location data for geocoding, device tokens for notifications) is transferred to the United States.

**Assessment:**
- The United States does not have a data protection regime equivalent to the Kenya DPA 2019.
- **Safeguards applied:**
  1. **Minimum data principle:** Only the specific data needed for each service is sent:
     - Vision: receipt images only (no GPS or personal identifiers)
     - Maps Geocoding: only trailer "last seen" coordinates (already retained as summary data)
     - FCM: push tokens and notification payloads only (no GPS or personal data in tokens)
  2. **Data Processing Agreements** are in place with Google for GCP services.
  3. **Purpose limitation:** All use is strictly for platform functionality (OCR, maps, notifications).
  4. **Obfuscation/minimisation:** GPS data sent to Vision is scoped to receipt images only; no location data accompanies Vision OCR requests.
  5. **Tesseract fallback** (A1.4): OCR can fall back to on-instance Tesseract, avoiding Google transfer entirely for receipt processing.

### 4.3 Africa's Talking (Kenya — In-Country)

**Finding:** Africa's Talking SMS services are hosted in Kenya. No cross-border transfer occurs for SMS escalation data.

**Assessment:** ✅ No cross-border risk. Phone numbers are normalised to E.164 (`+254…`) format.

### 4.4 Necessity of Transfers

| Transfer | Data | Justified? | Mitigation |
|---|---|---|---|
| AWS af-south-1 | All platform data | Yes — infrastructure provider | Adequate jurisdiction (POPIA); fallback path documented (N1) |
| Google Vision (US) | Receipt images | Yes — OCR processing (A1.4) | Tesseract fallback; images only; no PII in images |
| Google Maps (US) | Trailer "last seen" coordinates | Yes — geocoding (C4.3) | Cached addresses; minimised; only summary coordinates |
| FCM (US) | Push token + notification payload | Yes — delivery receipts (N9) | No GPS/personal data in FCM payloads |
| Africa's Talking (KE) | Phone number + SMS content | Yes — emergency escalation (A1.8) | In-country; E.164 normalisation |

### 4.5 Fallback Path

If legal counsel requires true in-country storage, the fallback path (`docs/architecture/00-locked-decisions.md` N1 option b) is activated:
- **MinIO** (self-hosted S3-compatible) instead of AWS S3
- **Tesseract** on-premise instead of Google Vision
- **Self-hosted Nominatim** instead of Google Maps Geocoding
- **In-country push gateway** instead of FCM

This is a re-platform, not a patch.

---

## 5. Risks Identified

| ID | Risk | Category | Severity | Likelihood | Risk Score | Linked To |
|---|---|---|---|---|---|---|
| DPIA-01 | GPS location data transferred to US (Google Maps, FCM) | Cross-border transfer | Medium | Medium | 12 | §4.2 |
| DPIA-02 | Receipt images sent to US for OCR (Google Vision) | Cross-border transfer | Low | Medium | 6 | §4.2, A1.4 |
| DPIA-03 | Data stored outside Kenya (Cape Town, af-south-1) | Data residency | Medium | High | 15 | §4.1, R-101 |
| DPIA-04 | Over-retention of work-plan and DVIR photos (7 years) | Storage limitation | Low | Low | 3 | §6.3, R-106, M7 |
| DPIA-05 | Off-shift GPS discard could fail, retaining more than intended | Data minimisation | Low | Low | 2 | §6.2, C5.6 |
| DPIA-06 | Accident telemetry tampering (if hash chain broken) | Integrity | Low | Low | 2 | §6.5, C3.4 |
| DPIA-07 | Driver offline PIN brute-force (4-digit) | Security | Low | Medium | 3 | §6.7, B12/M4 |
| DPIA-08 | Emergency SOS may have empty telemetry off-shift | Functionality/Safety | Low | Low | 1 | §6.2, N3.2, R-107 |
| DPIA-09 | Admin MFA bypass via recovery codes | Security | Low | Low | 2 | §6.7, B12 |
| DPIA-10 | No third-party analytics, but future addition possible | Transparency | Low | Medium | 3 | §4.3 |

---

## 6. Mitigation Measures

### 6.1 Cross-Border Transfer Mitigations (DPIA-01, DPIA-02, DPIA-03)

1. **Legal basis:** Legitimate interests for operational necessity (fleet management requires GPS/maps/notifications); contract performance for OCR and communication.
2. **Data Processing Agreements** with Google and all subprocessors, incorporating Kenya DPA 2019-equivalent obligations.
3. **Data minimisation:** Only the minimum data necessary is sent to each service (§4.2).
4. **Safeguard documentation:** This DPIA serves as the documented transfer safeguard.
5. **Fallback path:** In-country infrastructure alternative documented (N1 option b).
6. **Regular review:** Sub-processor list reviewed annually; DPIA reviewed every 12 months.

### 6.2 Data Minimisation (DPIA-05)

1. **Off-shift GPS discard** implemented in the ingestion worker (C5.6/N3): telemetry positions outside `clock_in − 15 min` to `clock_out + 15 min` are discarded at ingest.
2. **Off-shift movement** is recorded as a timestamp-only `vehicle_movement_events` record (no coordinates).
3. **Driver consent** required before any GPS tracking (C5.5).
4. **Recovery mode** (N3.1) allows admin-enabled retention for a bounded window with mandatory reason and full audit trail — this is the only exception.

### 6.3 Storage Limitation (DPIA-04)

1. **Work-plan and DVIR photo retention** raised to 7 years (M7) to match the Kenyan payroll dispute window.
2. **Justification:** Proportionate under Kenya DPA 2019 Article 16(f) as necessary for legal defence (employment disputes, accident liability, defect liability).
3. **Audit trail:** Retention period is fixed and auditable; no extension without re-assessment.
4. **Object Lock (WORM):** Accident media stored in S3 Object Lock buckets, preventing premature deletion.

### 6.4 Data Integrity (DPIA-06)

1. **SHA-256 hash chain** on accident telemetry (C3.4): any tampering breaks the chain, detectable at review.
2. **Append-only tables** for `audit_logs`, `accident_telemetry`, `accident_media` — triggers reject UPDATE/DELETE (C6.5).
3. **`media_object_id` FK constraints** guarantee referenced objects exist (R-112).

### 6.5 Security Measures (DPIA-07, DPIA-09)

1. **Offline PIN** stored only as bcrypt hash in device keystore (B12) — never on servers.
2. **Brute-force protection:** 5 failures → 15-minute lock; 10 failures → remote wipe + forced re-login (M4).
3. **MFA/TOTP mandatory** for ADMIN and FLEET_MANAGER (A2.7).
4. **MFA recovery codes:** single-use, hashed in DB, shown once (§3, auth.md).
5. **Certificate pinning** on mobile apps (S-4) prevents man-in-the-middle.

### 6.6 Emergency SOS Telemetry (DPIA-08)

1. **Off-shift SOS** retroactively retains the configured freeze window from Traccar before purge (N3.2).
2. If no telemetry exists, the record is marked `telemetry_available = false` — never silently empty.
3. Last-known position from the phone is always captured as part of the mayday path (B17).

### 6.7 Ongoing Monitoring (DPIA-10)

1. **No third-party analytics** currently integrated.
2. If analytics are added in the future, a supplementary DPIA will be conducted.
3. **Security event telemetry** monitors for anomalous access patterns (§10, security.md).

---

## 7. Conclusion and Sign-off

### 7.1 Conclusion

The Helix Fleet Management platform implements strong data protection measures that align with the Kenya DPA 2019. The identified risks are predominantly **low severity** and are mitigated by:

- Data minimisation (off-shift GPS discard, consent-gated tracking)
- Strong technical and organisational measures (encryption, RBAC, MFA, tamper-evident logging)
- Legal safeguards for cross-border transfers (DPAs with subprocessors, POPIA adequacy)
- Proportionate retention periods (90 days for raw GPS, 7 years for compliance-critical records)

The residual risk is **LOW** and acceptable for go-live, provided legal counsel approves this DPIA.

### 7.2 Outstanding Items

| Risk | Status | Requirement |
|---|---|---|
| **R-101** this DPIA | ✅ Documents prepared | Legal counsel sign-off (below) |
| **R-106** over-retention | ✅ Justified & documented | None — documented as proportionate |
| **R-103** emergency numbers | ⚠️ PENDING | Transport counsel confirmation |
| **R-104** DVIR matrix | ⚠️ PENDING | Fleet safety officer review |

### 7.3 Sign-off

This DPIA requires **legal counsel approval** before production go-live (R-101 launch gate).

| Role | Name | Signature | Date | Status |
|---|---|---|---|---|
| **Data Protection Officer** | [Name] | ____________________ | [Date] | ✅ Draft complete |
| **Legal Counsel** | [Name] | ____________________ | [Date] | ⬜ **REQUIRED** — must be signed before go-live |
| **Head of Product / Engineering** | [Name] | ____________________ | [Date] | ✅ Approved internally |

---

## Appendices

### Appendix A: Relevant Architecture References

| Decision | Reference |
|---|---|
| Data residency (Cape Town) | `00-locked-decisions.md` N1, A1.10 |
| GPS consent requirement | `00-locked-decisions.md` C5.5 |
| Off-shift discard | `00-locked-decisions.md` C5.6, N3, N3.3 |
| Accident telemetry hash chain | `00-locked-decisions.md` C3.4 |
| Retention periods | `00-locked-decisions.md` C5.3, M7 |
| Audit log retention | `00-locked-decisions.md` C6.5 |
| MFA/TOTP requirement | `00-locked-decisions.md` A3.7, A2.7 |
| Offline PIN storage | `00-locked-decisions.md` B12 |
| Sub-processors | `01-service-boundaries.md` §2, N9, A1.4, A1.8, C4.3 |
| Single tenant | `00-locked-decisions.md` A2.5 |
| Encryption | `docs/security.md` §11 |
| Kenya DPA 2019 jurisdiction | `00-locked-decisions.md` A2.1 |

### Appendix B: Data Subject Rights Implementation

| Right | Implementation | Location |
|---|---|---|
| Access | Data export via admin tools + support request | `docs/backend/02-auth.md` §2 |
| Rectification | "Unlock for Correction" (B18); audit log preserves originals | `00-locked-decisions.md` B18 |
| Erasure | Subject to 7-year retention; soft delete (D3) | `00-locked-decisions.md` C5.3 |
| Restriction | Flag records as restricted | Privacy Policy §5.4 |
| Objection | Opt-out from non-essential processing | Privacy Policy §5.5 |
| Portability | CSV/JSON exports | Privacy Policy §5.6 |
| Consent withdrawal | Revocable via `user_consents` | `docs/backend/02-auth.md` §7 |

### Appendix C: Retention Schedule Summary

| Data | Retention | Legal Basis |
|---|---|---|
| Raw GPS (location_updates) | 90 days | Data minimisation (C5.3) |
| Shift records | 7 years | Employment/HOS compliance (C5.3) |
| Accident reports + media | 7 years, WORM | Insurance, legal (C5.3) |
| DVIR reports + photos | 7 years | Vehicle safety/NTSA (C5.3, M7) |
| Work plan photos | 7 years | Payroll disputes (M7) |
| Audit logs | 7 years, append-only | Compliance (C6.5) |
| Fuel/receipt data | 7 years | Financial records (C5.3) |
| Driver documents | 7 years after expiry | Regulatory (C3.10) |
| Vehicle documents | 7 years after expiry | Regulatory (C3.10) |
