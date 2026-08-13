package com.fleetpulse.app.ui.driver

import androidx.compose.foundation.clickable
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
import com.fleetpulse.app.data.repo.FleetRepository
import com.fleetpulse.app.ui.components.EmptyState
import com.fleetpulse.app.ui.components.SectionCard
import com.fleetpulse.app.ui.components.StatusChip
import com.fleetpulse.app.ui.theme.*

@Composable
fun MyAccidentsScreen(repository: FleetRepository, nav: NavController, locale: String) {
    val accidents by repository.accidentReports.collectAsState()
    Column(modifier = Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp)) {
        BackButton({ nav.popBackStack() }, locale)
        Spacer(Modifier.height(8.dp))
        ScreenTitle(t(locale, "myAccidents.title"))
        Spacer(Modifier.height(16.dp))
        if (accidents.isEmpty()) {
            EmptyState(Icons.Filled.ReportProblem, t(locale, "myAccidents.title"), "No accident reports on file.")
            return
        }
        accidents.forEach { a ->
            SectionCard(modifier = Modifier.fillMaxWidth().padding(bottom = 12.dp).clickable { nav.navigate("driver_accident_detail/${a.id}") }) {
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                    Text(a.vehicleId ?: "Vehicle", style = MaterialTheme.typography.titleMedium, color = BentoTextPrimary)
                    if (a.isMayday) StatusChip("MAYDAY", StatusDanger) else StatusChip(a.status.name, StatusWarning)
                }
                Spacer(Modifier.height(6.dp))
                Text(a.driverStatement ?: "No statement", style = MaterialTheme.typography.bodyMedium, color = BentoTextSecondary)
            }
        }
    }
}
