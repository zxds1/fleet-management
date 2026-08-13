package com.fleetpulse.app.ui.driver

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.FactCheck
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.navigation.NavController
import com.fleetpulse.app.data.repo.FleetRepository
import com.fleetpulse.app.ui.components.EmptyState
import com.fleetpulse.app.ui.components.SectionCard
import com.fleetpulse.app.ui.components.StatusChip
import com.fleetpulse.app.ui.theme.*

@Composable
fun DvirListScreen(repository: FleetRepository, nav: NavController, locale: String) {
    val reports by repository.dvirReports.collectAsState()
    Column(modifier = Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp)) {
        BackButton({ nav.popBackStack() }, locale)
        Spacer(Modifier.height(8.dp))
        ScreenTitle(t(locale, "dvirList.title"))
        Spacer(Modifier.height(16.dp))
        if (reports.isEmpty()) {
            EmptyState(Icons.Filled.FactCheck, t(locale, "dvirList.title"), "No inspections recorded yet.")
            return
        }
        reports.forEach { r ->
            SectionCard(modifier = Modifier.fillMaxWidth().padding(bottom = 12.dp).clickable { nav.navigate("dvir_detail/${r.id}") }) {
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                    Text(r.vehicleId ?: "Vehicle", style = MaterialTheme.typography.titleMedium, color = BentoTextPrimary)
                    StatusChip(r.overallStatus, if (r.overallStatus == "PASS") StatusSafe else StatusWarning)
                }
                Spacer(Modifier.height(6.dp))
                Text("Defects: ${r.defectCount}  •  ${r.createdAt}", style = MaterialTheme.typography.bodyMedium, color = BentoTextSecondary)
                Text("Signed: ${r.signatureName}", style = MaterialTheme.typography.bodyMedium, color = BentoTextSecondary)
            }
        }
    }
}
