package com.fleetpulse.app.ui.auth

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.LocalShipping
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.fleetpulse.app.data.AppConstants
import com.fleetpulse.app.ui.theme.*

/**
 * Centralized en/sw user-facing copy for the auth vertical slice (CONTRACTS.md §i18n).
 * Every string is a function of the locale so it can be swapped for string resources later without
 * touching the screens. Locale is sourced from `Principal.locale` (default "en").
 */
object AuthStrings {
    private fun pick(locale: String, en: String, sw: String): String =
        if (locale.lowercase().startsWith("sw")) sw else en

    fun appName(l: String) = pick(l, "FleetPulse", "FleetPulse")
    fun signInTitle(l: String) = pick(l, "Sign in", "Ingia")
    fun signInSubtitle(l: String) = pick(
        l,
        "Drivers sign in with their phone number. Administrators use their email address.",
        "Madereva wanaingia kwa namba ya simu. Wasimamizi wanatumia barua pepe.",
    )
    fun phoneTab(l: String) = pick(l, "Driver (phone)", "Dereva (simu)")
    fun emailTab(l: String) = pick(l, "Admin (email)", "Msimamizi (barua pepe)")
    fun phoneLabel(l: String) = pick(l, "Phone number", "Namba ya simu")
    fun phoneHint(l: String) = pick(l, AppConstants.SAMPLE_PHONE_HINT, AppConstants.SAMPLE_PHONE_HINT)
    fun emailLabel(l: String) = pick(l, "Email address", "Barua pepe")
    fun emailHint(l: String) = pick(l, "you@company.com", "wewe@kampuni.com")
    fun passwordLabel(l: String) = pick(l, "Password", "Nenosiri")
    fun mfaCodeOptional(l: String) = pick(l, "MFA code (if enabled)", "Namba ya MFA (ikiwa imewekwa)")
    fun signInBtn(l: String) = pick(l, "Sign in", "Ingia")
    fun forgotPassword(l: String) = pick(l, "Forgot password?", "Umesahau nenosiri?")
    fun createCompany(l: String) = pick(l, "Create a company account", "Fungua akaunti ya kampuni")
    fun offlineCannotSignIn(l: String) = pick(
        l,
        "You are offline. Sign-in needs a connection.",
        "Hakuna mtandao. Kuingia kunahitaji mtandao.",
    )
    fun showPassword(l: String) = pick(l, "Show password", "Onyesha nenosiri")
    fun hidePassword(l: String) = pick(l, "Hide password", "Ficha nenosiri")

    // MFA
    fun mfaTitle(l: String) = pick(l, "Two-factor verification", "Uthibitisho wa hatua mbili")
    fun mfaSubtitle(l: String) = pick(
        l,
        "Enter the 6-digit code from your authenticator app to finish signing in.",
        "Weka namba 6 kutoka programu yako ya uthibitisho ili kukamilisha kuingia.",
    )
    fun mfaVerifyBtn(l: String) = pick(l, "Verify", "Thibitisha")
    fun mfaCodeLabel(l: String) = pick(l, "6-digit code", "Namba ya tarakimu 6")
    fun backToLogin(l: String) = pick(l, "Back to sign in", "Rudi kuingia")

    // Signup
    fun signupTitle(l: String) = pick(l, "Create your company", "Fungua kampuni yako")
    fun signupSubtitle(l: String) = pick(
        l,
        "This provisions your company workspace and makes you its first administrator.",
        "Hii inaunda eneo la kampuni yako na kukufanya msimamizi wake wa kwanza.",
    )
    fun companyLabel(l: String) = pick(l, "Company name", "Jina la kampuni")
    fun fullNameLabel(l: String) = pick(l, "Your full name", "Jina lako kamili")
    fun createAccountBtn(l: String) = pick(l, "Create account", "Fungua akaunti")
    fun haveAccount(l: String) = pick(l, "I already have an account", "Nina akaunti tayari")
    fun passwordRule(l: String) = pick(
        l,
        "At least 12 characters.",
        "Angalau herufi 12.",
    )
    fun passwordTooShort(l: String) = pick(
        l,
        "Password must be at least 12 characters.",
        "Nenosiri linatakiwa liwe na herufi 12 au zaidi.",
    )
    fun confirmPasswordLabel(l: String) = pick(l, "Confirm password", "Rudia nenosiri")
    fun passwordsDoNotMatch(l: String) = pick(l, "Passwords do not match.", "Manenosiri hayalingani.")
    fun emailInvalid(l: String) = pick(l, "Enter a valid email address.", "Weka barua pepe sahihi.")
    fun companyRequired(l: String) = pick(l, "Company name is required.", "Jina la kampuni linahitajika.")

