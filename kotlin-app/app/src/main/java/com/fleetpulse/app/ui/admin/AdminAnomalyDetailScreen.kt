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
    val localAnomaly = anomalies.firstOrNull { it.id == id }
    var detail by remember { mutableStateOf<Map<String, Any?>?>(null) }
    var loading by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }

    LaunchedEffect(id, localAnomaly) {
        if (localAnomaly == null && detail == null && !loading) {
            loading = true
            repository.fetchAnomalyDetail(id)
                .onSuccess { detail = it }
                .onFailure { error = it.localizedMessage ?: "Failed to load anomaly" }
            loading = false
        }
    }

    if (localAnomaly != null) {
        renderAnomaly(repository, locale, localAnomaly, nav)
        return
    }
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
    detail?.let { d ->
        renderAnomaly(repository, locale, repository.mapAnomalyDetail(d, id), nav)
        return
    }
    Box(Modifier.fillMaxSize().padding(32.dp), contentAlignment = Alignment.Center) { Text("Anomaly not found", color = BentoTextSecondary) }
}

@Composable
private fun renderAnomaly(repository: FleetRepository, locale: String, anomaly: com.fleetpulse.app.data.AnomalyItem, nav: NavController) {
    val color = when (anomaly.severity) {
        AnomalySeverity.CRITICAL -> StatusDanger
        AnomalySeverity.WARNING -> StatusWarning
        else -> StatusInfo
    }
    Column(Modifier.fillMaxSize().padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Text(anomaly.title, style = MaterialTheme.typography.titleLarge, color = BentoTextPrimary)
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            StatusChip(text = anomaly.domain.name, color = BentoBluePrimary)
            StatusChip(text = anomaly.severity.name, color = color)
        }
        AdminRowCard(title = "Vehicle", subtitle = anomaly.vehicleId ?: "—")
        AdminRowCard(title = "Detail", subtitle = anomaly.detail)
    }
}
