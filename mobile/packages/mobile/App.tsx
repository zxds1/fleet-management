import React, { useEffect, useState } from 'react';
import { AppState, type AppStateStatus } from 'react-native';
import * as Linking from 'expo-linking';
import * as LocalAuthentication from 'expo-local-authentication';
import * as Network from 'expo-network';
import Ionicons from '@expo/vector-icons/Ionicons';
import { focusManager, onlineManager, useQuery } from '@tanstack/react-query';
import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { Archivo_700Bold, useFonts } from '@expo-google-fonts/archivo';
import { PublicSans_400Regular, PublicSans_600SemiBold } from '@expo-google-fonts/public-sans';
import i18n from './src/i18n';
import { RootNavigator } from './src/navigation';
import { openTarget } from './src/navigation/ref';
import { initCache, shouldPersist } from './src/cache';
import { drainScheduler, ensureAccessToken, queryClient, reconcileQueueOwner, refreshNetworkFailed, refreshOutboxCount, session, syncPrincipal } from './src/services';
import { initPushRoleReader, stopRealtime, syncRealtime } from './src/realtimeService';
import { initLocalNotifications, onNotificationTap } from './src/push';
import { runSecurityChecks } from './src/security';
import { parseDeepLink } from './src/core/deepLinks';
import { PERSIST_MAX_AGE } from './src/core/queryConfig';
import { shiftActiveQuery, vehicleStatesQuery } from './src/queries';
import { PrivacyShield } from './src/design/PrivacyShield';
import { useUi } from './src/state/store';

type Persister = Awaited<ReturnType<typeof initCache>>;

// React Query learns about the app lifecycle: refetch stale data when the app returns to the foreground or the network comes back.
focusManager.setEventListener((handle) => { const s = AppState.addEventListener('change', (st: AppStateStatus) => handle(st === 'active')); return () => s.remove(); });
onlineManager.setEventListener((setOnline) => { const sub = Network.addNetworkStateListener((s) => setOnline(!!s.isConnected && s.isInternetReachable !== false)); return () => sub.remove(); });

/**
 * Boot order: security gate -> restore the session (24 h ceiling) -> silent refresh -> PIN if offline /
 * biometric if enabled -> app. The Principal is rebuilt from the refresh response body, which is the
 * only identity source the app trusts (C5.3).
 */
async function boot() {
  const ui = useUi.getState();
  const verdict = await runSecurityChecks();
  if (!verdict.ok) { ui.setSecurityReason(verdict.reason); ui.setAuth('blocked'); return; }
  const [ceiling, roles, refresh] = [await session.checkAuthCeiling(), await session.roles(), await session.getRefreshToken()];
  if (!ceiling.ok || !roles.length || !refresh) { ui.setAuth('signedOut'); return; }
  const net = await Network.getNetworkStateAsync();
  const online = !!net.isConnected && net.isInternetReachable !== false;
  ui.setOnline(online);
  if (!online && (await session.hasPin())) { ui.setAuth('needsPin'); return; }
  if (online) {
    // silent refresh: a revoked/suspended session is discovered here, before any screen shows
    const tok = await ensureAccessToken();
    if (!tok && !refreshNetworkFailed) { if (useUi.getState().auth !== 'suspended') ui.setAuth('signedOut'); return; }
  }
  if (await session.biometricEnabled()) {
    const r = await LocalAuthentication.authenticateAsync({ promptMessage: i18n.t('profile.biometric') });   // local unlock only; the server still needs a valid refresh token
    if (!r.success) { ui.setAuth((await session.hasPin()) ? 'needsPin' : 'signedOut'); return; }
  }
  await reconcileQueueOwner(useUi.getState().principal?.user_id ?? '');
  ui.setSession(roles);
}

export default function App() {
  const [fontsReady] = useFonts({ Archivo_700Bold, PublicSans_400Regular, PublicSans_600SemiBold, ...Ionicons.font });
  const [persister, setPersister] = useState<Persister | null>(null);
  const { auth, activeRole } = useUi();

  useEffect(() => { initPushRoleReader(); void initCache().then(setPersister); void boot(); }, []);

  // Connectivity: banner + (re)drain with backoff. The scheduler also retries on its own after a 5xx or flaky link.
  useEffect(() => {
    const sub = Network.addNetworkStateListener((s) => {
      const online = !!s.isConnected && s.isInternetReachable !== false;
      useUi.getState().setOnline(online);
      if (online && useUi.getState().auth === 'signedIn') void drainScheduler.kick().then(refreshOutboxCount);
    });
    const app = AppState.addEventListener('change', (st) => { if (st === 'active' && useUi.getState().auth === 'signedIn') void drainScheduler.kick().then(refreshOutboxCount); });
    return () => { sub.remove(); app.remove(); drainScheduler.stop(); };
  }, []);

  // Signed in: warm the cache, flush anything left from last session, register push, attach deep links + push taps.
  useEffect(() => {
    if (auth !== 'signedIn' || !activeRole) { stopRealtime(); return; }
    void queryClient.prefetchQuery(shiftActiveQuery);
    void queryClient.prefetchQuery(vehicleStatesQuery);
    void drainScheduler.kick().then(refreshOutboxCount);
    void initLocalNotifications();
    const open = (url: string) => { const t = parseDeepLink(url, useUi.getState().activeRole ?? 'DRIVER'); if (t) openTarget(t, useUi.getState().activeRole); };
    const link = Linking.addEventListener('url', (e) => open(e.url));
    void Linking.getInitialURL().then((u) => { if (u) open(u); });
    const off = onNotificationTap((t) => openTarget(t, useUi.getState().activeRole));
    return () => { link.remove(); off(); stopRealtime(); };
  }, [auth, activeRole]);

  if (!fontsReady || !persister) return null;
  return (
    <SafeAreaProvider>
      <PersistQueryClientProvider client={queryClient} persistOptions={{ persister, maxAge: PERSIST_MAX_AGE, buster: '3', dehydrateOptions: { shouldDehydrateQuery: shouldPersist } }}>
        <RealtimeBridge /><RootNavigator /><PrivacyShield />
      </PersistQueryClientProvider>
    </SafeAreaProvider>
  );
}

/** One socket per role: the gateway picks the rooms from the token, the app only picks which events to listen for. */
function RealtimeBridge() {
  const { auth, activeRole } = useUi();
  const enabled = auth === 'signedIn' && !!activeRole;
  const shift = useQuery({ ...shiftActiveQuery, enabled: enabled && activeRole === 'DRIVER' });
  useEffect(() => { if (enabled && activeRole) syncRealtime(activeRole); }, [enabled, activeRole]);
  return null;
}