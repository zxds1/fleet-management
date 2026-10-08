import React, { useState } from 'react';
import { StyleSheet } from 'react-native';
import { usePreventScreenCapture } from 'expo-screen-capture';
import { useTranslation } from 'react-i18next';
import { Body, Button, Card, ErrorState, Field, Title } from '../../design/components';
import { Screen } from '../../design/Screen';
import { Text } from '../../design/Text';
import { BackgroundImage } from '../../design/BackgroundImage';
import { bgImage } from '../../design/branding';
import { announce } from '../../design/states';
import { color, font, space } from '../../design/tokens';
import { performLogin } from '../../auth';
import { describeError } from '../../core/errors';
import { useUi } from '../../state/store';
import { acceptConsent, registerDeviceAfterLogin, session, signOut } from '../../services';
import { z } from 'zod';
import { AppError, SignupSchema, RoleCode } from '@fleet/shared';
import { ENDPOINTS, url } from '../../api/endpoints';
import { api } from '../../services';

/** Shown while the app decides whether there is a usable session. */
export function SplashScreen() {
  const { t } = useTranslation();
  return (
    <BackgroundImage source={bgImage.driver}>
      <Screen center testID="splash"><Title>{t('app.loading')}</Title><Body dim>{t('auth.splashHint')}</Body></Screen>
    </BackgroundImage>
  );
}

/**
 * Self-service company signup. Creates the tenant + first ADMIN in one POST.
 * The backend returns a session, so the person is signed in immediately.
 */
export function SignupScreen({ navigation }: any) {
  const { t } = useTranslation();
  const [company, setCompany] = useState('');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  usePreventScreenCapture();

  async function submit() {
    setErr(null); setBusy(true);
    try {
      const body = SignupSchema.parse({ company_name: company, full_name: name, email, password });
      const r = await api.post(url(ENDPOINTS.signup), { body, schema: z.object({ access_token: z.string(), refresh_token: z.string(), roles: z.array(RoleCode), permissions: z.array(z.string()), locale: z.enum(['en', 'sw']), tenant_id: z.string() }) });
      await session.saveTokens({ access_token: r.access_token, refresh_token: r.refresh_token, roles: r.roles });
      useUi.getState().setSession(r.roles);
      navigation.replace('Root');
    } catch (e) { setErr(e instanceof AppError ? e.error_code : 'UNKNOWN'); } finally { setBusy(false); }
  }

  return (
    <BackgroundImage source={bgImage.driver}>
      <Screen center testID="signup">
        <Title>{t('auth.signUp')}</Title>
        <Field label={t('auth.companyName')} value={company} onChangeText={setCompany} autoCapitalize="words" />
        <Field label={t('profileExtra.name')} value={name} onChangeText={setName} autoCapitalize="words" />
        <Field label={t('auth.emailOrPhone')} value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" textContentType="emailAddress" />
        <Field label={t('auth.password')} value={password} onChangeText={setPassword} secureTextEntry autoCapitalize="none" textContentType="newPassword" />
        {err ? <ErrorState code={err} /> : null}
        <Button label={t('auth.signUp')} busy={busy} disabled={!company || !name || !email || password.length < 8} onPress={() => void submit()} testID="signup-submit" />
        <Button tone="quiet" label={t('auth.logIn')} onPress={() => navigation.goBack()} />
      </Screen>
    </BackgroundImage>
  );
}

/**
 * Password reset request. The backend sends a code to the account owner's email or SMS.
 * This screen collects the contact and the new code + password.
 */
export function PasswordResetScreen({ navigation }: any) {
  const { t } = useTranslation();
  const [contact, setContact] = useState('');
  const [step, setStep] = useState<'request' | 'complete'>('request');
  const [resetId, setResetId] = useState('');
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  usePreventScreenCapture();

  async function requestReset() {
    setErr(null); setBusy(true);
    try {
      const r = await api.post(url(ENDPOINTS.passwordResetRequest), { body: { email_or_phone: contact }, schema: z.object({ reset_id: z.string(), status: z.string(), contact_hint: z.string(), expires_at: z.string(), requires_approval: z.boolean() }) });
      setResetId(r.reset_id);
      setStep('complete');
    } catch (e) { setErr(e instanceof AppError ? e.error_code : 'UNKNOWN'); } finally { setBusy(false); }
  }

  async function completeReset() {
    setErr(null); setBusy(true);
    try {
      await api.post(url(ENDPOINTS.passwordResetComplete(resetId)), { body: { code, new_password: password } });
      announce(t('auth.passwordResetDone'));
      navigation.goBack();
    } catch (e) { setErr(e instanceof AppError ? e.error_code : 'UNKNOWN'); } finally { setBusy(false); }
  }

  return (
    <BackgroundImage source={bgImage.driver}>
      <Screen center testID="password-reset">
        <Title>{t('auth.passwordReset')}</Title>
        {step === 'request' ? (
          <>
            <Body dim>{t('auth.passwordResetHelp')}</Body>
            <Field label={t('auth.emailOrPhone')} value={contact} onChangeText={setContact} autoCapitalize="none" keyboardType="email-address" />
            {err ? <ErrorState code={err} /> : null}
            <Button label={t('auth.passwordReset')} busy={busy} onPress={() => void requestReset()} testID="reset-request" />
          </>
        ) : (
          <>
            <Body dim>{t('auth.passwordResetCode')}</Body>
            <Field label={t('auth.mfaCode')} value={code} onChangeText={setCode} keyboardType="number-pad" maxLength={10} />
            <Field label={t('settings.newPassword')} value={password} onChangeText={setPassword} secureTextEntry />
            {err ? <ErrorState code={err} /> : null}
            <Button label={t('auth.passwordReset')} busy={busy} onPress={() => void completeReset()} testID="reset-complete" />
          </>
        )}
        <Button tone="quiet" label={t('auth.logIn')} onPress={() => navigation.goBack()} />
      </Screen>
    </BackgroundImage>
  );
}

