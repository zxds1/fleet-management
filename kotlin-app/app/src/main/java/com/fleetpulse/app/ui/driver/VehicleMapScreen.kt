package com.fleetpulse.app.ui.driver

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
import com.fleetpulse.app.ui.components.EmptyState
import com.fleetpulse.app.ui.components.FullScreenVehicleMap
import com.fleetpulse.app.ui.components.StatusChip
import com.fleetpulse.app.ui.theme.*

@Composable
fun VehicleMapScreen(repository: FleetRepository, nav: NavController, locale: String) {
    val vehicles by repository.vehicles.collectAsState()
    val principal by repository.principal.collectAsState()
    val shift by repository.activeShift.collectAsState()
    val assigned = shift?.vehicleId?.let { id -> vehicles.firstOrNull { it.id == id } }
        ?: vehicles.firstOrNull { it.currentDriverName == principal?.email || it.currentDriverName == principal?.phone }
        ?: vehicles.firstOrNull()

    Scaffold(
        topBar = {
            Surface(color = BentoBackground, modifier = Modifier.fillMaxWidth()) {
                Row(
                    modifier = Modifier.fillMaxWidth().padding(horizontal = 8.dp, vertical = 8.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    IconButton(onClick = { nav.popBackStack() }) { Icon(Icons.Filled.ArrowBack, contentDescription = "Back", tint = BentoTextPrimary) }
                    Spacer(Modifier.width(8.dp))
                    Text(t(locale, "vehicle.mapTitle"), style = MaterialTheme.typography.titleMedium, color = BentoTextPrimary)
                }
            }
        },
    ) { inner ->
        Box(Modifier.fillMaxSize().padding(inner)) {
            if (assigned == null) {
                EmptyState(icon = Icons.Filled.Map, title = "No vehicle", message = "Your assigned vehicle's position will appear here.")
                return@Box
            }
            if (assigned.lat == null || assigned.lng == null) {
                EmptyState(icon = Icons.Filled.LocationOff, title = "Position unavailable", message = "No live coordinates for ${assigned.plateNumber} yet.")
                return@Box
            }
            FullScreenVehicleMap(
                vehicles = listOf(assigned),
                onVehicleClick = {},
            )
            Surface(
                color = BentoCardBg.copy(alpha = 0.92f),
                shape = RoundedCornerShape(16.dp),
                border = BorderStroke(1.dp, BentoBorder),
                modifier = Modifier.align(Alignment.BottomCenter).padding(16.dp),
            ) {
                Row(Modifier.padding(16.dp), verticalAlignment = Alignment.CenterVertically) {
                    Column(Modifier.weight(1f)) {
                        Text(assigned.plateNumber, style = MaterialTheme.typography.titleMedium, color = BentoTextPrimary)
                        assigned.currentDriverName?.let { Text(it, style = MaterialTheme.typography.bodySmall, color = BentoTextSecondary) }
                    }
                    StatusChip(assigned.displayState.name, displayStateColor(assigned.displayState))
                }
            }
        }
    }
}
