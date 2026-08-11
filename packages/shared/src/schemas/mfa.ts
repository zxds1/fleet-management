// packages/shared/src/schemas/mfa.ts
// MFA delivery routing (role-routed delivered OTP). Drivers receive the OTP by SMS (Africa's
// Talking); admins receive it by email (Resend). The contact channel is derived from the user's
// role + the contact on file at login time.

export type MfaDeliveryChannel = "sms" | "email";
