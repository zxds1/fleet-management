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
import com.fleetpulse.app.data.repo.FleetRepository
import com.fleetpulse.app.ui.components.StatusChip
import com.fleetpulse.app.ui.theme.*

@Composable
fun AdminVehicleDetailScreen(repository: FleetRepository, locale: String, id: String, nav: NavController) {
    val vehicles by repository.vehicles.collectAsState()
    val issues by repository.vehicleIssues.collectAsState()
    val vehicle = vehicles.firstOrNull { it.id == id }
    LaunchedEffect(Unit) { if (vehicle != null) repository.loadVehicleIssues() }
    if (vehicle == null) {
        Box(Modifier.fillMaxSize().padding(32.dp), contentAlignment = Alignment.Center) { Text("Vehicle not found", color = BentoTextSecondary) }
        return
    }
    val (label, color) = stateColorChip(vehicle.displayState)
    Column(Modifier.fillMaxSize().padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Text(vehicle.plateNumber, style = MaterialTheme.typography.titleLarge, color = BentoTextPrimary)
        StatusChip(text = label, color = color)
        AdminRowCard(title = "Model", subtitle = vehicle.model.ifEmpty { "—" })
        AdminRowCard(title = "Odometer", subtitle = "${vehicle.odometerKm} km")
        AdminRowCard(title = "Fuel level", subtitle = vehicle.fuelLevelPct?.let { "$it%" } ?: "—")
        AdminRowCard(title = "Driver", subtitle = vehicle.currentDriverName ?: "—")
        AdminRowCard(title = "Location", subtitle = vehicle.locationName ?: vehicle.lat?.let { "${"%.3f".format(it)}, ${vehicle.lng?.let { l -> "%.3f".format(l) }}" } ?: "—")
        AdminRowCard(title = "Speed", subtitle = vehicle.speedKph?.let { "${it.toInt()} km/h" } ?: "—")
        val vIssues = issues.filter { it.vehicleId == vehicle.id }
        if (vIssues.isNotEmpty()) {
            Text("Open issues", style = MaterialTheme.typography.titleMedium, color = BentoTextPrimary)
            vIssues.forEach { AdminRowCard(title = it.category, subtitle = it.description) }
        }
    }
}
