import React, { useState } from "react";
import { LoginScreen } from "./LoginScreen";
import { SignupScreen } from "./SignupScreen";
import { ForgotPasswordScreen } from "./ForgotPasswordScreen";
import { ResetCodeScreen } from "./ResetCodeScreen";
import { ResetDoneScreen } from "./ResetDoneScreen";

type Step = "LOGIN" | "SIGNUP" | "FORGOT" | "RESET" | "RESET_DONE";

/** Auth vertical-slice router (mirrors AuthRoot.kt). MFA/Consent are handled globally by RootNavigator. */
export function AuthFlow() {
  const [step, setStep] = useState<Step>("LOGIN");
  const [resetId, setResetId] = useState<string | null>(null);
  const [resetHint, setResetHint] = useState<string | null>(null);

  if (step === "LOGIN")
    return (
      <LoginScreen
        onNavigateToSignup={() => setStep("SIGNUP")}
        onNavigateToForgot={() => setStep("FORGOT")}
      />
    );
  if (step === "SIGNUP")
    return <SignupScreen onNavigateToLogin={() => setStep("LOGIN")} />;
  if (step === "FORGOT")
    return (
      <ForgotPasswordScreen
        onResetRequested={(id, hint) => {
          setResetId(id);
          setResetHint(hint);
          setStep("RESET");
        }}
        onBackToLogin={() => setStep("LOGIN")}
      />
    );
  if (step === "RESET" && resetId)
    return (
      <ResetCodeScreen
        resetId={resetId}
        contactHint={resetHint}
        onResetComplete={() => setStep("RESET_DONE")}
        onBackToLogin={() => setStep("LOGIN")}
      />
    );
  return <ResetDoneScreen onBackToLogin={() => setStep("LOGIN")} />;
}

