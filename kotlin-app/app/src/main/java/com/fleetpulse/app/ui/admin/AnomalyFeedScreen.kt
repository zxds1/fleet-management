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
import com.fleetpulse.app.data.AnomalySeverity
import com.fleetpulse.app.data.repo.FleetRepository
import com.fleetpulse.app.ui.components.EmptyState
import com.fleetpulse.app.ui.components.StatusChip
import com.fleetpulse.app.ui.theme.*

@Composable
fun AnomalyFeedScreen(repository: FleetRepository, locale: String, nav: NavController) {
    val anomalies by repository.anomalies.collectAsState()
    if (anomalies.isEmpty()) {
        EmptyState(icon = Icons.Filled.BugReport, title = "No anomalies", message = "Open anomalies across fuel, HOS, accidents and maintenance appear here.")
        return
    }
    AdminListScaffold(locale, Icons.Filled.BugReport, "No anomalies", "", isEmpty = false) {
        items(anomalies, key = { it.id }) { a ->
            val color = when (a.severity) {
                AnomalySeverity.CRITICAL -> StatusDanger
                AnomalySeverity.WARNING -> StatusWarning
                else -> StatusInfo
            }
            Surface(color = BentoCardBg, shape = RoundedCornerShape(16.dp), border = BorderStroke(1.dp, BentoBorder),
                modifier = Modifier.fillMaxWidth().clickable { nav.navigate("anomaly_detail/${a.id}") }.testTag("anomaly_row_${a.id}")) {
                Column(Modifier.padding(16.dp)) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Text(a.title, style = MaterialTheme.typography.bodyLarge, color = BentoTextPrimary, fontWeight = FontWeight.SemiBold, modifier = Modifier.weight(1f))
                        StatusChip(text = a.severity.name, color = color)
                    }
                    Text("${a.domain.name}${a.vehicleId?.let { " · $it" } ?: ""}", style = MaterialTheme.typography.bodySmall, color = BentoTextSecondary)
                }
            }
        }
    }
}
