import React, { useEffect, useState } from 'react';
import * as LocalAuthentication from 'expo-local-authentication';
import * as Device from 'expo-device';
import Constants from 'expo-constants';
import { useTranslation } from 'react-i18next';
import { z } from 'zod';
import { AppError, ChangePasswordSchema, SaveOnboardingProfileSchema, SubmitBackgroundCheckSchema, DriverTrainingStatusSchema, type ChangePasswordInput, type SaveOnboardingProfileInput, type SubmitBackgroundCheckInput } from '@fleet/shared';
import { ENDPOINTS, url } from '../../api/endpoints';
import { api, session, signOut } from '../../services';
import { getDevices, getDeviceId, revokeCurrentDevice, setServerAndLocalPin } from '../../device';
import { decodeJwt } from '../../core/jwt';
import { rememberLocale } from '../../i18n';
import { fmtDate } from '../../format';
import { Body, Button, Card, ErrorState, Field } from '../../design/components';
import { Screen } from '../../design/Screen';
import { Section } from '../../design/Section';
import { Title } from '../../design/components';
import { useUi, useCan, type Role } from '../../state/store';
import { announce } from '../../design/states';

/** Everything the person can change about themselves and this device, grouped: Account, Security, Device, Data. */
export function SettingsScreen({ navigation }: any) {
  const { t, i18n } = useTranslation(); const { roles, outboxCount, setLocale, activeRole, setActiveRole } = useUi(); const canManageMfa = useCan('manage_own_mfa');
  const [who, setWho] = useState(''); const [deviceId, setDeviceId] = useState(''); const [bio, setBio] = useState(false); const [consent, setConsent] = useState<{ version: string; at: string } | null>(null);
  const [pin, setPin] = useState(''); const [pinMsg, setPinMsg] = useState<string | null>(null); const [pinErr, setPinErr] = useState<string | null>(null); const [armLogout, setArmLogout] = useState(false);
  const [cp, setCp] = useState<{ current: string; next: string }>({ current: '', next: '' }); const [cpErr, setCpErr] = useState<string | null>(null); const [cpMsg, setCpMsg] = useState<string | null>(null);
  const [profile, setProfile] = useState<SaveOnboardingProfileInput>({ full_name: '', licence_number: '', licence_class: '', emergency_contact_name: '', emergency_contact_phone: '' }); const [profileErr, setProfileErr] = useState<string | null>(null); const [profileMsg, setProfileMsg] = useState<string | null>(null);
  const [bg, setBg] = useState<SubmitBackgroundCheckInput>({ provider: '', consent_given: false }); const [bgErr, setBgErr] = useState<string | null>(null); const [bgMsg, setBgMsg] = useState<string | null>(null);
  const [training, setTraining] = useState<{ completed: string[]; total: number; all: boolean } | null>(null); const [trainingErr, setTrainingErr] = useState<string | null>(null);
  const [devices, setDevices] = useState<{ device_id: string; platform: string; last_seen_at: string | null }[]>([]); const [revoking, setRevoking] = useState<string | null>(null);
  useEffect(() => {
    void getDeviceId().then(setDeviceId); void session.biometricEnabled().then(setBio); void session.getConsent().then(setConsent);
    void session.getAccessToken().then((tok) => { const c = decodeJwt(tok); setWho(c?.name ?? c?.email ?? ''); });
    void loadProfile(); void loadTraining(); void loadDevices();
  }, []);
  const other: Role | null = roles.includes('ADMIN') && roles.includes('DRIVER') ? (activeRole === 'ADMIN' ? 'DRIVER' : 'ADMIN') : null;
  const flip = () => { const l = i18n.language === 'sw' ? 'en' : 'sw'; void i18n.changeLanguage(l); setLocale(l); rememberLocale(l); };
  async function loadProfile() { try { const r = await api.get(url(ENDPOINTS.myOnboarding), { schema: SaveOnboardingProfileSchema }); setProfile({ full_name: r.full_name ?? '', licence_number: r.licence_number ?? '', licence_class: r.licence_class ?? '', emergency_contact_name: r.emergency_contact_name ?? '', emergency_contact_phone: r.emergency_contact_phone ?? '' }); } catch { /* auth-only */ } }
  async function loadTraining() { try { const r = await api.get(url(ENDPOINTS.myTrainingStatus), { schema: DriverTrainingStatusSchema }); setTraining({ completed: r.completed_lessons, total: r.total_lessons, all: r.all_complete }); } catch (e) { setTrainingErr(e instanceof AppError ? e.error_code : 'UNKNOWN'); } }
  async function loadDevices() { const list = await getDevices(); setDevices(list.map((d) => ({ device_id: d.device_id, platform: d.platform, last_seen_at: d.last_seen_at }))); }
  async function savePin() { setPinErr(null); setPinMsg(null); try { await setServerAndLocalPin(pin); setPin(''); setPinMsg(t('profile.pinSaved')); announce(t('profile.pinSaved')); } catch (e) { setPinErr(e instanceof AppError ? e.error_code : 'UNKNOWN'); } }
  async function toggleBio() { if (!bio) { const ok = (await LocalAuthentication.hasHardwareAsync()) && (await LocalAuthentication.isEnrolledAsync()); if (!ok) return; const r = await LocalAuthentication.authenticateAsync({ promptMessage: t('profile.biometric') }); if (!r.success) return; } await session.setBiometricEnabled(!bio); setBio(!bio); }
  async function changePassword() { setCpErr(null); setCpMsg(null); try { const body = ChangePasswordSchema.parse(cp); await api.post(url(ENDPOINTS.changePassword), { body }); setCp({ current: '', next: '' }); setCpMsg(t('profile.passwordSaved')); announce(t('profile.passwordSaved')); } catch (e) { setCpErr(e instanceof AppError ? e.error_code : 'UNKNOWN'); } }
  async function saveProfile() { setProfileErr(null); setProfileMsg(null); try { const body = SaveOnboardingProfileSchema.parse(profile); await api.post(url(ENDPOINTS.saveOnboardingProfile), { body }); setProfileMsg(t('profile.saved')); announce(t('profile.saved')); } catch (e) { setProfileErr(e instanceof AppError ? e.error_code : 'UNKNOWN'); } }
  async function submitBg() { setBgErr(null); setBgMsg(null); try { const body = SubmitBackgroundCheckSchema.parse(bg); await api.post(url(ENDPOINTS.submitBackgroundCheck), { body }); setBgMsg(t('profile.bgSubmitted')); announce(t('profile.bgSubmitted')); } catch (e) { setBgErr(e instanceof AppError ? e.error_code : 'UNKNOWN'); } }
  async function revoke(device_id: string) { setRevoking(device_id); try { await revokeCurrentDevice(device_id); await loadDevices(); } finally { setRevoking(null); } }
  return (
    <Screen>
      <Title>{t('profile.title')}</Title>
      <Section title={t('settings.account')}>
        {who ? <Body>{t('profileExtra.name')}: {who}</Body> : null}<Body dim>{roles.join(', ')}</Body>
        <Button tone="quiet" label={`${t('profile.language')}: ${i18n.language === 'sw' ? 'Kiswahili' : 'English'}`} onPress={flip} />
        {other ? <Button tone="quiet" label={t('settings.switchRole', { role: t(`settings.role${other}`) })} onPress={() => setActiveRole(other)} /> : null}
      </Section>
      <Section title={t('settings.security')}>
        {activeRole === 'DRIVER' ? <><Field label={t('profile.resetPin')} value={pin} onChangeText={(v) => setPin(v.replace(/\D/g, ''))} keyboardType="number-pad" maxLength={4} secureTextEntry returnKeyType="done" onSubmitEditing={() => pin.length === 4 && void savePin()} />
          {pinErr ? <ErrorState code={pinErr} /> : null}{pinMsg ? <Body>{pinMsg}</Body> : null}<Button tone="quiet" label={t('profile.resetPin')} onPress={() => void savePin()} disabled={pin.length !== 4} /></> : null}
        <Button tone="quiet" label={`${t('profile.biometric')}: ${bio ? t('settings.on') : t('settings.off')}`} onPress={() => void toggleBio()} />
        {canManageMfa ? <Button tone="quiet" label={t('profile.setupMfa')} onPress={() => navigation.navigate('MfaSetup')} /> : <Body dim>{t('settings.readOnly')}</Body>}
        <Card><Body>{t('settings.changePassword')}</Body>
          <Field label={t('auth.password')} value={cp.current} onChangeText={(v) => setCp((p) => ({ ...p, current: v }))} secureTextEntry />
          <Field label={t('settings.newPassword')} value={cp.next} onChangeText={(v) => setCp((p) => ({ ...p, next: v }))} secureTextEntry />
          {cpErr ? <ErrorState code={cpErr} /> : null}{cpMsg ? <Body>{cpMsg}</Body> : null}
          <Button label={t('settings.changePassword')} onPress={() => void changePassword()} disabled={cp.current.length === 0 || cp.next.length < 8} /></Card>
      </Section>
      <Section title={t('settings.profile')}>
        <Card><Body>{t('profile.edit')}</Body>
          <Field label={t('profileExtra.name')} value={profile.full_name} onChangeText={(v) => setProfile((p) => ({ ...p, full_name: v }))} />
          <Field label={t('profile.licenceNumber')} value={profile.licence_number} onChangeText={(v) => setProfile((p) => ({ ...p, licence_number: v }))} />
          <Field label={t('profile.licenceClass')} value={profile.licence_class} onChangeText={(v) => setProfile((p) => ({ ...p, licence_class: v }))} />
          <Field label={t('profile.emergencyName')} value={profile.emergency_contact_name} onChangeText={(v) => setProfile((p) => ({ ...p, emergency_contact_name: v }))} />
          <Field label={t('profile.emergencyPhone')} value={profile.emergency_contact_phone} onChangeText={(v) => setProfile((p) => ({ ...p, emergency_contact_phone: v }))} />
          {profileErr ? <ErrorState code={profileErr} /> : null}{profileMsg ? <Body>{profileMsg}</Body> : null}
          <Button label={t('profile.save')} onPress={() => void saveProfile()} /></Card>
        <Card><Body>{t('profile.backgroundCheck')}</Body>
          <Field label={t('profile.bgProvider')} value={bg.provider} onChangeText={(v) => setBg((p) => ({ ...p, provider: v }))} />
          <Button tone="quiet" label={`${t('profile.bgConsent')}: ${bg.consent_given ? t('settings.on') : t('settings.off')}`} onPress={() => setBg((p) => ({ ...p, consent_given: !p.consent_given }))} />
          {bgErr ? <ErrorState code={bgErr} /> : null}{bgMsg ? <Body>{bgMsg}</Body> : null}
          <Button label={t('profile.bgSubmit')} onPress={() => void submitBg()} disabled={!bg.provider.trim()} /></Card>
        {training ? <Card><Body>{t('profile.training')}: {training.completed.length}/{training.total} {training.all ? '✓' : ''}</Body></Card> : trainingErr ? <Card><Body dim>{trainingErr}</Body></Card> : null}
      </Section>
      <Section title={t('settings.device')}>
        <Body>{t('profile.consent')}</Body><Body dim>{consent ? t('profileExtra.consentVersion', { v: consent.version, date: fmtDate(consent.at) }) : t('profileExtra.consentUnknown')}</Body>
        <Body dim>{t('profileExtra.model')}: {Device.modelName ?? '–'} · {Device.osName} {Device.osVersion}</Body><Body dim>{t('profileExtra.app')}: {Constants.expoConfig?.version ?? '–'} · {t('profileExtra.deviceId')}: {deviceId.slice(0, 8)}</Body>
        {devices.map((d) => (<Card key={d.device_id}><Body dim>{d.platform} · {d.device_id.slice(0, 8)} · {d.last_seen_at ? fmtDate(d.last_seen_at) : '–'}</Body>
          <Button tone="danger" label={t('profile.revokeDevice')} busy={revoking === d.device_id} onPress={() => void revoke(d.device_id)} /></Card>))}
      </Section>
      <Section title={t('settings.data')}>
        {activeRole === 'DRIVER' ? <Button tone="quiet" label={`${t('profile.openOutbox')}${outboxCount ? ` (${outboxCount})` : ''}`} onPress={() => navigation.navigate('Outbox')} /> : null}
        {armLogout && outboxCount > 0 ? <Body>{t('settings.logoutWarn')}</Body> : null}
        <Button tone="danger" label={t('auth.logOut')} onPress={() => { if (outboxCount > 0 && !armLogout) { setArmLogout(true); return; } void signOut(); }} />
      </Section>
    </Screen>
  );
}
