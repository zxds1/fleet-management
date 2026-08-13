package com.fleetpulse.app.ui.admin

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.navigation.NavController
import com.fleetpulse.app.data.repo.FleetRepository
import com.fleetpulse.app.ui.components.EmptyState
import com.fleetpulse.app.ui.components.StatusChip
import com.fleetpulse.app.ui.theme.*

@Composable
fun DriversScreen(repository: FleetRepository, locale: String, nav: NavController) {
    val roster by repository.driverRoster.collectAsState()
    LaunchedEffect(Unit) { repository.loadDriverRosterData() }
    if (roster.isEmpty()) {
        EmptyState(icon = Icons.Filled.People, title = "No drivers", message = "Your tenant's drivers will be listed here.")
        return
    }
    AdminListScaffold(locale, Icons.Filled.People, "No drivers", "", isEmpty = false) {
        items(roster, key = { it.id }) { d ->
            val color = when (d.status) {
                "SUSPENDED" -> StatusDanger
                "ON_LEAVE" -> StatusWarning
                "TERMINATED" -> BentoTextSecondary
                else -> StatusSafe
            }
            Surface(color = BentoCardBg, shape = RoundedCornerShape(16.dp), border = BorderStroke(1.dp, BentoBorder),
                modifier = Modifier.fillMaxWidth().clickable { nav.navigate("driver_detail/${d.id}") }.testTag("driver_row_${d.id}")) {
                Column(Modifier.padding(16.dp)) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Text(d.name, style = MaterialTheme.typography.bodyLarge, color = BentoTextPrimary, fontWeight = FontWeight.SemiBold, modifier = Modifier.weight(1f))
                        StatusChip(text = d.status, color = color)
                    }
                    Text("${d.mfaEnrolled.takeIf { it }?.let { "MFA on" } ?: "MFA off"} · ${d.activeSessionsCount} active session(s)", style = MaterialTheme.typography.bodySmall, color = BentoTextSecondary)
                }
            }
        }
    }
}
