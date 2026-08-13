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
import com.fleetpulse.app.ui.theme.*

@Composable
fun DashboardScreen(repository: FleetRepository, locale: String, nav: NavController) {
    val vehicles by repository.vehicles.collectAsState()
    val accidents by repository.accidentReports.collectAsState()
    val purchases by repository.refuelPurchases.collectAsState()
    val anomalies by repository.anomalies.collectAsState()
    val notifications by repository.notifications.collectAsState()
    val principal by repository.principal.collectAsState()
    val dash by repository.adminDashboard.collectAsState()

    LaunchedEffect(Unit) { repository.loadAdminDashboard() }

    // Prefer the authoritative admin analytics roll-up when available; fall back to locally
    // derived counts (best-effort from cached state) until the /analytics/company call returns.
    val active = dash?.activeFleet ?: vehicles.count { it.displayState == VehicleDisplayState.MOVING || it.displayState == VehicleDisplayState.IDLING }
    val quarantined = vehicles.count { it.displayState == VehicleDisplayState.QUARANTINED }
    val openAccidents = dash?.openAccidents ?: accidents.count { it.status.name != "RESOLVED" && it.status.name != "CLOSED" }
    val pendingFuel = purchases.count { it.approvalStatus.name == "PENDING" }
    val openAnomalies = dash?.anomaliesOpen ?: anomalies.count { it.severity != com.fleetpulse.app.data.AnomalySeverity.INFO }
    val expiringDocs = dash?.expiringDocs ?: 0
    val fuelSpend30d = dash?.fuelSpend30d ?: 0.0

    Column(Modifier.fillMaxSize().padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Text("Welcome, ${principal?.email?.substringBefore("@") ?: "Admin"}", style = MaterialTheme.typography.titleLarge, color = BentoTextPrimary)
        Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            KpiCard("Active", active.toString(), Icons.Filled.DirectionsCar, StatusSafe, Modifier.weight(1f), "kpi_active")
            KpiCard("Quarantined", quarantined.toString(), Icons.Filled.Lock, StatusDanger, Modifier.weight(1f), "kpi_quarantined")
        }
        Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            KpiCard("Open Accidents", openAccidents.toString(), Icons.Filled.Warning, StatusWarning, Modifier.weight(1f), "kpi_accidents")
            KpiCard("Pending Fuel", pendingFuel.toString(), Icons.Filled.LocalGasStation, BentoPurplePrimary, Modifier.weight(1f), "kpi_fuel")
        }
        Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            KpiCard("Expiring Docs", expiringDocs.toString(), Icons.Filled.Description, StatusWarning, Modifier.weight(1f), "kpi_docs")
            KpiCard("Fuel Spend (30d)", "Ksh ${"%,.0f".format(fuelSpend30d)}", Icons.Filled.AttachMoney, BentoPurplePrimary, Modifier.weight(1f), "kpi_fuel_spend")
        }
        KpiCard("Anomalies", openAnomalies.toString(), Icons.Filled.BugReport, StatusInfo, Modifier.fillMaxWidth(), "kpi_anomalies")

        Text("Quick links", style = MaterialTheme.typography.titleMedium, color = BentoTextPrimary)
        val links = listOf(
            Triple("Live Map", Icons.Filled.Map) { nav.navigate("live_map") },
            Triple("Accident Console", Icons.Filled.Warning) { nav.navigate("accidents_console") },
            Triple("DVIR Review", Icons.Filled.Checklist) { nav.navigate("dvir_review") },
            Triple("Fuel Reconcile", Icons.Filled.LocalGasStation) { nav.navigate("fuel_reconcile") },
            Triple("Drivers", Icons.Filled.People) { nav.navigate("drivers") },
            Triple("Expiring Docs", Icons.Filled.Description) { nav.navigate("expiring_docs") },
            Triple("Notifications", Icons.Filled.Notifications) { nav.navigate("notifications") },
            Triple("Profile", Icons.Filled.Person) { nav.navigate("profile") },
        )
        links.forEach { (label, icon, action) ->
            AdminRowCard(title = label, onClick = action, modifier = Modifier.fillMaxWidth())
        }
    }
}
