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
import com.fleetpulse.app.ui.theme.BentoPurplePrimary
import com.fleetpulse.app.ui.theme.BentoTextSecondary
import com.fleetpulse.app.ui.theme.StatusWarning
import kotlinx.coroutines.launch

private const val SIGNUP_MIN_PASSWORD_LENGTH = 12
private val SIGNUP_EMAIL_REGEX = Regex("^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$")

/**
 * Self-service ADMIN + TENANT provisioning (POST /auth/signup). Creates the company workspace and its
 * first administrator, then the repository continues straight into the login/MFA gate (ADMIN accounts
 * require MFA). On success MainActivity routes off authState; on failure the repo surfaces the error.
 */
@Composable
fun SignupScreen(
    repository: FleetRepository,
    onNavigateToLogin: () -> Unit,
) {
    val scope = rememberCoroutineScope()
    val principal by repository.principal.collectAsState()
    val isConnected by repository.isNetworkConnected.collectAsState()
    val locale = principal?.locale ?: "en"

    var company by remember { mutableStateOf("") }
    var fullName by remember { mutableStateOf("") }
    var email by remember { mutableStateOf("") }
    var password by remember { mutableStateOf("") }
    var confirm by remember { mutableStateOf("") }
    var showPassword by remember { mutableStateOf(false) }
    var submitting by remember { mutableStateOf(false) }
    var errorMessage by remember { mutableStateOf<String?>(null) }

    fun validate(): String? = when {
        company.isBlank() -> AuthStrings.companyRequired(locale)
        !SIGNUP_EMAIL_REGEX.matches(email.trim()) -> AuthStrings.emailInvalid(locale)
        password.length < SIGNUP_MIN_PASSWORD_LENGTH -> AuthStrings.passwordTooShort(locale)
        password != confirm -> AuthStrings.passwordsDoNotMatch(locale)
        else -> null
    }

    val canSubmit = company.isNotBlank() && email.isNotBlank() &&
        password.isNotBlank() && confirm.isNotBlank() && isConnected && !submitting

    AuthScaffold(
        title = AuthStrings.signupTitle(locale),
        subtitle = AuthStrings.signupSubtitle(locale),
        modifier = Modifier.testTag("signup_screen"),
    ) {
        SectionCard {
            AuthTextField(
                value = company,
                onValueChange = { company = it },
                label = AuthStrings.companyLabel(locale),
                enabled = !submitting,
                modifier = Modifier.testTag("signup_company_input"),
            )
            Spacer(Modifier.height(12.dp))

            AuthTextField(
                value = fullName,
                onValueChange = { fullName = it },
                label = AuthStrings.fullNameLabel(locale),
                enabled = !submitting,
                modifier = Modifier.testTag("signup_fullname_input"),
            )
            Spacer(Modifier.height(12.dp))

            AuthTextField(
                value = email,
                onValueChange = { email = it },
                label = AuthStrings.emailLabel(locale),
                placeholder = AuthStrings.emailHint(locale),
                enabled = !submitting,
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Email),
                modifier = Modifier.testTag("signup_email_input"),
            )
            Spacer(Modifier.height(12.dp))

            AuthTextField(
                value = password,
                onValueChange = { password = it },
                label = AuthStrings.passwordLabel(locale),
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
                modifier = Modifier.testTag("signup_password_input"),
            )
            Spacer(Modifier.height(12.dp))

            AuthTextField(
                value = confirm,
                onValueChange = { confirm = it },
                label = AuthStrings.confirmPasswordLabel(locale),
                enabled = !submitting,
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password),
                visualTransformation = if (showPassword) VisualTransformation.None else PasswordVisualTransformation(),
                modifier = Modifier.testTag("signup_confirm_input"),
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
                text = AuthStrings.createAccountBtn(locale),
                onClick = {
                    val validationError = validate()
                    if (validationError != null) {
                        errorMessage = validationError
                    } else if (!submitting) {
                        submitting = true
                        errorMessage = null
                        scope.launch {
                            repository.signupAdmin(
                                email = email.trim(),
                                password = password,
                                company = company.trim(),
                                fullName = fullName.trim().ifBlank { null },
                            ).onFailure { e ->
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
                enabled = canSubmit,
                modifier = Modifier.testTag("signup_submit_btn"),
            )

            Spacer(Modifier.height(4.dp))
            TextButton(
                onClick = onNavigateToLogin,
                enabled = !submitting,
                modifier = Modifier
                    .align(Alignment.CenterHorizontally)
                    .testTag("signup_login_btn"),
            ) { Text(AuthStrings.haveAccount(locale), color = BentoPurplePrimary) }
        }
    }
}
