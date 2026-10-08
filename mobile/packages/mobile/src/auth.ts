import { ENDPOINTS, url } from './api/endpoints';
import {
  AppError,
  DeviceRegisterResponseSchema,
  LoginSchema,
  MfaChallengeResponseSchema,
  MfaVerifySchema,
  NetworkError,
  SessionResponseSchema,
  type SessionResponse,
} from '@fleet/shared';
import { api, reconcileQueueOwner, registerDeviceAfterLogin, session, syncPrincipal } from './services';
import { getDeviceHash } from './device';
import { useUi } from './state/store';

export type LoginResult =
  | { status: 'ok' }
  | { status: 'mfa'; wrongCode: boolean }
  | { status: 'error'; code: string };

/** A driver signs in with a phone number, everyone else with an email. Both are accepted here. */
const looksLikePhone = (v: string): boolean => /^\+?[1-9]\d{6,14}$/.test(v.replace(/[\s()-]/g, ''));

/**
 * The login state machine, in one place so Login and MFA Challenge cannot drift apart.
 *
 * C-13 resolved: there is no fixed order to enforce. The server decides what happens next and says
 * so in the response:
 *  • tokens          -> signed in
 *  • `mfa_required`  -> the MFA challenge screen (the response carries `mfa_challenge_token`)
 *  • 403 CONSENT_REQUIRED / ACCOUNT_SUSPENDED -> the matching screen
 *  • 401 UNAUTHENTICATED -> wrong password
 * Device registration is NOT a gate: it runs right after a successful login (see `device.ts`).
 */
export async function performLogin(
  login: string,
  password: string,
  opts: { challengeToken?: string; code?: string } = {},
): Promise<LoginResult> {
  const ui = useUi.getState();

  try {
    const body = opts.challengeToken
      ? MfaVerifySchema.parse({ mfa_challenge_token: opts.challengeToken, code: opts.code ?? '' })
      : LoginSchema.parse(
          looksLikePhone(login)
            ? { phone: login.replace(/[\s()-]/g, ''), password, device_id_hash: await getDeviceHash() }
            : { email: login.trim(), password, device_id_hash: await getDeviceHash() },
        );

    const path = opts.challengeToken ? url(ENDPOINTS.mfaVerify) : url(ENDPOINTS.login);
    const res = await api.post(path, { auth: false, schema: opts.challengeToken ? SessionResponseSchema : undefined, body });

    // The server can answer the plain login with the MFA gate instead of tokens.
    if (!opts.challengeToken && !('access_token' in res)) {
      const challenge = MfaChallengeResponseSchema.parse(res);
      ui.setPendingLogin({ login, password, challengeToken: challenge.mfa_challenge_token });
      ui.setAuth('needsMfa');
      return { status: 'mfa', wrongCode: false };
    }

    const r = res as SessionResponse;
    await finishLogin(r);
    return { status: 'ok' };
  } catch (e) {
    const code = e instanceof AppError ? e.error_code : e instanceof NetworkError ? 'NETWORK' : 'UNKNOWN';
    if (code === 'ACCOUNT_SUSPENDED') { ui.setAuth('suspended'); return { status: 'error', code }; }
    if (code === 'CONSENT_REQUIRED') { ui.setAuth('needsConsent'); return { status: 'error', code }; }
    if (code === 'MFA_REQUIRED') { ui.setAuth('needsMfa'); return { status: 'mfa', wrongCode: !!opts.challengeToken }; }
    return { status: 'error', code };
  }
}

/** Stores the session, binds the device, then decides which experience to open. */
export async function finishLogin(r: SessionResponse): Promise<void> {
  const ui = useUi.getState();
  await session.saveTokens({ access_token: r.access_token, refresh_token: r.refresh_token, roles: r.roles });
  await reconcileQueueOwner(r.user_id);
  syncPrincipal(r);
  ui.setPendingLogin(null);
  await registerDeviceAfterLogin();
  ui.setSession(r.roles);
}

export { DeviceRegisterResponseSchema };