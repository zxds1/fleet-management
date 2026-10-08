import React from 'react';
import { Text as RNText, type TextProps } from 'react-native';
/** Every piece of text in the app goes through this so large system font sizes can never break a layout (capped at 1.3x). */
export function Text(props: TextProps) { return <RNText maxFontSizeMultiplier={1.3} {...props} />; }
