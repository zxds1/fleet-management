package com.fleetpulse.app.ui.auth

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Block
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.fleetpulse.app.data.repo.FleetRepository
import com.fleetpulse.app.ui.components.FleetButton
import com.fleetpulse.app.ui.components.SectionCard
import com.fleetpulse.app.ui.components.StatusChip
import com.fleetpulse.app.ui.theme.*
import kotlinx.coroutines.launch

/**
 * Terminal screen for a blocked account — shown when `principal.isSuspended()` is true or the backend
 * returned ACCOUNT_SUSPENDED / DEVICE_REVOKED / SESSION_REVOKED. There is no retry action: the only
 * way forward is signing out and contacting an administrator. Queued offline work is intentionally
 * preserved on the device until access is restored.
 */
@Composable
fun SuspendedScreen(
    repository: FleetRepository,
    errorCode: String = "ACCOUNT_SUSPENDED",
) {
    val scope = rememberCoroutineScope()
    val principal by repository.principal.collectAsState()
    val locale = principal?.locale ?: "en"

    var signingOut by remember { mutableStateOf(false) }

    AuthScaffold(
        title = AuthStrings.suspendedTitle(locale),
        subtitle = null,
        modifier = Modifier.testTag("suspended_screen"),
    ) {
        SectionCard {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                Surface(color = StatusDanger.copy(alpha = 0.15f), shape = CircleShape) {
                    Icon(
                        imageVector = Icons.Default.Block,
                        contentDescription = null,
                        tint = StatusDanger,
                        modifier = Modifier.padding(8.dp).size(22.dp),
                    )
                }
                Column(Modifier.weight(1f)) {
                    Text(
                        text = AuthStrings.suspendedTitle(locale),
                        style = MaterialTheme.typography.titleMedium,
                        fontWeight = FontWeight.Bold,
                        color = BentoTextPrimary,
                    )
                    principal?.email?.takeIf { it.isNotBlank() }?.let { email ->
                        Text(email, style = MaterialTheme.typography.bodySmall, color = BentoTextSecondary)
                    }
                }
            }

            Spacer(Modifier.height(12.dp))
            StatusChip(text = errorCode, color = StatusDanger)

            Spacer(Modifier.height(14.dp))
            Text(
                text = AuthStrings.suspendedBody(locale),
                style = MaterialTheme.typography.bodyMedium,
                color = BentoTextSecondary,
            )

            Spacer(Modifier.height(12.dp))
            AuthNoticeBanner(AuthStrings.errorCopy(locale, errorCode, null), tint = StatusWarning)

            Spacer(Modifier.height(20.dp))
            FleetButton(
                text = AuthStrings.signOut(locale),
                onClick = {
                    if (!signingOut) {
                        signingOut = true
                        scope.launch { repository.logout() }
                    }
                },
                enabled = !signingOut,
                modifier = Modifier.testTag("suspended_logout_btn"),
            )
        }
    }
}
