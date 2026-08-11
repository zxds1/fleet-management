# Data Processing Agreement (DPA)

**Template Version:** 1.0  
**Effective Date:** [To be filled at signing]  
**Governing Law:** Kenya Data Protection Act, 2019 (Cap 110A)

**Company:** Helix Fleet Management Ltd  
**Registered Office:** Nairobi, Kenya

This Data Processing Agreement ("Agreement") is entered into between:

**(A) The Customer ("Controller"):**  
The entity subscribing to the Helix Fleet Management platform ("Platform"), being a fleet operator or organisation that determines the purposes and means of processing personal data through the Platform.

**(B) Helix Fleet Management Ltd ("Processor"):**  
A company registered in Kenya that provides the Platform as a data processing service on behalf of the Controller.

Each may be referred to herein as a "Party" and collectively as the "Parties."

---

## 1. Definitions

| Term | Meaning |
|---|---|
| **Personal Data** | Any information relating to an identified or identifiable natural person, as defined in Article 2 of the Kenya DPA 2019. |
| **Processing** | Any operation performed upon personal data, whether or not by automated means. |
| **Data Subject** | The identified or identifiable natural person to whom personal data relates. |
| **Data Protection Laws** | The Kenya Data Protection Act, 2019, its subsidiary legislation, and any other applicable data protection or privacy laws. |
| **Sub-processor** | Any person appointed by or on behalf of the Processor to process personal data on behalf of the Controller. |
| **Document** | This Agreement, including all schedules and appendices. |

---

## 2. Appointment

2.1 The Controller appoints the Processor as a **data processor** to process personal data solely for the **specific purposes** of providing the Helix Fleet Management platform, including GPS tracking, driver management, fleet operations, safety compliance, accident management, fuel tracking, maintenance scheduling, and administrative services.

2.2 The Processor accepts this appointment and will process personal data only on documented instructions from the Controller, except where required by applicable law to act without such instructions (in which case the Processor will inform the Controller of that legal requirement before processing, unless prohibited by law).

---

## 3. Scope and Purpose

### 3.1 Scope
This Agreement applies to all personal data processed by the Processor in the course of providing the Services, including:
- Driver personal data (identity, licence, employment, contact information)
- Vehicle and telemetry data (GPS location, speed, ignition state, odometer readings)
- Shift and Hours of Service data
- Fuel purchase and expense data
- Accident reports and media (photos, telemetry, witness statements)
- DVIR inspection data and defect reports
- Maintenance records and schedules
- Audit logs and authentication records

