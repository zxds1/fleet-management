# Privacy Policy

**Effective Date:** 1 January 2025  
**Last Updated:** 10 August 2026

**Company:** Helix Fleet Management Ltd  
**Registered Office:** Nairobi, Kenya  
**Company Registration:** [Registration Number withheld for template]  
**Contact (Data Protection Officer):** dpo@helixfleet.co.ke  

This Privacy Policy describes how Helix Fleet Management Ltd ("we", "us", or "our") collects, uses, discloses, and protects your personal data when you use the Helix Fleet Management platform ("Platform"), including the mobile applications, web admin console, REST API, and backend services (collectively, the "Services").

We are committed to complying with the Kenya Data Protection Act, 2019 (Cap 110A) ("Kenya DPA 2019") and other applicable data protection laws.

---

## 1. What Personal Data We Collect

### 1.1 Driver and User Data

| Category | Examples |
|---|---|
| **Identity Data** | Full name, email address, phone number, driver's licence number, national ID number |
| **Employment Data** | Employer, job title, hire date, vehicle assignments, shift records |
| **Device Data** | Device ID hash, OS version, app version, IP address at login |
| **Biometric / Security Data** | Bcrypt-hashed offline PIN (stored only on the device, never on our servers), TOTP secrets (encrypted at rest) |

### 1.2 GPS and Telemetry Data

| Category | Description |
|---|---|
| **GPS Location** | Real-time vehicle latitude/longitude coordinates, speed, ignition state, bearing, accuracy |
| **Odometer Readings** | Start and end odometer values for each shift, captured via driver photo + manual entry |
| **Driving Behaviour** | Hard braking, harsh acceleration, speeding events, idling time |
| **Vehicle Diagnostics** | Fuel level, engine hours, fault codes (via OBD-II through the tracker CAN bus) |

### 1.3 Operational Data

| Category | Description |
|---|---|
| **Shift Data** | Clock-in/clock-out times, duty status, Hours of Service (HOS) state, break inference |
| **Fuel Data** | Fuel purchase amounts, card last four digits (never full PAN), fuel gauge readings |
| **Accident Data** | Accident reports, telemetry snapshots (5 min before / 1 min after), accident photos, police OB numbers, insurance claim numbers |
| **DVIR Data** | Driver Vehicle Inspection Reports, defect photos, inspector notes, signatures |
| **Maintenance Data** | Maintenance schedules, vendor records, parts lists, costs, downtime records |
| **Work Plan Photos** | Up to 5 photos per work plan, used for delivery/inspection confirmation |

### 1.4 Document and Media Data

| Category | Description |
|---|---|
| **Asset Documents** | Vehicle registration, insurance, fitness certificates, trailer documents |
| **Driver Documents** | Licence, medical certificate, passport photos |
| **Accident Media** | Timestamped photos and a SHA-256 hash-chain of telemetry (tamper-evident) |
| **Receipt Photos** | Fuel and expense receipts processed via Google Cloud Vision or Tesseract |

### 1.5 Communication Data

| Category | Description |
|---|---|
| **Notifications** | Push tokens (FCM), notification preferences, quiet hours |
| **SMS** | Phone numbers for Africa's Talking SMS escalation (emergency contacts only) |
| **Audit Logs** | All user actions (who, what, when) for compliance auditing |

---

## 2. How We Use Your Personal Data

### 2.1 Fleet Management Operations
- Track vehicle location and utilisation in real time
- Record and verify driver shifts, clock-in/clock-out, and Hours of Service compliance
- Capture fuel usage, odometer readings, and refuel events
- Manage vehicle assignments and driver schedules

### 2.2 Safety and Compliance
- Detect speeding, harsh driving, and unsafe behaviour
- Generate accident reports with telemetry evidence (C3.4 — tamper-evident hash chain)
- Enforce Driver Vehicle Inspection Reports (DVIR) and defect review workflows
- Monitor document expirations (licences, insurance, fitness certificates)
- Manage emergency escalation (C3.5 — Police, Ambulance, Fleet Manager contacts)
- Compute Hours of Service to ensure NTSA driving/rest compliance (C3.3 hard block on rest violations)

### 2.3 Financial and Billing
- Process M-Pesa payments via Africa's Talking for subscription fees (A1.8)
- Generate payroll exports (Driver, Vehicle, Shift Date, Total Hours, Driving Hours, Total KM)
- Reconcile fuel card purchases against uploaded statements (A1.9)
- Track vehicle operating costs (fuel, maintenance, tolls, parking)

