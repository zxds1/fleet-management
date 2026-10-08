import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { en } from '../src/i18n/en';

const walk = (d: string): string[] => readdirSync(d).flatMap((f) => { const p = join(d, f); return statSync(p).isDirectory() ? walk(p) : /\.tsx?$/.test(p) ? [p] : []; });
const src = walk('src').map((p) => [p, readFileSync(p, 'utf8')] as const); const all = src.filter(([p]) => !p.includes('/i18n/')).map(([, s]) => s).join('\n');
const flat = (o: any, p = ''): string[] => Object.entries(o).flatMap(([k, v]) => (typeof v === 'object' && v ? flat(v, p + k + '.') : [p + k]));

describe('review guards (each protects a fix from the design review)', () => {
  it('no dead translation keys: every key is used literally or through a dynamic prefix', () => {
    const dyn = [...all.matchAll(/t\(`([a-zA-Z._]+?)\.?\$\{/g)].map((m) => m[1]!);
    const dead = flat(en).filter((k) => !new RegExp(`['"\`]${k.replace(/\./g, '\\.')}['"\`]`).test(all) && !dyn.some((p) => k.startsWith(p)));
    expect(dead).toEqual([]);
  });
  it('the app is branded Helix everywhere a person or the OS can see it', () => {
    const cfg = readFileSync('app.config.ts', 'utf8'); expect(cfg).toContain("'Helix"); expect(cfg).toContain("scheme: 'helix'"); expect(cfg).not.toMatch(/Fleet (Driver|Admin)/);
    expect(src.filter(([, s]) => /'fleet:\/\/|fleet:\\\/\\\//.test(s)).map(([p]) => p)).toEqual([]);
  });
  it('a consent decline signs out (it must never continue the session)', () => {
    const auth = readFileSync('src/screens/auth/AuthScreens.tsx', 'utf8'); expect(auth).toMatch(/auth\.decline'\)\} onPress=\{\(\) => void signOut\(\)\}/);
  });
  it('credential and secret screens block screenshots', () => {
    for (const [file, fn] of [['src/screens/auth/AuthScreens.tsx', 'LoginScreen'], ['src/screens/auth/AuthScreens.tsx', 'MfaChallengeScreen'], ['src/screens/auth/AuthScreens.tsx', 'PinScreen'], ['src/screens/settings/MfaSetupScreen.tsx', 'MfaSetupScreen']] as const) {
      const s = readFileSync(file, 'utf8'); const body = s.slice(s.indexOf(`function ${fn}`), s.indexOf(`function ${fn}`) + 400); expect(body, fn).toContain('usePreventScreenCapture');
    }
  });
  it('recovery codes are not selectable (no clipboard leak)', () => { expect(readFileSync('src/screens/settings/MfaSetupScreen.tsx', 'utf8')).not.toMatch(/<Text[^>]*\bselectable\b/); });
  it('socket snapshots never write into the query cache', () => { expect(readFileSync('src/core/realtime.ts', 'utf8')).not.toMatch(/setQueryData/); expect(readFileSync('src/realtimeService.ts', 'utf8')).not.toMatch(/setQueryData/); });
  it('no Firebase: no google-services.json, no FCM token, no push registration', () => {
    // Notifications are delivered by the realtime gateway as LOCAL notifications (src/push.ts). Adding FCM
    // back would be a deliberate decision, not an accident, so it needs a failing test first.
    // Comments are stripped, so the config can EXPLAIN that Firebase is gone without tripping the guard.
    const code = (p: string) => readFileSync(p, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    const cfg = code('app.config.ts');
    expect(cfg).not.toContain('googleServicesFile');
    expect(cfg).not.toContain('GOOGLE_SERVICES_JSON');
    expect(code('src/push.ts')).not.toMatch(/getDevicePushTokenAsync|Firebase|fcm_token|registerForPushNotifications/);
    expect(code('src/device.ts')).not.toMatch(/getDevicePushTokenAsync|fcm_token/);
    // `POST /auth/devices` still accepts push_token; the app simply never sends one.
    expect(code('src/device.ts')).not.toContain('push_token:');
    // The build-time env template is how a key gets into a build, so it counts: it used to advertise
    // GOOGLE_SERVICES_JSON, which is the one artefact that would drag Firebase back in.
    const envExample = readFileSync('.env.example', 'utf8').replace(/#.*$/gm, '');
    expect(envExample).not.toMatch(/GOOGLE_SERVICES_JSON|google-services\.json|fcm/i);
    expect(envExample).toContain('GOOGLE_MAPS_API_KEY=');
  });
  it('every Mayday goes through the single sender (hold-to-send), never an ad-hoc POST', () => {
    const offenders = src.filter(([p, s]) => !/(mayday|MaydayButton|endpoints)\.tsx?$/.test(p) && /ENDPOINTS\.mayday|accidents\/mayday/.test(s)).map(([p]) => p); expect(offenders).toEqual([]);
  });
  it('forms that submit through the queue are wrapped in FormShell so they empty after success', () => {
    const f = readFileSync('src/screens/driver/FormScreens.tsx', 'utf8'); for (const n of ['RefuelScreen', 'DvirScreen', 'AccidentScreen', 'TrailerSwapScreen']) expect(f).toMatch(new RegExp(`export const ${n} = \\(\\) => <FormShell>`));
  });
  it('clock in/out sends the gauge the driver chose, never a default', () => {
    const d = readFileSync('src/screens/driver/DriverScreens.tsx', 'utf8'); expect(d).not.toMatch(/fuel_gauge: '(EMPTY|QUARTER|HALF|THREE_QUARTER|FULL)'/); expect(d).toContain('start_fuel_gauge: gauge'); expect(d).toContain('end_fuel_gauge: gauge');
  });
  it('nothing calls crypto.randomUUID (Hermes has none); ids come from core/uuid', () => {
    expect(src.filter(([p, s]) => !p.endsWith('core/uuid.ts') && /crypto\.randomUUID\(\)/.test(s.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, ''))).map(([p]) => p).filter((p) => !p.includes('Crypto'))).toEqual([]);
  });
  it('no raw UUID text entry in release builds (only behind __DEV__)', () => { const d = readFileSync('src/screens/driver/DriverScreens.tsx', 'utf8'); expect(d).toMatch(/__DEV__ \? <Field label=\{t\('shift\.assignment'\)\}/); });
  it('every dashboard / list screen uses the shared list or Screen container, not hand-rolled ScrollViews with padding', () => {
    const offenders = src.filter(([p, s]) => /screens\//.test(p) && /contentContainerStyle=\{\{ padding: space\.md/.test(s) && !/PagedList|Screen/.test(s)).map(([p]) => p); expect(offenders).toEqual([]);
  });
});
