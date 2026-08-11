# Terms of Service

**Effective Date:** 1 January 2025  
**Last Updated:** 10 August 2026

**Company:** Helix Fleet Management Ltd  
**Registered Office:** Nairobi, Kenya  

These Terms of Service ("Terms") govern your ("Customer", "you", or "your") access to and use of the Helix Fleet Management platform, including the mobile applications, web admin console, REST API, backend services, and all related software (collectively, the "Platform" or "Services").

By accessing or using the Services, you agree to be bound by these Terms. If you do not agree with any part of these Terms, you must not use the Services.

---

## 1. Acceptance of Terms

1.1 These Terms constitute a legally binding agreement between you and Helix Fleet Management Ltd governing your access to and use of the Services.

1.2 By creating an account, clicking "I Accept", or otherwise using the Services, you represent that you are at least 18 years old, have the legal capacity to enter into this agreement, and are accessing the Services for business purposes as a fleet operator, driver, or authorised representative.

1.3 If you are accessing the Services on behalf of a business entity (e.g., as a fleet manager or administrator), you represent that you have the authority to bind that entity to these Terms.

1.4 The Platform is governed by the locked decisions in `docs/architecture/00-locked-decisions.md` and the service boundaries in `docs/architecture/01-service-boundaries.md`. In the event of a conflict between these Terms and the architecture documents, these Terms control for legal matters.

---

## 2. Account Registration and Access

2.1 To use the Services, you must create an account by providing accurate, complete, and current information. You are responsible for maintaining the confidentiality of your account credentials.

2.2 **Administrative Access:** Admin and Fleet Manager accounts require MFA/TOTP (A2.7/A3.7). You agree to keep your MFA methods secure and notify us immediately of any unauthorised access.

2.3 **Driver Access:** Drivers use a 4-digit offline PIN (B12) stored only on the device (bcrypt-hashed in the device keystore). The server stores only a hash of your `device_id` and a device-bound refresh token, never the PIN itself.

2.4 You may not share your account credentials with any third party, except that fleet managers may provision driver devices on behalf of their drivers (D-12).

2.5 Your account may be suspended or terminated if you provide false information, fail to keep your account secure, or violate these Terms.

---

## 3. User Obligations

### 3.1 Safe Driving
You agree to operate all vehicles safely and in accordance with Kenyan traffic laws (NTSA regulations). The Platform enforces Hours of Service (HOS) rules (C3.1): 8 hours driving per day, 30-minute break after 4 hours of cumulative driving, 10-hour daily rest, 14-hour duty window. The 14-hour rule does not auto-clock-out; overrun shifts require driver or admin closure (N6).

### 3.2 Accident Reporting
You must report all accidents promptly through the Platform. The Platform provides a permanent "SEND HELP NOW" action (B17) that submits GPS coordinates and bypasses photo requirements, firing full escalation immediately. Standard accident reports require telemetry (C3.3), a police OB number, and relevant photos (C3.6).

### 3.3 Vehicle Inspections
Drivers must complete a Driver Vehicle Inspection Report (DVIR) before each shift (C1.4). DVIR items are severity-classified: `BLOCKER` severity items fail the shift and quarantine the vehicle; `WARNING` severity items allow the shift to proceed with an admin flag (C1.5). You must review previous defects and provide a typed signature (C1.6).

### 3.4 GPS Consent
Before starting a shift, each driver must provide explicit consent for GPS tracking during working hours (C5.5). Consent is recorded in `app.user_consents` and can be withdrawn at any time via the DPO.

### 3.5 Data Accuracy
You are responsible for ensuring that all data you enter into the Platform (odometer readings, fuel gauge levels, defect reports, etc.) is accurate. The Platform implements conflict detection for divergent data sources (B15/M3) and will flag discrepancies for manual review.

---

## 4. Subscription Tiers and Billing

### 4.1 Subscription Plans
The Services are offered on the following subscription tiers (D-1):

| Tier | Target | Features | Billing |
|---|---|---|---|
| **Basic** | Small fleets (up to 10 vehicles) | Core GPS tracking, driver app, basic dashboard | Monthly in advance |
| **Professional** | Medium fleets (11–100 vehicles) | All Basic + HOS compliance, DVIR, fuel tracking, maintenance alerts, FCM push | Monthly or annual |
| **Enterprise** | Large fleets (100+ vehicles) | All Professional + audit logs, API access, custom HOS policies, multi-role management, dedicated support, DPA available | Annual contract |

### 4.2 Pricing
Pricing is set at `system_config` and is subject to change upon 30 days' notice. All prices are in **Kenyan Shillings (KES)** (A2.2).

### 4.3 M-Pesa Payments
4.3.1 Subscription fees are processed via **M-Pesa** (A1.8). Payments are facilitated through **Africa's Talking**, a Kenyan payment aggregator.

4.3.2 You authorise us to collect subscription fees automatically via M-Pesa STK Push to the phone number registered with your account.

4.3.3 Payment failures: if an M-Pesa payment fails or is reversed, your account may be suspended until payment is resolved. No pro-rata refunds are issued for partial months of service.

4.3.4 You receive a payment confirmation via SMS through Africa's Talking (sender ID: `FLEET_ALERT`) (A1.8).

### 4.4 Late Payment
Unpaid invoices accrue interest at the maximum rate permitted by Kenyan law. Accounts more than 15 days overdue may be suspended or terminated without notice.

---

## 5. Data Usage and Ownership

### 5.1 Your Data
You retain all ownership rights in the data you input into the Platform ("Customer Data"), including driver records, vehicle data, shift reports, accident reports, and inspection results.

### 5.2 License to Use
You grant us a non-exclusive, worldwide, royalty-free license to use, copy, display, and distribute the Platform and to process Customer Data solely to provide the Services and as described in our Privacy Policy.