### 2.4 Analytics and Improvement
- Compute efficiency baselines per vehicle (B6 — rolling 30-shift average)
- Generate sustainability and fuel efficiency reports
- Improve the Platform through usage analytics and bug detection
- Train internal operational dashboards for fleet managers

### 2.5 Legal and Regulatory Compliance
- Maintain append-only audit logs for 7 years (C6.5) for compliance and dispute resolution
- Retain accident media, DVIR, work plans, and receipts for 7 years (C5.3/M7)
- Discard GPS positions outside active shift windows + 15-minute buffer (C5.6)
- Apply retention transforms at ingest time (§2, service-boundaries)

---

## 3. Legal Basis for Processing

Under the Kenya DPA 2019, we rely on the following legal bases:

| Purpose | Legal Basis | Section |
|---|---|---|
| Performance of a contract (shifting, fuel tracking, billing) | Article 16(a) — necessity for performance of a contract | Contractual necessity |
| Compliance with legal obligations (NTSA HOS, safety, record-keeping) | Article 16(b) — necessity for compliance with a legal obligation | Legal obligation |
| Legitimate interests (fleet analytics, efficiency, security monitoring) | Article 16(f) — necessity for legitimate interests | Legitimate interests |
| Consent (explicit consent for specific optional processing) | Article 16(c) — consent given | Consent |
| Vital interests (emergency accident response) | Article 16(d) — necessity to protect vital interests | Vital interests |

**Note on off-shift location data (C5.6/N3):** The Platform collects GPS 24/7 from trackers, but off-shift location is **discarded at ingest** — only a timestamp of movement is retained. An off-shift SOS triggers retroactive telemetry retention (N3.2). This design minimises data collection while preserving safety.

**Note on consent:** Each driver must provide explicit consent for GPS tracking for working hours (C5.5). This consent is recorded in `app.user_consents` and must be accepted before a driver can start a shift. See §7 below.

---

## 4. Data Retention Periods

| Data Category | Retention Period | Legal Basis |
|---|---|---|
| Raw GPS positions (location_updates) | 90 days (C5.3) | Minimisation; aggregated into summaries |
| Shift records (shifts, driver_duty_segments, driver_hos_state) | 7 years (C5.3) | Employment / HOS compliance |
| Fuel purchase records + receipts | 7 years (C5.3) | Financial record-keeping |
| Accident reports + media (accident_telemetry, accident_media) | 7 years, WORM/Object Lock (C5.3) | Insurance, legal, dispute resolution |
| DVIR reports + inspection photos | 7 years (C5.3, M7) | Vehicle safety / NTSA compliance |
| Work plan photos | 7 years (C5.3, M7) | Payroll dispute window |
| Audit logs (audit_logs) | 7 years, append-only (C6.5) | Compliance auditing |
| Driver documents (licence, medical) | 7 years after expiry (C3.10) | Regulatory compliance |
| Vehicle documents (registration, insurance) | 7 years after expiry (C3.10) | Regulatory compliance |
| Maintenance records | 7 years (C3.11) | Vehicle history / safety |
| Emergency contact / SMS numbers | While account active + 30 days | Escalation (C3.5, A1.8) |
| Refresh tokens (user_sessions) | 7 days, or 24 h offline window (B13) | Session management |
| FCM push tokens | While app is active | Push notifications (N9) |

Work-plan and DVIR photo retention was deliberately raised from 90 days / 1 year to 7 years to match the Kenyan payroll dispute window. This over-retention is acknowledged in the DPIA (R-106) as proportionate under the Kenya DPA 2019 for dispute resolution purposes.

---

## 5. Data Subject Rights

Under the Kenya DPA 2019, you have the right to:

### 5.1 Right of Access (Article 21)
Request a copy of the personal data we hold about you, including:
- GPS location history for your shifts
- Shift and HOS records
- Accident reports you are involved in
- Fuel and expense records
- Audit log entries concerning your actions

### 5.2 Right to Rectification (Article 22)
Request correction of inaccurate personal data. For verified shifts, an "Unlock for Correction" workflow is available (B18) — original values are preserved in audit logs.

### 5.3 Right to Erasure (Article 23)
Request deletion of personal data. Note that certain categories (audit logs, accident media, financial records) are retained for legal/regulatory purposes (7-year minimum) and cannot be deleted during the retention period.

