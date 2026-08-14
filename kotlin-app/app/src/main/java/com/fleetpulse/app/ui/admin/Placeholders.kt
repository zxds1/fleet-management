package com.fleetpulse.app.ui.admin

import androidx.compose.foundation.layout.*
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.navigation.NavController
import com.fleetpulse.app.data.repo.FleetRepository
import com.fleetpulse.app.data.VehicleDisplayState
import com.fleetpulse.app.ui.components.EmptyState
import com.fleetpulse.app.ui.theme.*

@Composable
fun AnalyticsReportScreen(repository: FleetRepository, locale: String, nav: NavController) {
    val vehicles by repository.vehicles.collectAsState()
    val accidents by repository.accidentReports.collectAsState()
    val purchases by repository.refuelPurchases.collectAsState()
    val dash by repository.adminDashboard.collectAsState()

    LaunchedEffect(Unit) { repository.loadAdminDashboard() }

    val active = dash?.activeFleet ?: vehicles.count { it.displayState == VehicleDisplayState.MOVING || it.displayState == VehicleDisplayState.IDLING }
    val quarantined = vehicles.count { it.displayState == VehicleDisplayState.QUARANTINED }
    val openAccidents = dash?.openAccidents ?: accidents.count { it.status.name != "RESOLVED" && it.status.name != "CLOSED" }
    val pendingFuel = purchases.count { it.approvalStatus.name == "PENDING" }
    val expiringDocs = dash?.expiringDocs ?: 0
    val fuelSpend30d = dash?.fuelSpend30d ?: 0.0

    Column(Modifier.fillMaxSize().padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Text("Analytics", style = MaterialTheme.typography.titleLarge, color = BentoTextPrimary)
        Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            KpiCard("Active", active.toString(), Icons.Filled.DirectionsCar, StatusSafe, Modifier.weight(1f))
            KpiCard("Quarantined", quarantined.toString(), Icons.Filled.Lock, StatusDanger, Modifier.weight(1f))
        }
        Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            KpiCard("Open Accidents", openAccidents.toString(), Icons.Filled.Warning, StatusWarning, Modifier.weight(1f))
            KpiCard("Pending Fuel", pendingFuel.toString(), Icons.Filled.LocalGasStation, BentoBluePrimary, Modifier.weight(1f))
        }
        Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            KpiCard("Expiring Docs", expiringDocs.toString(), Icons.Filled.Description, StatusWarning, Modifier.weight(1f))
            KpiCard("Fuel Spend (30d)", "Ksh ${"%,.0f".format(fuelSpend30d)}", Icons.Filled.AttachMoney, BentoBluePrimary, Modifier.weight(1f))
        }
        Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            KpiCard("Vehicles", vehicles.size.toString(), Icons.Filled.DirectionsCar, StatusInfo, Modifier.weight(1f))
            KpiCard("Accidents", accidents.size.toString(), Icons.Filled.BugReport, StatusInfo, Modifier.weight(1f))
        }
        KpiCard("Refuel Purchases", purchases.size.toString(), Icons.Filled.LocalGasStation, StatusSafe, Modifier.fillMaxWidth())
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