    // Consent
    fun consentTitle(l: String) = pick(l, "GPS tracking consent", "Ruhusa ya ufuatiliaji wa GPS")
    fun consentSubtitle(l: String) = pick(
        l,
        "Required before you can start a shift.",
        "Inahitajika kabla ya kuanza kazi.",
    )
    fun consentBody(l: String) = pick(
        l,
        "FleetPulse records your vehicle's location during WORKING HOURS ONLY — from clock-in until " +
            "clock-out. Tracking stops when your shift ends. Location data is used for dispatch, " +
            "safety, accident response and fuel reconciliation.",
        "FleetPulse hurekodi mahali gari lako lipo KWA MUDA WA KAZI PEKEE — kutoka kuanza kazi hadi " +
            "kumaliza. Ufuatiliaji husimama mara kazi inapoisha. Taarifa hizi hutumika kwa upangaji " +
            "safari, usalama, dharura za ajali na uhakiki wa mafuta.",
    )
    fun consentPoints(l: String): List<String> = if (l.lowercase().startsWith("sw")) listOf(
        "Ufuatiliaji ni wakati wa kazi tu (kuanza kazi → kumaliza kazi).",
        "Hakuna ufuatiliaji ukiwa nje ya kazi.",
        "Taarifa hutunzwa kwa muda uliopangwa na kampuni yako.",
        "Unaweza kuomba taarifa zako kwa msimamizi wako.",
    ) else listOf(
        "Tracking is limited to working hours (clock-in → clock-out).",
        "No tracking while you are off duty.",
        "Data is retained per your company's retention policy.",
        "You may request a copy of your data from your administrator.",
    )
    fun consentVersionLabel(l: String, version: String) =
        pick(l, "Policy version $version", "Toleo la sera $version")
    fun consentAcceptBtn(l: String) = pick(l, "I agree — enable tracking", "Nakubali — ruhusu ufuatiliaji")
    fun consentMandatory(l: String) = pick(
        l,
        "Consent is mandatory. You cannot start a shift without it.",
        "Ruhusa ni lazima. Hauwezi kuanza kazi bila hiyo.",
    )
    fun signOut(l: String) = pick(l, "Sign out", "Toka")

    // Forgot / reset
    fun forgotTitle(l: String) = pick(l, "Reset your password", "Weka nenosiri jipya")
    fun forgotSubtitle(l: String) = pick(
        l,
        "Enter the email or phone number on your account. We'll send a reset code — " +
            "some companies require an administrator to approve first.",
        "Weka barua pepe au namba ya simu ya akaunti yako. Tutatuma namba ya kubadilisha — " +
            "kampuni zingine zinahitaji msimamizi akubali kwanza.",
    )
    fun identifierLabel(l: String) = pick(l, "Email or phone", "Barua pepe au simu")
    fun sendCodeBtn(l: String) = pick(l, "Send reset code", "Tuma namba")
    fun resetTitle(l: String) = pick(l, "Enter reset code", "Weka namba ya kubadilisha")
    fun resetSubtitle(l: String) = pick(
        l,
        "We sent a code to the contact on your account. Enter it with your new password.",
        "Tumetuma namba kwenye mawasiliano ya akaunti yako. Iweke pamoja na nenosiri jipya.",
    )
    fun resetCodeLabel(l: String) = pick(l, "Reset code", "Namba ya kubadilisha")
    fun newPasswordLabel(l: String) = pick(l, "New password", "Nenosiri jipya")
    fun setPasswordBtn(l: String) = pick(l, "Set new password", "Weka nenosiri jipya")
    fun resetDoneTitle(l: String) = pick(l, "Password updated", "Nenosiri limebadilishwa")
    fun resetDoneBody(l: String) = pick(
        l,
        "All other sessions were signed out. Sign in with your new password.",
        "Vipindi vingine vyote vimefungwa. Ingia kwa nenosiri lako jipya.",
    )
    fun resetPendingApproval(l: String) = pick(
        l,
        "If your company requires approval, the code arrives once an administrator approves.",
        "Ikiwa kampuni yako inahitaji uthibitisho, namba itafika msimamizi akikubali.",
    )
    fun codeRequired(l: String) = pick(l, "Enter the code you received.", "Weka namba uliyopokea.")

