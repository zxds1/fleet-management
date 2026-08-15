import React from "react";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { LoginScreen } from "../screens/auth/LoginScreen";
import { SignupScreen } from "../screens/auth/SignupScreen";
import { ForgotPasswordScreen } from "../screens/auth/ForgotPasswordScreen";
import { ResetCodeScreen } from "../screens/auth/ResetCodeScreen";
import { ResetDoneScreen } from "../screens/auth/ResetDoneScreen";
import { MfaScreen } from "../screens/auth/MfaScreen";
import { ConsentScreen } from "../screens/auth/ConsentScreen";

const Stack = createNativeStackNavigator();

export function AuthStack() {
  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      <Stack.Screen name="login">
        {({ navigation }) => (
          <LoginScreen
            onNavigateToSignup={() => navigation.navigate("signup")}
            onNavigateToForgot={() => navigation.navigate("forgot")}
          />
        )}
      </Stack.Screen>
      <Stack.Screen name="signup">
        {({ navigation }) => <SignupScreen onNavigateToLogin={() => navigation.navigate("login")} />}
      </Stack.Screen>
      <Stack.Screen name="forgot">
        {({ navigation }) => (
          <ForgotPasswordScreen
            onResetRequested={(resetId, hint) => navigation.navigate("reset_code", { resetId, contactHint: hint })}
            onBackToLogin={() => navigation.navigate("login")}
          />
        )}
      </Stack.Screen>
      <Stack.Screen name="reset_code">
        {({ navigation, route }) => (
          <ResetCodeScreen
            resetId={(route.params as any)?.resetId ?? ""}
            contactHint={(route.params as any)?.contactHint ?? null}
            onResetComplete={() => navigation.navigate("reset_done")}
            onBackToLogin={() => navigation.navigate("login")}
          />
        )}
      </Stack.Screen>
      <Stack.Screen name="reset_done">
        {({ navigation }) => <ResetDoneScreen onBackToLogin={() => navigation.navigate("login")} />}
      </Stack.Screen>
      <Stack.Screen name="mfa" component={MfaScreen} />
      <Stack.Screen name="consent" component={ConsentScreen} />
    </Stack.Navigator>
  );
}