### 5.3 Aggregate Data
We may use anonymised, aggregated data for analytics and product improvement, provided it does not identify you or any individual.

### 5.4 Data Residency
Customer Data is stored in **AWS af-south-1 (Cape Town, South Africa)** (A1.10/N1). The DPIA documents the cross-border transfer safeguards under the Kenya DPA 2019. Africa's Talking SMS services remain in-country (Kenya).

---

## 6. Disclaimers and Limitation of Liability

### 6.1 Disclaimer
6.1.1 THE SERVICES ARE PROVIDED "AS IS" AND "AS AVAILABLE". WE DISCLAIM ALL WARRANTIES, WHETHER EXPRESS, IMPLIED, STATUTORY, OR OTHERWISE, INCLUDING WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, AND NON-INFRINGEMENT.

6.1.2 WE DO NOT WARRANT THAT THE SERVICES WILL BE UNINTERRUPTED, SECURE, OR ERROR-FREE, OR THAT DEFECTS WILL BE CORRECTED.

6.1.3 GPS accuracy depends on device and satellite conditions. The Platform interpolates telemetry gaps ≤5 minutes and flags gaps >5 minutes as `tracker_reliability = 'PARTIAL'` (C1.9). Telemetry is not guaranteed to be 100% accurate.

6.1.4 The Platform processes OCR on fuel receipts via Google Cloud Vision with a Tesseract fallback (A1.4). OCR output is advisory; driver-entered values are authoritative until admin verification.

### 6.2 Limitation of Liability
6.2.1 TO THE MAXIMUM EXTENT PERMITTED BY LAW, IN NO EVENT SHALL HELIX FLEET MANAGEMENT LTD BE LIABLE FOR ANY INDIRECT, INCIDENTAL, SPECIAL, CONSEQUENTIAL, OR PUNITIVE DAMAGES, OR ANY LOSS OF DATA, PROFITS, REVENUE, OR BUSINESS, WHETHER DIRECT OR INDIRECT, ARISING OUT OF OR IN CONNECTION WITH YOUR USE OF THE SERVICES.

6.2.2 OUR TOTAL AGGREGATE LIABILITY UNDER THESE TERMS SHALL NOT EXCEED THE AMOUNT PAID BY YOU FOR THE SERVICES IN THE 12 MONTHS IMMEDIATELY PRECEDING THE EVENT GIVING RISE TO THE CLAIM.

6.2.3 NOTHING IN THESE TERMS EXCLUDES OR LIMITS OUR LIABILITY FOR DEATH OR PERSONAL INJURY CAUSED BY OUR NEGLIGENCE, FRAUD, OR FRAUDULENT MISREPRESENTATION, OR ANY OTHER LIABILITY THAT CANNOT BE EXCLUDED OR LIMITED UNDER KENYAN LAW.

### 6.3 No Liability for Third-Party Services
We are not responsible for the availability or accuracy of third-party services integrated with the Platform, including Google Cloud Vision, Google Maps, FCM, Africa's Talking, and AWS infrastructure.

---

## 7. Termination

### 7.1 By You
You may terminate your account at any time by contacting support. Upon termination, your data will be retained in accordance with our retention schedule (see Privacy Policy §4) to comply with legal and regulatory obligations.

### 7.2 By Us
We may suspend or terminate your access to all or part of the Services at any time, with or without cause, with 30 days' notice to the email address on file.

### 7.3 Effect of Termination
Upon termination, (a) all licenses granted under these Terms cease, (b) you must cease all use of the Services, and (c) we will retain your data in accordance with applicable retention periods.

### 7.4 Survival
Sections 5 (Data Usage and Ownership), 6 (Disclaimers and Limitation of Liability), 7 (Termination), 8 (Governing Law), and 9 (Miscellaneous) survive termination.

---

## 8. Governing Law and Dispute Resolution

8.1 These Terms are governed by and construed in accordance with the laws of Kenya, without regard to its conflict of law principles.

8.2 Any dispute, controversy, or claim arising out of or in connection with these Terms, including any question regarding its existence, validity, or termination, shall be subject to the exclusive jurisdiction of the courts of Kenya.

8.3 We encourage you to contact us first to resolve any dispute. Our contact details are provided in the Privacy Policy.

---

## 9. Suspension by Fleet Manager

9.1 A Fleet Manager or Admin may suspend a driver's account at any time. Upon suspension, the driver's device-bound refresh token is invalidated server-side (B13). When the driver next syncs, the API returns `403 ACCOUNT_SUSPENDED`, and the driver cannot start new shifts until reinstated.

9.2 Suspended drivers cannot override this restriction through offline mode. The 24-hour offline window (B13) applies, after which the device is forced online and the suspension is enforced.

---

## 10. General Provisions

10.1 **Entire Agreement:** These Terms, together with our Privacy Policy, Cookie Policy, Data Processing Agreement, and DPIA, constitute the entire agreement between you and us regarding the Services.

10.2 **Severability:** If any provision of these Terms is held invalid or unenforceable, the remaining provisions remain in full force and effect.

10.3 **Waiver:** Failure to enforce any right or provision under these Terms shall not constitute a waiver of such right or provision.

10.4 **Assignment:** You may not assign or transfer these Terms without our prior written consent. We may assign these Terms without restriction.

10.5 **Changes to Terms:** We may update these Terms from time to time. We will notify you of material changes by posting a notice on the Platform and, where appropriate, via email or push notification.

10.6 **No Third-Party Rights:** These Terms do not confer any rights on any person or entity other than you and Helix Fleet Management Ltd.

---

**Contact Information:**  
Helix Fleet Management Ltd  
Nairobi, Kenya  
Email: support@helixfleet.co.ke  
DPO: dpo@helixfleet.co.ke