    // Offline PIN
    fun pinTitle(l: String) = pick(l, "Enter your PIN", "Weka PIN yako")
    fun pinSubtitle(l: String) = pick(
        l,
        "You are offline. Enter your 4-digit PIN to unlock your queued work.",
        "Hakuna mtandao. Weka PIN yako ya tarakimu 4 kufungua kazi zilizosubiri.",
    )
    fun pinSetupTitle(l: String) = pick(l, "Create an offline PIN", "Unda PIN ya nje ya mtandao")
    fun pinSetupSubtitle(l: String) = pick(
        l,
        "This 4-digit PIN unlocks your offline work queue when there is no network.",
        "PIN hii ya tarakimu 4 hufungua kazi zako ukiwa hakuna mtandao.",
    )
    fun pinLabel(l: String) = pick(l, "4-digit PIN", "PIN ya tarakimu 4")
    fun pinConfirmLabel(l: String) = pick(l, "Confirm PIN", "Rudia PIN")
    fun pinUnlockBtn(l: String) = pick(l, "Unlock", "Fungua")
    fun pinSaveBtn(l: String) = pick(l, "Save PIN", "Hifadhi PIN")
    fun pinWrong(l: String, remaining: Int) = pick(
        l,
        "Incorrect PIN. $remaining attempt(s) left before lockout.",
        "PIN si sahihi. Umebakiza majaribio $remaining kabla ya kufungwa.",
    )
    fun pinLocked(l: String) = pick(
        l,
        "PIN locked after 5 failed attempts. Sign in online to unlock.",
        "PIN imefungwa baada ya majaribio 5. Ingia mtandaoni kufungua.",
    )
    fun pinWiped(l: String) = pick(
        l,
        "Too many failed attempts. Local data was wiped for safety. Sign in online.",
        "Majaribio mengi yameshindikana. Taarifa za ndani zimefutwa kwa usalama. Ingia mtandaoni.",
    )
    fun pinMismatch(l: String) = pick(l, "PINs do not match.", "PIN hazilingani.")
    fun pinFourDigits(l: String) = pick(l, "PIN must be 4 digits.", "PIN inatakiwa iwe tarakimu 4.")

    // Role switch
    fun roleSwitchTitle(l: String) = pick(l, "Choose your workspace", "Chagua eneo lako la kazi")
    fun roleSwitchSubtitle(l: String) = pick(
        l,
        "Your account can use both shells. Pick the one you need — you can switch later from your profile.",
        "Akaunti yako inaweza kutumia sehemu zote mbili. Chagua unayohitaji — unaweza kubadilisha baadaye.",
    )
    fun driverShell(l: String) = pick(l, "Driver", "Dereva")
    fun driverShellDesc(l: String) = pick(
        l,
        "Clock in/out, inspections, refuels, accident reporting.",
        "Anza/maliza kazi, ukaguzi, mafuta, ripoti za ajali.",
    )
    fun adminShell(l: String) = pick(l, "Administrator", "Msimamizi")
    fun adminShellDesc(l: String) = pick(
        l,
        "Live map, verification inboxes, anomalies, fleet management.",
        "Ramani ya moja kwa moja, uhakiki, hitilafu, usimamizi wa magari.",
    )
    fun continueBtn(l: String) = pick(l, "Continue", "Endelea")

    // Suspended
    fun suspendedTitle(l: String) = pick(l, "Account suspended", "Akaunti imesimamishwa")
    fun suspendedBody(l: String) = pick(
        l,
        "Your access has been suspended by your fleet administrator. Contact them to restore access. " +
            "Any work already queued on this device is kept and will sync once access is restored.",
        "Ufikiaji wako umesimamishwa na msimamizi wa magari. Wasiliana naye kurejesha ufikiaji. " +
            "Kazi zilizosubiri kwenye kifaa hiki zimehifadhiwa na zitatumwa ufikiaji ukirejeshwa.",
    )

