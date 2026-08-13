package com.fleetpulse.app.ui.driver

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.navigation.NavController
import com.fleetpulse.app.data.repo.FleetRepository
import com.fleetpulse.app.ui.components.SectionCard
import com.fleetpulse.app.ui.components.StatusChip
import com.fleetpulse.app.ui.theme.*

@Composable
fun DvirDetailScreen(repository: FleetRepository, nav: NavController, locale: String, id: String) {
    val reports by repository.dvirReports.collectAsState()
    val report = reports.firstOrNull { it.id == id }
    Column(modifier = Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp)) {
        BackButton({ nav.popBackStack() }, locale)
        Spacer(Modifier.height(8.dp))
        ScreenTitle(t(locale, "dvirList.title"))
        Spacer(Modifier.height(16.dp))
        if (report == null) {
            Text("Inspection not found.", color = BentoTextSecondary)
            return
        }
        SectionCard {
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                Text(report.vehicleId ?: "Vehicle", style = MaterialTheme.typography.titleMedium, color = BentoTextPrimary)
                StatusChip(report.overallStatus, if (report.overallStatus == "PASS") StatusSafe else StatusWarning)
            }
            Spacer(Modifier.height(6.dp))
            Text("Subject: ${report.subject}", style = MaterialTheme.typography.bodyMedium, color = BentoTextSecondary)
            Text("Defects: ${report.defectCount}", style = MaterialTheme.typography.bodyMedium, color = BentoTextSecondary)
            Text("Driver: ${report.driverName ?: "—"}", style = MaterialTheme.typography.bodyMedium, color = BentoTextSecondary)
            Text("Signed: ${report.signatureName}", style = MaterialTheme.typography.bodyMedium, color = BentoTextSecondary)
        }
        Spacer(Modifier.height(12.dp))
        report.items.forEach { it ->
            SectionCard(modifier = Modifier.fillMaxWidth().padding(bottom = 8.dp)) {
                Text(it.label, style = MaterialTheme.typography.bodyLarge, color = BentoTextPrimary)
                Spacer(Modifier.height(4.dp))
                StatusChip(it.result.name, when (it.result) { com.fleetpulse.app.data.InspectionItemResult.PASS -> StatusSafe; else -> StatusWarning })
                if (it.notes != null) Text("Notes: ${it.notes}", style = MaterialTheme.typography.bodyMedium, color = BentoTextSecondary)
            }
        }
    }
}
