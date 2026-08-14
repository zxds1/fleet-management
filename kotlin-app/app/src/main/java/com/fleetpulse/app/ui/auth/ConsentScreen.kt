package com.fleetpulse.app.ui.auth

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.GpsFixed
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.fleetpulse.app.data.remote.AppException
import com.fleetpulse.app.data.repo.FleetRepository
import com.fleetpulse.app.ui.components.FleetButton
import com.fleetpulse.app.ui.components.SectionCard
import com.fleetpulse.app.ui.theme.*
import kotlinx.coroutines.launch

/**
 * Mandatory GPS working-hours consent gate (C5.5). Rendered by MainActivity while
 * `authState is NeedsConsent`. Consent is MANDATORY: there is no decline action that proceeds — the
 * only alternative is signing out. Accepting posts /auth/consent and flips authState to Authenticated.
 */
@Composable
fun ConsentScreen(repository: FleetRepository) {
    val scope = rememberCoroutineScope()
    val principal by repository.principal.collectAsState()
    val locale = principal?.locale ?: "en"

    var submitting by remember { mutableStateOf(false) }
    var errorMessage by remember { mutableStateOf<String?>(null) }

    AuthScaffold(
        title = AuthStrings.consentTitle(locale),
        subtitle = AuthStrings.consentSubtitle(locale),
        modifier = Modifier.testTag("consent_screen"),
    ) {
        SectionCard {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                Surface(color = BentoLilacContainer, shape = CircleShape) {
                    Icon(
                        imageVector = Icons.Default.GpsFixed,
                        contentDescription = null,
                        tint = BentoBluePrimary,
                        modifier = Modifier.padding(8.dp).size(20.dp),
                    )
                }
                Text(
                    text = AuthStrings.consentTitle(locale),
                    style = MaterialTheme.typography.titleMedium,
                    fontWeight = FontWeight.Bold,
                    color = BentoTextPrimary,
                )
            }

            Spacer(Modifier.height(14.dp))
            Text(
                text = AuthStrings.consentBody(locale),
                style = MaterialTheme.typography.bodyMedium,
                color = BentoTextSecondary,
            )

            Spacer(Modifier.height(14.dp))
            AuthStrings.consentPoints(locale).forEach { point ->
                Row(
                    modifier = Modifier.fillMaxWidth().padding(vertical = 4.dp),
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    Box(
                        Modifier
                            .padding(top = 6.dp)
                            .size(6.dp)
                            .clip(CircleShape)
                            .background(BentoBluePrimary),
                    )
                    Text(
                        text = point,
                        style = MaterialTheme.typography.bodySmall,
                        color = BentoTextSecondary,
                    )
                }
            }

            Spacer(Modifier.height(14.dp))
            AuthNoticeBanner(AuthStrings.consentMandatory(locale), tint = StatusWarning)

            errorMessage?.let {
                Spacer(Modifier.height(12.dp))
                AuthErrorBanner(it)
            }

            Spacer(Modifier.height(20.dp))
            FleetButton(
                text = AuthStrings.consentAcceptBtn(locale),
                onClick = {
                    if (!submitting) {
                        submitting = true
                        errorMessage = null
                        scope.launch {
                            repository.acceptConsent().onFailure { e ->
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
                enabled = !submitting,
                modifier = Modifier.testTag("consent_accept_btn"),
            )

            Spacer(Modifier.height(4.dp))
            TextButton(
                onClick = { scope.launch { repository.logout() } },
                enabled = !submitting,
                modifier = Modifier
                    .align(Alignment.CenterHorizontally)
                    .testTag("consent_signout_btn"),
            ) { Text(AuthStrings.signOut(locale), color = BentoTextSecondary) }
        }
    }
}