    /** Plain-language, action-oriented copy for the auth error codes (CONTRACTS.md error catalogue). */
    fun errorCopy(l: String, code: String, detail: String?): String = when (code) {
        "VALIDATION_ERROR" -> pick(l, "Please check the details you entered.", "Tafadhali angalia taarifa ulizoweka.")
        "UNAUTHENTICATED" -> pick(l, "Incorrect credentials. Try again.", "Taarifa za kuingia si sahihi. Jaribu tena.")
        "MFA_REQUIRED" -> pick(l, "Enter your two-factor code to continue.", "Weka namba ya hatua mbili kuendelea.")
        "FORBIDDEN" -> pick(l, "This account cannot use the mobile app.", "Akaunti hii haiwezi kutumia programu hii.")
        "ACCOUNT_SUSPENDED" -> pick(l, "Your account is suspended. Contact your administrator.", "Akaunti yako imesimamishwa. Wasiliana na msimamizi.")
        "DEVICE_REVOKED" -> pick(l, "This device was revoked. Contact your administrator.", "Kifaa hiki kimezuiliwa. Wasiliana na msimamizi.")
        "IP_BLOCKED" -> pick(l, "Sign-in is blocked from this network.", "Kuingia kumezuiliwa kwenye mtandao huu.")
        "SESSION_REVOKED" -> pick(l, "Your session ended. Sign in again.", "Kipindi chako kimeisha. Ingia tena.")
        "SESSION_LIMIT" -> pick(l, "Too many active sessions. Sign out elsewhere first.", "Vipindi vingi sana. Toka kwingine kwanza.")
        "CONSENT_REQUIRED" -> pick(l, "You must accept the tracking consent first.", "Lazima ukubali ruhusa ya ufuatiliaji kwanza.")
        "DUPLICATE" -> pick(l, "An account with these details already exists.", "Akaunti yenye taarifa hizi ipo tayari.")
        "RATE_LIMITED" -> pick(l, "Too many attempts. Wait a moment and retry.", "Majaribio mengi. Subiri kidogo na ujaribu tena.")
        "SERVICE_UNAVAILABLE" -> pick(l, "The service is busy. Try again shortly.", "Huduma ina shughuli nyingi. Jaribu tena baadaye.")
        "OFFLINE_PIN_LOCKED" -> pinLocked(l)
        "NOT_FOUND" -> pick(l, "We could not find a matching account.", "Hatukupata akaunti inayolingana.")
        "NETWORK_UNAVAILABLE" -> pick(l, "No connection. Check your network and retry.", "Hakuna mtandao. Angalia mtandao na ujaribu tena.")
        else -> detail?.takeIf { it.isNotBlank() }
            ?: pick(l, "Something went wrong. Please try again.", "Kuna hitilafu. Tafadhali jaribu tena.")
    }
}

/** Shared scrollable, centered shell used by every auth screen so they look identical. */
@Composable
fun AuthScaffold(
    title: String,
    subtitle: String?,
    modifier: Modifier = Modifier,
    content: @Composable ColumnScope.() -> Unit,
) {
    Column(
        modifier = modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(horizontal = 20.dp, vertical = 32.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Spacer(Modifier.height(8.dp))
        AuthBrandMark()
        Spacer(Modifier.height(24.dp))
        Text(
            text = title,
            style = MaterialTheme.typography.headlineSmall,
            fontWeight = FontWeight.Bold,
            color = BentoTextPrimary,
        )
        if (!subtitle.isNullOrBlank()) {
            Spacer(Modifier.height(8.dp))
            Text(
                text = subtitle,
                style = MaterialTheme.typography.bodyMedium,
                color = BentoTextSecondary,
            )
        }
        Spacer(Modifier.height(24.dp))
        content()
        Spacer(Modifier.height(24.dp))
    }
}

@Composable
private fun AuthBrandMark() {
    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
        Surface(color = BentoBluePrimary, shape = RoundedCornerShape(14.dp)) {
            Icon(
                imageVector = Icons.Default.LocalShipping,
                contentDescription = null,
                tint = BentoTextPrimary,
                modifier = Modifier.padding(8.dp).size(24.dp),
            )
        }
        Text(
            text = "FleetPulse",
            style = MaterialTheme.typography.titleLarge,
            fontWeight = FontWeight.Bold,
            color = BentoTextPrimary,
        )
    }
}

