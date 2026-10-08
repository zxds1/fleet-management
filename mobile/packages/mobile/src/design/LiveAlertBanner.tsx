import { useState } from 'react';
import { Alert, Linking } from 'react-native';
import { Modal, ScrollView, StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Card } from '../design/components';
import { Body, Button } from '../design/components';
import { Text } from '../design/Text';
import { color, font, radius, space } from '../design/tokens';
import { useUi } from '../state/store';
import { currentFix } from '../core/location';
import { alertFromEvent } from '../core/liveAlerts';
import { sendMayday } from '../mayday';
import { queryClient } from '../services';
import { useCan } from '../state/store';

export { alertFromEvent };

/**
 * Mayday banner. Fed by the gateway's `accident:live` and `driver:accident` events (the driver only
 * ever joins their own room), never by polling. Dismissing is local; the admin's live list is still
 * refreshed in the background.
 */
export function LiveAlertBanner() {
  const { t } = useTranslation();
  const alert = useUi((s) => s.liveAlert);
  const [sending, setSending] = useState(false);
  const activeRole = useUi((s) => s.activeRole);
  if (!alert || activeRole !== 'ADMIN') return null;
  const isMayday = alert.kind === 'MAYDAY';

  async function open() {
    if (isMayday) { setSending(true); try { await sendMayday({ shift_id: null, vehicle_id: null }, 'ADMIN_MAYDAY_ESCALATION'); } catch { Alert.alert(t('mayday.failed')); } finally { setSending(false); } return; }
    setSending(true);
    try {
      const fix = await currentFix();
      if (!fix) { Alert.alert(t('mayday.noGps')); return; }
      await sendMayday({ shift_id: null, vehicle_id: null }, 'ADMIN_ASSIST');
    } catch { Alert.alert(t('mayday.failed')); } finally { setSending(false); }
  }

  return (
    <View accessibilityRole="alert" style={[s.wrap, { backgroundColor: isMayday ? color.brake : color.hazard }]}>
      <View style={{ flex: 1, gap: space.xs }}>
        <Text style={[s.title, { color: isMayday ? color.paper : color.asphalt }]}>{isMayday ? t('alerts.mayday') : t('alerts.accidentUpdate', { status: alert.text })}</Text>
      </View>
      <View style={s.actions}>
        <Button tone="quiet" label={sending ? t('state.loading') : t('alerts.maydayOpen')} onPress={() => { void open(); void queryClient.invalidateQueries({ queryKey: ['accidents'] }); }} />
        <Button tone="quiet" label={t('alerts.dismiss')} onPress={() => useUi.getState().setLiveAlert(null)} />
      </View>
    </View>
  );
}

export const useAccidentAcknowledgePermission = (): boolean => useCan('accident:acknowledge');

const s = StyleSheet.create({
  wrap: { flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingHorizontal: space.md, paddingVertical: space.sm },
  title: { fontFamily: font.heading, fontSize: 16 },
  actions: { flexDirection: 'row', gap: space.sm },
});

export { Card, Body, ScrollView, Modal, Linking, radius };