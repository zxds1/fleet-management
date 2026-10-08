import React, { useEffect, useState } from 'react';
import { AppState, View } from 'react-native';
import { Logo } from './Logo';
import { color } from './tokens';
/** Covers the app while it is in the app switcher / backgrounded so recents never show driver, fuel or accident data. */
export function PrivacyShield() {
  const [hidden, setHidden] = useState(AppState.currentState !== 'active');
  useEffect(() => { const sub = AppState.addEventListener('change', (s) => setHidden(s !== 'active')); return () => sub.remove(); }, []);
  return hidden ? <View pointerEvents="none" style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: color.dust, alignItems: 'center', justifyContent: 'center' }}><Logo size={96} /></View> : null;
}
