import { createNavigationContainerRef } from '@react-navigation/native';
import type { Role, Target } from '../core/deepLinks';
import { useUi } from '../state/store';
export const navRef = createNavigationContainerRef<any>();

/** Admin screens live inside bottom tabs; this maps a plain screen name to its tab + screen. */
const ADMIN_HOME: Record<string, { tab: string; screen?: string }> = {
  Dashboard: { tab: 'Overview' },
  Map: { tab: 'AdminTabs', screen: 'Map' },
  Accidents: { tab: 'Accidents' },
  AccidentDetail: { tab: 'AdminTabs', screen: 'AccidentDetail' },
  Review: { tab: 'Review' },
  ShiftDetail: { tab: 'AdminTabs', screen: 'ShiftDetail' },
  DvirDetail: { tab: 'AdminTabs', screen: 'DvirDetail' },
  FuelDetail: { tab: 'AdminTabs', screen: 'FuelDetail' },
  AdminFuel: { tab: 'AdminTabs', screen: 'AdminFuel' },
  Drivers: { tab: 'Drivers' },
  DriverDetail: { tab: 'AdminTabs', screen: 'DriverDetail' },
  Inbox: { tab: 'AdminTabs', screen: 'Inbox' },
  Settings: { tab: 'More' },
  ImportStatement: { tab: 'AdminTabs', screen: 'ImportStatement' },
   Vehicles: { tab: 'AdminTabs', screen: 'Vehicles' },
  VehicleIssues: { tab: 'AdminTabs', screen: 'VehicleIssues' },
  Training: { tab: 'AdminTabs', screen: 'Training' },
  TrainingRoster: { tab: 'AdminTabs', screen: 'TrainingRoster' },
  Maintenance: { tab: 'AdminTabs', screen: 'Maintenance' },
  Privacy: { tab: 'AdminTabs', screen: 'Privacy' },
  TrackerPair: { tab: 'AdminTabs', screen: 'TrackerPair' },
};
/** Role-aware navigation by screen name, usable from anywhere (error actions, banners, push taps). Unknown/forbidden targets are ignored. */
export function goto(name: string, params?: Record<string, unknown>) {
  if (!navRef.isReady()) return;
  const role = useUi.getState().activeRole;
  if (role === 'ADMIN') {
    const h = ADMIN_HOME[name];
    if (!h) return;
    if (h.screen) navRef.navigate(h.tab, { screen: h.screen, params });
    else navRef.navigate(h.tab, params);
    return;
  }
  if (role === 'DRIVER') {
    if (name === 'Home' || name === 'Settings') navRef.navigate('DriverTabs', { screen: name === 'Home' ? 'Home' : 'More' });
    else if (name === 'Accidents') navRef.navigate('DriverTabs', { screen: 'Accidents' });
    else navRef.navigate(name, params);
  }
}

/** Maps a validated deep-link/push Target onto real routes for the current role. */
export function openTarget(t: Target, role: Role | null) {
  if (!navRef.isReady() || !role) return;
  const id = t.params?.id;   // UUID-validated by core/deepLinks before we get here
  if (role === 'ADMIN') {
    if (t.screen === 'AccidentDetail' && id) goto('AccidentDetail', { item: { accident_id: id } });
    else if (t.screen === 'DvirReview' && id) goto('DvirDetail', { item: { inspection_id: id } });
    else if (t.screen === 'FuelReview' && id) goto('FuelDetail', { item: { fuel_purchase_id: id, litres: 0, total_cost: { amount: '–', currency: '' }, anomaly_flags: [] } });
    else if (t.screen === 'Map') goto('Map');
    else if (t.screen === 'Notifications') goto('Inbox', { initial: 'notifications' });
  } else {
    if (t.screen === 'AccidentDetail') goto('Accidents');
    else if (t.screen === 'Notifications') goto('Inbox', { initial: 'notifications' });
    else if (t.screen === 'Outbox') goto('Outbox');
  }
}
