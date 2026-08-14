package com.fleetpulse.app.ui.auth

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Visibility
import androidx.compose.material.icons.filled.VisibilityOff
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.unit.dp
import com.fleetpulse.app.data.repo.FleetRepository
import com.fleetpulse.app.ui.components.FleetButton
import com.fleetpulse.app.ui.components.SectionCard
import com.fleetpulse.app.ui.theme.BentoBluePrimary
import com.fleetpulse.app.ui.theme.BentoTextSecondary
import com.fleetpulse.app.ui.theme.StatusWarning
import kotlinx.coroutines.launch

/**
 * Login screen. The role is chosen here (CONTRACTS.md + Expo AuthFlow): drivers sign in with a phone
 * number in E.164, administrators with email. There is NO separate post-login role picker; the shell
 * is derived from the principal's permissions after a successful sign-in.
 *
 * On success MainActivity routes off `repository.authState` (Authenticated / NeedsMfa / NeedsConsent),
 * so this screen only needs to call `repository.login(...)` and surface `AuthState.Error`.
 */
@Composable
fun LoginScreen(
    repository: FleetRepository,
    onNavigateToSignup: () -> Unit,
    onNavigateToForgot: () -> Unit,
) {
    val scope = rememberCoroutineScope()
    val authState by repository.authState.collectAsState()
    val principal by repository.principal.collectAsState()
    val isConnected by repository.isNetworkConnected.collectAsState()
    val locale = principal?.locale ?: "en"

    // index 0 = driver (phone), 1 = admin (email). Mirrors the two identifier types.
    var tabIndex by remember { mutableStateOf(0) }
    var identifier by remember { mutableStateOf("") }
    var password by remember { mutableStateOf("") }
    var mfaCode by remember { mutableStateOf("") }
    var showPassword by remember { mutableStateOf(false) }
    var submitting by remember { mutableStateOf(false) }

    val errorMessage = (authState as? FleetRepository.AuthState.Error)
        ?.let { AuthStrings.errorCopy(locale, it.code, it.message) }

    val canSubmit = identifier.isNotBlank() && password.isNotBlank() && isConnected && !submitting

    AuthScaffold(
        title = AuthStrings.signInTitle(locale),
        subtitle = AuthStrings.signInSubtitle(locale),
        modifier = Modifier.testTag("login_screen"),
    ) {
        SectionCard {
            AuthSegmentedToggle(
                options = listOf(AuthStrings.phoneTab(locale), AuthStrings.emailTab(locale)),
                selectedIndex = tabIndex,
                onSelect = { tabIndex = it },
                enabled = !submitting,
            )
            Spacer(Modifier.height(16.dp))

            AuthTextField(
                value = identifier,
                onValueChange = { identifier = it },
                label = if (tabIndex == 0) AuthStrings.phoneLabel(locale) else AuthStrings.emailLabel(locale),
                placeholder = if (tabIndex == 0) AuthStrings.phoneHint(locale) else AuthStrings.emailHint(locale),
                enabled = !submitting,
                keyboardOptions = KeyboardOptions(
                    keyboardType = if (tabIndex == 0) KeyboardType.Phone else KeyboardType.Email,
                ),
                modifier = Modifier.testTag("identifier_input"),
            )
            Spacer(Modifier.height(12.dp))

            AuthTextField(
                value = password,
                onValueChange = { password = it },
                label = AuthStrings.passwordLabel(locale),
                enabled = !submitting,
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password),
                visualTransformation = if (showPassword) VisualTransformation.None else PasswordVisualTransformation(),
                trailingIcon = {
                    IconButton(onClick = { showPassword = !showPassword }) {
                        Icon(
                            imageVector = if (showPassword) Icons.Default.VisibilityOff else Icons.Default.Visibility,
                            contentDescription = if (showPassword) AuthStrings.hidePassword(locale) else AuthStrings.showPassword(locale),
                            tint = BentoTextSecondary,
                        )
                    }
                },
                modifier = Modifier.testTag("password_input"),
            )
            Spacer(Modifier.height(12.dp))

            // Optional inline MFA code. If the server requires MFA it issues a challenge and
            // MainActivity routes to MfaScreen for the second leg; this field is a convenience only.
            AuthTextField(
                value = mfaCode,
                onValueChange = { if (it.length <= 6 && it.all { c -> c.isDigit() }) mfaCode = it },
                label = AuthStrings.mfaCodeOptional(locale),
                enabled = !submitting,
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.NumberPassword),
                modifier = Modifier.testTag("login_mfa_input"),
            )

            if (!isConnected) {
                Spacer(Modifier.height(12.dp))
                AuthNoticeBanner(AuthStrings.offlineCannotSignIn(locale), tint = StatusWarning)
            }
            if (errorMessage != null) {
                Spacer(Modifier.height(12.dp))
                AuthErrorBanner(errorMessage)
            }

            Spacer(Modifier.height(20.dp))
            FleetButton(
                text = AuthStrings.signInBtn(locale),
                onClick = {
                    if (!submitting) {
                        submitting = true
                        scope.launch {
                            try {
                                repository.login(identifier.trim(), password)
                            } finally {
                                submitting = false
                            }
                        }
                    }
                },
                enabled = canSubmit,
                modifier = Modifier.testTag("login_submit_btn"),
            )

            Spacer(Modifier.height(4.dp))
            TextButton(
                onClick = onNavigateToForgot,
                enabled = !submitting,
                modifier = Modifier.align(Alignment.CenterHorizontally),
            ) { Text(AuthStrings.forgotPassword(locale), color = BentoBluePrimary) }
        }

        Spacer(Modifier.height(16.dp))
        TextButton(
            onClick = onNavigateToSignup,
            enabled = !submitting,
            modifier = Modifier.testTag("go_signup_btn"),
        ) { Text(AuthStrings.createCompany(locale), color = BentoBluePrimary) }
    }
}
