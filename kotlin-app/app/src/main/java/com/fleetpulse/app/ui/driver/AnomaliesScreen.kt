package com.fleetpulse.app.ui.driver

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ReportProblem
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.navigation.NavController
import com.fleetpulse.app.data.AnomalySeverity
import com.fleetpulse.app.data.repo.FleetRepository
import com.fleetpulse.app.ui.components.EmptyState
import com.fleetpulse.app.ui.components.SectionCard
import com.fleetpulse.app.ui.components.StatusChip
import com.fleetpulse.app.ui.theme.*

@Composable
fun AnomaliesScreen(repository: FleetRepository, nav: NavController, locale: String) {
    val anomalies by repository.anomalies.collectAsState()
    Column(modifier = Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp)) {
        BackButton({ nav.popBackStack() }, locale)
        Spacer(Modifier.height(8.dp))
        ScreenTitle(t(locale, "anomalies.title"))
        Spacer(Modifier.height(16.dp))
        if (anomalies.isEmpty()) {
            EmptyState(Icons.Filled.ReportProblem, t(locale, "anomalies.title"), "No anomalies detected.")
            return
        }
        anomalies.forEach { a ->
            val tone = when (a.severity) {
                AnomalySeverity.CRITICAL -> StatusDanger
                AnomalySeverity.WARNING -> StatusWarning
                else -> StatusSafe
            }
            SectionCard(modifier = Modifier.fillMaxWidth().padding(bottom = 12.dp)) {
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                    Text(a.title, style = MaterialTheme.typography.titleMedium, color = BentoTextPrimary)
                    StatusChip(a.severity.name, tone)
                }
                Spacer(Modifier.height(6.dp))
                Text(a.detail, style = MaterialTheme.typography.bodyMedium, color = BentoTextSecondary)
                Text("Domain: ${a.domain}", style = MaterialTheme.typography.bodySmall, color = BentoTextSecondary)
            }
        }
    }
}
