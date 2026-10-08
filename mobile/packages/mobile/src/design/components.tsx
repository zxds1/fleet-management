import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, TextInput, View, StyleSheet, type StyleProp, type TextInputProps, type TextStyle } from 'react-native';
import { Text } from './Text';
import { useTranslation } from 'react-i18next';
import { color, font, radius, space, statusColor, touch, type, type DisplayState } from './tokens';
import { describeError } from '../core/errors';
import { defaultActionFor } from '../errorActions';

const clamp = { maxFontSizeMultiplier: 1.3 } as const;

export function Button({ label, onPress, busy, disabled, tone = 'primary', testID }: { label: string; onPress: () => void; busy?: boolean; disabled?: boolean; tone?: 'primary' | 'quiet' | 'danger'; testID?: string }) {
  const off = busy || disabled;
  const bg = tone === 'primary' ? color.verge : tone === 'danger' ? color.brake : 'transparent';
  return (
    <Pressable testID={testID} accessibilityRole="button" accessibilityState={{ disabled: !!off, busy: !!busy }} onPress={off ? undefined : onPress}
      style={({ pressed }) => [s.btn, { backgroundColor: bg, opacity: off ? 0.5 : pressed ? 0.85 : 1, borderWidth: tone === 'quiet' ? 2 : 0, borderColor: color.asphalt }]}>
      {busy ? <ActivityIndicator color={tone === 'quiet' ? color.asphalt : color.paper} /> : <Text {...clamp} style={[s.btnText, { color: tone === 'quiet' ? color.asphalt : color.paper }]}>{label}</Text>}
    </Pressable>
  );
}

/**
 * A labelled text input. `onChange` receives the TEXT, not the event, so every form can wire
 * `onChange={setX}` directly and never touch `event.nativeEvent.text`.
 */
export interface FieldProps extends Omit<TextInputProps, 'onChange'> {
  label: string;
  error?: string;
  secureToggle?: boolean;
  onChange?: (text: string) => void;
}
export function Field({ label, error, secureToggle, onChange, ...p }: FieldProps) {
  const { t } = useTranslation(); const [hidden, setHidden] = useState(!!p.secureTextEntry);
  return (
    <View style={{ gap: space.xs }}>
      <Text {...clamp} style={s.label}>{label}</Text>
      <View style={[s.inputWrap, error ? { borderColor: color.brake } : null]}>
        <TextInput maxFontSizeMultiplier={1.3} {...p} onChangeText={onChange} accessibilityLabel={label} secureTextEntry={hidden} placeholderTextColor={color.mist} style={s.input} />
        {secureToggle ? <Pressable accessibilityRole="button" onPress={() => setHidden((h) => !h)} hitSlop={12}><Text {...clamp} style={s.link}>{hidden ? t('auth.showPassword') : t('auth.hidePassword')}</Text></Pressable> : null}
      </View>
      {error ? <Text {...clamp} accessibilityLiveRegion="polite" style={s.error}>{error}</Text> : null}
    </View>
  );
}

export const Card = ({ children }: { children: React.ReactNode }) => <View style={s.card}>{children}</View>;

/**
 * A single-selectable row in a list of options (a trailer to hook, a card to present). Announced as a
 * radio rather than a checkbox, because choosing one of several IS a radio group, and a screen-reader
 * user needs to be able to hear that the alternatives are mutually exclusive.
 */
export function CheckRow({ label, checked, onPress, sublabel, testID }: { label: string; checked?: boolean; onPress: () => void; sublabel?: string; testID?: string }) {
  return (
    <Pressable testID={testID} accessibilityRole="radio" accessibilityState={{ selected: !!checked }} accessibilityLabel={sublabel ? `${label}. ${sublabel}` : label} onPress={onPress}
      style={[s.row, checked ? { borderColor: color.verge, backgroundColor: color.dust } : null]}>
      <View style={{ flex: 1, gap: space.xs }}>
        <Text {...clamp} style={s.rowLabel}>{label}</Text>
        {sublabel ? <Text {...clamp} style={s.rowSub}>{sublabel}</Text> : null}
      </View>
      <Text {...clamp} style={[s.rowMark, checked ? { color: color.verge } : null]}>{checked ? '\u25cf' : '\u25cb'}</Text>
    </Pressable>
  );
}
export const Title = ({ children, style }: { children: React.ReactNode; style?: StyleProp<TextStyle> }) => <Text {...clamp} accessibilityRole="header" style={[s.title, style]}>{children}</Text>;
export const Body = ({ children, dim, style }: { children: React.ReactNode; dim?: boolean; style?: StyleProp<TextStyle> }) => <Text {...clamp} style={[s.body, dim ? { color: color.mist } : null, style]}>{children}</Text>;

