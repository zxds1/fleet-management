import React from "react";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import { repository } from "../repo/FleetRepository";
import { useStore } from "../store";
import { colors } from "../theme";
import { Icon } from "../components/Icon";

import { DriverHomeScreen } from "../screens/driver/DriverHomeScreen";
import { VehicleMapScreen } from "../screens/driver/VehicleMapScreen";
import { AccidentsScreen, MyAccidentsScreen, DriverAccidentDetailScreen, AccidentReportScreen } from "../screens/driver/AccidentsScreen";
import { ProfileScreen } from "../screens/driver/ProfileScreen";

import { ClockInScreen } from "../screens/driver/ClockInScreen";
import { ClockOutScreen } from "../screens/driver/ClockOutScreen";
import { RefuelScreen } from "../screens/driver/RefuelScreen";
import { FuelHistoryScreen } from "../screens/driver/FuelHistoryScreen";
import { InspectionScreen } from "../screens/driver/InspectionScreen";
import { DvirListScreen } from "../screens/driver/DvirListScreen";
import { DvirDetailScreen } from "../screens/driver/DvirListScreen";
import { AnomaliesScreen } from "../screens/driver/AnomaliesScreen";
import { NotificationsScreen } from "../screens/driver/NotificationsScreen";
import { MyShiftsScreen, DriverDocumentsScreen } from "../screens/driver/MyShiftsScreen";
import { VehicleStateScreen } from "../screens/driver/VehicleStateScreen";
import { VehicleIssueScreen } from "../screens/driver/VehicleIssueScreen";
import { OnboardingScreens } from "../screens/driver/OnboardingScreens";
import { OutboxScreen } from "../screens/driver/OutboxScreen";
import { TrainingHubScreen } from "../screens/driver/TrainingHubScreen";
import { LessonDetailScreen } from "../screens/driver/LessonDetailScreen";
import { ResourceLibraryScreen } from "../screens/driver/ResourceLibraryScreen";

const Tab = createBottomTabNavigator();
const Stack = createNativeStackNavigator();

function DriverTabs() {
  const notifs = useStore(repository.notifications);
  const badge = notifs.filter((n) => !n.isRead).length;
  return (
    <Tab.Navigator
      screenOptions={{
        headerShown: false,
        tabBarStyle: { backgroundColor: colors.surface, borderTopColor: colors.outlineVariant },
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.onSurfaceVariant,
      }}
    >
      <Tab.Screen name="home" component={DriverHomeScreen} options={{ title: "Home", tabBarIcon: ({ color }) => <Icon name="home" color={color} size={22} /> }} />
      <Tab.Screen name="map" component={VehicleMapScreen} options={{ title: "Map", tabBarIcon: ({ color }) => <Icon name="map" color={color} size={22} /> }} />
      <Tab.Screen
        name="accidents"
        component={AccidentsScreen}
        options={{ title: "Accidents", tabBarIcon: ({ color }) => <Icon name="warning" color={color} size={22} />, tabBarBadge: badge > 0 ? badge : undefined }}
      />
      <Tab.Screen name="profile" component={ProfileScreen} options={{ title: "Profile", tabBarIcon: ({ color }) => <Icon name="person" color={color} size={22} /> }} />
    </Tab.Navigator>
  );
}

export function DriverApp() {
  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      <Stack.Screen name="tabs" component={DriverTabs} />
      <Stack.Screen name="clock_in" component={ClockInScreen} />
      <Stack.Screen name="clock_out" component={ClockOutScreen} />
      <Stack.Screen name="refuel" component={RefuelScreen} />
      <Stack.Screen name="fuel_history" component={FuelHistoryScreen} />
      <Stack.Screen name="inspection" component={InspectionScreen} />
      <Stack.Screen name="dvir_list" component={DvirListScreen} />
      <Stack.Screen name="dvir_detail" component={DvirDetailScreen} />
      <Stack.Screen name="my_accidents" component={MyAccidentsScreen} />
      <Stack.Screen name="accident_detail" component={DriverAccidentDetailScreen} />
      <Stack.Screen name="accident_report" component={AccidentReportScreen} />
      <Stack.Screen name="anomalies" component={AnomaliesScreen} />
      <Stack.Screen name="notifications" component={NotificationsScreen} />
      <Stack.Screen name="my_shifts" component={MyShiftsScreen} />
      <Stack.Screen name="documents" component={DriverDocumentsScreen} />
      <Stack.Screen name="vehicle_state" component={VehicleStateScreen} />
      <Stack.Screen name="vehicle_issue" component={VehicleIssueScreen} />
      <Stack.Screen name="onboarding" component={OnboardingScreens} />
      <Stack.Screen name="outbox" component={OutboxScreen} />
      <Stack.Screen name="training_hub" component={TrainingHubScreen} />
      <Stack.Screen name="lesson_detail" component={LessonDetailScreen} />
      <Stack.Screen name="resource_library" component={ResourceLibraryScreen} />
    </Stack.Navigator>
  );
}


