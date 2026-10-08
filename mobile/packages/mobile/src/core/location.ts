import * as Location from 'expo-location';
export type Fix = { latitude: number; longitude: number };
/** Last known fix first (instant, works with weak signal), then a fresh balanced fix. Null => no permission or no signal. */
// Only foreground location permission is requested; nothing tracks in the background, because the app
// has no background tracking loop (see docs/ASSUMPTIONS.md U-01).
export async function currentFix(): Promise<Fix | null> {
  const p = await Location.requestForegroundPermissionsAsync();
  if (!p.granted) return null;
  const last = await Location.getLastKnownPositionAsync();
  if (last) return { latitude: last.coords.latitude, longitude: last.coords.longitude };
  try { const c = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }); return { latitude: c.coords.latitude, longitude: c.coords.longitude }; }
  catch { return null; }
}