/** Inline, dismissible-free error strip used across the auth screens. */
@Composable
fun AuthErrorBanner(message: String, modifier: Modifier = Modifier) {
    Surface(
        color = StatusDanger.copy(alpha = 0.12f),
        shape = RoundedCornerShape(14.dp),
        modifier = modifier.fillMaxWidth(),
    ) {
        Text(
            text = message,
            style = MaterialTheme.typography.bodyMedium,
            color = StatusDanger,
            modifier = Modifier.padding(horizontal = 14.dp, vertical = 10.dp),
        )
    }
}

/** Informational strip (offline, pending approval, mandatory-consent notices). */
@Composable
fun AuthNoticeBanner(message: String, tint: Color = StatusInfo, modifier: Modifier = Modifier) {
    Surface(
        color = tint.copy(alpha = 0.12f),
        shape = RoundedCornerShape(14.dp),
        modifier = modifier.fillMaxWidth(),
    ) {
        Text(
            text = message,
            style = MaterialTheme.typography.bodySmall,
            color = tint,
            modifier = Modifier.padding(horizontal = 14.dp, vertical = 10.dp),
        )
    }
}

/** Themed text field shared by the auth screens (keeps the Bento look in one place). */
@Composable
fun AuthTextField(
    value: String,
    onValueChange: (String) -> Unit,
    label: String,
    modifier: Modifier = Modifier,
    placeholder: String? = null,
    enabled: Boolean = true,
    isError: Boolean = false,
    singleLine: Boolean = true,
    keyboardOptions: androidx.compose.foundation.text.KeyboardOptions = androidx.compose.foundation.text.KeyboardOptions.Default,
    visualTransformation: androidx.compose.ui.text.input.VisualTransformation = androidx.compose.ui.text.input.VisualTransformation.None,
    trailingIcon: (@Composable () -> Unit)? = null,
    supportingText: String? = null,
) {
    OutlinedTextField(
        value = value,
        onValueChange = onValueChange,
        label = { Text(label) },
        placeholder = placeholder?.let { { Text(it, color = BentoTextSecondary) } },
        enabled = enabled,
        isError = isError,
        singleLine = singleLine,
        keyboardOptions = keyboardOptions,
        visualTransformation = visualTransformation,
        trailingIcon = trailingIcon,
        supportingText = supportingText?.let { { Text(it, color = BentoTextSecondary) } },
        shape = RoundedCornerShape(14.dp),
        colors = OutlinedTextFieldDefaults.colors(
            focusedBorderColor = BentoBluePrimary,
            unfocusedBorderColor = BentoBorder,
            focusedLabelColor = BentoBluePrimary,
            unfocusedLabelColor = BentoTextSecondary,
            focusedTextColor = BentoTextPrimary,
            unfocusedTextColor = BentoTextPrimary,
            cursorColor = BentoBluePrimary,
            errorBorderColor = StatusDanger,
            errorLabelColor = StatusDanger,
            focusedContainerColor = BentoBackground,
            unfocusedContainerColor = BentoBackground,
        ),
        modifier = modifier.fillMaxWidth(),
    )
}

/** Pill segmented control (driver phone ↔ admin email). */
@Composable
fun AuthSegmentedToggle(
    options: List<String>,
    selectedIndex: Int,
    onSelect: (Int) -> Unit,
    modifier: Modifier = Modifier,
    enabled: Boolean = true,
) {
    Surface(color = BentoDarkBadge, shape = CircleShape, modifier = modifier.fillMaxWidth()) {
        Row(Modifier.padding(4.dp), horizontalArrangement = Arrangement.spacedBy(4.dp)) {
            options.forEachIndexed { index, label ->
                val selected = index == selectedIndex
                Surface(
                    color = if (selected) BentoBluePrimary else BentoDarkBadge,
                    shape = CircleShape,
                    modifier = Modifier.weight(1f),
                ) {
                    TextButton(
                        onClick = { onSelect(index) },
                        enabled = enabled,
                        shape = CircleShape,
                        modifier = Modifier.fillMaxWidth(),
                    ) {
                        Text(
                            text = label,
                            style = MaterialTheme.typography.labelLarge,
                            fontWeight = if (selected) FontWeight.Bold else FontWeight.Normal,
                            color = if (selected) BentoTextPrimary else BentoTextSecondary,
                        )
                    }
                }
            }
        }
    }
}
