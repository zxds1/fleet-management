package com.fleetpulse.app.ui.admin

import androidx.compose.foundation.layout.*
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.navigation.NavController
import com.fleetpulse.app.data.Permission
import com.fleetpulse.app.data.repo.FleetRepository
import com.fleetpulse.app.ui.components.StatusChip
import com.fleetpulse.app.ui.theme.*

@Composable
fun AdminAccidentDetailScreen(repository: FleetRepository, locale: String, id: String, nav: NavController) {
    val accidents by repository.accidentReports.collectAsState()
    val principal by repository.principal.collectAsState()
    val scope = rememberCoroutineScope()
    val accident = accidents.firstOrNull { it.id == id }
    var busy by remember { mutableStateOf(false) }
    var result by remember { mutableStateOf<String?>(null) }

    if (accident == null) {
        Box(Modifier.fillMaxSize().padding(32.dp), contentAlignment = Alignment.Center) {
            Text("Accident not found", color = BentoTextSecondary)
        }
        return
    }
    val canAck = principal?.hasPermission(Permission.ACCIDENT_ACKNOWLEDGE) ?: false

    Column(Modifier.fillMaxSize().padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Text("Accident ${accident.id.take(8)}", style = MaterialTheme.typography.titleLarge, color = BentoTextPrimary)
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            StatusChip(text = accident.status.name, color = StatusInfo)
            if (accident.tierLevel > 0) StatusChip(text = "TIER ${accident.tierLevel}", color = StatusWarning)
            if (accident.escalationArmed) StatusChip(text = "ESCALATION ARMED", color = StatusDanger)
            if (accident.acknowledged) StatusChip(text = "ACK", color = StatusSafe)
        }
        AdminRowCard(title = "Vehicle", subtitle = accident.vehicleId ?: "—")
        AdminRowCard(title = "Driver", subtitle = accident.driverName ?: "—")
        AdminRowCard(title = "Position", subtitle = accident.position?.let { "${it.latitude}, ${it.longitude}" } ?: "—")
        accident.driverStatement?.let { AdminRowCard(title = "Statement", subtitle = it) }

        result?.let { Text(it, color = StatusSafe, style = MaterialTheme.typography.bodySmall) }

        if (canAck && !accident.acknowledged) {
            Button(
                onClick = {
                    busy = true
                    scope.launch {
                        repository.acknowledgeAccident(accident.id).onSuccess {
                            result = if (locale == "sw") "Imekubaliwa." else "Acknowledged. Escalation timer cancelled."
                            repository.loadAccidentReports()
                        }.onFailure { result = errorCopy((it as? com.fleetpulse.app.data.remote.AppException)?.errorCode ?: "UNKNOWN", locale) }
                        busy = false
                    }
                },
                enabled = !busy,
                colors = ButtonDefaults.buttonColors(containerColor = BentoPurplePrimary),
                modifier = Modifier.fillMaxWidth().testTag("ack_button"),
            ) { Text(if (busy) "..." else if (locale == "sw") "Kubali" else "Acknowledge") }
        }
    }
}
