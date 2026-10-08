import React, { useEffect } from 'react';
import { View } from 'react-native';
import { Text } from './Text';
import { announce } from './states';
import { color, font, radius, space } from './tokens';
import { useUi } from '../state/store';

/** A quiet, self-dismissing message for things that need no decision (e.g. "Duplicate change discarded"). Announced to screen readers. */
export function Toast() {
  const msg = useUi((s) => s.toast); const clear = useUi((s) => s.clearToast);
  useEffect(() => { if (!msg) return; announce(msg); const t = setTimeout(clear, 4000); return () => clearTimeout(t); }, [msg, clear]);
  if (!msg) return null;
  return <View pointerEvents="none" style={{ position: 'absolute', left: space.md, right: space.md, bottom: space.xl, backgroundColor: color.asphalt, padding: space.md, borderRadius: radius.control }}><Text style={{ fontFamily: font.bodyStrong, color: color.paper }}>{msg}</Text></View>;
}
