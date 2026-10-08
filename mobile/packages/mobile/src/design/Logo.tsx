import React from 'react';
import Svg, { Defs, G, LinearGradient, Line, Path, Circle, Rect, Filter, FeGaussianBlur, FeComposite, Stop } from 'react-native-svg';
import { color } from './tokens';

export function Logo({ size = 88 }: { size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 512 512" accessibilityRole="image" accessibilityLabel="Helix">
      <Defs>
        <LinearGradient id="helixBg" x1="0%" y1="0%" x2="100%" y2="100%">
          <Stop offset="0%" stopColor="#090D16" />
          <Stop offset="50%" stopColor="#0F172A" />
          <Stop offset="100%" stopColor="#030712" />
        </LinearGradient>
        <LinearGradient id="strandCyan" x1="0%" y1="0%" x2="100%" y2="100%">
          <Stop offset="0%" stopColor="#06B6D4" />
          <Stop offset="60%" stopColor="#0EA5E9" />
          <Stop offset="100%" stopColor="#3B82F6" />
        </LinearGradient>
        <LinearGradient id="strandViolet" x1="0%" y1="100%" x2="100%" y2="0%">
          <Stop offset="0%" stopColor="#6366F1" />
          <Stop offset="50%" stopColor="#8B5CF6" />
          <Stop offset="100%" stopColor="#D946EF" />
        </LinearGradient>
        <LinearGradient id="bridgeGrad" x1="0%" y1="50%" x2="100%" y2="50%">
          <Stop offset="0%" stopColor="#06B6D4" stopOpacity="0.8" />
          <Stop offset="100%" stopColor="#D946EF" stopOpacity="0.8" />
        </LinearGradient>
        <Filter id="softGlow" x="-20%" y="-20%" width="140%" height="140%">
          <FeGaussianBlur stdDeviation="14" result="blur" />
          <FeComposite in="SourceGraphic" in2="blur" operator="over" />
        </Filter>
      </Defs>
      <Rect width="512" height="512" rx="116" fill="url(#helixBg)" />
      <Rect x="2" y="2" width="508" height="508" rx="114" fill="none" stroke="#FFFFFF" strokeOpacity="0.08" strokeWidth="2.5" />
      <G transform="translate(146, 96)" filter="url(#softGlow)" opacity="0.35">
        <Line x1="45" y1="90" x2="175" y2="110" stroke="url(#bridgeGrad)" strokeWidth="8" strokeLinecap="round" />
        <Line x1="175" y1="210" x2="45" y2="230" stroke="url(#bridgeGrad)" strokeWidth="8" strokeLinecap="round" />
        <Path d="M 45 40 C 45 100 175 120 175 160 C 175 200 45 220 45 280" fill="none" stroke="url(#strandCyan)" strokeWidth="28" strokeLinecap="round" />
        <Path d="M 175 40 C 175 100 45 120 45 160 C 45 200 175 220 175 280" fill="none" stroke="url(#strandViolet)" strokeWidth="28" strokeLinecap="round" />
      </G>
      <Line x1="50" y1="92" x2="170" y2="108" stroke="url(#bridgeGrad)" strokeWidth="6" strokeLinecap="round" opacity="0.85" />
      <Line x1="170" y1="212" x2="50" y2="228" stroke="url(#bridgeGrad)" strokeWidth="6" strokeLinecap="round" opacity="0.85" />
      <Circle cx="110" cy="160" r="7" fill="#FFFFFF" opacity="0.95" />
      <Path d="M 50 40 C 50 100 170 120 170 160 C 170 200 50 220 50 280" fill="none" stroke="url(#strandCyan)" strokeWidth="24" strokeLinecap="round" />
      <Path d="M 170 40 C 170 100 50 120 50 160 C 50 200 170 220 170 280" fill="none" stroke="url(#strandViolet)" strokeWidth="24" strokeLinecap="round" />
      <Circle cx="50" cy="40" r="7" fill="#67E8F9" />
      <Circle cx="170" cy="40" r="7" fill="#F472B6" />
      <Circle cx="50" cy="280" r="7" fill="#38BDF8" />
      <Circle cx="170" cy="280" r="7" fill="#E879F9" />
    </Svg>
  );
}
