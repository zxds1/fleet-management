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
import com.fleetpulse.app.ui.components.EmptyState
import com.fleetpulse.app.ui.theme.*

@Composable
private fun Placeholder(route: String, repository: FleetRepository, locale: String, nav: NavController, icon: androidx.compose.ui.graphics.vector.ImageVector, title: String, note: String) {
    Column(Modifier.fillMaxSize()) {
        Box(Modifier.weight(1f)) { EmptyState(icon = icon, title = title, message = note) }
    }
}

@Composable
fun GeofenceZonesScreen(repository: FleetRepository, locale: String, nav: NavController) {
    Placeholder("geofence", repository, locale, nav, Icons.Filled.Map, "Geofence Zones", "Geofence definitions are managed in the backend. No local data yet.")
}

@Composable
fun DispatchWaypointsScreen(repository: FleetRepository, locale: String, nav: NavController) {
    Placeholder("dispatch", repository, locale, nav, Icons.Filled.Route, "Dispatch Waypoints", "Dispatch waypoints come from the backend dispatch service.")
}

@Composable
fun AnalyticsReportScreen(repository: FleetRepository, locale: String, nav: NavController) {
    val vehicles by repository.vehicles.collectAsState()
    val purchases by repository.refuelPurchases.collectAsState()
    val accidents by repository.accidentReports.collectAsState()
    Column(Modifier.fillMaxSize().padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Text("Analytics", style = MaterialTheme.typography.titleLarge, color = BentoTextPrimary)
        Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            KpiCard("Vehicles", vehicles.size.toString(), Icons.Filled.DirectionsCar, StatusSafe, Modifier.weight(1f))
            KpiCard("Fuel spend", purchases.sumOf { it.amountSpent ?: 0.0 }.let { "%.0f".format(it) }, Icons.Filled.LocalGasStation, BentoPurplePrimary, Modifier.weight(1f))
        }
        KpiCard("Accidents", accidents.size.toString(), Icons.Filled.Warning, StatusWarning, Modifier.fillMaxWidth())
        Text("Detailed analytics reports are served by the backend.", style = MaterialTheme.typography.bodySmall, color = BentoTextSecondary)
    }
}

@Composable
fun MaintenanceScheduleScreen(repository: FleetRepository, locale: String, nav: NavController) {
    val records by repository.maintenanceRecords.collectAsState()
    LaunchedEffect(Unit) { repository.loadMaintenance() }
    Column(Modifier.fillMaxSize()) {
        if (records.isEmpty()) { Box(Modifier.fillMaxSize()) { EmptyState(icon = Icons.Filled.Build, title = "No maintenance", message = "Completed work orders from the backend appear here.") }; return@Column }
        AdminListScaffold(locale, Icons.Filled.Build, "No maintenance", "", isEmpty = false) {
            items(records, key = { it.id }) {
                AdminRowCard(
                    title = "${it.assetKind.lowercase()} ${it.assetId ?: "—"} · ${it.taskCode}",
                    subtitle = "${it.vendor ?: "—"}${it.cost?.let { c -> " · ${"%,.0f".format(c)} ${it.currency ?: ""}" } ?: ""}",
                )
            }
        }
    }
}