/**
 * Login. The server accepts either an email (admins) or a phone number (drivers) — `LoginSchema`
 * requires exactly one — so there is one field and the app detects which to send.
 *
 * Device registration is NOT a gate: login can never answer DEVICE_UNKNOWN, and `POST /auth/devices`
 * runs right after the session exists. What can block a person after login is consent, so this
 * screen offers "Register this device" only as a retry for a failed post-login bind.
 */
export function LoginScreen({ navigation }: any) {
  const { t } = useTranslation();
  const [login, setLogin] = useState('');
  const [password, setPassword] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [regMsg, setRegMsg] = useState(false);
  usePreventScreenCapture();

  async function submit() {
    setErr(null); setRegMsg(false); setBusy(true);
    const r = await performLogin(login, password);
    if (r.status === 'error') { setErr(r.code); announce(t(describeError(r.code).key)); }
    setBusy(false);
  }

  async function retryDevice() {
    setErr(null); setBusy(true);
    const ok = await registerDeviceAfterLogin();
    setRegMsg(ok);
    if (!ok) setErr('UPLOAD_UNAVAILABLE');
    setBusy(false);
  }

  return (
    <BackgroundImage source={bgImage.driver}>
      <Screen center testID="login">
        <Title>{t('auth.logIn')}</Title>
        <Field label={t('auth.emailOrPhone')} value={login} onChange={setLogin} autoCapitalize="none" autoCorrect={false} keyboardType="default" textContentType="username" testID="login-email" />
        <Field label={t('auth.password')} value={password} onChange={setPassword} secureTextEntry secureToggle autoCapitalize="none" textContentType="password" testID="login-password" />
        {err ? <ErrorState code={err} /> : null}
        {regMsg ? <Card><Body>{t('security.registered')}</Body></Card> : null}
        <Button label={t('auth.logIn')} busy={busy} disabled={!login || !password} onPress={() => void submit()} testID="login-submit" />
        <Button tone="quiet" label={t('auth.forgotPassword')} onPress={() => navigation.navigate('PasswordReset')} />
        <Button tone="quiet" label={t('auth.signUp')} onPress={() => navigation.navigate('Signup')} />
        <Button tone="quiet" label={t('actions.REGISTER_DEVICE')} onPress={() => void retryDevice()} />
        <Text style={styles.foot}>{t('auth.loginHelp')}</Text>
      </Screen>
    </BackgroundImage>
  );
}

/**
 * MFA challenge. The backend delivers a 6-digit OTP (SMS for drivers, email for admins) with a
 * 5-attempt cap, and recovery codes are accepted in the SAME field: `POST /auth/mfa/verify` takes
 * `{ mfa_challenge_token, code }` where the code is 4-16 characters and `MfaService.verify` tries
 * recovery codes first. So there is no separate recovery flow (C-02) and no QR/TOTP (E-19).
 */
export function MfaChallengeScreen() {
  const { t } = useTranslation();
  const [code, setCode] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  usePreventScreenCapture();

  async function submit() {
    setErr(null); setBusy(true);
    const pending = useUi.getState().pendingLogin;
    if (!pending) { setBusy(false); setErr('UNKNOWN'); return; }
    const r = await performLogin(pending.login, pending.password, { challengeToken: pending.challengeToken, code });
    if (r.status === 'error') { setErr(r.code); announce(t(describeError(r.code).key)); }
    setBusy(false);
  }

  return (
    <Screen center testID="mfa">
      <Title>{t('auth.mfaCode')}</Title>
      <Body dim>{t('auth.mfaHelp')}</Body>
      <Field label={t('auth.mfaCode')} value={code} onChange={setCode} keyboardType="default" autoCapitalize="characters" autoCorrect={false} testID="mfa-code" />
      {err ? <ErrorState code={err} /> : null}
      <Button label={t('auth.verify')} busy={busy} disabled={code.length < 4} onPress={() => void submit()} testID="mfa-submit" />
      <Button tone="quiet" label={t('auth.logOut')} onPress={() => { useUi.getState().setPendingLogin(null); void signOut(); }} />
    </Screen>
  );
}