export function StatusBadge({ state }: { state: DisplayState }) {
  const { t } = useTranslation();   // status is always text + color, never color alone
  return <View style={[s.badge, { backgroundColor: statusColor[state] }]}><Text {...clamp} style={s.badgeText}>{t(`status.${state}`)}</Text></View>;
}

export function OfflineBanner() {
  const { t } = useTranslation();
  return <View accessibilityRole="alert" style={s.banner}><Text {...clamp} style={s.bannerText}>{t('offline.banner')}</Text></View>;
}

export function ErrorState({ code, detail, onAction }: { code: string; detail?: string; onAction?: () => void }) {
  const { t } = useTranslation(); const { key, action } = describeError(code);
  const press = onAction ?? defaultActionFor(action);   // explicit screen handler first, then the app-wide default for this action
  // RATE_LIMITED is the one error where the right action really is "wait, then try again": the button unlocks after a short countdown.
  const timed = code === 'RATE_LIMITED'; const [wait, setWait] = useState(15);
  useEffect(() => { if (!timed || wait <= 0) return; const i = setTimeout(() => setWait((w) => w - 1), 1000); return () => clearTimeout(i); }, [timed, wait]);
  const retry = onAction ?? defaultActionFor('RETRY');
  return (
    <Card>
      <Text {...clamp} accessibilityLiveRegion="assertive" style={[s.body, { color: color.brake, fontFamily: font.bodyStrong }]}>{t(key)}</Text>
      {detail && code === 'VALIDATION_ERROR' ? <Body dim>{detail}</Body> : null}
      {timed && retry ? <Button tone="quiet" disabled={wait > 0} label={wait > 0 ? t('state.waitSeconds', { n: wait }) : t('actions.RETRY')} onPress={retry} /> : press && !timed ? <Button tone="quiet" label={t(`actions.${action}`)} onPress={press} /> : null}
    </Card>
  );
}

export function EmptyState({ text, actionLabel, onAction }: { text: string; actionLabel?: string; onAction?: () => void }) {
  return <View style={{ alignItems: 'center', gap: space.md, padding: space.xl }}><Body dim>{text}</Body>{actionLabel && onAction ? <Button label={actionLabel} onPress={onAction} /> : null}</View>;
}

const s = StyleSheet.create({
  btn: { minHeight: touch, borderRadius: radius.control, alignItems: 'center', justifyContent: 'center', paddingHorizontal: space.lg },
  btnText: { fontFamily: font.heading, fontSize: type.lead },
  row: { minHeight: touch, flexDirection: 'row', alignItems: 'center', gap: space.sm, borderWidth: 2, borderColor: color.line, borderRadius: radius.control, paddingHorizontal: space.md, paddingVertical: space.sm, backgroundColor: color.paper },
  rowLabel: { fontFamily: font.bodyStrong, fontSize: type.lead, color: color.asphalt },
  rowSub: { fontFamily: font.body, fontSize: type.caption, color: color.mist },
  rowMark: { fontFamily: font.heading, fontSize: type.lead, color: color.mist },
  label: { fontFamily: font.bodyStrong, fontSize: type.caption + 1, color: color.asphalt },
  inputWrap: { minHeight: touch, flexDirection: 'row', alignItems: 'center', backgroundColor: color.paper, borderRadius: radius.control, borderWidth: 2, borderColor: color.line, paddingHorizontal: space.md, gap: space.sm },
  input: { flex: 1, fontFamily: font.body, fontSize: type.lead, color: color.asphalt, minHeight: touch },
  link: { fontFamily: font.bodyStrong, fontSize: type.caption + 1, color: color.verge },
  error: { fontFamily: font.body, fontSize: type.caption + 1, color: color.brake },
  card: { backgroundColor: color.paper, borderRadius: radius.sheet, padding: space.md, gap: space.sm },
  title: { fontFamily: font.heading, fontSize: type.title, color: color.asphalt },
  body: { fontFamily: font.body, fontSize: type.body, color: color.asphalt, lineHeight: type.body * 1.5 },
  badge: { alignSelf: 'flex-start', paddingHorizontal: space.sm + 2, paddingVertical: space.xs + 1, borderRadius: radius.control },
  badgeText: { fontFamily: font.bodyStrong, fontSize: type.caption + 1, color: color.paper },
  banner: { backgroundColor: color.hazard, padding: space.sm + 2 },
  bannerText: { fontFamily: font.bodyStrong, fontSize: type.caption + 1, color: color.asphalt },
});
