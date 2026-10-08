import React, { useState } from 'react';
import { View } from 'react-native';
import { usePreventScreenCapture } from 'expo-screen-capture';
import { useTranslation } from 'react-i18next';
import { AppError, MfaEnrollSchema, MfaEnrollResponseSchema } from '@fleet/shared';
import { api } from '../../services';
import { ENDPOINTS, url } from '../../api/endpoints';
import { Body, Button, Card, ErrorState, Field, Title } from '../../design/components';
import { Screen } from '../../design/Screen';
import { Text } from '../../design/Text';
import { color, font, space } from '../../design/tokens';

/**
 * Two-step login setup.
 *
 * C-03 and E-19 resolved, and both change this screen:
 *  • MFA is a DELIVERED OTP, not TOTP. `POST /auth/mfa/enroll` returns `{ recovery_codes }` and
 *    nothing else — there is no `provisioning_uri`, no secret and no QR code to show, because the
 *    6-digit code arrives by SMS (drivers) or email (admins). The QR screen was a wrong guess and is
 *    gone.
 *  • Enrolment is SELF-service and takes only `{ password }`. The endpoint requires
 *    `manage_own_mfa`, there is no target-user field and no admin provisioning route anywhere in the
 *    API, so the admin driver detail cannot enrol on somebody else's behalf and this screen is not
 *    reachable from the driver roster.
 */
export function MfaSetupScreen() {
  const { t } = useTranslation();
  const [password, setPassword] = useState('');
  const [codes, setCodes] = useState<string[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  usePreventScreenCapture();   // the recovery codes must not land in screenshots, recents or screen recordings

  async function start() {
    setBusy(true); setErr(null);
    try {
      const r = await api.post(url(ENDPOINTS.mfaEnroll), { body: MfaEnrollSchema.parse({ password }), schema: MfaEnrollResponseSchema });
      setCodes(r.recovery_codes); setPassword('');
    } catch (e) { setErr(e instanceof AppError ? e.error_code : 'UNKNOWN'); }
    finally { setBusy(false); }
  }

  return (
    <Screen testID="mfa-setup">
      <Title>{t('mfa.title')}</Title>
      {codes ? (
        <>
          <Card>
            <Body>{t('mfa.recoveryHelp')}</Body>
            <View style={{ gap: space.xs }}>
              {codes.map((c) => <Text key={c} style={styles.code}>{c}</Text>)}
            </View>
          </Card>
          <Body dim>{t('mfa.deliveredCodeHelp')}</Body>
        </>
      ) : (
        <>
          <Body>{t('mfa.body')}</Body>
          <Field label={t('mfa.password')} value={password} onChange={setPassword} secureTextEntry secureToggle autoCapitalize="none" textContentType="password" />
          {err ? <ErrorState code={err} /> : null}
          <Button label={t('mfa.start')} busy={busy} disabled={!password} onPress={() => void start()} testID="mfa-enroll" />
        </>
      )}
    </Screen>
  );
}

const styles = { code: { fontFamily: font.bodyStrong, fontSize: 16, color: color.asphalt } } as const;