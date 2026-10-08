import { describe, it, expect } from 'vitest';
import { initialRoleFor, isRoleAllowed, ADMIN_ROLES, useCan } from '../src/state/roles';
import { principalFromSessionBody } from '@fleet/shared';

/**
 * B-11 (decided: the choice persists on the device) and the presentation-only rule: which experience
 * opens is NEVER an authorisation input, so a remembered choice must be re-validated against the roles
 * the session actually has, and a driver-only account can never land in an admin shell.
 */
describe('role selection', () => {
  it('opens the only experience a single-role account has', () => {
    expect(initialRoleFor(['DRIVER'])).toBe('DRIVER');
    expect(initialRoleFor(['ADMIN'])).toBe('ADMIN');
    expect(initialRoleFor(['FLEET_MANAGER'])).toBe('ADMIN');
    expect(initialRoleFor([])).toBeNull();
  });
  it('asks when both are held, which is the only honest option', () => {
    expect(initialRoleFor(['DRIVER', 'ADMIN'])).toBeNull();
    expect(initialRoleFor(['DRIVER', 'DISPATCHER'])).toBeNull();
  });
  it('re-validates a remembered choice against the SESSION roles, not the stored ones', () => {
    expect(isRoleAllowed('ADMIN', ['DRIVER'])).toBe(false);          // lost admin rights
    expect(isRoleAllowed('ADMIN', ['ADMIN'])).toBe(true);
    expect(isRoleAllowed('DRIVER', ['DRIVER', 'ADMIN'])).toBe(true);
    expect(isRoleAllowed('ADMIN', [])).toBe(false);
  });
  it('ADMIN_ROLES is the backend role vocabulary, not a UI preference', () => {
    expect(ADMIN_ROLES).toContain('ADMIN');
    expect(ADMIN_ROLES).toContain('FLEET_MANAGER');
    expect(ADMIN_ROLES).toContain('AUDITOR');
    expect(ADMIN_ROLES).not.toContain('DRIVER');
  });
  it('can() is strict when the trusted body carried the permission union, and open when it did not', () => {
    const strict = principalFromSessionBody({ user_id: 'u', roles: ['ADMIN'], permissions: ['fuel:verify'] });
    const open = principalFromSessionBody({ user_id: 'u', roles: ['ADMIN'] });
    expect(useCan(strict, 'fuel:verify')).toBe(true);
    expect(useCan(strict, 'fuel:adjust')).toBe(false);
    expect(useCan(open, 'fuel:adjust')).toBe(true);
    expect(useCan(null, 'fuel:verify')).toBe(false);
  });
});
