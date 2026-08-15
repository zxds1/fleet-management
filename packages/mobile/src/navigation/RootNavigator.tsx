import React from "react";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { repository } from "../repo/FleetRepository";
import { useStore } from "../store";
import { AuthStack } from "./AuthStack";
import { DriverApp } from "./DriverApp";
import { AdminApp } from "./AdminApp";
import { SuspendedScreen } from "../screens/driver/SuspendedScreen";

const Stack = createNativeStackNavigator();

export function RootNavigator() {
  const authState = useStore(repository.authState);
  const principal = useStore(repository.principal);
  const shell = useStore(repository.activeShell);

  if (authState.kind === "suspended") {
    return (
      <Stack.Navigator screenOptions={{ headerShown: false }}>
        <Stack.Screen name="suspended" component={SuspendedScreen} />
      </Stack.Navigator>
    );
  }

  if (authState.kind === "authenticated" && principal) {
    return shell === "DRIVER" ? <DriverApp /> : <AdminApp />;
  }

  return <AuthStack />;
}

