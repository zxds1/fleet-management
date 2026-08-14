package com.fleetpulse.app.ui.admin

import androidx.compose.foundation.layout.*
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.unit.dp
import androidx.navigation.NavController
import com.fleetpulse.app.data.Permission
import com.fleetpulse.app.data.repo.FleetRepository
import com.fleetpulse.app.ui.components.StatusChip
import com.fleetpulse.app.ui.theme.*
import kotlinx.coroutines.launch

@Composable
fun AdminAccidentDetailScreen(repository: FleetRepository, locale: String, id: String, nav: NavController) {
    val accidents by repository.accidentReports.collectAsState()
    val principal by repository.principal.collectAsState()
    val scope = rememberCoroutineScope()
    val accident = accidents.firstOrNull { it.id == id }
    var detail by remember { mutableStateOf<Map<String, Any?>?>(null) }
    var loading by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    var busy by remember { mutableStateOf(false) }
    var result by remember { mutableStateOf<String?>(null) }

    LaunchedEffect(id, accident) {
        if (accident == null && detail == null && !loading) {
            loading = true
            repository.fetchAccidentDetail(id)
                .onSuccess { detail = it }
                .onFailure { error = it.localizedMessage ?: "Failed to load accident" }
            loading = false
        }
    }

    val resolvedAccident = accident ?: (detail?.let { repository.mapAccident(it) })

    if (resolvedAccident == null) {
        if (loading) {
            Box(Modifier.fillMaxSize().padding(32.dp), contentAlignment = Alignment.Center) {
                CircularProgressIndicator(color = BentoBluePrimary)
            }
            return
        }
        error?.let {
            Box(Modifier.fillMaxSize().padding(32.dp), contentAlignment = Alignment.Center) { Text(it, color = StatusDanger) }
            return
        }
        Box(Modifier.fillMaxSize().padding(32.dp), contentAlignment = Alignment.Center) {
            Text("Accident not found", color = BentoTextSecondary)
        }
        return
    }

    val a = resolvedAccident
    val canAck = principal?.hasPermission(Permission.ACCIDENT_ACKNOWLEDGE) ?: false

    Column(Modifier.fillMaxSize().padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Text("Accident ${a.id.take(8)}", style = MaterialTheme.typography.titleLarge, color = BentoTextPrimary)
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            StatusChip(text = a.status.name, color = StatusInfo)
            if (a.tierLevel > 0) StatusChip(text = "TIER ${a.tierLevel}", color = StatusWarning)
            if (a.escalationArmed) StatusChip(text = "ESCALATION ARMED", color = StatusDanger)
            if (a.acknowledged) StatusChip(text = "ACK", color = StatusSafe)
        }
        AdminRowCard(title = "Vehicle", subtitle = a.vehicleId ?: "—")
        AdminRowCard(title = "Driver", subtitle = a.driverName ?: "—")
        AdminRowCard(title = "Position", subtitle = a.position?.let { "${it.latitude}, ${it.longitude}" } ?: "—")
        a.driverStatement?.let { AdminRowCard(title = "Statement", subtitle = it) }

        result?.let { Text(it, color = StatusSafe, style = MaterialTheme.typography.bodySmall) }

        if (canAck && !a.acknowledged) {
            Button(
                onClick = {
                    busy = true
                    scope.launch {
                        repository.acknowledgeAccident(a.id).onSuccess {
                            result = if (locale == "sw") "Imekubaliwa." else "Acknowledged. Escalation timer cancelled."
                            repository.loadAccidentReports()
                        }.onFailure { result = errorCopy((it as? com.fleetpulse.app.data.remote.AppException)?.errorCode ?: "UNKNOWN", locale) }
                        busy = false
                    }
                },
                enabled = !busy,
                colors = ButtonDefaults.buttonColors(containerColor = BentoBluePrimary),
                modifier = Modifier.fillMaxWidth().testTag("ack_button"),
            ) { Text(if (busy) "..." else if (locale == "sw") "Kubali" else "Acknowledge") }
        }
    }
}
