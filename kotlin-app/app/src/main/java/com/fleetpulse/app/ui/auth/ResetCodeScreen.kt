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
import com.fleetpulse.app.data.remote.AppException
import com.fleetpulse.app.data.repo.FleetRepository
import com.fleetpulse.app.ui.components.FleetButton
import com.fleetpulse.app.ui.components.SectionCard
import com.fleetpulse.app.ui.theme.BentoTextSecondary
import com.fleetpulse.app.ui.theme.StatusWarning
import kotlinx.coroutines.launch

private const val RESET_MIN_PASSWORD_LENGTH = 12

/**
 * Password reset step 2 (POST /auth/password-reset/{id}/complete). The reset id + emailed/SMSed code
 * ARE the credential (anonymous call). The backend applies the new password and revokes every session,
 * so the user must sign in again afterwards — hence [onResetComplete] leads to the done screen.
 */
@Composable
fun ResetCodeScreen(
    repository: FleetRepository,
    resetId: String,
    contactHint: String?,
    onResetComplete: () -> Unit,
    onBackToLogin: () -> Unit,
) {
    val scope = rememberCoroutineScope()
    val principal by repository.principal.collectAsState()
    val isConnected by repository.isNetworkConnected.collectAsState()
    val locale = principal?.locale ?: "en"

    var code by remember { mutableStateOf("") }
    var newPassword by remember { mutableStateOf("") }
    var confirm by remember { mutableStateOf("") }
    var showPassword by remember { mutableStateOf(false) }
    var submitting by remember { mutableStateOf(false) }
    var errorMessage by remember { mutableStateOf<String?>(null) }

    fun validate(): String? = when {
        code.isBlank() -> AuthStrings.codeRequired(locale)
        newPassword.length < RESET_MIN_PASSWORD_LENGTH -> AuthStrings.passwordTooShort(locale)
        newPassword != confirm -> AuthStrings.passwordsDoNotMatch(locale)
        else -> null
    }

    AuthScaffold(
        title = AuthStrings.resetTitle(locale),
        subtitle = AuthStrings.resetSubtitle(locale),
        modifier = Modifier.testTag("reset_screen"),
    ) {
        SectionCard {
            if (!contactHint.isNullOrBlank()) {
                Text(
                    text = contactHint,
                    style = MaterialTheme.typography.bodySmall,
                    color = BentoTextSecondary,
                )
                Spacer(Modifier.height(12.dp))
            }

            AuthTextField(
                value = code,
                onValueChange = { code = it; errorMessage = null },
                label = AuthStrings.resetCodeLabel(locale),
                enabled = !submitting,
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.NumberPassword),
                modifier = Modifier.testTag("reset_code_input"),
            )
            Spacer(Modifier.height(12.dp))

            AuthTextField(
                value = newPassword,
                onValueChange = { newPassword = it },
                label = AuthStrings.newPasswordLabel(locale),
                enabled = !submitting,
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password),
                visualTransformation = if (showPassword) VisualTransformation.None else PasswordVisualTransformation(),
                supportingText = AuthStrings.passwordRule(locale),
                trailingIcon = {
                    IconButton(onClick = { showPassword = !showPassword }) {
                        Icon(
                            imageVector = if (showPassword) Icons.Default.VisibilityOff else Icons.Default.Visibility,
                            contentDescription = if (showPassword) AuthStrings.hidePassword(locale) else AuthStrings.showPassword(locale),
                            tint = BentoTextSecondary,
                        )
                    }
                },
                modifier = Modifier.testTag("reset_password_input"),
            )
            Spacer(Modifier.height(12.dp))

            AuthTextField(
                value = confirm,
                onValueChange = { confirm = it },
                label = AuthStrings.confirmPasswordLabel(locale),
                enabled = !submitting,
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password),
                visualTransformation = if (showPassword) VisualTransformation.None else PasswordVisualTransformation(),
                modifier = Modifier.testTag("reset_confirm_input"),
            )

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
                text = AuthStrings.setPasswordBtn(locale),
                onClick = {
                    val validationError = validate()
                    if (validationError != null) {
                        errorMessage = validationError
                    } else if (!submitting) {
                        submitting = true
                        errorMessage = null
                        scope.launch {
                            repository.completePasswordReset(resetId, code.trim(), newPassword)
                                .onSuccess { onResetComplete() }
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
                enabled = code.isNotBlank() && newPassword.isNotBlank() && isConnected && !submitting,
                modifier = Modifier.testTag("reset_submit_btn"),
            )

            Spacer(Modifier.height(4.dp))
            TextButton(
                onClick = onBackToLogin,
                enabled = !submitting,
                modifier = Modifier
                    .align(Alignment.CenterHorizontally)
                    .testTag("reset_back_btn"),
            ) { Text(AuthStrings.backToLogin(locale), color = BentoTextSecondary) }
        }
    }
}
