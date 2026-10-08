import * as SecureStore from 'expo-secure-store';
import * as Crypto from 'expo-crypto';
import { MMKV } from 'react-native-mmkv';
import { createSyncStoragePersister } from '@tanstack/query-sync-storage-persister';
import type { Query } from '@tanstack/react-query';

let mmkv: MMKV | null = null;
/** MMKV is encrypted with a random key that lives only in the secure store (Layer 1 -> Layer 2 of the cache design). */
export async function initCache() {
  let key = await SecureStore.getItemAsync('mmkv_key');
  if (!key) { key = Crypto.randomUUID().replace(/-/g, ''); await SecureStore.setItemAsync('mmkv_key', key); }
  mmkv = new MMKV({ id: 'helix-cache', encryptionKey: key });
  const m = mmkv;
  return createSyncStoragePersister({ storage: { getItem: (k) => m.getString(k) ?? null, setItem: (k, v) => m.set(k, v), removeItem: (k) => void m.delete(k) }, throttleTime: 1000 });
}
/** Nothing with queued bodies (PII) or one-off consent text is written to disk. */
const NEVER_PERSIST = new Set(['outbox', 'consent', 'mfa']);
export const shouldPersist = (q: Query) => q.state.status === 'success' && !NEVER_PERSIST.has(String(q.queryKey[0]));
export const clearDiskCache = () => { mmkv?.clearAll(); };
