import React, { useEffect, useRef } from 'react';
import { AccessibilityInfo, Animated, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Text } from './Text';
import { color, font, radius, space } from './tokens';
import { useUi } from '../state/store';

/** Loading placeholder: pulsing bars. Announced once to screen readers instead of every bar. */
export function Skeleton({ rows = 3, height = 72 }: { rows?: number; height?: number }) {
  const { t } = useTranslation(); const a = useRef(new Animated.Value(0.45)).current;
  const [still, setStill] = React.useState(false);
  useEffect(() => { void AccessibilityInfo.isReduceMotionEnabled().then(setStill); }, []);   // respect the system "reduce motion" setting
  useEffect(() => { if (still) return; const loop = Animated.loop(Animated.sequence([Animated.timing(a, { toValue: 1, duration: 700, useNativeDriver: true }), Animated.timing(a, { toValue: 0.45, duration: 700, useNativeDriver: true })])); loop.start(); return () => loop.stop(); }, [a, still]);
  return (
    <View accessibilityRole="progressbar" accessibilityLabel={t('state.loading')} style={{ gap: space.sm }}>
      {Array.from({ length: rows }, (_, i) => <Animated.View key={i} style={{ opacity: a, height, borderRadius: radius.sheet, backgroundColor: color.line }} />)}
    </View>
  );
}

function Chip({ label, bg, fg }: { label: string; bg: string; fg: string }) {
  return <View style={{ alignSelf: 'flex-start', backgroundColor: bg, paddingHorizontal: space.sm + 2, paddingVertical: space.xs + 1, borderRadius: radius.control }}><Text style={{ fontFamily: font.bodyStrong, fontSize: 13, color: fg }}>{label}</Text></View>;
}
/** "Offline copy" tag, shown on any cached read while the device is offline. */
export function OfflineTag({ show }: { show?: boolean }) {
  const { t } = useTranslation(); const online = useUi((s) => s.online);
  return !online && show !== false ? <Chip label={t('state.offlineCopy')} bg={color.hazard} fg={color.asphalt} /> : null;
}
/** "Pending" chip for anything the person submitted that has not reached the server yet. */
export function PendingChip() { const { t } = useTranslation(); return <Chip label={t('state.pending')} bg={color.asphalt} fg={color.paper} />; }

/** Tells screen readers what just happened (success, queued, error) without moving focus. */
export const announce = (msg: string) => AccessibilityInfo.announceForAccessibility(msg);
/** Explains WHY a button is disabled, so nobody is left guessing which field is missing. */
export function MissingHint({ items }: { items: string[] }) {
  const { t } = useTranslation();
  return items.length ? <Text accessibilityLiveRegion="polite" style={{ fontFamily: font.body, fontSize: 14, color: color.mist }}>{t('forms.missing', { items: items.join(', ') })}</Text> : null;
}
