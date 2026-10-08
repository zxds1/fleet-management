import { useEffect } from 'react';
import { Alert } from 'react-native';
import { useTranslation } from 'react-i18next';

/** Asks before leaving a screen with unsaved input (back button, swipe, hardware back). */
export function useDiscardGuard(navigation: { addListener: (ev: 'beforeRemove', cb: (e: { preventDefault: () => void; data: { action: unknown } }) => void) => () => void; dispatch: (a: any) => void }, dirty: boolean) {
  const { t } = useTranslation();
  useEffect(() => navigation.addListener('beforeRemove', (e) => {
    if (!dirty) return; e.preventDefault();
    Alert.alert(t('forms.discardTitle'), t('forms.discardBody'), [{ text: t('forms.keepEditing'), style: 'cancel' }, { text: t('forms.discard'), style: 'destructive', onPress: () => navigation.dispatch(e.data.action) }]);
  }), [navigation, dirty, t]);
}
