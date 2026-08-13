package com.fleetpulse.app.ui.driver

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.navigation.NavController
import com.fleetpulse.app.data.ShiftState
import com.fleetpulse.app.data.repo.FleetRepository
import com.fleetpulse.app.ui.components.SectionCard
import com.fleetpulse.app.ui.components.StatusChip
import com.fleetpulse.app.ui.theme.*

@Composable
fun MyShiftsScreen(repository: FleetRepository, nav: NavController, locale: String) {
    val active by repository.activeShift.collectAsState()
    val history by repository.shiftsHistory.collectAsState()
    Column(modifier = Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp)) {
        BackButton({ nav.popBackStack() }, locale)
        Spacer(Modifier.height(8.dp))
        ScreenTitle(t(locale, "myShifts.title"))
        Spacer(Modifier.height(16.dp))

        Text("Active shift", style = MaterialTheme.typography.titleMedium, color = BentoTextPrimary)
        Spacer(Modifier.height(8.dp))
        if (active != null) {
            SectionCard {
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                    Text(active!!.vehicleId ?: "Vehicle", style = MaterialTheme.typography.titleMedium, color = BentoTextPrimary)
                    StatusChip(active!!.state.name, if (active!!.state == ShiftState.OPEN) StatusSafe else StatusWarning)
                }
                Spacer(Modifier.height(6.dp))
                Text("Start odometer: ${active!!.startOdometerKm ?: "—"} km", style = MaterialTheme.typography.bodyMedium, color = BentoTextSecondary)
                Text("Clock-in: ${active!!.clockInAt ?: "—"}", style = MaterialTheme.typography.bodyMedium, color = BentoTextSecondary)
            }
        } else {
            Text(t(locale, "home.noActiveShift"), color = BentoTextSecondary)
        }

        Spacer(Modifier.height(16.dp))
        Text("Shift history", style = MaterialTheme.typography.titleMedium, color = BentoTextPrimary)
        Spacer(Modifier.height(8.dp))
        if (history.isEmpty()) {
            Text("No past shifts yet.", color = BentoTextSecondary)
        } else {
            history.forEach { s ->
                SectionCard(modifier = Modifier.fillMaxWidth().padding(bottom = 8.dp)) {
                    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                        Text(s.vehicleId ?: "Vehicle", style = MaterialTheme.typography.bodyLarge, color = BentoTextPrimary)
                        StatusChip(s.state.name, if (s.state == ShiftState.OPEN) StatusSafe else StatusWarning)
                    }
                    Text("Odometer: ${s.startOdometerKm ?: "—"} → ${s.endOdometerKm ?: "—"} km", style = MaterialTheme.typography.bodyMedium, color = BentoTextSecondary)
                }
            }
        }
    }
}
