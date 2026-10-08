import { Linking } from 'react-native';
import type { ErrorAction } from './core/errors';
import { ADMIN_CONTACT } from './config';
import { queryClient, signOut } from './services';
import { goto } from './navigation/ref';
import { useUi } from './state/store';

/**
 * The app-wide behaviour behind each error's single action button. Screens can still pass their own handler
 * (e.g. retry this exact form) because only the screen knows how to redo its work; everything else is handled here.
 * Returns null when the right behaviour is "no button" (e.g. WAIT: the message already says to wait).
 */
export function defaultActionFor(action: ErrorAction): (() => void) | null {
  switch (action) {
    case 'RETRY': return () => { void queryClient.invalidateQueries(); };                 // refetch everything on screen
    case 'REFRESH': return () => { void queryClient.invalidateQueries({ queryKey: ['assignments'] }); void queryClient.invalidateQueries({ queryKey: ['shift-active'] }); };
    case 'RELOGIN': return () => { void signOut(); };
    case 'GIVE_CONSENT': return () => useUi.getState().setAuth('needsConsent');
    case 'OPEN_CLOCKOUT': return () => goto('ClockOut');                                  // the pending close-out form
    case 'OPEN_SHIFT': return () => goto('Home');                                         // the open shift, where Clock out is offered
    case 'VIEW_FLAGS': return () => goto('Inbox', { initial: 'flags' });
    case 'CONTACT_ADMIN': return ADMIN_CONTACT ? () => { void Linking.openURL(ADMIN_CONTACT); } : null;
    default: return null;
  }
}
