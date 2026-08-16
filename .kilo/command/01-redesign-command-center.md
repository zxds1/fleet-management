# Command: Redsign to Command-Center Dark Ops Style

## Overview
Redesign the FleetPulse mobile app UI from the Carbon Enterprise System light theme to a **dark command-center / tactical operations console** aesthetic, matching the design language established in `src/screens/admin/CommandCenterMap.tsx` and `src/screens/admin/commandCenterTheme.ts`.

## Design Language Definition
- **Nickname**: "Command Center" or "Dark Ops Console"
- **Inspiration**: Air-traffic-control (ATC) displays, SOC (Security Operations Center) dashboards, military C4ISR interfaces
- **Contrast**: High-contrast dark theme with semi-transparent overlays
- **Information density**: Maximize data per screen through compact, layered panels
- **Numeric precision**: Monospace tabular figures for all telemetry values

## Color Palette
```typescript
// File: src/theme/commandColors.ts
export const commandColors = {
  // Surfaces (dark stack)
  canvas: "#0A0A0C",           // full-screen background
  surface: "#121215",          // card / panel background
  surfaceRaised: "#16161A",    // elevated panel (higher than surface)
  surfaceCritical: "#171315",  // error-critical panel bg
  border: "rgba(255,255,255,0.10)",    // standard border/separator
  borderStrong: "rgba(255,255,255,0.16)", // strong border

  // Text
  text: "#EAEAEA",    // primary text
  textMuted: "#8D8D8D", // secondary/muted text
  textDim: "#73737B",   // dim/disabled text
  white: "#FFFFFF",

  // Semantic (IBM Blue primary)
  blue: "#0F62FE",    // primary action color
  blueSoft: "#78A9FF", // soft blue accent

  // Status colors
  info: "#60A5FA",     // blue (telemetry/info)
  success: "#42BE65",  // green
  successSoft: "#78D79A",
  warning: "#FBBF24",  // amber
  danger: "#DA1E28",   // red
  dangerSoft: "#FF8389",
  parked: "#94949D",   // vehicle parked state
} as const;
```

## Typography
- **Primary font**: IBM Plex Sans (consistent with Carbon)
- **Telemetry/monospace**: Use `fontFamily: "monospace"` with `fontVariant: ["tabular-nums"]` for all numeric displays (speed, fuel %, odometer, HOS)
- **Font scale**: Compact — labels at 8-10px, values at 13-18px, headers at 12-14px
- **Weight hierarchy**: 600-700 for emphasis, no large font jumps
- **Text colors**: White/light text on dark surfaces; dim/muted for secondary info

## Spacing System
- **Micro**: 4px (for badge gaps, tight label groups)
- **XS**: 8px (between inline elements, badge clusters)
- **SM**: 12px (within compact panels)
- **MD**: 16px (between section groups)
- **LG**: 20px (between major section blocks)
- **XL**: 24px (page-level spacing)

## Layout Principles

### 1. Dark Surface Stack
- Root canvas: `colors.canvas` (`#0A0A0C`)
- Cards/panels: `colors.surface` (`#121215`)
- Elevated panels: `colors.surfaceRaised` (`#16161A`)
- Use `borderBottomWidth: 1, borderColor: colors.border` instead of full borders

### 2. Semi-Transparent Overlays
- Telemetry panels: `backgroundColor: "rgba(18,18,22,0.94)"` (surface+ with transparency)
- Dark scrim over maps: `backgroundColor: "rgba(5,5,8,0.20)"`
- Use `rgba()` overlays for layered depth without full-color backgrounds

### 3. Absolute Positioning
- Floating panels positioned with `position: "absolute"`
- Telemetry cards: anchored to bottom corners of the screen
- Badge clusters: positioned absolutely on map markers or top corners
- Action buttons: clustered in absolute-positioned floating groups

### 4. Information Density
- Pack multiple data points per row (e.g., speed | fuel | HOS | odometer)
- Use micro-spacing for related items
- Collapse/expand patterns for detailed views
- Prioritize critical data (status, location, telemetry) in primary view

## Component Patterns

### Status Dot
```
6px × 6px circle, colored by state
- moving: colors.success
- parked: colors.parked
- speeding: colors.warning
- hosAlert: colors.warning
- quarantined: colors.danger
- offline: colors.textDim
```

