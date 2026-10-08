import React from 'react';
import { View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { useTranslation } from 'react-i18next';
import { useUi } from '../state/store';
import { useBadgeCounts } from '../hooks';
import { BlockedScreen, ConsentScreen, LoginScreen, MfaChallengeScreen, PasswordResetScreen, PinScreen, RoleSwitchScreen, SignupScreen, SplashScreen, SuspendedScreen } from '../screens/auth/AuthScreens';
import { ClockInScreen, ClockOutScreen, HomeScreen, OutboxScreen } from '../screens/driver/DriverScreens';
import { AccidentScreen, DvirScreen, RefuelScreen, TrailerSwapScreen } from '../screens/driver/FormScreens';
import { MyVehicleScreen } from '../screens/driver/MyVehicleScreen';
import { DashboardScreen, LiveMapScreen } from '../screens/admin/AdminScreens';
import { AccidentsScreen } from '../screens/admin/AccidentsScreen';
import { AdminFuelScreen } from '../screens/admin/AdminFuelScreen';
import { AccidentDetailScreen, AnomalyDetailScreen, DocDetailScreen, DvirDetailScreen, FuelDetailScreen } from '../screens/admin/DetailScreens';
import { ImportStatementScreen } from '../screens/admin/ImportStatementScreen';
import { DriverDetailScreen, DriversScreen } from '../screens/admin/DriversScreen';
import { ShiftDetailScreen } from '../screens/admin/ShiftScreens';
import { VehiclesScreen } from '../screens/admin/VehiclesScreen';
import { VehicleIssuesScreen } from '../screens/admin/VehicleIssuesScreen';
import { TrainingScreen, TrainingRosterScreen } from '../screens/admin/TrainingScreen';
import { MaintenanceScreen } from '../screens/admin/MaintenanceScreen';
import { PrivacyScreen } from '../screens/admin/PrivacyScreen';
import { TrackerPairScreen } from '../screens/admin/TrackerPairScreen';
import { ReviewQueueScreen } from '../screens/review/ReviewQueueScreen';
import { InboxScreen } from '../screens/inbox/InboxScreen';
import { SettingsScreen } from '../screens/settings/SettingsScreen';
import { MfaSetupScreen } from '../screens/settings/MfaSetupScreen';
import { EditQueuedScreen } from '../screens/settings/EditQueuedScreen';
import { LiveAlertBanner } from '../design/LiveAlertBanner';
import { Toast } from '../design/Toast';
import { OfflineBanner } from '../design/components';
import { color, font, admin } from '../design/tokens';
import { navRef } from './ref';

const Stack = createNativeStackNavigator(); const Tabs = createBottomTabNavigator();
type Icon = React.ComponentProps<typeof Ionicons>['name'];
const icon = (name: Icon) => ({ color, size }: { color: string; size: number }) => <Ionicons name={name} size={size} color={color} />;
const header = { headerStyle: { backgroundColor: color.paper }, headerTitleStyle: { fontFamily: font.heading, color: color.asphalt }, headerTintColor: color.asphalt } as const;
const tabStyle = { tabBarActiveTintColor: color.verge, tabBarInactiveTintColor: color.mist, tabBarLabelStyle: { fontFamily: font.bodyStrong, fontSize: 12 } } as const;

function AuthStack() {
  const { t } = useTranslation();
  return (
    <Stack.Navigator screenOptions={header}>
      <Stack.Screen name="Login" component={LoginScreen} options={{ title: t('auth.logIn') }} />
      <Stack.Screen name="Signup" component={SignupScreen} options={{ title: t('auth.signUp') }} />
      <Stack.Screen name="PasswordReset" component={PasswordResetScreen} options={{ title: t('auth.passwordReset') }} />
    </Stack.Navigator>
  );
}

/** Detail screens both roles can reach from the inbox. Registered in every stack that hosts the inbox. */
const inboxDetails = (t: (k: string) => string) => [
  <Stack.Screen key="ad" name="AnomalyDetail" component={AnomalyDetailScreen} options={{ title: t('anomalies.title') }} />,
  <Stack.Screen key="dd" name="DocDetail" component={DocDetailScreen} options={{ title: t('docs.title') }} />,
];

// ---- Driver: bottom tabs (phone) -------------------------------------------------
function DriverTabs() {
  const { t } = useTranslation(); const pending = useUi((s) => s.outboxCount);
  return (
    <Tabs.Navigator screenOptions={{ ...tabStyle, headerShown: true, ...header }}>
      <Tabs.Screen name="Home" component={HomeScreen} options={{ title: t('nav.home'), tabBarIcon: icon('home-outline') }} />
      <Tabs.Screen name="Refuel" component={RefuelScreen} options={{ title: t('nav.refuel'), tabBarIcon: icon('water-outline') }} />
      <Tabs.Screen name="Inspect" component={DvirScreen} options={{ title: t('nav.inspect'), tabBarIcon: icon('clipboard-outline') }} />
      <Tabs.Screen name="Accidents" component={AccidentScreen} options={{ title: t('nav.accidents'), tabBarIcon: icon('warning-outline'), tabBarActiveTintColor: color.brake }} />
      <Tabs.Screen name="More" component={SettingsScreen} options={{ title: t('nav.more'), tabBarIcon: icon('menu-outline'), tabBarBadge: pending > 0 ? pending : undefined }} />
    </Tabs.Navigator>
  );
}
function DriverStack() {
  const { t } = useTranslation();
  return (
    <Stack.Navigator screenOptions={header}>
      <Stack.Screen name="DriverTabs" component={DriverTabs} options={{ headerShown: false }} />
      <Stack.Screen name="ClockIn" component={ClockInScreen} options={{ title: t('shift.clockIn') }} />
      <Stack.Screen name="ClockOut" component={ClockOutScreen} options={{ title: t('shift.clockOut') }} />
      <Stack.Screen name="TrailerSwap" component={TrailerSwapScreen} options={{ title: t('swap.title') }} />
      <Stack.Screen name="Outbox" component={OutboxScreen} options={{ title: t('outbox.title') }} />
      <Stack.Screen name="EditQueued" component={EditQueuedScreen} options={{ title: t('outbox.edit') }} />
      <Stack.Screen name="MyVehicle" component={MyVehicleScreen} options={{ title: t('vehicle.title') }} />
      <Stack.Screen name="Inbox" component={InboxScreen} options={{ title: t('inbox.title') }} />
      <Stack.Screen name="MfaSetup" component={MfaSetupScreen} options={{ title: t('mfa.title') }} />
      {inboxDetails(t)}
    </Stack.Navigator>
  );
}

// ---- Admin: bottom tabs (mobile-adapted) -------------------------------------------------
const adminTabStyle = { ...tabStyle, headerShown: true, ...header, tabBarLabelStyle: { ...tabStyle.tabBarLabelStyle, fontSize: 11 } } as const;

function AdminTabs() {
  const { t } = useTranslation(); const { unread } = useBadgeCounts();
  return (
    <Tabs.Navigator screenOptions={adminTabStyle}>
      <Tabs.Screen name="Overview" component={DashboardScreen} options={{ title: t('tabs.overview'), tabBarIcon: icon('speedometer-outline') }} />
      <Tabs.Screen name="Accidents" component={AccidentsScreen} options={{ title: t('admin.accidents'), tabBarIcon: icon('warning-outline'), tabBarActiveTintColor: color.brake }} />
      <Tabs.Screen name="Review" component={ReviewQueueScreen} options={{ title: t('tabs.review'), tabBarIcon: icon('checkmark-done-outline') }} />
      <Tabs.Screen name="Drivers" component={DriversScreen} options={{ title: t('drivers.title'), tabBarIcon: icon('people-outline') }} />
      <Tabs.Screen name="More" component={SettingsScreen} options={{ title: t('nav.more'), tabBarIcon: icon('menu-outline'), tabBarBadge: unread > 0 ? unread : undefined }} />
    </Tabs.Navigator>
  );
}
function AdminStack() {
  const { t } = useTranslation();
  return (
    <Stack.Navigator screenOptions={header}>
      <Stack.Screen name="AdminTabs" component={AdminTabs} options={{ headerShown: false }} />
      <Stack.Screen name="Map" component={LiveMapScreen} options={{ title: t('nav.map') }} />
      <Stack.Screen name="AccidentDetail" component={AccidentDetailScreen} options={{ title: t('admin.accidents') }} />
      <Stack.Screen name="ShiftDetail" component={ShiftDetailScreen} options={{ title: t('review.shifts') }} />
      <Stack.Screen name="DvirDetail" component={DvirDetailScreen} options={{ title: t('review.inspections') }} />
      <Stack.Screen name="FuelDetail" component={FuelDetailScreen} options={{ title: t('review.fuel') }} />
      <Stack.Screen name="DriverDetail" component={DriverDetailScreen} options={{ title: t('drivers.title') }} />
      <Stack.Screen name="ImportStatement" component={ImportStatementScreen} options={{ title: t('importer.title') }} />
      <Stack.Screen name="Inbox" component={InboxScreen} options={{ title: t('inbox.title') }} />
      <Stack.Screen name="MfaSetup" component={MfaSetupScreen} options={{ title: t('mfa.title') }} />
      <Stack.Screen name="AdminFuel" component={AdminFuelScreen} options={{ title: t('review.fuel') }} />
      <Stack.Screen name="Vehicles" component={VehiclesScreen} options={{ title: t('vehicle.title') }} />
      <Stack.Screen name="TrackerPair" component={TrackerPairScreen} options={{ title: t('hardware.title') }} />
      <Stack.Screen name="VehicleIssues" component={VehicleIssuesScreen} options={{ title: t('vehicle.issues') }} />
      <Stack.Screen name="Training" component={TrainingScreen} options={{ title: t('training.title') }} />
      <Stack.Screen name="TrainingRoster" component={TrainingRosterScreen} options={{ title: t('training.roster') }} />
      <Stack.Screen name="Maintenance" component={MaintenanceScreen} options={{ title: t('maintenance.title') }} />
      <Stack.Screen name="Privacy" component={PrivacyScreen} options={{ title: t('privacy.title') }} />
      {inboxDetails(t)}
    </Stack.Navigator>
  );
}

export function RootNavigator() {
  const { auth, activeRole, online } = useUi();
  let body: React.ReactNode;
  if (auth === 'booting') body = <SplashScreen />;
  else if (auth === 'needsMfa') body = <MfaChallengeScreen />;
  else if (auth === 'blocked') body = <BlockedScreen />;
  else if (auth === 'suspended') body = <SuspendedScreen />;
  else if (auth === 'needsConsent') body = <ConsentScreen />;
  else if (auth === 'needsPin') body = <PinScreen />;
  else if (auth !== 'signedIn') body = <AuthStack />;
  else if (!activeRole) body = <RoleSwitchScreen />;
  else body = activeRole === 'ADMIN' ? <AdminStack /> : <DriverStack />;
  return <NavigationContainer ref={navRef}><View style={{ flex: 1 }}><LiveAlertBanner />{!online ? <OfflineBanner /> : null}{body}<Toast /></View></NavigationContainer>;
}
