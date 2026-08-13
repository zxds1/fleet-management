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
fun DriverAccidentDetailScreen(repository: FleetRepository, nav: NavController, locale: String, id: String) {
    val accidents by repository.accidentReports.collectAsState()
    val accident = accidents.firstOrNull { it.id == id }
    Column(modifier = Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp)) {
        BackButton({ nav.popBackStack() }, locale)
        Spacer(Modifier.height(8.dp))
        ScreenTitle(t(locale, "myAccidents.title"))
        Spacer(Modifier.height(16.dp))
        if (accident == null) { Text("Accident not found.", color = BentoTextSecondary); return }
        if (accident.isMayday) {
            SectionCard(modifier = Modifier.fillMaxWidth().padding(bottom = 12.dp)) {
                StatusChip("MAYDAY DISPATCHED", StatusDanger)
                Spacer(Modifier.height(6.dp))
                Text("Emergency services have been alerted.", color = BentoTextPrimary)
            }
        }
        SectionCard {
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                Text(accident.vehicleId ?: "Vehicle", style = MaterialTheme.typography.titleMedium, color = BentoTextPrimary)
                StatusChip(accident.status.name, StatusWarning)
            }
            Spacer(Modifier.height(6.dp))
            Text("Statement: ${accident.driverStatement ?: "—"}", style = MaterialTheme.typography.bodyMedium, color = BentoTextSecondary)
            accident.position?.let { p -> Text("Position: ${"%.4f".format(p.latitude)}, ${"%.4f".format(p.longitude)}", style = MaterialTheme.typography.bodyMedium, color = BentoTextSecondary) }
        }
    }
}