### Telemetry Metric
```
Vertical data point:
[label, 8px, uppercase, colors.textDim]
[value unit, 13px, monospace tabular-nums, colors.white]
Optional fuel track bar beneath
```

### Badge System
- **Asset badge**: `rgba(10,10,12,0.88)` bg, 9px text, uppercase, letter-spacing 0.7
- **Delay badge**: `rgba(251,191,36,0.08)` bg, `rgba(251,191,36,0.32)` border, amber text
- **Status chip**: small, pill-less, `borderRadius: 0`, 9px font

### Map Marker
- 34×34 container, circular, colored border by vehicle state
- Icon: `navigation` (MaterialIcons), size 18-21
- Selected state: larger icon (21px), colored border + bg `rgba(color, 0.14)`

### Map Controls
- Action buttons: 36×36, `rgba(10,10,12,0.88)` bg, 1px border, no border-radius
- Positioned in clusters (top-right, bottom-right floating groups)

### Fuel Track
- 2px tall horizontal bar, `colors.border` bg
- Fill: `colors.info` (`#60A5FA`), width as % of fuelLevelPct
- Appears beneath fuel metric in telemetry panel

### No-Telemetry State
- Absolute positioned panel at bottom
- Icon + title + body text + "Open map" link
- `colors.textDim` for icon and body, `colors.blueSoft` for link

## Custom Map Style (Google Maps / react-native-maps)
Use `commandCenterTheme.ts` `darkMapStyle` array:
- `geometry`: `#15151A`
- `labels.text.fill`: `#676771`
- `labels.text.stroke`: `#15151A`
- `administrative.geometry`: `#2A2A31`
- `poi.geometry`: `#18181D`
- `road.geometry`: `#303038`, `road.highway.geometry`: `#3B3B45`
- `transit.geometry`: `#202027`
- `water.geometry`: `#0C1118`
- Disable: compass, my-location button, toolbar

## Screens to Apply This Style
1. **Admin Dashboard** → Full command center: live vehicle map + telemetry overlay
2. **Vehicle Map** (driver) → Simplified dark map with driver's vehicle marker
3. **Vehicle State Screen** → Dark telemetry card with status dot + metrics
4. **Accidents Console** → Dark cards with severity badges, dark scrim map
5. **Driver Home** → Dark quick-action tiles, HOS countdown, vehicle status

## Files to Create/Modify
- `src/theme/commandColors.ts` — export full command center color palette
- `src/theme/index.ts` — re-export `commandColors`
- `src/components/StatusDot.tsx` — 6×6 colored status indicator
- `src/components/TelemetryCard.tsx` — dark panel with monospace metrics + fuel track
- `src/components/Badge.tsx` — asset badge + delay badge variants
- `src/components/MapMarker.tsx` — circular marker with colored status border
- `src/components/MapControls.tsx` — floating action button cluster
- `src/screens/admin/CommandCenterMap.tsx` — existing, use as reference template
- `src/screens/admin/commandCenterTheme.ts` — existing, export as design tokens

## What NOT to Do
- Do NOT use the Carbon light theme (`colors.background = #ffffff`, `colors.surface = #ffffff`)
- Do NOT use `colors.onSurface = #161616` (light text color) — use `colors.text = #EAEAEA`
- Do NOT use Bento dark (`bentoBackground`, `bentoCardBg`, `bentoBluePrimary`)
- Do NOT use `radius.pill` (999) or rounded corners — use `borderRadius: 0` everywhere
- Do NOT use large font jumps — maintain compact 8-13px range for data
- Do NOT put cards on full-width with large margins — use tight packing with micro gaps

## Acceptance Criteria
- `tsc --noEmit` passes with zero errors
- All screens use `commandColors` palette instead of `colors` (Carbon palette)
- Map screens use `darkMapStyle` from `commandCenterTheme.ts`
- Telemetry text uses monospace with `tabular-nums`
- Status indicators use colored dots, not status chips with alpha backgrounds
- Borders use `rgba(255,255,255,0.10)` / `0.16`
- Panels use semi-transparent dark overlays (`rgba(18,18,22,0.94)`)
- No light-colored surfaces or white backgrounds in admin/driver active screens
