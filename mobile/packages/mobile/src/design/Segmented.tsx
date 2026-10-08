import React from 'react';
import { Pressable, View } from 'react-native';
import { Text } from './Text';
import { chipHeight, color, font, radius, space } from './tokens';

/** Equal-width segmented control (tabs inside a screen). Announced as a tab list; selected state is also shown by fill, not colour alone. */
export function Segmented<K extends string>({ options, value, onChange }: { options: { key: K; label: string; badge?: number }[]; value: K; onChange: (k: K) => void }) {
  return (
    <View accessibilityRole="tablist" style={{ flexDirection: 'row', backgroundColor: color.paper, borderRadius: radius.control, padding: 4, gap: 4 }}>
      {options.map((o) => {
        const on = o.key === value;
        return (
          <Pressable key={o.key} accessibilityRole="tab" accessibilityState={{ selected: on }} onPress={() => onChange(o.key)} style={{ flex: 1, minHeight: chipHeight, borderRadius: radius.control - 3, alignItems: 'center', justifyContent: 'center', backgroundColor: on ? color.asphalt : 'transparent', paddingHorizontal: space.sm }}>
            <Text numberOfLines={1} style={{ fontFamily: font.bodyStrong, color: on ? color.paper : color.asphalt }}>{o.label}{o.badge ? ` · ${o.badge}` : ''}</Text>
          </Pressable>);
      })}
    </View>
  );
}
