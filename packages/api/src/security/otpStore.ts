// packages/api/src/security/otpStore.ts
// Short-lived OTP persistence for delivered-MFA (replaces TOTP). The 6-digit code is held in Redis
// with a 5-minute TTL; attempts are capped separately so a brute force cannot be reset by re-issuing
// a fresh code (the same code is reused while it is still live — see MfaService.sendCode). When no
// Redis client is available (REDIS_ENABLED=false / test) an in-process map is used so a single
// instance still functions.

import type Redis from "ioredis";

export interface OtpStore {
  /** Returns the live code for the user, or null if expired/absent. */
  get(userId: string): Promise<string | null>;
  /** Stores the code with the configured TTL. */
  set(userId: string, code: string): Promise<void>;
  /** Removes the code and any attempt counter. */
  delete(userId: string): Promise<void>;
  /** Increments and returns the attempt count for the window. */
  incrementAttempts(userId: string): Promise<number>;
  /** Clears the attempt counter. */
  resetAttempts(userId: string): Promise<void>;
}

const codeKey = (userId: string) => `mfa:otp:${userId}`;
const attemptsKey = (userId: string) => `mfa:otp:attempts:${userId}`;

export class RedisOtpStore implements OtpStore {
  private readonly mem = new Map<string, { code: string; exp: number }>();
  private readonly memAttempts = new Map<string, number>();

  constructor(
    private readonly client: Redis | null,
    private readonly ttlSeconds: number = 300,
  ) {}

  async get(userId: string): Promise<string | null> {
    if (!this.client) {
      const entry = this.mem.get(userId);
      if (!entry || entry.exp < Date.now()) {
        this.mem.delete(userId);
        return null;
      }
      return entry.code;
    }
    return (await this.client.get(codeKey(userId))) ?? null;
  }

  async set(userId: string, code: string): Promise<void> {
    if (!this.client) {
      this.mem.set(userId, { code, exp: Date.now() + this.ttlSeconds * 1000 });
      return;
    }
    await this.client.set(codeKey(userId), code, "EX", this.ttlSeconds);
  }

  async delete(userId: string): Promise<void> {
    if (!this.client) {
      this.mem.delete(userId);
      this.memAttempts.delete(userId);
      return;
    }
    await this.client.del(codeKey(userId), attemptsKey(userId));
  }

  async incrementAttempts(userId: string): Promise<number> {
    if (!this.client) {
      const next = (this.memAttempts.get(userId) ?? 0) + 1;
      this.memAttempts.set(userId, next);
      return next;
    }
    const count = await this.client.incr(attemptsKey(userId));
    if (count === 1) await this.client.expire(attemptsKey(userId), this.ttlSeconds);
    return count;
  }

  async resetAttempts(userId: string): Promise<void> {
    if (!this.client) {
      this.memAttempts.delete(userId);
      return;
    }
    await this.client.del(attemptsKey(userId));
  }
}
