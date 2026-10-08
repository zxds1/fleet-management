import * as SecureStore from 'expo-secure-store';
import { create } from 'zustand';
import type { PermissionCode, Principal, RoleCode } from '@fleet/shared';
import { can } from '@fleet/shared';
import type { Locale } from '../i18n';
import type { SecurityReason } from '../core/security';
import type { LiveAlert } from '../core/liveAlerts';
import { ROLE_KEY, initialRoleFor, isRoleAllowed, type Role } from './roles';

export type AuthStatus = 'booting' | 'blocked' | 'needsPin' | 'signedOut' | 'needsConsent' | 'needsMfa' | 'suspended' | 'signedIn';

export type { Role } from './roles';

interface UiState {
  auth: AuthStatus;
  roles: RoleCode[];
  activeRole: Role | null;
  pendingLogin: { login: string; password: string; challengeToken: string } | null;
  setPendingLogin: (p: { login: string; password: string; challengeToken: string } | null) => void;
  online: boolean;
  socketUp: boolean;
  locale: Locale;
  outboxCount: number;
  securityReason: SecurityReason | null;
  setSecurityReason: (r: SecurityReason | null) => void;
  // The login body carries email + phone but NO name, so this is not a display name: the driver's name
  // comes from `GET /drivers/me/onboarding` (U-06).
  principal: Principal | null;
  setPrincipal: (p: Principal | null) => void;
  liveAlert: LiveAlert | null;
  setLiveAlert: (a: LiveAlert | null) => void;
  toast: string | null;
  showToast: (m: string) => void;
  clearToast: () => void;
  setAuth: (a: AuthStatus) => void;
  setSession: (roles: readonly string[]) => void;
  setActiveRole: (r: Role | null) => void;
  setOnline: (v: boolean) => void;
  setSocketUp: (v: boolean) => void;
  setLocale: (l: Locale) => void;
  setOutboxCount: (n: number) => void;
  reset: () => void;
}

/** Role names are the backend's `app.user_roles` vocabulary; see `roles.ts`. */

/**
 * B-17: the chosen experience PERSISTS on the device, and is re-validated against the roles the
 * session actually has on every sign-in, so a remembered choice can never grant access the roles do not
 * carry. An invalid or absent choice falls back to the single obvious experience. ASSUMPTION[B-17]
 */
async function restoreActiveRole(roles: readonly string[]): Promise<void> {
  const fallback = initialRoleFor(roles);
  const saved = await SecureStore.getItemAsync(ROLE_KEY);
  const next = saved && isRoleAllowed(saved === 'ADMIN' ? 'ADMIN' : 'DRIVER', roles) ? (saved === 'ADMIN' ? 'ADMIN' : 'DRIVER') : fallback;
  useUi.getState().setActiveRole(next);
}

/** The role to show before anything is restored, without touching the store. */
export const roleOnBoot = (roles: readonly string[]): Role | null => initialRoleFor(roles);

/** Zustand holds UI state only (Rule 10). Server data lives in TanStack Query. */
export const useUi = create<UiState>((set) => ({
  auth: 'booting',
  pendingLogin: null,
  setPendingLogin: (pendingLogin) => set({ pendingLogin }),
  roles: [],
  activeRole: null,
  online: true,
  socketUp: false,
  locale: 'en',
  outboxCount: 0,
  securityReason: null,
  setSecurityReason: (securityReason) => set({ securityReason }),
  principal: null,
  setPrincipal: (principal) => set({ principal }),
  liveAlert: null,
  setLiveAlert: (liveAlert) => set({ liveAlert }),
  toast: null,
  showToast: (toast) => set({ toast }),
  clearToast: () => set({ toast: null }),
  setAuth: (auth) => set({ auth }),
  /**
   * B-11 (decided): the chosen experience PERSISTS on the device, and is re-validated against the roles the
   * session actually has on every sign-in, so a remembered choice can never grant access the roles do not
   * carry. An invalid or absent choice falls back to the single obvious experience.
   */
  setSession: (roles) => {
    set({ roles: roles as RoleCode[], auth: 'signedIn', activeRole: null });
    void restoreActiveRole(roles);
  },
  setActiveRole: (activeRole) => { set({ activeRole }); if (activeRole) void SecureStore.setItemAsync(ROLE_KEY, activeRole); },
  setOnline: (online) => set({ online }),
  setSocketUp: (socketUp) => set({ socketUp }),
  setLocale: (locale) => set({ locale }),
  setOutboxCount: (outboxCount) => set({ outboxCount }),
  reset: () => set({ liveAlert: null, principal: null, pendingLogin: null, auth: 'signedOut', roles: [], activeRole: null, outboxCount: 0 }),
}));

/**
 * UI gate for a control, using the permission the endpoint's `requirePermission` actually enforces.
 * Unknown permissions (the response carried no union) show the control and let the server's 403
 * decide; when the union is present the check is strict.
 */
export const useCan = (code: PermissionCode): boolean => useUi((s) => can(s.principal, code));