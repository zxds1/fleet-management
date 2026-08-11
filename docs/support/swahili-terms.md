# Swahili Terms Glossary

> **Status:** Machine-generated (R-105). These translations are sourced from
> `packages/mobile/src/core/i18n/sw.json` and require review by a native Swahili speaker
> before being treated as production-ready. See decision
> `docs/architecture/00-locked-decisions.md` — "Swahili localisation strings must be
> validated by a native speaker before release."

This glossary maps the key Swahili user-facing strings used across the Heliox Fleet
mobile app, the API error catalogue, and the support documentation.

---

## 1. Error codes (API + client)

These map to the `error_code` field in RFC 7807 problem responses (see
`packages/shared/src/errors.ts`). The **English canonical code** is shown first, followed
by the Swahili user-facing message and the recommended recovery action.

| English code | Swahili message | Recovery action (Swahili) | HTTP status |
|---|---|---|---|
| `VALIDATION_ERROR` | "Baadhi ya maelezo hayako au hayafai. Angalia sehemu zilizoonyeshwa." | "Hariri sehemu zilizoonyeshwa kisha jaribu tena." | 400 |
| `UNAUTHENTICATED` | "Kuingia kwako sasa hakifai tena. Tafadhali ingia tena." | "Ingia tena." | 401 |
| `MFA_REQUIRED` | "Weka nambari kutoka kwenye programu yako ya uthibitishaji." | "Weka nambari ya OTP." | 401 |
| `FORBIDDEN` | "Huna ruhusa ya kufanya hivyo. Wasiliana na Msimamizi wako." | "Wasiliana na msimamizi wako." | 403 |
| `ACCOUNT_SUSPENDED` | "Akaunti imefungwa. Wasiliana na Msimamizi." | "Wasiliana na Msimamizi." | 403 |
| `DEVICE_REVOKED` | "Kifaa hiki kimefutwa. Wasiliana na Msimamizi wako." | "Wasiliana na Msimamizi wako." | 403 |
| `DEVICE_UNKNOWN` | "Kifaa hiki hakijasajiliwa bado. Sajili ili kuendelea." | "Sajili kifaa hiki." | 403 |
| `CONSENT_REQUIRED` | "Lazima ukubali ufuatiliaji wa eneo kabla ya kuanza zamu." | "Kubali idhini ya eneo." | 403 |
| `NOT_FOUND` | "Rekodi hiyo haipo tena." | — | 404 |
| `CLOCKOUT_PENDING` | "Zamu yako ya awali inasubiri kufungwa. Maliza kwanza." | "Funga zamu ya awali." | 409 |
| `SHIFT_ALREADY_OPEN` | "Tayari una zamu iliyo wazi." | "Funga zamu iliyo wazi kwanza." | 409 |
| `UNLOCK_REQUIRED` | "Rekodi hii imehakikiwa na kufungwa. Fungua kwanza ili kurekebisha." | "Fungua kumbukumbu kwanza." | 409 |
| `NO_ASSIGNMENT` | "Huna ugawaji wa gari hili. Wasiliana na msimamizi wako." | "Pata gari uliopewa." | 409 |
| `DUPLICATE` | "Hiki kimekwisha rekodiwa." | — | 409 |
| `SESSION_LIMIT` | "Umeingia kwenye vifaa vingi mno. Toka kwenye vingine ujaribu tena." | "Toka kwa kifaa kingine." | 422 |
| `IDEMPOTENCY_INFLIGHT` | "Bado inatuma badiliko lako la mwisho. Inajaribu tena hivi karibuni." | "Subiri kuanza upate urejelevu." | 409 |
| `IDEMPOTENCY_CONFLICT` | "Badiliko hili limeshatumwa. Nakala imeondolewa." | "Usanidi tena badiliko." | 422 |
| `ODOMETER_DECREASED` | "Odometer haiwezi kuwa chini ya sowo la mwisho. Angalia nambari ujaribu tena." | "Angalia namba ya odometer." | 422 |
| `ODOMETER_DIVERGENCE` | "Somo lako la odometer litofautiana na kifuatiliaji. Thibitisha nambari." | "Hakikisha odometer ni sawa." | 422 |
| `HOS_REST_BLOCKED` | "Kipindi chako cha kupumzika hakijakwisha bado." | "Subiri kipindi cha kupumzika." | 422 |
| `MISSING_GAUGE_PAIR` | "Ujazo wa mafuta unahitaji sowo la mafuta kabla na baada." | "Piga picha ya kiwango kabla na baada." | 422 |
| `DVIR_FAIL_NEEDS_PHOTO` | "Ongeza picha kwa kila kipengee kilichoshindwa." | "Piga picha kwa vipengee vilivyoshindwa." | 422 |
| `DEFECTS_NOT_REVIEWED` | "Thibitisha ulikagua dosari za awali." | "Rekebisha dosari za awali." | 422 |
| `WORK_PLAN_REQUIRED` | "Ongeza maelezo ya mpango wako au picha kabla ya kuingia kazi." | "Ongeza maelezo ya mpango au picha." | 422 |
| `RATE_LIMITED` | "Majarubi mengi mno. Tafadhali subiri kidogo ujaribu tena." | "Subiri kidogo." | 429 |
| `OFFLINE_PIN_LOCKED` | "PIN imefungwa. Jaribu tena baada ya dakika chache." | "Subiri kisha jaribu tena." | 429 |
| `SERVICE_UNAVAILABLE` | "Huduma haipatikani kwa muda. Tutajaribu tena kiotomatiki." | "Subiri na jaribu tena." | 503 |
| `NETWORK_UNAVAILABLE` | "Hakuna muunganisho. Badiliko lako limehifadhiwa kwenye kifaa." | "Jiunge na mtandao." | 503 |
| `RESPONSE_INVALID` | "Seva ilituma jibu lisilotarajiwa. Tafadhali jaribu tena." | "Jaribu tena." | 503 |
| `MEDIA_UPLOAD_FAILED` | "Picha haikupakia. Jaribu tena ukiwa na ishara bora." | "Jaribu tena na ishara bora." | 503 |
| `UNKNOWN` | "Kuna hitilafu. Tafadhali jaribu tena." | "Jaribu tena." | 500 |

