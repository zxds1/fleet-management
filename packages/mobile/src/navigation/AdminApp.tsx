import React from "react";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import { repository } from "../repo/FleetRepository";
import { useStore } from "../store";
import { colors } from "../theme";
import { Icon } from "../components/Icon";

import { DashboardScreen } from "../screens/admin/DashboardScreen";
import { VehicleMapScreen } from "../screens/driver/VehicleMapScreen";
import { AccidentsConsoleScreen } from "../screens/admin/AccidentsConsoleScreen";
import { ProfileScreen } from "../screens/driver/ProfileScreen";
import { AdminProfileScreen } from "../screens/admin/AdminProfileScreen";

import { DvirReviewScreen } from "../screens/admin/DvirReviewScreen";
import { FuelReconcileScreen } from "../screens/admin/FuelReconcileScreen";
import { ImportStatementScreen } from "../screens/admin/ImportStatementScreen";
import { DriverRosterScreen } from "../screens/admin/DriverRosterScreen";
import { HardwareTrackerScreen } from "../screens/admin/HardwareTrackerScreen";
import { VehicleMasterScreen } from "../screens/admin/VehicleMasterScreen";
import { MaintenanceScreen } from "../screens/admin/MaintenanceScreen";
import { TrainingHubScreen } from "../screens/driver/TrainingHubScreen";
import { ResourceLibraryScreen } from "../screens/driver/ResourceLibraryScreen";
import { PrivacyScreen } from "../screens/admin/PrivacyScreen";
import { SettingsScreen } from "../screens/admin/SettingsScreen";
import { OutboxScreen } from "../screens/driver/OutboxScreen";
import { OnboardingScreens } from "../screens/driver/OnboardingScreens";
import { LessonDetailScreen } from "../screens/driver/LessonDetailScreen";

const Tab = createBottomTabNavigator();
const Stack = createNativeStackNavigator();

function AdminTabs() {
  const openAccidents = useStore(repository.accidents).filter((a) => a.status === "PENDING" || a.status === "INVESTIGATING").length;
  return (
    <Tab.Navigator
      screenOptions={{
        headerShown: false,
        tabBarStyle: { backgroundColor: colors.surface, borderTopColor: colors.outlineVariant },
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.onSurfaceVariant,
      }}
    >
      <Tab.Screen name="dashboard" component={DashboardScreen} options={{ title: "Dashboard", tabBarIcon: ({ color }) => <Icon name="grid-view" color={color} size={22} /> }} />
      <Tab.Screen name="map" component={VehicleMapScreen} options={{ title: "Map", tabBarIcon: ({ color }) => <Icon name="map" color={color} size={22} /> }} />
      <Tab.Screen
        name="console"
        component={AccidentsConsoleScreen}
        options={{ title: "Console", tabBarIcon: ({ color }) => <Icon name="error" color={color} size={22} />, tabBarBadge: openAccidents > 0 ? openAccidents : undefined }}
      />
      <Tab.Screen name="profile" component={AdminProfileScreen} options={{ title: "Profile", tabBarIcon: ({ color }) => <Icon name="person" color={color} size={22} /> }} />
    </Tab.Navigator>
  );
}

export function AdminApp() {
  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      <Stack.Screen name="tabs" component={AdminTabs} />
      <Stack.Screen name="dvir_review" component={DvirReviewScreen} />
      <Stack.Screen name="fuel_reconcile" component={FuelReconcileScreen} />
      <Stack.Screen name="import_statement" component={ImportStatementScreen} />
      <Stack.Screen name="driver_roster" component={DriverRosterScreen} />
      <Stack.Screen name="hardware_tracker" component={HardwareTrackerScreen} />
      <Stack.Screen name="vehicle_master" component={VehicleMasterScreen} />
      <Stack.Screen name="maintenance" component={MaintenanceScreen} />
      <Stack.Screen name="training_hub" component={TrainingHubScreen} />
      <Stack.Screen name="lesson_detail" component={LessonDetailScreen} />
      <Stack.Screen name="resource_library" component={ResourceLibraryScreen} />
      <Stack.Screen name="privacy" component={PrivacyScreen} />
      <Stack.Screen name="settings" component={SettingsScreen} />
      <Stack.Screen name="outbox" component={OutboxScreen} />
      <Stack.Screen name="onboarding" component={OnboardingScreens} />
    </Stack.Navigator>
  );
}


