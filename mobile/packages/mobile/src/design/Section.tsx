import React from 'react';
import { View } from 'react-native';
import { Text } from './Text';
import { color, font, radius, space } from './tokens';
/** A titled group of related rows (settings are grouped, not one long list of identical buttons). */
export function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={{ gap: space.sm }}>
      <Text accessibilityRole="header" style={{ fontFamily: font.bodyStrong, fontSize: 13, letterSpacing: 0.6, textTransform: 'uppercase', color: color.mist }}>{title}</Text>
      <View style={{ backgroundColor: color.paper, borderRadius: radius.sheet, padding: space.md, gap: space.sm }}>{children}</View>
    </View>
  );
}
