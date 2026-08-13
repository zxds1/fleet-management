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
import com.fleetpulse.app.data.Permission
import com.fleetpulse.app.data.repo.FleetRepository
import com.fleetpulse.app.ui.components.EmptyState
import com.fleetpulse.app.ui.components.StatusChip
import com.fleetpulse.app.ui.theme.*

@Composable
fun AccidentConsoleScreen(repository: FleetRepository, locale: String, nav: NavController) {
    val accidents by repository.accidentReports.collectAsState()
    val principal by repository.principal.collectAsState()
    val canAck = principal?.hasPermission(Permission.ACCIDENT_ACKNOWLEDGE) ?: false

    LaunchedEffect(Unit) { repository.loadAccidentReports() }

    if (accidents.isEmpty()) {
        EmptyState(icon = Icons.Filled.Warning, title = "No accidents", message = "Reported accidents and maydays appear here in real time.")
        return
    }
    AdminListScaffold(locale, Icons.Filled.Warning, "No accidents", "", isEmpty = false) {
        items(accidents, key = { it.id }) { a ->
            val open = a.status.name != "RESOLVED" && a.status.name != "CLOSED"
            val color = when {
                a.isMayday -> StatusDanger
                a.escalationArmed -> StatusWarning
                open -> StatusInfo
                else -> BentoTextSecondary
            }
            Surface(color = BentoCardBg, shape = RoundedCornerShape(16.dp), border = BorderStroke(1.dp, BentoBorder),
                modifier = Modifier.fillMaxWidth().clickable { nav.navigate("accident_detail/${a.id}") }.testTag("accident_row_${a.id}")) {
                Column(Modifier.padding(16.dp)) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Text(a.id.take(8), style = MaterialTheme.typography.bodyLarge, color = BentoTextPrimary, fontWeight = FontWeight.SemiBold, modifier = Modifier.weight(1f))
                        if (a.tierLevel > 0) StatusChip(text = "TIER ${a.tierLevel}", color = StatusWarning)
                    }
                    Text(a.vehicleId ?: "unknown vehicle", style = MaterialTheme.typography.bodySmall, color = BentoTextSecondary)
                    Spacer(Modifier.height(8.dp))
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        StatusChip(text = a.status.name, color = color)
                        if (a.acknowledged) StatusChip(text = "ACK", color = StatusSafe)
                        if (a.isMayday) StatusChip(text = "MAYDAY", color = StatusDanger)
                    }
                }
            }
        }
    }
}
