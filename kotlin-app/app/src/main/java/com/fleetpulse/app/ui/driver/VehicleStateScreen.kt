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
fun VehicleStateScreen(repository: FleetRepository, nav: NavController, locale: String) {
    val vehicles by repository.vehicles.collectAsState()
    val principal by repository.principal.collectAsState()
    val shift by repository.activeShift.collectAsState()
    val assigned = shift?.vehicleId?.let { id -> vehicles.firstOrNull { it.id == id } }
        ?: vehicles.firstOrNull { it.currentDriverName == principal?.email || it.currentDriverName == principal?.phone }
        ?: vehicles.firstOrNull()

    Column(modifier = Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp)) {
        BackButton({ nav.popBackStack() }, locale)
        Spacer(Modifier.height(8.dp))
        ScreenTitle(t(locale, "vehicle.title"))
        Spacer(Modifier.height(16.dp))

        if (assigned == null) {
            SectionCard {
                Text("No vehicle assigned", style = MaterialTheme.typography.titleMedium, color = BentoTextPrimary)
                Spacer(Modifier.height(6.dp))
                Text("Vehicle state will appear here once dispatch assigns you one.", color = BentoTextSecondary)
            }
            return
        }

        val v = assigned
        SectionCard {
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
                Column {
                    Text("Plate", style = MaterialTheme.typography.bodySmall, color = BentoTextSecondary)
                    Text(v.plateNumber, style = MaterialTheme.typography.titleMedium, color = BentoTextPrimary)
                }
                StatusChip(v.displayState.name, displayStateColor(v.displayState))
            }
            Spacer(Modifier.height(8.dp))
            if (v.lat != null && v.lng != null) {
                Text("Position: ${"%.4f".format(v.lat)}, ${"%.4f".format(v.lng)}", style = MaterialTheme.typography.bodyMedium, color = BentoTextSecondary)
            } else {
                Text("Position: unavailable", style = MaterialTheme.typography.bodyMedium, color = BentoTextSecondary)
            }
            if (v.speedKph != null) Text("Speed: ${v.speedKph} kph", style = MaterialTheme.typography.bodyMedium, color = BentoTextSecondary)
        }

        Spacer(Modifier.height(12.dp))
        SectionCard {
            Text("Fuel level", style = MaterialTheme.typography.bodyMedium, color = BentoTextSecondary)
            Spacer(Modifier.height(4.dp))
            LinearProgressIndicator(progress = (v.fuelLevelPct ?: 0) / 100f, modifier = Modifier.fillMaxWidth(), color = StatusSafe)
            Spacer(Modifier.height(6.dp))
            Text("${v.fuelLevelPct ?: "—"}%  •  Odometer ${v.odometerKm} km", style = MaterialTheme.typography.bodyMedium, color = BentoTextPrimary)
        }

        Spacer(Modifier.height(12.dp))
        Row(Modifier.fillMaxWidth()) {
            Button(onClick = { nav.navigate("vehicle_issue") }, modifier = Modifier.weight(1f).height(48.dp), colors = ButtonDefaults.buttonColors(containerColor = BentoCardBg, contentColor = BentoTextPrimary)) {
                Text("Report issue")
            }
            Spacer(Modifier.width(8.dp))
            Button(onClick = { nav.navigate("vehicle_map") }, modifier = Modifier.weight(1f).height(48.dp), colors = ButtonDefaults.buttonColors(containerColor = BentoBluePrimary)) {
                Text("Map")
            }
        }
    }
}
