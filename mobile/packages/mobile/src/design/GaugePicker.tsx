import React from 'react';
import { Pressable, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { FuelGauge } from '@fleet/shared';
import { Text } from './Text';
import { chipHeight, color, font, radius, space } from './tokens';

const SHORT: Record<FuelGauge, string> = { EMPTY: 'E', QUARTER: '¼', HALF: '½', THREE_QUARTER: '¾', FULL: 'F' };
/** The five fuel-gauge positions the API accepts. Required on clock-in and clock-out: it must be what the driver reads, never a default. */
export function GaugePicker({ label, value, onChange }: { label: string; value: FuelGauge | null; onChange: (g: FuelGauge) => void }) {
  const { t } = useTranslation();
  return (
    <View accessibilityRole="radiogroup" accessibilityLabel={label} style={{ gap: space.xs }}>
      <Text style={{ fontFamily: font.bodyStrong, fontSize: 14, color: color.asphalt }}>{label}</Text>
      <View style={{ flexDirection: 'row', gap: space.sm }}>
        {FuelGauge.options.map((g) => {
          const on = value === g;
          return (
            <Pressable key={g} accessibilityRole="radio" accessibilityState={{ selected: on }} accessibilityLabel={t(`gauge.${g}`)} onPress={() => onChange(g)}
              style={{ flex: 1, minHeight: chipHeight + 8, alignItems: 'center', justifyContent: 'center', borderRadius: radius.control, borderWidth: 2, borderColor: color.asphalt, backgroundColor: on ? color.asphalt : color.paper }}>
              <Text style={{ fontFamily: font.heading, fontSize: 20, color: on ? color.paper : color.asphalt }}>{SHORT[g]}</Text>
            </Pressable>);
        })}
      </View>
    </View>
  );
}
