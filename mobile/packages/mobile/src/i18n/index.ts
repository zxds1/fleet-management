// i18n bootstrap. The app ships en + sw (POLICY.locales is the single source of the list) and the
// initial language is the DEVICE locale; an explicit choice in Settings overrides it and is remembered
// on the device, so a driver who picks Swahili on an English phone keeps Swahili (B-19, decided).
//
// The order matters and is the whole decision: a remembered choice wins, otherwise the device locale,
// otherwise English. Nothing here reads the ACCOUNT locale — the server localises notification copy only
// (app.notifications.locale) and has no opinion about the app's own UI, so there is nothing to sync.
import * as SecureStore from 'expo-secure-store';
import i18next from 'i18next';
import { initReactI18next } from 'react-i18next';
import { getLocales } from 'expo-localization';
import { en } from './en';
import { sw } from './sw';

import { POLICY } from '../core/policy';

/** Where the explicit override is remembered. SecureStore, same as the remembered role. */
export const LOCALE_KEY = 'helix.locale';

/** The languages the app ships. The server localises notification copy only, so this list is the whole
 *  contract for app-side languages and `test/i18nKeys.test.ts` checks both dictionaries against it. */
export type Locale = (typeof POLICY.locales.value)[number];

const isLocale = (v: string | null | undefined): v is Locale =>
  !!v && (POLICY.locales.value as readonly string[]).includes(v);

/**
 * Swahili if the device language is Swahili, otherwise English. English is the fallback for every other
 * device language on purpose: a partial translation is worse than a complete one.
 */
export const deviceLocale = (): Locale => (getLocales()[0]?.languageCode === 'sw' ? 'sw' : 'en');

/**
 * The remembered choice if it is one of ours, otherwise the device locale.
 *
 * `expo-secure-store` has no synchronous read, so this is async and is deliberately NOT awaited by the
 * module: `init` below uses the device locale and the remembered choice is applied right after, the same
 * way the remembered role is restored (`restoreActiveRole` in state/store.ts). A driver whose device is
 * in English and who chose Swahili gets one extra render on a cold start, which is the right trade for
 * never blocking app start on a keychain read.
 */
export const rememberedLocale = async (): Promise<Locale> => {
  try {
    const saved = await SecureStore.getItemAsync(LOCALE_KEY);
    if (isLocale(saved)) return saved;
  } catch {
    // A SecureStore failure must not stop the app from starting; the device locale is a fine answer.
  }
  return deviceLocale();
};

/** Remembers an explicit choice. Called by the Settings toggle, and by the tests. */
export const rememberLocale = async (l: Locale): Promise<void> => {
  try {
    await SecureStore.setItemAsync(LOCALE_KEY, l);
  } catch {
    // Same reasoning as above: a failed write only costs the override, never the session.
  }
};

void i18next.use(initReactI18next).init({
  resources: { en: { translation: en }, sw: { translation: sw } },
  lng: deviceLocale(), fallbackLng: 'en', interpolation: { escapeValue: false }, compatibilityJSON: 'v4',
});

void rememberedLocale().then((l) => {
  if (l !== i18next.language) void i18next.changeLanguage(l);
});

export default i18next;