> **Note:** Some error codes (e.g. `NETWORK_UNAVAILABLE`, `RESPONSE_INVALID`,
> `MEDIA_UPLOAD_FAILED`, `WORK_PLAN_REQUIRED`, `OFFLINE_PIN_LOCKED`) are generated
> client-side and are not returned by the API. See
> `packages/mobile/src/core/errorCodes.ts` for the full disposition mapping.

---

## 2. Common UI strings

| English key | Swahili | Notes |
|---|---|---|
| appName | Fleet | Brand name — left as-is per branding guidelines. |
| cancel | Ghairi | — |
| confirm | Thibitisha | — |
| save | Hifadhi | — |
| submit | Tuma | — |
| retry | Jaribu tena | — |
| loading | Inapakia… | — |
| offline | Nje ya mtandao | — |
| pending | Inasubiri | — |

---

## 3. Driver role labels

| English | Swahili | Notes |
|---|---|---|
| Driver | Dereva | The role name on iOS/Android should remain "Driver" (untranslated) per i18n convention; the Swahili UI uses "Dereva" for the human-readable label. |
| Admin | Msimamizi | Used in the role-switch screen. |
| Clock in | Ingia Kazi | — |
| Clock out | Toka Kazi | — |
| Active shift | Zamu inayotumika | — |
| No active shift | Hakuna zamu inayotumika | — |

---

## 4. Vehicle & asset states

| English state code | Swahili | Notes |
|---|---|---|
| MOVING | Inasonga | — |
| IDLING | Inatega injini | — |
| PARKED | Imeegemezwa | — |
| OFFLINE | Nje ya mtandao | — |
| QUARANTINED | Imezuiliwa | — |
| HOS_ALERT | Tahadhari ya HOS | — |
| SPEEDING | Inakimbia kupita kiasi | — |

---

## 5. DVIR (inspection) outcomes

| English | Swahili |
|---|---|
| Pass | Faa |
| Fail | Shindwa |
| Not applicable | Haidhumu |
| Defects found | Dosari {{count}} zimepatikana |
| Quarantined | Imezuiliwa |
| Verified | Imethibitishwa |
| Flagged | Imetiwa alama |

---

## 6. HOS (Hours of Service)

| English | Swahili |
|---|---|
| HOS violation | Ukiukaji wa saa za kazi |
| Rest period incomplete | Kipindi chako cha kupumzika hakijakwisha bado |
| HOS rest blocked | HOS_REST_BLOCKED |

---

## 7. Fuel

| English key | Swahili |
|---|---|
| Refuel | Jaza Mafuta |
| Odometer reading | Usomaji wa odometer |
| Fuel level | Kiwango cha mafuta |
| Station | Kituo |
| Litres | Lita |
| Total cost | Jumla ya gharama |
| Cost per km | Gharama kwa kila km |

---

## 8. Accidents

| English | Swahili |
|---|---|
| Accident | Ajali |
| Mayday | TUMA MSADA SASA |
| Escalate | Ukuaji |
| Acknowledged | Imekubaliwa |
| Awaiting acknowledgement | Inasubiri kuthibitishwa |
| Speed at impact | Kasi wakati wa mgongano |

---

## 9. Security

| English | Swahili |
|---|---|
| Device revoked | Kifaa hiki kimefutwa |
| Account suspended | Akaunti imefungwa |
| Rooted device | Kifaa hakifahamiki |
| Tampered app | Ukaguzi wa uadilifu umeshindwa |
| Certificate pinning failed | Muunganisho salama umeshindwa |
| MFA enabled | MFA imewezeshwa |
| MFA disabled | MFA haijasajiliwa |

---

## 10. Consent & onboarding

| English | Swahili |
|---|---|
| Location tracking consent | Idhini ya ufuatiliaji wa eneo |
| Consent required | CONSENT_REQUIRED |
| Accept | Kubali |
| Decline | Kataa |
| Background check | Uhakiki wa historia |
| Cleared | Imeidhinishwa |
| Onboarding status | Hali ya usajili |

---

## 11. Outbox / sync states

| English code | Swahili |
|---|---|
| PENDING | Inasubiri |
| INFLIGHT | Inatuma |
| FAILED_REVIEW | Inahitaji ukaguzi |
| DONE | Imetumwa |
| Offline | Uko nje ya mtandao |

---

## 12. Anomaly domains

| English domain | Notes |
|---|---|
| fuel | Fuel-related anomalies (e.g. odometer divergence, missing gauge pair). |
| dvir | DVIR-related anomalies (e.g. failed items without photos). |
| speed | Speeding / overtake anomalies. |
| hos | Hours-of-Service violations. |
| route | Route deviation anomalies. |

> These are domain enum values that are **not translated** in the UI — they remain in
> English in the `/anomalies` API response and admin console. Only the display labels
> around them are translated.
