// packages/api/src/security/totp.ts
// RFC 6238 TOTP, 30 s step, 1-step skew (02 §3). Mandatory for ADMIN / FLEET_MANAGER
// (roles.requires_mfa), enforced at login (02 §2 step 2).

import { authenticator } from "otplib";

authenticator.options = { step: 30, window: 1, digits: 6 };

export interface TotpService {
  generateSecret(): string;
  provisioningUri(email: string, secret: string): string;
  verify(secret: string, code: string): boolean;
}

export const totp: TotpService = {
  generateSecret(): string {
    return authenticator.generateSecret();
  },
  provisioningUri(email: string, secret: string): string {
    return authenticator.keyuri(email, "Fleet Management Platform", secret);
  },
  verify(secret: string, code: string): boolean {
    try {
      return authenticator.verify({ token: code, secret });
    } catch {
      return false;
    }
  },
};
