# Cookie Policy

**Effective Date:** 1 January 2025  
**Last Updated:** 10 August 2026

**Company:** Helix Fleet Management Ltd  
**Registered Office:** Nairobi, Kenya

This Cookie Policy explains how Helix Fleet Management Ltd ("we", "us", or "our") uses cookies and similar tracking technologies when you access or use the Helix Fleet Management platform ("Platform" or "Services").

---

## 1. Important: Our API Does Not Use Cookies for Authentication

This is a critical disclosure: **the backend API uses JWT Bearer tokens (HS256) for authentication, not cookies.**

- **Access tokens** (JWT HS256, 15-minute lifetime) are held **in memory** only on the client and are never persisted to disk or cookie storage.
- **Refresh tokens** (opaque, 7-day lifetime) are stored in **`expo-secure-store`** on mobile devices — an encrypted, OS-provided keychain/keystore — **not** in cookies.
- The API expects an `Authorization: Bearer <token>` header on every authenticated request. No session cookies are set by the API.

This design was chosen to support the offline-first mobile architecture (D-5) and the 24-hour offline window (B13), where tokens must be accessible to the background sync queue without web context.

---

## 2. Where Cookies or Similar Technologies May Be Used

### 2.1 Mobile Applications (Expo / React Native)

| Technology | Purpose | Storage | Duration |
|---|---|---|---|
| `expo-secure-store` | Encrypted storage for refresh tokens, biometric keys | OS keychain (iOS) / keystore (Android) | 7 days (refresh token TTL) |
| `expo-sqlite` | Durable offline queue for pending writes | Local SQLite database | Until synced and acknowledged |
| `expo-local-authentication` | Biometric unlock gate | OS-native biometric API | On-demand, no storage |
| FCM registration token | Push notification delivery | expo-notifications / FCM SDK | Until refreshed |

**Note:** The offline PIN (4-digit, B12) is **never** stored on our servers. It exists only as a bcrypt hash in the **device keystore**, encrypted by the OS. After 10 failed attempts, the local PIN hash is wiped and the driver is forced to re-authenticate online (M4).

### 2.2 Current Backend API (No Cookies)

The backend API (`@fleet/api`, Express + TypeScript, A3.1) does not set or read any cookies. All authentication is via:
- `Authorization: Bearer <jwt>` header
- `Idempotency-Key: <uuid>` header (C5.1/D4) on state-changing requests

### 2.3 Future Web Admin Console (Planned)

If a web-based admin console is introduced in a future phase (currently, the admin app is a React Native/Expo tablet app per D-2), it will adhere to the following cookie policy:

| Cookie Type | Purpose | Strictly Necessary? | Duration |
|---|---|---|---|
| Session JWT token | API authentication | Yes (could use Bearer header instead) | In-memory (no cookie) or session-only if cookie-based |
| CSRF token | Cross-site request forgery protection | Yes (if using cookies for auth) | Session |

Any future cookies will be:
- **Strictly necessary** for core functionality
- **Session-only** or with explicit expiry consent
- **Secure** (HTTPS only), **HttpOnly**, and **SameSite=Lax** or **Strict**
- Documented in an updated version of this policy

---

## 3. Third-Party Tracking Technologies

### 3.1 Mobile App Analytics (If Added)

Currently, the Platform does **not** integrate third-party analytics SDKs. If analytics are added in a future phase, we will use privacy-first, server-side analytics only, and will not share GPS or personal data with advertising or behavioural tracking networks.

### 3.2 Push Notification Services

| Service | Technology | Purpose | Data Shared |
|---|---|---|---|
| **Firebase Cloud Messaging (FCM)** | FCM direct (N9) via `expo-notifications` | Delivery of push notifications (alerts, accident escalation, HOS warnings) | Push token, device model, notification payload |
| **Google Maps** | `react-native-maps` with Google provider (D-9) | Map rendering in driver and admin apps | No PII; only map tile requests |
| **Google Cloud Vision** | REST API | OCR on fuel receipts (A1.4) | Receipt images only (no GPS/location) |

### 3.3 SMS and Communication

| Service | Technology | Purpose | Data Shared |
|---|---|---|---|
| **Africa's Talking** | REST API | SMS for emergency escalation (A1.8) | Phone number, message content (emergency alert context) |

### 3.4 Web Tracking

The Platform does **not** use third-party web trackers, advertising pixels, or behavioural profiling cookies. No Google Analytics, Meta Pixel, or similar services are integrated.

---

## 4. How to Manage Tracking Preferences

### 4.1 Mobile App Permissions

You control data access through your device's operating system settings:
- **Location:** The app requests GPS access for shift tracking. You can revoke this, but doing so will prevent shift clock-in (C5.5).
- **Notifications:** Push notifications can be disabled in your device settings. Disabling them means you will not receive accident alerts or escalation notifications (C6.3).
- **Camera:** Used for photo capture (odometer, DVIR, accidents, receipts). Can be revoked in OS settings, but will block photo-based workflows.
- **Biometric:** Used to unlock the secure store. Can be disabled; you will then use your offline PIN.

### 4.2 Withdrawal of Consent

To withdraw GPS consent or request data deletion, contact our Data Protection Officer at **dpo@helixfleet.co.ke**.

---

## 5. Changes to This Cookie Policy

We may update this Cookie Policy from time to time to reflect changes in our practices or for legal, regulatory, or compliance reasons. Any material changes will be communicated via the Platform and, where appropriate, via email or push notification.

The "Last Updated" date at the top indicates the most recent revision.

---

## 6. Contact Us

If you have questions about this Cookie Policy or our use of tracking technologies:

**Data Protection Officer (DPO):**  
Helix Fleet Management Ltd  
Nairobi, Kenya  
Email: **dpo@helixfleet.co.ke**  
Phone: +254 700 000 000

You may also lodge a complaint with the Office of the Data Protection Commissioner (ODPC), Kenya.

---

*This Cookie Policy is part of our comprehensive privacy framework, which includes our Privacy Policy (`docs/legal/privacy-policy.md`), Data Processing Agreement (`docs/legal/data-processing-agreement.md`), and Data Protection Impact Assessment (`docs/legal/dPIA.md`).*