### 3.2 Purpose
The personal data is processed solely for:
1. Providing the Platform's core functionality (fleet tracking, driver management, safety monitoring)
2. Ensuring compliance with NTSA regulations and Kenyan employment law
3. Generating reports and analytics for fleet optimisation
4. Billing and payment processing (via M-Pesa through Africa's Talking)
5. Emergency response and accident management
6. System security, monitoring, and audit compliance

---

## 4. Duration

This Agreement commences on the Effective Date and continues for as long as the Processor provides the Services and processes personal data on behalf of the Controller, unless terminated earlier in accordance with its terms.

Upon termination of the Services, the Processor will, at the Controller's choice, either:
- **Return** all personal data to the Controller, or
- **Delete** all personal data, except for data retained in backup systems for the purposes of disaster recovery, which will be deleted or returned when such backups are next routinely destroyed.

The Processor will certify completion of deletion to the Controller upon request.

---

## 5. Nature and Purpose of Processing

### 5.1 Nature of Processing
The Processor will:
- Collect, store, and analyse personal data as input by the Controller's users (drivers, fleet managers, administrators)
- Process GPS telemetry from vehicle trackers
- Generate derived analytics (HOS state, efficiency baselines, anomaly detection)
- Send notifications and alerts (FCM push, Africa's Talking SMS, email)
- Produce reports and exports for the Controller's internal use
- Maintain audit logs for compliance purposes

### 5.2 Purpose of Processing
Processing is limited to the purposes set out in §3.2 above and as further detailed in the Controller's documented instructions via the Platform.

### 5.3 Processing by Personnel
The Processor will ensure that all personnel authorised to process personal data have committed themselves to confidentiality or are under an appropriate statutory obligation of confidentiality.

---

## 6. Types of Personal Data

The personal data processed includes the following categories:

### 6.1 Identity and Contact Data
- Full name, email address, phone number
- Driver's licence number, national ID number
- Vehicle registration numbers

### 6.2 Location and Telemetry Data
- GPS latitude/longitude coordinates (active shift only, with 15-minute buffer)
- Vehicle speed, ignition state, bearing, odometer readings
- Timestamped movement events (off-shift movement recorded as timestamp only — C5.6)

### 6.3 Employment and Operational Data
- Employment dates, job title, assigned vehicle
- Shift start/end times, duty status, rest periods
- Fuel gauge readings, fuel purchase amounts
- Maintenance schedules and completion records

### 6.4 Safety and Compliance Data
- Accident reports, photos, and telemetry evidence
- DVIR inspection results and defect photos
- Driver behaviour events (speeding, harsh braking)
- Emergency contact information

### 6.5 Technical and Security Data
- Device ID hashes, IP addresses
- Refresh token hashes (bcrypt), session identifiers
- Bcrypt-hashed offline PINs (stored only on the device, never on the Processor's servers)
- Audit log entries (who, what, when)

---

## 7. Categories of Data Subjects

The personal data concerns the following categories of data subjects:

1. **Drivers** — individuals operating vehicles in the Controller's fleet
2. **Fleet Managers** — individuals managing the Controller's fleet operations via the Platform
3. **Administrative Users** — individuals with admin or finance roles
4. **Auditors** — individuals reviewing compliance records
5. **Emergency Contacts** — individuals nominated for accident escalation
6. **Third Parties** — individuals appearing in accident photos or involved in incidents (e.g., other drivers, witnesses)

---

## 8. Processor Obligations

The Processor shall:

8.1 **Process only on documented instruction.** Process personal data only on the documented instructions of the Controller, unless required by law to act without such instruction, in which case the Processor will notify the Controller beforehand.

8.2 **Ensure confidentiality.** Ensure that persons authorised to process personal data have committed to confidentiality.

8.3 **Implement security measures.** Implement appropriate technical and organisational measures to ensure a level of security appropriate to the risk, as detailed in §10.

8.4 **Sub-processors.** Obtain the Controller's prior written authorisation before engaging Sub-processors. The Processor may engage Sub-processors only with the Controller's prior written consent. A list of approved Sub-processors is set out in §9.

8.5 ** Data Subject Rights.** Take reasonable steps to assist the Controller in fulfilling its obligations to respond to requests from data subjects seeking to exercise their rights under the Kenya DPA 2019 (access, rectification, erasure, restriction, objection, data portability).

8.6 ** **Assist the Controller with DPIAs.** Provide reasonable cooperation and assistance to the Controller in conducting Data Protection Impact Assessments (DPIAs) and prior consultations with the ODPC.

8.7 ** **Breach Notification.** Notify the Controller **without undue delay** after becoming aware of any personal data breach, providing at least: (a) a description of the nature of the breach; (b) the categories and approximate number of data subjects affected; (c) the categories and approximate number of personal data records affected; (d) a description of likely consequences; and (e) a description of remedial actions taken.

8.8 ** **Data Deletion / Return.** On termination or at the Controller's request, delete or return all personal data (except for data retained in backups for disaster recovery, which will be deleted on next routine destruction).

8.9 ** **Audit Rights.** Submit to audits and inspections (subject to reasonable notice and conditions) and provide the Controller with sufficient information to demonstrate compliance with this Agreement.

8.10 ** **Record of Processing.** Maintain records of all processing activities under this Agreement.

---

## 9. Sub-processors

The Processor uses the following Sub-processors for the purposes of providing the Services:

| Sub-processor | Purpose | Location |
|---|---|---|
| **Google Cloud Vision** | OCR on fuel receipts (A1.4) | United States |
| **Google Maps Geocoding API** | Reverse-geocoding for trailer "last seen" (C4.3) | United States |
| **Firebase Cloud Messaging (FCM)** | Push notifications (N9) | United States |
| **Africa's Talking** | SMS for emergency escalation (A1.8) | Kenya (in-country) |
| **Amazon Web Services (af-south-1)** | Primary hosting: RDS, Redis, S3 (A1.10/N1) | South Africa |
| **Traccar (self-hosted)** | GPS tracker protocol decoding (A1.1, N2.3) | South Africa (af-south-1) |

Each Sub-processor is bound by data protection obligations equivalent to those in this Agreement. The Processor will:
- Provide the Controller with a 30-day notice of any intended changes to Sub-processors
- Remain fully liable for all obligations of Sub-processors under this Agreement
- Ensure each Sub-processor is bound by written terms no less protective than this Agreement

The Processor will maintain and update a current list of Sub-processors, available at `docs/legal/data-processing-agreement.md` (this document).

---

## 10. Security Measures

The Processor implements the following technical and organisational measures, consistent with `docs/security.md` and the locked decisions in `docs/architecture/00-locked-decisions.md`:

### 10.1 Encryption
- **In transit:** TLS 1.3 on all network communications; HSTS with preload
- **At rest:** KMS-managed encryption for RDS PostgreSQL and S3; field-level encryption (AES-GCM) for MFA secrets
- **Object Lock (WORM):** 7-year retention on accident evidence bucket (C5.3)

### 10.2 Access Control
- **RBAC with union permissions** (N4/C6.2): DRIVER, DISPATCHER, FLEET_MANAGER, ADMIN, FINANCE, AUDITOR
- **MFA/TOTP mandatory** for ADMIN and FLEET_MANAGER (A2.7)
- **Device-bound refresh tokens** — server never stores offline PINs; PINs are bcrypt-hashed in device keystores only (B12)
- **Session cap:** 10 concurrent sessions per user (A1.6)

### 10.3 Physical and Environmental
- **Single-tenant** infrastructure (A2.5) — no shared compute with other organisations
- **Multi-AZ RDS:** RPO 15 min, RTO 2 h, PITR retained 35 days (C5.4)

### 10.4 Monitoring and Logging
- **CloudWatch** (infrastructure) + **Sentry** (application) monitoring (C5.7)
- **Append-only audit logs** — triggers reject UPDATE/DELETE (C6.5)
- **Security event telemetry** — alerts on auth bursts, impossible-travel, WAF blocks (§10, security.md)
- **Tamper-evident telemetry** — SHA-256 hash chain on accident evidence (C3.4)

### 10.5 Application Security
- **Input validation:** zod schemas on all inputs; prototype-pollution-safe JSON parsing (security.md §3)
- **Injection prevention:** parameterised SQL only; no command/OS/NoSQL injection surfaces
- **Media security:** 60-second presigned PUT URLs; malware scan on ingest (S-2); EXIF stripping (C5.2)
- **Rate limiting:** per-IP and per-user sliding windows; strict on auth endpoints (S-3)

---

## 11. Data Subject Rights Assistance

The Processor will, to the extent technically feasible and within a reasonable timeframe, assist the Controller in fulfilling its obligations to respond to data subject requests:

| Right | How the Processor Assists |
|---|---|
| **Access (Art 21)** | Provides data export via Controller admin tools; raw data access via support request |
| **Rectification (Art 22)** | "Unlock for Correction" workflow for verified shifts (B18); audit log preserves originals |
| **Erasure (Art 23)** | Deletion subject to retention obligations (7-year minimum for certain records) |
| **Restriction (Art 24)** | Flags user records as restricted; excludes from analytics |
| **Objection (Art 25)** | Supports opt-out from non-essential processing |
| **Data Portability (Art 26)** | Exports in structured, machine-readable formats (CSV/JSON) |
| **Withdraw Consent (Art 19)** | GPS consent is revocable via user_consents table (C5.5) |

Requests from data subjects should be submitted through the Controller, who will forward them to the Processor via the designated DPO contact.

---

## 12. International Data Transfers

12.1 The personal data will be transferred to and processed in **South Africa (AWS af-south-1, Cape Town)**, which is outside Kenya.

12.2 The Processor has implemented appropriate safeguards for this transfer, including:
- Standard data protection clauses modelled on the Kenya DPA 2019 requirements
- The DPIA (`docs/legal/dPIA.md`) documents the cross-border transfer analysis and has been approved by legal counsel (R-101)
- Sub-processors (Google services, FCM) are bound by equivalent obligations

12.3 The fallback path (self-hosted MinIO + Tesseract + self-hosted Nominatim in-country) is documented in `00-locked-decisions.md` N1 option (b) and may be activated if legally required.

---

## 13. Audit Rights

13.1 The Controller (or a mutually agreed, independent auditor) may, no more than once per calendar year and upon 30 days' written notice, conduct an audit or inspection of the Processor's facilities, records, and controls relating to this Agreement.

13.2 The Processor will provide all information reasonably necessary to demonstrate compliance with this Agreement, including:
- Current Sub-processor list
- Security certifications and audit reports
- Documentation of technical and organisational measures
- Records of processing activities
- Data breach incident reports

13.3 The Controller will bear its own costs and time for any audit. If an audit reveals a material breach of this Agreement, the Processor will bear the reasonable cost of the audit.

13.4 Where the Processor offers independent third-party audit reports or certifications equivalent to the requirements of this Article, the Processor will provide such reports to the Controller.

---

## 14. Governing Law

This Agreement is governed by and construed in accordance with the laws of Kenya, including the Kenya Data Protection Act, 2019 (Cap 110A). Any disputes arising out of or in connection with this Agreement shall be subject to the exclusive jurisdiction of the courts of Kenya.

---

## 15. Miscellaneous

15.1 **Entire Agreement.** This Agreement, together with the Privacy Policy and DPIA, constitutes the entire agreement between the Parties regarding the subject matter hereof.

15.2 **Amendments.** This Agreement may only be amended by written agreement signed by authorised representatives of both Parties.

15.3 **Severability.** If any provision is found to be invalid or unenforceable, the remaining provisions remain in full force.

15.4 **Assignment.** The Processor may not assign this Agreement without the Controller's prior written consent. The Controller may assign this Agreement to a successor in interest in connection with a merger, acquisition, or sale of all or substantially all of its assets.

15.5 **Notices.** All notices must be in writing and sent to the contact details in §16.

15.6 **Binding Effect.** This Agreement binds and benefits the Parties and their successors and assigns.

---

## 16. Contact

**Data Protection Officer (DPO):**  
Helix Fleet Management Ltd  
Nairobi, Kenya  
Email: **dpo@helixfleet.co.ke**  
Phone: +254 700 000 000

---

*IN WITNESS WHEREOF, the Parties have executed this Agreement by their authorised representatives as of the Effective Date.*

| Controller (Customer) | Processor (Helix Fleet Management Ltd) |
|---|---|
| Name: | Name: |
| Title: | Title: |
| Signature: | Signature: |
| Date: | Date: |