### 5.4 Right to Restriction of Processing (Article 24)
Request that we restrict processing of your personal data in certain circumstances, such as when you dispute the accuracy of the data.

### 5.5 Right to Object (Article 25)
Object to processing based on legitimate interests. Note that off-shift GPS discard (C5.6) and shift-only telemetry retention already implement data minimisation.

### 5.6 Right to Data Portability (Article 26)
Receive your personal data in a structured, commonly used, machine-readable format, including:
- Shift records and HOS state
- Fuel and expense records
- DVIR reports
- Audit trail of your actions

### 5.7 Right to Withdraw Consent (Article 19)
Withdraw consent for GPS tracking at any time. Note that withdrawing GPS consent prevents clock-in (C5.5) and may affect your ability to work shifts.

### 5.8 Right to Lodge a Complaint (Article 34)
File a complaint with the Office of the Data Protection Commissioner (ODPC) in Kenya.

To exercise any of these rights, contact our Data Protection Officer at **dpo@helixfleet.co.ke**. We will respond within 30 days as required by the Kenya DPA 2019.

---

## 6. Data Sharing and Disclosure

### 6.1 Service Providers (Processors)

We share personal data with the following service providers, who process data solely on our behalf under contractual obligations:

| Service | Purpose | Location |
|---|---|---|
| **Google Cloud Vision** | OCR for fuel receipts (A1.4) | United States (cross-border) |
| **Google Maps Geocoding API** | Reverse-geocode trailer "last seen" locations (C4.3) | United States (cross-border) |
| **Firebase Cloud Messaging (FCM)** | Push notifications with delivery receipts (N9) | United States (cross-border) |
| **Africa's Talking** | SMS for emergency escalation (A1.8) | Kenya (in-country) |
| **AWS (af-south-1)** | Primary data hosting: RDS PostgreSQL, Redis, S3 (A1.10, N1) | South Africa (cross-border to Kenya) |
| **Traccar (self-hosted)** | GPS tracker protocol decoding and forwarding (A1.1, N2.3) | South Africa (af-south-1) |

### 6.2 Cross-Border Transfers

Personal data is primarily hosted in **AWS af-south-1 (Cape Town, South Africa)**, which is outside Kenya. We rely on the following safeguards for cross-border transfers under the Kenya DPA 2019:

1. **Adequacy determination:** South Africa has a data protection regime (POPIA) substantially similar to the Kenya DPA 2019.
2. **Standard contractual clauses:** Data Processing Agreements with all subprocessors include Kenya DPA 2019-compliant transfer safeguards.
3. **Purpose limitation:** Only the minimum data necessary is transferred to each service.

Transfers to Google services (Vision, Maps, FCM) and FCM are documented in detail in our **Data Protection Impact Assessment (DPIA)** — see `docs/legal/dPIA.md`. The DPIA has been approved by our legal counsel (R-101).

Africa's Talking SMS services remain in-country (Kenya), and emergency numbers are normalised to E.164 (`+254…`).

### 6.3 Legal and Emergency Disclosure

We may disclose personal data when required by law or to protect rights and safety:

- **Emergency services:** In an accident, telemetry and location data may be shared with police, ambulance, or fleet managers (C3.5, B17 — "SEND HELP NOW" mayday path).
- **Legal requests:** In response to valid court orders, subpoenas, or regulatory requests (ODPC).
- **Insurance claims:** Accident data, telemetry, and photos may be shared with insurers (C3.6).
- **NTSA compliance:** HOS and shift data may be reported as required by NTSA regulations.

### 6.4 Business Transfers

In the event of a merger, acquisition, or sale of all or part of our assets, personal data may be transferred to the acquiring entity, subject to the same protection standards.

---

## 7. Cookies and Consent

### 7.1 API Authentication

Our backend API uses **JWT Bearer tokens** (A3.7) for authentication. We do **not** use cookies for authentication. Access tokens are held in memory on the device, and refresh tokens are stored in encrypted storage (`expo-secure-store` on mobile, see §9).

### 7.2 Mobile App Storage

The Expo (React Native) mobile apps use:
- **`expo-secure-store`** — encrypted keychain/keystore for refresh tokens and biometric keys
- **`expo-sqlite`** — durable offline queue for pending writes (no PII stored beyond what is needed for sync)

### 7.3 Web Admin Console (Future)