/**
 * Offline PIN. 6 digits, salted PBKDF2 in SecureStore; 5 wrong tries lock the screen for 15 minutes
 * and 10 wipe the PIN locally. Those numbers come from the backend's config keys
 * (`auth.offline_pin_lockout_attempts`, `auth.offline_pin_wipe_attempts`,
 * `auth.offline_pin_lockout_minutes`). A clock moved backwards is treated as tampering, not as a
 * shorter wait. Unlocking is local only; the server still needs a valid refresh token online.
 */
export function PinScreen() {
  const { t } = useTranslation();
  const [pin, setPin] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  usePreventScreenCapture();

  async function submit() {
    setErr(null); setBusy(true);
    try {
      const r = await session.verifyPin(pin);
      if (!r.ok) {
        setErr(r.reason === 'WRONG' || r.reason === 'LOCKED' ? 'OFFLINE_PIN_LOCKED' : 'UNKNOWN');
        announce(r.reason === 'WRONG' ? t('pin.attempts', { n: r.attemptsLeftBeforeLock }) : r.reason === 'WIPED' ? t('pin.wiped') : t('pin.locked', { time: '' }));
        if (r.reason === 'WIPED' || r.reason === 'NO_PIN') await signOut();
        return;
      }
      const ui = useUi.getState();
      ui.setSession(await session.roles());
    } finally { setBusy(false); }
  }

  return (
    <Screen center testID="pin">
      <Title>{t('pin.title')}</Title>
      {err ? <ErrorState code={err} /> : null}
      <Field label={t('pin.title')} value={pin} onChangeText={setPin} keyboardType="number-pad" secureTextEntry maxLength={6} testID="pin-field" />
      <Button label={t('auth.continue')} busy={busy} disabled={pin.length !== 6} onPress={() => void submit()} testID="pin-submit" />
      <Button tone="quiet" label={t('pin.loginInstead')} onPress={() => void signOut()} />
    </Screen>
  );
}

/**
 * Consent. `GET /me/consent` is authoritative (`consented`, `current_version`, `required_version`)
 * and `POST /consent` records `{ consent_type, policy_version, accepted }`. The app asks for
 * `GPS_TRACKING_WORKING_HOURS`, which is what the clock-in contract requires (C-16).
 */
export function ConsentScreen() {
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);
  async function accept() {
    setBusy(true);
    try { await acceptConsent('GPS_TRACKING_WORKING_HOURS'); const ui = useUi.getState(); ui.setSession(ui.roles); }
    finally { setBusy(false); }
  }
  return (
    <Screen center testID="consent">
      <Title>{t('auth.consentTitle')}</Title>
      <Body>{t('auth.consentTitle')}</Body>
      <Body dim>{t('consent.body')}</Body>
      <Button label={t('auth.accept')} busy={busy} onPress={() => void accept()} testID="consent-accept" />
      <Button tone="quiet" label={t('auth.decline')} onPress={() => void signOut()} testID="consent-decline" />
    </Screen>
  );
}

export function SuspendedScreen() {
  const { t } = useTranslation();
  return <Screen center testID="suspended"><Title>{t('auth.suspendedTitle')}</Title><Body>{t('auth.suspended')}</Body><Button tone="quiet" label={t('auth.logOut')} onPress={() => void signOut()} /></Screen>;
}

export function BlockedScreen() {
  const { t } = useTranslation();
  const reason = useUi((s) => s.securityReason);
  React.useEffect(() => { void signOut(); }, []);
  return (
    <Screen center testID="blocked">
      <Title>{t('security.blockedTitle')}</Title>
      <Body>{t('security.blockedBody')}</Body>
      {reason === 'PINNING_NOT_CONFIGURED' ? <Body dim>{t('security.pinningMissing')}</Body> : null}
      {reason === 'HOOKED' ? <Body dim>{t('security.hooked')}</Body> : null}
      {reason === 'ROOTED' ? <Body dim>{t('security.rooted')}</Body> : null}
      <Button tone="quiet" label={t('auth.logOut')} onPress={() => void signOut()} />
    </Screen>
  );
}

/** B-17 (needs confirmation): both experiences offered when the account holds both roles. */
export function RoleSwitchScreen() {
  const { t } = useTranslation();
  const roles = useUi((s) => s.roles);
  const pick = (r: 'DRIVER' | 'ADMIN') => useUi.getState().setActiveRole(r);
  return (
    <Screen center testID="role-switch">
      <Title>{t('auth.chooseExperience')}</Title>
      {roles.includes('DRIVER') ? <Button label={t('auth.continueDriver')} onPress={() => pick('DRIVER')} testID="role-driver" /> : null}
      <Button label={t('auth.continueAdmin')} onPress={() => pick('ADMIN')} testID="role-admin" />
    </Screen>
  );
}

const styles = StyleSheet.create({
  foot: { fontFamily: font.body, fontSize: 13, color: color.mist, textAlign: 'center', marginTop: space.md },
});