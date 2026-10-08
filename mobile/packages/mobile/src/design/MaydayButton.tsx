import React, { useRef, useState } from 'react';
import { MAYDAY_HOLD_MS } from '../core/policy';
import { Animated, Pressable, Vibration, View } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Text } from './Text';
import { announce } from './states';
import { color, font, radius, space } from './tokens';
import { shiftActiveQuery } from '../queries';
import { sendMayday, type MaydayResult } from '../mayday';

// B-06 (decided): a 2 s hold, then a 300 ms vibration; location is the last known fix, else one balanced fix.
// Both the fill bar and `delayLongPress` read MAYDAY_HOLD_MS, so the animation and the trigger cannot disagree.
const HOLD_MS = MAYDAY_HOLD_MS;
/**
 * Hold-to-send Mayday, reachable from Home in one gesture. Two seconds of holding prevents a pocket press from alerting the whole
 * fleet; the fill bar shows progress. TalkBack/VoiceOver users trigger it with the standard "double tap and hold".
 */
export function MaydayButton() {
  const { t } = useTranslation(); const shift = useQuery(shiftActiveQuery); const fill = useRef(new Animated.Value(0)).current;
  const [state, setState] = useState<'idle' | 'holding' | 'sending' | MaydayResult | 'failed'>('idle');
  const start = () => { setState('holding'); Animated.timing(fill, { toValue: 1, duration: HOLD_MS, useNativeDriver: false }).start(); };
  const stop = () => { fill.stopAnimation(); fill.setValue(0); setState((s) => (s === 'holding' ? 'idle' : s)); };
  async function fire() {
    Vibration.vibrate(300); setState('sending');
    try { const r = await sendMayday({ shift_id: shift.data?.shift_id ?? null, vehicle_id: shift.data?.vehicle_id ?? null }); setState(r); announce(r === 'NO_GPS' ? t('mayday.noGps') : r === 'SENT' ? t('mayday.sent') : t('mayday.queued')); }
    catch { setState('failed'); announce(t('mayday.failed')); }
    finally { fill.setValue(0); }
  }
  const msg = state === 'SENT' ? t('mayday.sent') : state === 'QUEUED' ? t('mayday.queued') : state === 'NO_GPS' ? t('mayday.noGps') : state === 'failed' ? t('mayday.failed') : null;
  return (
    <View style={{ gap: space.sm }}>
      <Pressable accessibilityRole="button" accessibilityLabel={t('mayday.hold')} accessibilityHint={t('mayday.hint')} delayLongPress={HOLD_MS} onPressIn={start} onPressOut={stop} onLongPress={() => void fire()}
        style={{ minHeight: 72, borderRadius: radius.sheet, backgroundColor: color.brake, overflow: 'hidden', justifyContent: 'center', alignItems: 'center' }}>
        <Animated.View style={{ position: 'absolute', left: 0, top: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.28)', width: fill.interpolate({ inputRange: [0, 1], outputRange: ['0%', '100%'] }) }} />
        <Text style={{ fontFamily: font.heading, fontSize: 22, color: color.paper }}>{state === 'holding' ? t('mayday.holding') : t('mayday.hold')}</Text>
      </Pressable>
      {msg ? <Text accessibilityLiveRegion="assertive" style={{ fontFamily: font.bodyStrong, color: state === 'SENT' || state === 'QUEUED' ? color.asphalt : color.brake }}>{msg}</Text> : <Text style={{ fontFamily: font.body, fontSize: 13, color: color.mist }}>{t('mayday.hint')}</Text>}
    </View>
  );
}