If a web admin console is introduced in a future phase, it will use session-based JWT Bearer tokens in `Authorization` headers, and any session cookies will be strictly necessary, session-only, and documented under a future amendment to this policy.

See our separate **Cookie Policy** (`docs/legal/cookie-policy.md`) for details.

---

## 8. Security Measures

We implement the following technical and organisational measures to protect personal data, in accordance with Article 28 of the Kenya DPA 2019 and our ISO 27001 / SOC 2 compliance framework (`docs/security.md`):

### 8.1 Data in Transit
- **TLS 1.3** everywhere (API, WebSocket, S3, Traccar forwarding)
- **HSTS** with includeSubDomains and preload at the ingress
- **Certificate pinning** on mobile apps for API, WebSocket, and S3/Google endpoints (S-4)

### 8.2 Data at Rest
- **Encryption at rest** via KMS for RDS PostgreSQL + S3
- **Object Lock (WORM)** on the accident evidence S3 bucket (7-year retention, C5.3)
- **Field-level encryption** for MFA secrets (AES-GCM with KMS data key)

### 8.3 Access Control
- **RBAC with union permissions** (N4/C6.2): DRIVER, DISPATCHER, FLEET_MANAGER, ADMIN, FINANCE, AUDITOR
- **MFA/TOTP mandatory** for ADMIN and FLEET_MANAGER roles (A2.7)
- **Device-bound refresh tokens** — server never stores offline PIN; PIN is bcrypt-hashed in device keystore only (B12)
- **Least-privilege IAM** on all cloud resources

### 8.4 Security Monitoring
- **CloudWatch** (infrastructure) + **Sentry** (application errors) (C5.7)
- **Append-only audit logs** — triggers reject UPDATE/DELETE on `audit_logs`, `accident_telemetry`, `accident_media` (C6.5)
- **Security event telemetry** — alerts on auth bursts, 401/403/429 spikes, impossible-travel logins, WAF blocks (§10, security.md)
- **Tamper-evident telemetry** — SHA-256 hash chain on accident telemetry (C3.4)

### 8.5 Physical and Environmental
- **Single-tenant** deployment (A2.5) — no shared infrastructure with other organisations
- **Multi-AZ RDS** with RPO 15 min, RTO 2 h, PITR retained 35 days (C5.4)

---

## 9. International Data Transfers

### 9.1 Data Residency

Primary data is stored in **AWS af-south-1 (Cape Town, South Africa)**. We acknowledge this is outside Kenya and have documented the cross-border transfer safeguards in our DPIA. The fallback path (self-hosted MinIO + Tesseract + self-hosted Nominatim) is documented in `00-locked-decisions.md` N1 option (b) and can be activated if legally required.

### 9.2 Subprocessors

Subprocessors are listed in §6.1. We maintain a current list of subprocessors and will notify you of any new subprocessor 30 days in advance. Enterprise clients may object within that window.

### 9.3 Safeguards

All subprocessors are bound by Data Processing Agreements (see `docs/legal/data-processing-agreement.md`) that impose Kenya DPA 2019-equivalent obligations.

---

## 10. Children's Privacy

The Services are not directed to children under 18. We do not knowingly collect personal data from children. Drivers must be of legal working age and hold a valid licence.

---

## 11. Changes to This Privacy Policy

We may update this Privacy Policy from time to time. We will notify you of any material changes by posting the new policy on our platform and, where appropriate, via push notification or email. The "Last Updated" date at the top will reflect the latest revision.

---

## 12. Contact Us

If you have any questions about this Privacy Policy or wish to exercise your data protection rights:

**Data Protection Officer (DPO):**  
Helix Fleet Management Ltd  
Nairobi, Kenya  
Email: **dpo@helixfleet.co.ke**  
Phone: +254 700 000 000

**Postal Enquiries:**  
Data Protection Officer  
Helix Fleet Management Ltd  
[Postal address withheld for template]  
Nairobi, Kenya

You also have the right to lodge a complaint with the Office of the Data Protection Commissioner (ODPC), Kenya.

---

*This document is maintained alongside the Data Processing Agreement (`docs/legal/data-processing-agreement.md`) and the Data Protection Impact Assessment (`docs/legal/dPIA.md`). This Policy does not cover processing by our enterprise customers acting as data controllers; for those relationships, the DPA applies.*

**Governing Law:** This Privacy Policy is governed by and construed in accordance with the laws of Kenya, including the Kenya Data Protection Act, 2019.
