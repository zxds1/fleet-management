# Screen designs (visual reference)

Drop the **screen design images** here (PNG/JPG/PDF). These define **style only** — color, spacing,
typography, component look. The structural/behavioral contract for each screen lives in
`../flows.md` and the per-app docs (`../driver.md`, `../admin.md`).

## Naming convention (suggested)
Use the screen ids from `../flows.md` so they're easy to map:

Driver: `B1-login`, `B2-mfa`, `B3-offline-pin`, `B4-home`, `B5-clock-in`, `B6-clock-out`,
`B8-refuel`, `B11-dvir-form`, `B13-accident`, `B16-anomalies`, `B17-notifications`, `B18-my-vehicle`,
`B20-profile`, …

Admin: `C4-dashboard`, `C5-live-map`, `C6-accident-queue`, `C7-accident-detail`, `C8-dvir-review`,
`C10-reconciliation`, `C12-statement-import`, `C13-anomaly-feed`, `C15-documents`, `C17-drivers`,
`C18-driver-detail`, …

Missing a screen image? Follow `../flows.md` + the shared design system; do not invent layout.
