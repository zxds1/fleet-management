package com.fleetpulse.app.ui.auth

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import com.fleetpulse.app.data.remote.AppException
import com.fleetpulse.app.data.repo.FleetRepository
import com.fleetpulse.app.ui.components.FleetButton
import com.fleetpulse.app.ui.components.SectionCard
import com.fleetpulse.app.ui.theme.BentoTextSecondary
import com.fleetpulse.app.ui.theme.StatusWarning
import kotlinx.coroutines.launch

/**
 * Password reset step 1 (POST /auth/password-reset/request). The backend sends the code out of band
 * (email/SMS) and may require an administrator to approve first; the response only carries a redacted
 * contact hint, never the code. On success we advance to [ResetCodeScreen] with the returned reset id.
 */
@Composable
fun ForgotPasswordScreen(
    repository: FleetRepository,
    onResetRequested: (resetId: String, contactHint: String?) -> Unit,
    onBackToLogin: () -> Unit,
) {
    val scope = rememberCoroutineScope()
    val principal by repository.principal.collectAsState()
    val isConnected by repository.isNetworkConnected.collectAsState()
    val locale = principal?.locale ?: "en"

    var identifier by remember { mutableStateOf("") }
    var submitting by remember { mutableStateOf(false) }
    var errorMessage by remember { mutableStateOf<String?>(null) }

    AuthScaffold(
        title = AuthStrings.forgotTitle(locale),
        subtitle = AuthStrings.forgotSubtitle(locale),
        modifier = Modifier.testTag("forgot_screen"),
    ) {
        SectionCard {
            AuthTextField(
                value = identifier,
                onValueChange = { identifier = it; errorMessage = null },
                label = AuthStrings.identifierLabel(locale),
                enabled = !submitting,
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Email),
                modifier = Modifier.testTag("forgot_identifier_input"),
            )

            Spacer(Modifier.height(12.dp))
            AuthNoticeBanner(AuthStrings.resetPendingApproval(locale))

            if (!isConnected) {
                Spacer(Modifier.height(12.dp))
                AuthNoticeBanner(AuthStrings.offlineCannotSignIn(locale), tint = StatusWarning)
            }
            errorMessage?.let {
                Spacer(Modifier.height(12.dp))
                AuthErrorBanner(it)
            }

            Spacer(Modifier.height(20.dp))
            FleetButton(
                text = AuthStrings.sendCodeBtn(locale),
                onClick = {
                    if (!submitting) {
                        submitting = true
                        errorMessage = null
                        scope.launch {
                            repository.requestPasswordReset(identifier.trim())
                                .onSuccess { resetId -> onResetRequested(resetId, identifier.trim()) }
                                .onFailure { e ->
                                    val appError = e as? AppException
                                    errorMessage = AuthStrings.errorCopy(
                                        locale,
                                        appError?.errorCode ?: "UNKNOWN",
                                        appError?.detail ?: e.message,
                                    )
                                }
                            submitting = false
                        }
                    }
                },
                enabled = identifier.isNotBlank() && isConnected && !submitting,
                modifier = Modifier.testTag("forgot_submit_btn"),
            )

            Spacer(Modifier.height(4.dp))
            TextButton(
                onClick = onBackToLogin,
                enabled = !submitting,
                modifier = Modifier
                    .align(Alignment.CenterHorizontally)
                    .testTag("forgot_back_btn"),
            ) { Text(AuthStrings.backToLogin(locale), color = BentoTextSecondary) }
        }
    }
}
