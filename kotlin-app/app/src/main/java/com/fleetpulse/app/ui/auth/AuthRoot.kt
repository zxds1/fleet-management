package com.fleetpulse.app.ui.auth

import androidx.compose.foundation.layout.*
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.unit.dp
import com.fleetpulse.app.data.repo.FleetRepository
import com.fleetpulse.app.ui.components.FleetButton
import com.fleetpulse.app.ui.components.SectionCard
import com.fleetpulse.app.ui.theme.BentoTextSecondary
import com.fleetpulse.app.ui.theme.StatusSafe

/**
 * Router for the unauthenticated part of the auth vertical slice, mirroring the Expo `AuthFlow`
 * step machine (packages/mobile/src/core/auth/flow.ts):
 *
 *   login → signup | forgot → reset → resetDone → login
 *
 * The MFA and consent steps are NOT handled here: `MainActivity` renders [MfaScreen] / [ConsentScreen]
 * off `repository.authState` (NeedsMfa / NeedsConsent), so this router only owns the anonymous steps.
 * The role is chosen ON the login screen (drivers = phone, admins = email) — there is no post-login
 * role picker; [RoleSwitchScreen] is only used for mixed principals holding both shells.
 */
private enum class AuthStep { LOGIN, SIGNUP, FORGOT, RESET, RESET_DONE }

@Composable
fun AuthRoot(repository: FleetRepository) {
    var step by remember { mutableStateOf(AuthStep.LOGIN) }
    // Reset id returned by step 1 of the password reset; the code + id are the credential for step 2.
    var resetId by remember { mutableStateOf<String?>(null) }
    var resetContactHint by remember { mutableStateOf<String?>(null) }

    val principal by repository.principal.collectAsState()
    val locale = principal?.locale ?: "en"

    when (step) {
        AuthStep.LOGIN -> LoginScreen(
            repository = repository,
            onNavigateToSignup = { step = AuthStep.SIGNUP },
            onNavigateToForgot = { step = AuthStep.FORGOT },
        )

        AuthStep.SIGNUP -> SignupScreen(
            repository = repository,
            onNavigateToLogin = { step = AuthStep.LOGIN },
        )

        AuthStep.FORGOT -> ForgotPasswordScreen(
            repository = repository,
            onResetRequested = { id, hint ->
                resetId = id
                resetContactHint = hint
                step = AuthStep.RESET
            },
            onBackToLogin = { step = AuthStep.LOGIN },
        )

        AuthStep.RESET -> {
            val id = resetId
            if (id == null) {
                // Defensive: without a reset id the screen is a dead end — go back and request again.
                LaunchedEffect(Unit) { step = AuthStep.FORGOT }
            } else {
                ResetCodeScreen(
                    repository = repository,
                    resetId = id,
                    contactHint = resetContactHint,
                    onResetComplete = {
                        resetId = null
                        resetContactHint = null
                        step = AuthStep.RESET_DONE
                    },
                    onBackToLogin = {
                        resetId = null
                        step = AuthStep.LOGIN
                    },
                )
            }
        }

        AuthStep.RESET_DONE -> ResetDoneScreen(
            locale = locale,
            onBackToLogin = { step = AuthStep.LOGIN },
        )
    }
}

/** Terminal confirmation of a completed reset; all other sessions were revoked by the backend. */
@Composable
private fun ResetDoneScreen(locale: String, onBackToLogin: () -> Unit) {
    AuthScaffold(
        title = AuthStrings.resetDoneTitle(locale),
        subtitle = null,
        modifier = Modifier.testTag("reset_done_screen"),
    ) {
        SectionCard {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                Icon(Icons.Default.CheckCircle, contentDescription = null, tint = StatusSafe, modifier = Modifier.size(28.dp))
                Text(
                    text = AuthStrings.resetDoneBody(locale),
                    style = MaterialTheme.typography.bodyMedium,
                    color = BentoTextSecondary,
                )
            }
            Spacer(Modifier.height(20.dp))
            FleetButton(
                text = AuthStrings.signInBtn(locale),
                onClick = onBackToLogin,
                modifier = Modifier.testTag("reset_done_login_btn"),
            )
        }
    }
}
