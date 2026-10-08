import { N5_ORDER, type VehicleDisplayState } from '@fleet/shared';

// D-01 resolved: 7-colour logistics palette with fixed status semantics.
//   asphalt  - primary text / headers (road surface)
//   verge    - primary actions / healthy / go-safe-confirm (road verge)
//   hazard   - warnings / pending review / attention (hazard lights)
//   brake    - errors / destructive / stop-blocked (brake lights)
//   dust     - screen background (road dust)
//   paper    - cards / surfaces (paperwork)
//   mist     - secondary text / disabled / metadata (fog / low visibility)
export const color = {
  asphalt: '#1B2328',
  verge: '#095545',
  hazard: '#F5B400',
  brake: '#8C281E',
  dust: '#E6EAE9',
  paper: '#FFFFFF',
  mist: '#56646A',
  line: '#C9D1D0',
} as const;

export const statusSemantics: Record<DisplayState, string> = {
  QUARANTINED: 'out of service / maintenance required',
  OFFLINE: 'no signal / disconnected',
  HOS_ALERT: 'hours-of-service violation',
  SPEEDING: 'speed violation',
  MOVING: 'active, en route',
  IDLING: 'engine running, stationary',
  PARKED: 'stationary, available',
};

export { N5_ORDER };
export type DisplayState = VehicleDisplayState;

export const statusColor: Record<DisplayState, string> = {
  QUARANTINED: '#7A1F5C', OFFLINE: '#6B7478', HOS_ALERT: '#A85500', SPEEDING: '#8C281E',
  MOVING: '#095545', IDLING: '#8A6D00', PARKED: '#2F6DB5',
};

export const statusGlyph: Record<DisplayState, string> = {
  QUARANTINED: '✕', OFFLINE: '○', HOS_ALERT: '!', SPEEDING: '▲', MOVING: '►', IDLING: '❚❚', PARKED: 'P',
};

// Phone scale (driver: one-handed, glare, gloves).
export const phone = {
  space: { xs: 4, sm: 8, md: 16, lg: 24, xl: 32 } as const,
  radius: { control: 10, sheet: 18 } as const,
  touch: 56,
  chipHeight: 44,
  font: { heading: 'Archivo_700Bold', body: 'PublicSans_400Regular', bodyStrong: 'PublicSans_600SemiBold' } as const,
  type: { caption: 13, body: 16, lead: 20, title: 25, display: 31 } as const,
} as const;

// Admin scale (mobile-adapted: larger canvas, denser information, bigger touch targets).
export const admin = {
  space: { xs: 8, sm: 16, md: 24, lg: 32, xl: 48 } as const,
  radius: { control: 12, sheet: 24 } as const,
  touch: 64,
  chipHeight: 52,
  font: { heading: 'Archivo_700Bold', body: 'PublicSans_400Regular', bodyStrong: 'PublicSans_600SemiBold' } as const,
  type: { caption: 14, body: 17, lead: 22, title: 28, display: 36 } as const,
} as const;

// Default exports remain the phone scale for backward compatibility.
export const space = phone.space;
export const radius = phone.radius;
export const touch = phone.touch;
export const chipHeight = phone.chipHeight;
export const font = phone.font;
export const type = phone.type;
