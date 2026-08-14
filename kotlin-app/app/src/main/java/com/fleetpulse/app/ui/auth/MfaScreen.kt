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
import com.fleetpulse.app.ui.theme.BentoBluePrimary
import kotlinx.coroutines.launch

/**
 * Second leg of the login flow (POST /auth/mfa/verify). Rendered by MainActivity while
 * `authState is NeedsMfa`. The challenge token is held inside the repository — the client never
 * replays the login credentials here. On success the repository flips authState to
 * Authenticated / NeedsConsent and MainActivity routes onward.
 */
@Composable
fun MfaScreen(repository: FleetRepository) {
    val scope = rememberCoroutineScope()
    val principal by repository.principal.collectAsState()
    val locale = principal?.locale ?: "en"

    var code by remember { mutableStateOf("") }
    var submitting by remember { mutableStateOf(false) }
    var errorMessage by remember { mutableStateOf<String?>(null) }

    val canSubmit = code.length == 6 && !submitting

    AuthScaffold(
        title = AuthStrings.mfaTitle(locale),
        subtitle = AuthStrings.mfaSubtitle(locale),
        modifier = Modifier.testTag("mfa_screen"),
    ) {
        SectionCard {
            AuthTextField(
                value = code,
                onValueChange = { input ->
                    if (input.length <= 6 && input.all { it.isDigit() }) {
                        code = input
                        errorMessage = null
                    }
                },
                label = AuthStrings.mfaCodeLabel(locale),
                placeholder = "······",
                enabled = !submitting,
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.NumberPassword),
                modifier = Modifier.testTag("mfa_code_input"),
            )

            errorMessage?.let {
                Spacer(Modifier.height(12.dp))
                AuthErrorBanner(it)
            }

            Spacer(Modifier.height(20.dp))
            FleetButton(
                text = AuthStrings.mfaVerifyBtn(locale),
                onClick = {
                    if (!submitting) {
                        submitting = true
                        errorMessage = null
                        scope.launch {
                            val result = repository.verifyMfa(code)
                            result.onFailure { e ->
                                val appError = e as? AppException
                                errorMessage = AuthStrings.errorCopy(
                                    locale,
                                    appError?.errorCode ?: "UNKNOWN",
                                    appError?.detail ?: e.message,
                                )
                                code = ""
                            }
                            submitting = false
                        }
                    }
                },
                enabled = canSubmit,
                modifier = Modifier.testTag("mfa_verify_btn"),
            )

            Spacer(Modifier.height(4.dp))
            TextButton(
                onClick = { scope.launch { repository.logout() } },
                enabled = !submitting,
                modifier = Modifier
                    .align(Alignment.CenterHorizontally)
                    .testTag("mfa_back_btn"),
            ) { Text(AuthStrings.backToLogin(locale), color = BentoBluePrimary) }
        }
    }
}
