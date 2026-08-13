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
import com.fleetpulse.app.data.AnomalySeverity
import com.fleetpulse.app.data.repo.FleetRepository
import com.fleetpulse.app.ui.components.StatusChip
import com.fleetpulse.app.ui.theme.*

@Composable
fun AdminAnomalyDetailScreen(repository: FleetRepository, locale: String, id: String, nav: NavController) {
    val anomalies by repository.anomalies.collectAsState()
    val anomaly = anomalies.firstOrNull { it.id == id }
    if (anomaly == null) {
        Box(Modifier.fillMaxSize().padding(32.dp), contentAlignment = Alignment.Center) { Text("Anomaly not found", color = BentoTextSecondary) }
        return
    }
    val color = when (anomaly.severity) {
        AnomalySeverity.CRITICAL -> StatusDanger
        AnomalySeverity.WARNING -> StatusWarning
        else -> StatusInfo
    }
    Column(Modifier.fillMaxSize().padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Text(anomaly.title, style = MaterialTheme.typography.titleLarge, color = BentoTextPrimary)
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            StatusChip(text = anomaly.domain.name, color = BentoPurplePrimary)
            StatusChip(text = anomaly.severity.name, color = color)
        }
        AdminRowCard(title = "Vehicle", subtitle = anomaly.vehicleId ?: "—")
        AdminRowCard(title = "Detail", subtitle = anomaly.detail)
    }
}
